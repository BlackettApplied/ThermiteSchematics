// A deterministic archive builder; never edits signed content or an existing record.
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { hash, json } from "./support.mjs";
import { strictJsonBytes } from "./repin-io.mjs";
import { deterministicReceipt, verifyRecord } from "./repin-record.mjs";
import { TEXT_LIMIT, legacyRecord } from "./repin-record-policy.mjs";
import { checkSignedDrawings } from "./repin-drawing-bindings.mjs";
import { groupCrops } from "./repin-record-crops.mjs";
function input(bytes) {
  assert(Buffer.isBuffer(bytes), "Record inputs must be byte buffers");
  const zipped = bytes[0] === 31 && bytes[1] === 139;
  if (zipped)
    assert(
      bytes[3] === 0 && bytes.readUInt32LE(4) === 0,
      "Input gzip metadata must be fixed",
    );
  return {
    raw: zipped ? gunzipSync(bytes) : bytes,
    compressed: zipped ? bytes : undefined,
  };
}
function textFile(name, data, legacy) {
  const zipped = !legacy && (data.raw.length > TEXT_LIMIT || data.compressed);
  const path = zipped ? (name.endsWith(".gz") ? name : name + ".gz") : name;
  return {
    path,
    bytes: zipped
      ? (data.compressed ?? deterministicReceipt(data.raw))
      : data.raw,
    zipped: !!zipped,
  };
}
export function recordFor({
  pr,
  baseCommit,
  signed,
  receipt,
  cropIndex,
  crops,
  signedName = "decisions.signed",
  receiptName = "receipt.json.gz",
  indexName = "crop-index.json",
  pin,
}) {
  const s = input(signed),
    r = input(receipt),
    i = input(cropIndex);
  const legacy = legacyRecord(pr, hash(s.raw));
  const grouped = groupCrops(strictJsonBytes(i.raw).crops, crops, legacy);
  if (!legacy)
    checkSignedDrawings(strictJsonBytes(s.raw), grouped.rows, "Writer signed");
  const indexData = legacy
    ? i
    : {
        raw: Buffer.from(
          json({
            ...strictJsonBytes(i.raw),
            format: "thermite-draw-crop-index/2.0",
            crops: grouped.rows,
          }),
        ),
      };
  const stored = textFile(signedName, s, legacy),
    index = textFile(indexName, indexData, legacy),
    receiptBytes = r.compressed ?? deterministicReceipt(r.raw);
  const files = new Map([
      [stored.path, stored.bytes],
      [receiptName, receiptBytes],
      [index.path, index.bytes],
      ...grouped.files,
    ]),
    pathMap = grouped.pathMap;
  const decoded = strictJsonBytes(s.raw),
    result = strictJsonBytes(r.raw);
  const record = {
    format: "thermite-draw-repin-record/1.0",
    pr,
    baseCommit,
    signedDecisions: stored.path,
    signedDecisionsSha256: hash(s.raw),
    countersignMode:
      !stored.zipped && Buffer.from(json(decoded)).equals(s.raw)
        ? "canonical"
        : "sidecar",
    receipt: receiptName,
    receiptSha256: hash(r.raw),
    registryBeforeSha256: result.registryBeforeSha256,
    registryAfterSha256: result.registryAfterSha256,
    cropIndex: index.path,
    cropIndexSha256: hash(indexData.raw),
    pathMap,
    files: Object.fromEntries([...files].map(([p, b]) => [p, hash(b)])),
  };
  files.set("record.json", Buffer.from(json(record)));
  verifyRecord(record, files, { pin });
  return { record, files, pin };
}
export async function writeRecord(directory, result) {
  verifyRecord(result.record, result.files, { pin: result.pin });
  assert(
    result.files.get("record.json")?.equals(Buffer.from(json(result.record))),
    "Writer manifest bytes differ from record",
  );
  await mkdir(directory); // Exclusive: preserves an existing signed record.
  try {
    for (const [path, bytes] of result.files) {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
  } catch (e) {
    await rm(directory, { recursive: true, force: true });
    throw e;
  }
}
