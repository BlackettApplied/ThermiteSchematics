// File guards and atomic writes; no browser, native PDF or live-corpus reads.
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  realpath,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { resolve, dirname, relative, join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { hash, json } from "./support.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
import { prepareRepin, reviewInventory } from "./repin-core.mjs";
import { readCheckers, checkerManifestHash } from "./checker-manifest.mjs";
import { draftDecisions } from "./repin-draft.mjs";
import {
  drawingReferences,
  checkCropDrawing,
} from "./repin-drawing-bindings.mjs";
import { legacyRecord } from "./repin-record-policy.mjs";
export function strictJsonBytes(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    value = JSON.parse(text),
    stack = [];
  // Native parsing validates grammar; this bounded-stack scan catches duplicate
  // decoded keys without constructing a second AST for 20 MB measurement reports.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[")
      stack.push({ object: ch === "{", keys: new Set(), key: true });
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && stack.at(-1)?.object) stack.at(-1).key = true;
    else if (ch === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === '"') break;
      }
      const top = stack.at(-1);
      if (top?.object && top.key) {
        const key = JSON.parse(text.slice(start, i + 1));
        assert(!top.keys.has(key), "Duplicate JSON key: " + key);
        top.keys.add(key);
        top.key = false;
      }
    }
  }
  return value;
}
export async function strictJsonFile(path) {
  const bytes = await readFile(path);
  return { value: strictJsonBytes(bytes), sha256: hash(bytes) };
}

export async function within(path, base, { existing = false } = {}) {
  const root = await realpath(base),
    target = existing
      ? await realpath(path)
      : join(
          await realpath(dirname(path)),
          resolve(path).split(/[\\/]/).at(-1),
        );
  const rel = relative(root, target);
  assert(
    rel && !rel.startsWith("..") && !isAbsolute(rel),
    `Path must stay under ${base}`,
  );
  return target;
}
export async function readReviewedCrop(root, crop) {
  assert(
    crop &&
      typeof crop.path === "string" &&
      crop.path.trim() &&
      /^[a-f0-9]{64}$/.test(crop.sha256 ?? ""),
    "Crop required: supply a non-empty file path and SHA-256",
  );
  assert(
    crop && typeof crop.path === "string" && !isAbsolute(crop.path),
    "Crop path must be relative to the workspace",
  );
  await within(resolve(root, "evals/out/draw-samples"), root, {
    existing: true,
  });
  const path = await within(
    resolve(root, crop.path),
    resolve(root, "evals/out/draw-samples"),
    { existing: true },
  );
  const bytes = await readFile(path);
  assert(bytes.length > 0, "Crop required: the supplied file is empty");
  assert(
    bytes.length > 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "Reviewed crop must be a retained PNG",
  );
  assert(hash(bytes) === crop.sha256, "Reviewed crop hash mismatch");
  return bytes;
}
export async function reviewedCrop(root, crop) {
  return hash(await readReviewedCrop(root, crop));
}
async function loadCrops(root, file, cropHashes) {
  const legacy = file.value.pr === "#92" && legacyRecord(92, file.sha256);
  for (const { entry, crop } of drawingReferences(file.value)) {
    const bytes = await readReviewedCrop(root, crop);
    if (!legacy) checkCropDrawing(entry, crop, bytes);
    cropHashes.set(crop.path, hash(bytes));
  }
}
export async function loadRepinInputs({
  root,
  reportPath,
  decisionPaths = [],
  baselinePaths = [],
  registryPath = resolve(root, "evals/draw/expectations.mjs"),
  specs,
  registry,
}) {
  const raw = await readFile(registryPath),
    registrySha256 = hash(raw);
  registry ??= (
    await import(pathToFileURL(registryPath).href + "?sha=" + registrySha256)
  ).expectations;
  const report = await strictJsonFile(reportPath),
    decisions = [],
    baselines = new Map(),
    cropHashes = new Map();
  for (const path of baselinePaths) {
    const file = await strictJsonFile(path);
    assert(!baselines.has(file.sha256), "Duplicate baseline file");
    baselines.set(file.sha256, file.value);
  }
  for (const path of decisionPaths) {
    const file = await strictJsonFile(path);
    decisions.push(file.value);
    await loadCrops(root, file, cropHashes);
  }
  return {
    report: report.value,
    reportSha256: report.sha256,
    registry,
    registrySha256,
    checkerSha256: checkerManifestHash(
      await readCheckers(resolve(root, "evals/draw")),
    ),
    decisions,
    baselines,
    cropHashes,
    specs,
    registryPath,
  };
}
export async function executeRepin({
  root,
  inputs,
  previewPath,
  apply = false,
  beforeCommit,
}) {
  assert(previewPath, "Supply --preview under evals/out");
  await within(resolve(root, "evals/out"), root, { existing: true });
  const output = await within(
    resolve(previewPath),
    resolve(root, "evals/out"),
    { existing: apply },
  );
  const prepared = prepareRepin(inputs),
    text = serializeRegistry(prepared.registry);
  const receipt = {
    format: "thermite-draw-repin-receipt/1.0",
    summarySha256: inputs.reportSha256,
    registryBeforeSha256: inputs.registrySha256,
    checkerSha256: inputs.checkerSha256,
    registryAfterSha256: hash(text),
    decisions: prepared.receipts,
    expected: prepared.expected,
  };
  if (!apply) {
    await writeFile(output, text, { flag: "wx" });
    return { text, receipt };
  }
  assert(
    (await readFile(output, "utf8")) === text,
    "Preview differs from computed reviewed delta",
  );
  const target =
      inputs.registryPath ?? resolve(root, "evals/draw/expectations.mjs"),
    lock = target + ".repin.lock";
  const canonicalTarget = join(
    await realpath(root),
    "evals/draw/expectations.mjs",
  );
  assert(
    (await within(target, root, { existing: true })) === canonicalTarget,
    "Registry target must be this workspace's canonical expectations.mjs",
  );
  const handle = await open(lock, "wx");
  let temp;
  try {
    await handle.writeFile(
      json({ registrySha256: inputs.registrySha256, pid: process.pid }),
    );
    await beforeCommit?.();
    assert(
      hash(await readFile(target)) === inputs.registrySha256,
      "Registry changed before apply",
    );
    assert(
      checkerManifestHash(await readCheckers(resolve(root, "evals/draw"))) ===
        inputs.checkerSha256,
      "Checker bundle changed before apply",
    );
    temp = target + `.repin-${process.pid}-${hash(text).slice(0, 12)}.tmp`;
    await writeFile(temp, text, { flag: "wx" });
    assert(
      hash(await readFile(target)) === inputs.registrySha256,
      "Registry changed during apply",
    );
    assert(
      checkerManifestHash(await readCheckers(resolve(root, "evals/draw"))) ===
        inputs.checkerSha256,
      "Checker bundle changed during apply",
    );
    await rename(temp, target);
    temp = undefined;
  } finally {
    if (temp) await unlink(temp).catch(() => {});
    await handle.close();
    await unlink(lock);
  }
  return { text, receipt };
}
export async function writeInventory({ root, inputs, path }) {
  await within(resolve(root, "evals/out"), root, { existing: true });
  const output = await within(resolve(path), resolve(root, "evals/out"));
  await writeFile(output, json(reviewInventory(inputs)), { flag: "wx" });
}
export async function writeDraft({
  root,
  inventoryPath,
  path,
  pr,
  baselineSha256,
  superseded,
  survivors,
}) {
  const { value: inventory } = await strictJsonFile(inventoryPath);
  await within(resolve(root, "evals/out"), root, { existing: true });
  const output = await within(resolve(path), resolve(root, "evals/out"));
  const draft = draftDecisions(inventory, {
    pr,
    baselineSha256,
    superseded,
    survivors,
  });
  await writeFile(output, json(draft), { flag: "wx" });
  return draft;
}
