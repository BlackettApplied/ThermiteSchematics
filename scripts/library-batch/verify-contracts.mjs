import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function readJobContract({ read }) {
  const value = await read("job.json");
  for (const key of [
    "id",
    "expectedTypeId",
    "expectedManufacturer",
    "expectedOrderNumber",
  ])
    assert.equal(typeof value[key], "string", `job.${key} must be a string`);
  for (const key of [
    "id",
    "expectedTypeId",
    "expectedManufacturer",
    "expectedOrderNumber",
  ])
    assert(value[key].trim(), `job.${key} must not be empty`);
  return value;
}
export async function readCandidateContract({
  read,
  readStrict,
  here,
  createAjv2020,
  json,
  same,
  job,
}) {
  const value = await read("result.json");
  const schema = (await readStrict(join(here, "candidate.schema.json"))).value;
  const validate = createAjv2020().compile(schema);
  assert(validate(value), json(validate.errors));
  assert.equal(
    value.sourcePartId,
    job.id,
    "Candidate sourcePartId does not match job identity",
  );
  same(
    value.sources.map((source) => source.id),
    new Set(value.sources.map((source) => source.id)),
    "Duplicate source evidence IDs",
  );
  for (const source of value.sources)
    assert.equal(
      new URL(source.url).protocol,
      "https:",
      "Evidence URL must be a valid HTTPS URL",
    );
  return value;
}
export async function readResearchNote({ jobDir, snapshots, report, digest }) {
  const bytes = await readFile(join(jobDir, "research.md"));
  assert(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(),
    "Empty research.md",
  );
  snapshots.set("research.md", bytes);
  report.inputs["research.md"] = digest(bytes);
}
export async function readTypeContract({ read, same, job, result }) {
  const document = await read("type.json");
  same(Object.keys(document), ["types"], "type.json must contain only types");
  assert.equal(document.types.length, 1, "Exactly one device type is required");
  const value = document.types[0];
  assert.equal(value.kind, "device_type");
  assert.equal(value.id, job.expectedTypeId, "Type identity drift");
  assert.equal(
    value.catalog?.manufacturer,
    job.expectedManufacturer,
    "Manufacturer identity drift",
  );
  assert.equal(
    value.catalog?.orderNumber,
    job.expectedOrderNumber,
    "Order number identity drift",
  );
  assert(
    result.sources.length > 0,
    "At least one primary manufacturer source is required",
  );
  assert(result.conformance, "Candidate conformance is required");
  assert(
    ["partial", "complete"].includes(value.connectionCoverage?.status),
    "Explicit partial/complete connectionCoverage is required",
  );
  assert(
    value.connectionCoverage.notes?.trim(),
    "Connection coverage review notes are required",
  );
  checkTypeTerminals(value, result, same);
  return value;
}
function checkTypeTerminals(value, result, same) {
  const keys = Object.keys(value.terminals);
  same(
    keys,
    result.conformance.terminalKeys,
    "Terminal conformance inventory drift",
  );
  same(
    Object.entries(value.terminals)
      .filter(([, terminal]) => terminal.required === true)
      .map(([key]) => key),
    result.conformance.requiredTerminalKeys,
    "Required-terminal conformance drift",
  );
  const sourceIds = new Set(result.sources.map((source) => source.id));
  for (const link of result.conformance.fixedLinks) {
    assert(
      keys.includes(link.from) && keys.includes(link.to),
      "Fixed link refers to an unknown terminal",
    );
    assert.notEqual(
      link.from,
      link.to,
      "Fixed link must join distinct terminals",
    );
    assert(sourceIds.has(link.sourceId), "Fixed link evidence ID is unknown");
  }
  if (result.conformance.renderKind === "accessory") {
    assert.equal(keys.length, 0, "Accessory rendering requires zero terminals");
    assert.equal(
      Object.keys(value.functions).length,
      0,
      "Accessory rendering requires zero circuit functions",
    );
  }
  if (!keys.length)
    assert.notEqual(
      result.conformance.renderKind,
      "circuit",
      "Zero-terminal types require accessory or overview rendering",
    );
}
