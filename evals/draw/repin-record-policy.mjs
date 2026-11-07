import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
export const legacyRecord = (pr, sha) =>
  pr === 92 &&
  sha === "b56690d45cae4a53beef6dfe39b68221d00d00842cce36445cd6c175b7094da5";
export const TEXT_LIMIT = 256 * 1024;
export const RECORD_LIMIT = 3000000;
export function recordBudget(pin) {
  if (pin?.maxBytes === undefined) {
    assert(pin?.reason === undefined, "Unused record size exception reason");
    return RECORD_LIMIT;
  }
  assert(
    Number.isSafeInteger(pin.maxBytes) &&
      pin.maxBytes > RECORD_LIMIT &&
      typeof pin.reason === "string" &&
      pin.reason.trim(),
    "Record size exception needs an explicit larger cap and reason",
  );
  return pin.maxBytes;
}
export function payloadBytes(record, name, files) {
  const bytes = files.get(name);
  if (name.endsWith(".gz")) {
    assert(
      bytes[3] === 0 && bytes.readUInt32LE(4) === 0,
      "Text gzip must have deterministic metadata",
    );
    return gunzipSync(bytes);
  }
  const legacy = legacyRecord(record.pr, record.signedDecisionsSha256);
  assert(
    legacy || bytes.length <= TEXT_LIMIT,
    "Signed decisions and crop index over 256 KiB must be gzipped",
  );
  return bytes;
}
