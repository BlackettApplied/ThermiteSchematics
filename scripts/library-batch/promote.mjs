import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { compileProject, lockProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { parseJson } from "@thermite/schema";
import {
  assertNetPartition,
  assertPacketCoverage,
  verifyJob,
} from "./verify.mjs";

const inputs = ["job.json", "research.md", "result.json", "type.json"];
const fixtureFiles = [
  "source.json",
  "system.json",
  "packet.request.json",
  "boundary/library.json",
  "boundary/types.json",
  "candidate/library.json",
  "candidate/type.json",
];
const copiedFiles = [
  "source.json",
  "packet.request.json",
  "boundary/library.json",
  "boundary/types.json",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const formatting = await resolveConfig(join(repository, "package.json"));
const formatted = async (bytes, filepath) =>
  Buffer.from(
    await format(new TextDecoder("utf-8", { fatal: true }).decode(bytes), {
      ...formatting,
      filepath,
    }),
  );
const sameKeys = (value, keys, message) =>
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), message);
const hash = (value) =>
  assert.match(value, /^[a-f0-9]{64}$/, "Invalid SHA-256");
const safeName = (value) =>
  assert.match(
    value,
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Unsafe component/library name",
  );

async function regularBytes(path) {
  const info = await lstat(path);
  assert(
    info.isFile() && !info.isSymbolicLink(),
    `Expected ordinary file: ${path}`,
  );
  return readFile(path);
}

function parse(bytes, path) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = parseJson(text, path);
  assert.equal(value.diagnostics.length, 0, json(value.diagnostics));
  assert.notEqual(value.value, undefined, `No JSON value: ${path}`);
  // The strict parser deliberately uses null-prototype objects. Normalize only
  // after validation so comparisons with freshly generated JSON stay exact.
  return JSON.parse(text);
}

async function readJSON(path) {
  const bytes = await regularBytes(path);
  return { bytes, value: parse(bytes, path) };
}

async function absent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Target artifact already exists: ${path}`);
}

async function directory(path, create = false) {
  if (create) {
    try {
      await mkdir(path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const info = await lstat(path);
  assert(
    info.isDirectory() && !info.isSymbolicLink(),
    `Expected ordinary directory: ${path}`,
  );
}

async function inputSnapshot(job, expected) {
  sameKeys(
    expected,
    inputs,
    "Report must hash exactly the four candidate inputs",
  );
  const bytes = {};
  for (const name of inputs) {
    hash(expected[name]);
    bytes[name] = await regularBytes(join(job, name));
    assert.equal(
      digest(bytes[name]),
      expected[name],
      `Stale input hash: ${name}`,
    );
  }
  return bytes;
}

function conformance(type, value) {
  assert(
    value && ["circuit", "accessory", "overview"].includes(value.renderKind),
    "Missing conformance",
  );
  const keys = Object.keys(type.terminals);
  assert.deepEqual(
    [...value.terminalKeys].sort(),
    [...keys].sort(),
    "Terminal conformance drift",
  );
  assert.deepEqual(
    [...value.requiredTerminalKeys].sort(),
    Object.entries(type.terminals)
      .filter(([, terminal]) => terminal.required === true)
      .map(([key]) => key)
      .sort(),
    "Required-terminal conformance drift",
  );
  for (const link of value.fixedLinks) {
    assert(
      keys.includes(link.from) &&
        keys.includes(link.to) &&
        link.from !== link.to,
      "Invalid fixed link",
    );
    assert.equal(typeof link.sourceId, "string");
  }
  if (value.renderKind === "accessory") assert.equal(keys.length, 0);
}

/** Recheck committed canonical bytes, the locked example, independent nets and rendering.
 * Does not relock or change any project files.
 */
export async function verifyPromotedExample({ example: examplePath }) {
  const example = await realpath(resolve(examplePath));
  await directory(example);
  const metadata = (await readJSON(join(example, "promotion.json"))).value;
  assert.ok(
    [
      "thermite-component-promotion/0.1",
      "thermite-component-promotion/0.2",
    ].includes(metadata.format),
    "Unsupported component promotion format",
  );
  const slug = basename(example);
  safeName(slug);
  const library = resolve(example, "../..");
  assert.equal(
    dirname(example),
    join(library, "examples"),
    "Example must be under library/examples",
  );
  await directory(join(library, "types"));
  await directory(join(library, "research"));
  assert.equal(
    metadata.type.path,
    `types/${slug}.json`,
    "Unexpected canonical type path",
  );
  assert.equal(
    metadata.research.path,
    `research/${slug}.md`,
    "Unexpected canonical research path",
  );
  const typeBytes = await regularBytes(join(library, metadata.type.path));
  const researchBytes = await regularBytes(
    join(library, metadata.research.path),
  );
  for (const [bytes, record, name] of [
    [typeBytes, metadata.type, "type"],
    [researchBytes, metadata.research, "research"],
  ]) {
    hash(record.sha256);
    assert.equal(
      digest(bytes),
      record.sha256,
      `Canonical ${name} hash changed`,
    );
  }
  if (metadata.format === "thermite-component-promotion/0.2") {
    // Public catalog records pin the distributed bytes without private batch evidence.
    assert.deepEqual(metadata.provenance, { kind: "public-catalog" });
  } else {
    sameKeys(
      metadata.provenance.inputs,
      inputs,
      "Incomplete accepted-input hashes",
    );
    for (const value of Object.values(metadata.provenance.inputs)) hash(value);
    assert.equal(metadata.type.sha256, metadata.provenance.inputs["type.json"]);
    assert.equal(
      metadata.research.sha256,
      metadata.provenance.inputs["research.md"],
    );
    assert.equal(metadata.provenance.decision, "accept");
    assert.equal(metadata.provenance.verificationStatus, "verified-candidate");
    hash(metadata.provenance.reviewSHA256);
    hash(metadata.provenance.reportSHA256);
  }
  const document = parse(typeBytes, metadata.type.path);
  assert.equal(document.types.length, 1);
  const type = document.types[0];
  assert.equal(type.id, metadata.identity.typeId);
  assert.equal(type.catalog.manufacturer, metadata.identity.manufacturer);
  assert.equal(type.catalog.orderNumber, metadata.identity.orderNumber);
  conformance(type, metadata.conformance);
  const manifest = (await readJSON(join(library, "library.json"))).value;
  assert.equal(
    type.id,
    `${manifest.name}:${slug}`,
    "Canonical library/type identity drift",
  );
  const expectedFiles = [...copiedFiles, "system.json"];
  sameKeys(
    metadata.files,
    expectedFiles,
    "Unexpected promoted fixture file inventory",
  );
  for (const name of expectedFiles) {
    hash(metadata.files[name]);
    assert.equal(
      digest(await regularBytes(join(example, name))),
      metadata.files[name],
      `Promoted fixture hash changed: ${name}`,
    );
  }
  await absent(join(example, "candidate"));
  await absent(join(example, "type.json"));
  const system = (await readJSON(join(example, "system.json"))).value;
  assert.deepEqual(
    system.sources,
    ["source.json"],
    "Unexpected project source",
  );
  const boundary = (await readJSON(join(example, "boundary/library.json")))
    .value;
  assert.deepEqual(
    system.libraries,
    [
      { name: manifest.name, version: manifest.version, path: "../.." },
      ...(metadata.conformance.terminalKeys.length
        ? [{ name: boundary.name, version: boundary.version, path: "boundary" }]
        : []),
    ],
    "Example must reference only the canonical library and synthetic boundary",
  );
  const compiled = await compileProject(example);
  assert.equal(compiled.ok, true, json(compiled.diagnostics));
  const main = compiled.ir.devices.find(
    (device) => device.designation === "D1",
  );
  assert.equal(main?.typeId, type.id, "Example uses a different main type");
  assertNetPartition(
    compiled.ir,
    metadata.conformance.terminalKeys,
    metadata.conformance.fixedLinks,
  );
  const request = (await readJSON(join(example, "packet.request.json"))).value;
  const rendered = await renderSchematicPacket(compiled.ir, request);
  assert.equal(rendered.ok, true, json(rendered.error));
  assertPacketCoverage(
    rendered.value,
    compiled.ir,
    request,
    metadata.conformance.renderKind,
  );
  return {
    status: "verified-promoted-example",
    typeId: type.id,
    diagnostics: compiled.diagnostics,
    sheets: rendered.value.sheets.length,
  };
}

/** Promote one coordinator-accepted candidate. Existing artifacts are never overwritten.
 * The review binds candidate bytes; it is an explicit record, not an authenticated signature.
 * A failure rolls back artifacts created by this call. A process crash can leave partial
 * artifacts, which a later invocation refuses instead of silently completing or replacing.
 */
export async function promoteJob({
  job: jobPath,
  report: reportPath,
  review: reviewPath,
  library: libraryPath,
}) {
  const jobDir = await realpath(resolve(jobPath));
  const library = await realpath(resolve(libraryPath));
  await directory(jobDir);
  await directory(library);
  const reported = await readJSON(resolve(reportPath));
  const accepted = await readJSON(resolve(reviewPath));
  const report = reported.value,
    review = accepted.value;
  assert.equal(
    report.status,
    "verified-candidate",
    "Only a verified-candidate report may be promoted",
  );
  assert.equal(
    review.decision,
    "accept",
    "An explicit coordinator accept review is required",
  );
  assert.equal(typeof review.notes, "string", "Review notes are required");
  assert(review.notes.trim(), "Review notes must not be empty");
  assert.deepEqual(
    review.inputs,
    report.inputs,
    "Review input hashes do not match verification report",
  );
  assert(
    report.checks?.length &&
      report.checks.every((check) => check.status === "passed"),
    "Report has failed or missing checks",
  );
  const bytes = await inputSnapshot(jobDir, report.inputs);
  for (const name of ["type.json", "research.md"])
    assert(
      bytes[name].equals(await formatted(bytes[name], name)),
      `${name} must be Prettier-stable before verification and review`,
    );
  const job = parse(bytes["job.json"], "job.json");
  const result = parse(bytes["result.json"], "result.json");
  const manifestBytes = await regularBytes(join(library, "library.json"));
  const manifest = parse(manifestBytes, "library.json");
  assert.equal(
    typeof job.typeFileName,
    "string",
    "job.typeFileName is required",
  );
  assert.match(
    job.typeFileName,
    /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/,
    "Unsafe type filename",
  );
  const slug = job.typeFileName.slice(0, -5);
  safeName(manifest.name);
  assert.equal(job.targetLibrary, manifest.name, "Job target library mismatch");
  assert.equal(
    job.expectedTypeId,
    `${manifest.name}:${slug}`,
    "Job type/filename mismatch",
  );
  const typePath = join(library, "types", job.typeFileName);
  const researchPath = join(library, "research", `${slug}.md`);
  const example = join(library, "examples", slug);
  for (const name of ["types", "research", "examples"])
    await directory(join(library, name), true);
  for (const path of [typePath, researchPath, example]) await absent(path);
  const scratch = await mkdtemp(join(tmpdir(), "thermite-component-promote-"));
  const ownedFiles = [];
  let ownsExample = false,
    ownsLock = false;
  const guard = join(library, ".library-batch-promotion.lock");
  try {
    await writeFile(guard, json({ pid: process.pid }), { flag: "wx" });
    ownsLock = true;
    // Reports currently hash only inputs. Rerunning the central verifier and
    // comparing its deterministic fixture prevents unbound output edits from
    // being copied, and also rejects fabricated/obsolete verification reports.
    const verified = await verifyJob({
      job: jobDir,
      output: join(scratch, "verified"),
    });
    assert.equal(verified.status, "verified-candidate", verified.error);
    assert.deepEqual(
      verified.inputs,
      report.inputs,
      "Candidate changed since coordinator review",
    );
    assert.equal(
      typeof report.outputs?.fixture,
      "string",
      "Report fixture is missing",
    );
    const originalFixture = resolve(
      dirname(resolve(reportPath)),
      report.outputs.fixture,
    );
    const freshFixture = verified.outputs.fixture;
    const fixtureBytes = {};
    for (const name of fixtureFiles) {
      const fresh = await regularBytes(join(freshFixture, name));
      assert(
        (await regularBytes(join(originalFixture, name))).equals(fresh),
        `Verified fixture changed: ${name}`,
      );
      fixtureBytes[name] = fresh;
    }
    // The coordinator's visual review must also correspond to the reproducible
    // generated packet, not a separately edited SVG/HTML in the report folder.
    for (const name of ["packet", "html"]) {
      assert.equal(
        typeof report.outputs[name],
        "string",
        `Report ${name} is missing`,
      );
      const original = resolve(
        dirname(resolve(reportPath)),
        report.outputs[name],
      );
      assert(
        (await regularBytes(original)).equals(
          await regularBytes(verified.outputs[name]),
        ),
        `Verified output changed: ${name}`,
      );
    }
    assert.equal(
      report.outputs.svgs?.length,
      verified.outputs.svgs.length,
      "Verified sheet inventory changed",
    );
    for (const [index, fresh] of verified.outputs.svgs.entries()) {
      const original = resolve(
        dirname(resolve(reportPath)),
        report.outputs.svgs[index],
      );
      assert(
        (await regularBytes(original)).equals(await regularBytes(fresh)),
        `Verified output changed: sheet ${index + 1}`,
      );
    }
    await inputSnapshot(jobDir, report.inputs);
    assert(
      (await regularBytes(resolve(reviewPath))).equals(accepted.bytes),
      "Review changed during promotion",
    );
    assert(
      (await regularBytes(resolve(reportPath))).equals(reported.bytes),
      "Report changed during promotion",
    );
    assert(
      (await regularBytes(join(library, "library.json"))).equals(manifestBytes),
      "Target library manifest changed during promotion",
    );
    for (const path of [typePath, researchPath, example]) await absent(path);
    for (const [path, content] of [
      [typePath, bytes["type.json"]],
      [researchPath, bytes["research.md"]],
    ]) {
      await writeFile(path, content, { flag: "wx" });
      ownedFiles.push(path);
    }
    await mkdir(example);
    ownsExample = true;
    await mkdir(join(example, "boundary"));
    for (const name of copiedFiles)
      await writeFile(
        join(example, name),
        await formatted(fixtureBytes[name], name),
        { flag: "wx" },
      );
    const system = parse(fixtureBytes["system.json"], "system.json");
    assert.equal(system.libraries[0].path, "candidate");
    system.libraries[0] = {
      name: manifest.name,
      version: manifest.version,
      path: "../..",
    };
    await writeFile(
      join(example, "system.json"),
      await formatted(Buffer.from(json(system)), "system.json"),
      { flag: "wx" },
    );
    const locked = await lockProject(example);
    assert.equal(locked.ok, true, json(locked.diagnostics));
    const lockPath = join(example, "electrical-system.lock.json");
    await writeFile(
      lockPath,
      await formatted(
        await regularBytes(lockPath),
        "electrical-system.lock.json",
      ),
    );
    const metadata = {
      format: "thermite-component-promotion/0.1",
      identity: {
        typeId: job.expectedTypeId,
        manufacturer: job.expectedManufacturer,
        orderNumber: job.expectedOrderNumber,
      },
      type: {
        path: `types/${job.typeFileName}`,
        sha256: report.inputs["type.json"],
      },
      research: {
        path: `research/${slug}.md`,
        sha256: report.inputs["research.md"],
      },
      provenance: {
        sourcePartId: job.id,
        inputs: report.inputs,
        verificationStatus: report.status,
        decision: review.decision,
        reviewSHA256: digest(accepted.bytes),
        reportSHA256: digest(reported.bytes),
      },
      conformance: {
        terminalKeys: result.conformance.terminalKeys,
        requiredTerminalKeys: result.conformance.requiredTerminalKeys,
        fixedLinks: result.conformance.fixedLinks.map(
          ({ from, to, sourceId }) => ({ from, to, sourceId }),
        ),
        renderKind: result.conformance.renderKind,
      },
      files: {},
    };
    // A later intentional library addition may relock this example. The compiler
    // checks that lock against current library bytes; accepted source hashes stay
    // stable and are not rewritten when the lock changes.
    for (const name of [...copiedFiles, "system.json"])
      metadata.files[name] = digest(await regularBytes(join(example, name)));
    await writeFile(
      join(example, "promotion.json"),
      await formatted(Buffer.from(json(metadata)), "promotion.json"),
      {
        flag: "wx",
      },
    );
    const verification = await verifyPromotedExample({ example });
    return {
      status: "promoted",
      typeId: job.expectedTypeId,
      example,
      verification,
    };
  } catch (error) {
    if (ownsExample) await rm(example, { recursive: true, force: true });
    for (const path of ownedFiles.reverse()) await rm(path, { force: true });
    throw error;
  } finally {
    if (ownsLock) await rm(guard, { force: true });
    await rm(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(
        ["job", "report", "review", "library"].map((key) => [
          key,
          { type: "string" },
        ]),
      ),
      allowPositionals: false,
    });
    for (const key of ["job", "report", "review", "library"])
      assert(values[key], `Missing --${key}`);
    console.log(json(await promoteJob(values)).trim());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
