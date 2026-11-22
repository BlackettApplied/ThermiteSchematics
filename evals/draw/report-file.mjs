// Container encoding only. Bind source hashes to stored bytes, never reserialized JSON.
import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { hash, canonical } from "./support.mjs";
import { strictJsonBytes } from "./strict-json.mjs";
import { requireSingleGzipMember } from "./gzip-member.mjs";
export const reportFilename = (artifacts = false) =>
  artifacts ? "summary.json" : "summary.json.gz";
export function decodedReportBytes(bytes) {
  if (bytes[0] !== 31 || bytes[1] !== 139) return bytes;
  const maxOutputLength = 256 * 1024 * 1024;
  requireSingleGzipMember(bytes, maxOutputLength);
  return gunzipSync(bytes, { maxOutputLength });
}
export const parseReportBytes = (bytes) =>
  strictJsonBytes(decodedReportBytes(bytes));
export async function readReportFile(path) {
  const bytes = await readFile(path);
  return { value: parseReportBytes(bytes), sha256: hash(bytes) };
}
export async function readCheckpointReport(root) {
  try {
    return await readReportFile(join(root, "summary.json.gz"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return readReportFile(join(root, "summary.json"));
  }
}
export function encodedReportBytes(report, artifacts = false) {
  const raw = Buffer.from(JSON.stringify(canonical(report)) + "\n");
  if (artifacts) return raw;
  const packed = gzipSync(raw, { level: 6 });
  packed.writeUInt32LE(0, 4);
  packed[9] = 255;
  assert(
    raw.equals(gunzipSync(packed)),
    "Report gzip must round-trip exact canonical bytes",
  );
  return packed;
}
export async function writeReportFile(root, report, artifacts = false) {
  const name = reportFilename(artifacts),
    other = reportFilename(!artifacts);
  await writeFile(join(root, name), encodedReportBytes(report, artifacts));
  await rm(join(root, other), { force: true });
  return name;
}
