// Durable originals plus additive person countersigns; no live corpus or browser.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { hash, json } from "./support.mjs";
import { strictJsonBytes } from "./repin-io.mjs";
import { signOffs } from "./repin-signoff.mjs";
import { crossCheckReceipt } from "./repin-record-crosscheck.mjs";
import { payloadBytes, recordBudget } from "./repin-record-policy.mjs";
import { verifyCrops } from "./repin-record-crops.mjs";
const digest = (s) => /^[a-f0-9]{64}$/.test(s ?? "");
const local = (p) =>
  typeof p === "string" &&
  /^[a-zA-Z0-9_.\/-]+$/.test(p) &&
  !p.startsWith("/") &&
  p.split("/").every((s) => s && s !== "." && s !== "..");
export function deterministicReceipt(bytes) {
  const zipped = gzipSync(bytes, { level: 9 });
  zipped.fill(0, 4, 8);
  zipped[9] = 255;
  return zipped;
}
function signedContent(record, bytes) {
  const signed = strictJsonBytes(bytes);
  assert(Array.isArray(signed.entries), "Recorded decisions need entries");
  signed.entries.forEach(signOffs);
  if (record.countersignMode === "canonical") {
    assert(
      Buffer.from(json(signed)).equals(bytes),
      "Countersigned decisions must stay canonical",
    );
    for (const e of signed.entries) {
      if (e.counterSignOffs !== undefined)
        assert(e.counterSignOffs.length > 0, "Empty countersign addition");
      delete e.counterSignOffs;
    }
    assert(
      hash(json(signed)) === record.signedDecisionsSha256,
      "Immutable canonical signed content changed",
    );
    return Buffer.from(json(signed));
  }
  assert(record.countersignMode === "sidecar", "Unknown countersign mode");
  assert(
    hash(bytes) === record.signedDecisionsSha256,
    "Immutable signed bytes changed",
  );
  return bytes;
}
function sidecar(record, bytes, entries) {
  if (!bytes) return;
  assert(
    record.countersignMode === "sidecar",
    "Canonical record cannot have a countersign sidecar",
  );
  const extra = strictJsonBytes(bytes);
  assert(
    Object.keys(extra).sort().join() === "entries,format,signedDecisionsSha256",
    "Invalid countersignatures document",
  );
  assert(
    extra.format === "thermite-draw-countersignatures/1.0",
    "Unknown countersignatures format",
  );
  assert(
    extra.signedDecisionsSha256 === record.signedDecisionsSha256,
    "Countersignatures signed hash mismatch",
  );
  assert(
    Array.isArray(extra.entries) && extra.entries.length,
    "List person countersigns",
  );
  const used = new Set(
    entries.flatMap((e, entryIndex) =>
      signOffs(e)
        .filter((s) => s.kind === "person")
        .map((s) => json([entryIndex, s.by])),
    ),
  );
  for (const e of extra.entries) {
    assert(
      Object.keys(e).sort().join() === "by,entryIndex,kind",
      "Only countersign fields may be added",
    );
    assert(
      Number.isInteger(e.entryIndex) &&
        e.entryIndex >= 0 &&
        e.entryIndex < entries.length,
      "Unknown countersigned entry",
    );
    assert(e.kind === "person", "Countersign must be person");
    assert(
      typeof e.by === "string" && e.by.trim(),
      "Countersign by must be non-empty",
    );
    const key = json([e.entryIndex, e.by]);
    assert(!used.has(key), "Duplicate person countersign");
    used.add(key);
  }
}
function cropBindings(record, files, signed) {
  const bytes = payloadBytes(record, record.cropIndex, files);
  assert(hash(bytes) === record.cropIndexSha256, "Crop index hash mismatch");
  return verifyCrops(record, files, signed, strictJsonBytes(bytes));
}

function boundFiles(record, files) {
  assert(
    record.files && typeof record.files === "object",
    "File manifest required",
  );
  for (const [path, sha] of Object.entries(record.files)) {
    assert(
      local(path) &&
        path !== "record.json" &&
        path !== "countersignatures.json" &&
        digest(sha),
      "Invalid original file manifest",
    );
    if (path !== record.signedDecisions || path.endsWith(".gz")) {
      const bytes = files.get(path);
      assert(
        bytes && hash(bytes) === sha,
        "Original file hash mismatch: " + path,
      );
    }
  }
  for (const path of files.keys())
    assert(
      path === "record.json" ||
        path === "countersignatures.json" ||
        Object.hasOwn(record.files, path),
      "Unlisted record file: " + path,
    );
  assert(
    record.signedDecisions.endsWith(".gz")
      ? digest(record.files[record.signedDecisions])
      : record.files[record.signedDecisions] === record.signedDecisionsSha256,
    "Signed manifest binding mismatch",
  );
  assert(
    record.cropIndex.endsWith(".gz")
      ? digest(record.files[record.cropIndex])
      : record.files[record.cropIndex] === record.cropIndexSha256,
    "Index manifest binding mismatch",
  );
  assert(digest(record.files[record.receipt]), "Receipt missing from manifest");
}
export function verifyRecord(record, files, { pin } = {}) {
  assert(
    record.format === "thermite-draw-repin-record/1.0",
    "Unknown record format",
  );
  assert(
    Number.isSafeInteger(record.pr) &&
      record.pr > 0 &&
      /^[a-f0-9]{40}$/.test(record.baseCommit),
    "Record PR/base required",
  );
  for (const p of [record.signedDecisions, record.receipt, record.cropIndex])
    assert(local(p) && files.has(p), "Missing record input");
  for (const h of [
    record.signedDecisionsSha256,
    record.receiptSha256,
    record.cropIndexSha256,
    record.registryBeforeSha256,
    record.registryAfterSha256,
  ])
    assert(digest(h), "Invalid record hash");
  assert(
    !record.signedDecisions.endsWith(".gz") ||
      record.countersignMode === "sidecar",
    "Gzipped signed decisions require sidecar countersigns",
  );
  const original = signedContent(
    record,
    payloadBytes(record, record.signedDecisions, files),
  );
  boundFiles(record, files);
  const compressed = files.get(record.receipt),
    bytes = gunzipSync(compressed);
  assert(
    compressed[3] === 0 && compressed.readUInt32LE(4) === 0,
    "Receipt gzip must have deterministic metadata",
  );
  assert(
    hash(bytes) === record.receiptSha256,
    "Historical receipt hash mismatch",
  );
  const receipt = strictJsonBytes(bytes),
    signed = strictJsonBytes(original);
  assert(
    receipt.format === "thermite-draw-repin-receipt/1.0",
    "Unknown receipt format",
  );
  assert(
    receipt.registryBeforeSha256 === record.registryBeforeSha256 &&
      receipt.registryAfterSha256 === record.registryAfterSha256,
    "Registry receipt binding mismatch",
  );
  assert(
    signed.pr === "#" + record.pr &&
      receipt.decisions.length === signed.entries.length,
    "Decision record PR/count mismatch",
  );
  assert(
    signed.entries.length > 0 ||
      record.registryBeforeSha256 === record.registryAfterSha256,
    "Empty decisions cannot change the registry",
  );
  crossCheckReceipt(signed, receipt);
  sidecar(record, files.get("countersignatures.json"), signed.entries);
  const drawingGroups = cropBindings(record, files, signed);
  assert(!pin || pin.pr === record.pr, "Record size pin belongs to another PR");
  assert(
    [...files.values()].reduce((n, b) => n + b.length, 0) <= recordBudget(pin),
    "Record exceeds reviewed size cap",
  );
  return {
    entries: signed.entries.length,
    crops: Object.keys(record.pathMap).length,
    drawingGroups,
    countersignMode: record.countersignMode,
  };
}
export async function readRecord(directory, options) {
  const files = new Map();
  const walk = async (path, prefix = "") => {
    for (const e of await readdir(path, { withFileTypes: true })) {
      assert(!e.isSymbolicLink(), "Record symlinks are refused");
      if (e.isDirectory())
        await walk(join(path, e.name), prefix + e.name + "/");
      else files.set(prefix + e.name, await readFile(join(path, e.name)));
    }
  };
  await walk(directory);
  const record = strictJsonBytes(files.get("record.json"));
  return { record, files, ...verifyRecord(record, files, options) };
}
