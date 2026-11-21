import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
// Locate the first member's end without accepting padding or a second member.
// gunzipSync still checks gzip headers, CRC and uncompressed size afterwards.
export function requireSingleGzipMember(bytes, maxOutputLength) {
  assert(bytes.length >= 18, "Truncated gzip report");
  const flags = bytes[3];
  let offset = 10;
  if (flags & 4) {
    assert(offset + 2 <= bytes.length - 8, "Truncated gzip extra header");
    offset += 2 + bytes.readUInt16LE(offset);
  }
  for (const flag of [8, 16])
    if (flags & flag) {
      const end = bytes.indexOf(0, offset);
      assert(
        end >= offset && end < bytes.length - 8,
        "Unterminated gzip header",
      );
      offset = end + 1;
    }
  if (flags & 2) offset += 2;
  assert(offset < bytes.length - 8, "Truncated gzip header");
  const result = inflateRawSync(bytes.subarray(offset), {
    info: true,
    maxOutputLength,
  });
  assert(
    offset + result.engine.bytesWritten + 8 === bytes.length,
    "Report gzip must contain exactly one member and no trailing bytes",
  );
}
