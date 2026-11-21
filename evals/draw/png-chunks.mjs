// Strict PNG framing for the RGB/RGBA crop decoder.
import assert from "node:assert/strict";
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (0xedb88320 & -(n & 1));
  return n >>> 0;
});
export function pngCrc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = (c >>> 8) ^ crcTable[(c ^ b) & 255];
  return (c ^ 0xffffffff) >>> 0;
}

export function pngChunks(bytes) {
  assert(
    Buffer.isBuffer(bytes) && bytes.subarray(0, 8).equals(signature),
    "Invalid PNG signature",
  );
  const out = [];
  for (let offset = 8; offset < bytes.length;) {
    assert(offset + 12 <= bytes.length, "Truncated PNG chunk");
    const size = bytes.readUInt32BE(offset),
      end = offset + 12 + size;
    assert(end <= bytes.length, "Truncated PNG data");
    assert(
      pngCrc(bytes.subarray(offset + 4, end - 4)) ===
        bytes.readUInt32BE(end - 4),
      "PNG CRC mismatch",
    );
    out.push({
      type: bytes.toString("ascii", offset + 4, offset + 8),
      data: bytes.subarray(offset + 8, end - 4),
    });
    offset = end;
  }
  return out;
}
function header(data) {
  assert(data.length === 13, "Invalid PNG IHDR");
  const width = data.readUInt32BE(0),
    height = data.readUInt32BE(4);
  assert(
    width > 0 && height > 0 && width * height <= 20000000,
    "PNG dimensions exceed crop limit",
  );
  assert(
    data[8] === 8 &&
      [2, 6].includes(data[9]) &&
      data[10] === 0 &&
      data[11] === 0 &&
      data[12] === 0,
    "Unsupported PNG: require 8-bit RGB/RGBA, no interlace",
  );
  return { width, height, channels: data[9] === 2 ? 3 : 4 };
}
export function pngData(bytes) {
  const chunks = pngChunks(bytes),
    first = chunks.shift();
  assert(first?.type === "IHDR", "PNG must start with IHDR");
  const info = header(first.data),
    parts = [];
  let ended = false,
    dataEnded = false;
  for (const { type, data } of chunks) {
    assert(!ended, "Trailing PNG chunk");
    if (type === "IDAT") {
      assert(!dataEnded, "Non-contiguous PNG IDAT");
      parts.push(data);
    } else {
      if (parts.length) dataEnded = true;
      if (type === "IEND") {
        assert(data.length === 0 && parts.length, "Invalid PNG IEND");
        ended = true;
      } else if (type === "sBIT")
        assert(
          data.length === info.channels && data.every((b) => b === 8),
          "Unsupported PNG significant bits",
        );
      else
        assert(
          ["sRGB", "pHYs", "tEXt", "iTXt", "zTXt", "tIME"].includes(type),
          "Unsupported PNG chunk: " + type,
        );
    }
  }
  assert(ended, "Missing PNG IEND");
  return { ...info, compressed: Buffer.concat(parts) };
}
