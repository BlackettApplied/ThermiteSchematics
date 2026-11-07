// Synthetic provenance/PNG data only: no project or electrical facts.
import { deflateSync } from "node:zlib";
import { hash, json } from "./support.mjs";
import { drawingHash } from "./png-ink.mjs";
import { recordFor } from "./repin-record-write.mjs";
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(kind, data) {
  const type = Buffer.from(kind),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
function png(seed) {
  const width = 64,
    height = 32,
    pixels = Buffer.alloc((width * 4 + 1) * height),
    header = Buffer.alloc(13);
  let state = seed + 1;
  for (let y = 0; y < height; y++)
    for (let x = 1; x <= width * 4; x++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels[y * (width * 4 + 1) + x] = state & 255;
    }
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export function largeRecordFixture() {
  const crops = new Map(),
    rows = [];
  for (let n = 0; n < 280; n++) {
    const path = `evals/out/draw-samples/synthetic/crop-${n}.png`,
      bytes = png(n);
    crops.set(path, bytes);
    rows.push({
      path,
      sha256: hash(bytes),
      context: "Synthetic index evidence, not reviewed project data. ".repeat(
        30,
      ),
    });
  }
  const entries = Array.from({ length: 2600 }, (_, n) => ({
    action: n < 280 ? "new-defect" : "envelope-drift",
    reviewed: true,
    classification: "drawing",
    causeClass: "synthetic-scale",
    note:
      `Synthetic archive row ${n}; not a review or approval. ` +
      "Deterministic text for archive scale verification. ".repeat(5),
    signOff: { kind: "agent", by: "Synthetic scale fixture, not approval" },
    ...(n < 280
      ? {
          crop: { path: rows[n].path, sha256: rows[n].sha256 },
          drawingSha256: drawingHash(crops.get(rows[n].path)),
        }
      : {
          markerId: `synthetic/${n}`,
          metric: "occurrences",
          from: [1, 1],
          to: [1, 2],
          observed: [1, 2],
          coverage: "full",
        }),
  }));
  const signed = Buffer.from(
    json({
      format: "thermite-draw-decisions/1.0",
      pr: "#999",
      summarySha256: hash("synthetic report"),
      checkerSha256: hash("synthetic checker"),
      registrySha256: hash("synthetic before"),
      entries,
    }),
  );
  const receipt = Buffer.from(
    json({
      format: "thermite-draw-repin-receipt/1.0",
      summarySha256: hash("synthetic report"),
      checkerSha256: hash("synthetic checker"),
      registryBeforeSha256: hash("synthetic before"),
      registryAfterSha256: hash("synthetic after"),
      decisions: entries.map((e) => ({
        ...e,
        reviewerJudged: {
          causeClass: e.causeClass,
          note: e.note,
          cause: e.cause,
          drawingSha256: e.drawingSha256,
          signOffs: [{ ...e.signOff, label: "agent review" }],
        },
      })),
    }),
  );
  const cropIndex = Buffer.from(
    json({ format: "synthetic-crop-index/1.0", crops: rows }),
  );
  return {
    result: recordFor({
      pr: 999,
      baseCommit: "9".repeat(40),
      signed,
      receipt,
      cropIndex,
      crops,
    }),
    uncompressed: {
      signed: signed.length,
      receipt: receipt.length,
      index: cropIndex.length,
    },
    entries: entries.length,
    crops: crops.size,
  };
}
