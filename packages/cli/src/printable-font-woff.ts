import { createRequire } from "node:module";
// Pure JS compression, pinned along with fontkit: no native zlib/platform variation.
const { deflate } = createRequire(import.meta.url)("pako") as {
  deflate(bytes: Uint8Array, options: { level: number }): Uint8Array;
};
export const align = (n: number) => (n + 3) & ~3;
const checksum = (b: Buffer) => {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4)
    sum =
      (sum +
        ((b[i] ?? 0) * 0x1000000 +
          (b[i + 1] ?? 0) * 0x10000 +
          (b[i + 2] ?? 0) * 0x100 +
          (b[i + 3] ?? 0))) >>>
      0;
  return sum;
};
/** Required tables belong to the pinned bundled TrueType faces. */
export function fontTable(
  ts: ReadonlyMap<string, Buffer>,
  tag: string,
): Buffer {
  const table = ts.get(tag);
  if (!table) throw Error(`Bundled font is missing ${tag}`);
  return table;
}
function sfntDirectory(ts: Map<string, Buffer>) {
  const head = fontTable(ts, "head");
  const entries = [...ts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const n = entries.length,
    sfntSize =
      12 + n * 16 + entries.reduce((sum, [, b]) => sum + align(b.length), 0);
  const sfnt = Buffer.alloc(sfntSize);
  sfnt.writeUInt32BE(0x10000);
  sfnt.writeUInt16BE(n, 4);
  const power = 2 ** Math.floor(Math.log2(n));
  sfnt.writeUInt16BE(power * 16, 6);
  sfnt.writeUInt16BE(Math.log2(power), 8);
  sfnt.writeUInt16BE(n * 16 - power * 16, 10);
  let at = 12 + n * 16;
  entries.forEach(([tag, b], i) => {
    const p = 12 + i * 16;
    sfnt.write(tag, p, 4, "ascii");
    sfnt.writeUInt32BE(checksum(b), p + 4);
    sfnt.writeUInt32BE(at, p + 8);
    sfnt.writeUInt32BE(b.length, p + 12);
    b.copy(sfnt, at);
    at += align(b.length);
  });
  const adjustment = (0xb1b0afba - checksum(sfnt)) >>> 0;
  head.writeUInt32BE(adjustment, 8);
  return { entries, n, sfntSize, adjustment };
}
/** Deterministic SFNT checksums and WOFF transport; no platform codec. */
export function encodeWoff(ts: Map<string, Buffer>): Buffer {
  const { entries, n, sfntSize, adjustment } = sfntDirectory(ts);
  let at: number;
  const compressed = entries.map(([tag, b]) => {
    const zipped = Buffer.from(deflate(b, { level: 9 }));
    return { tag, original: b, data: zipped.length < b.length ? zipped : b };
  });
  const woff = Buffer.alloc(
    44 + n * 20 + compressed.reduce((sum, b) => sum + align(b.data.length), 0),
  );
  woff.write("wOFF");
  woff.writeUInt32BE(0x10000, 4);
  woff.writeUInt32BE(woff.length, 8);
  woff.writeUInt16BE(n, 12);
  woff.writeUInt32BE(sfntSize, 16);
  woff.writeUInt16BE(1, 20);
  at = 44 + n * 20;
  compressed.forEach(({ tag, original, data }, i) => {
    const p = 44 + i * 20;
    woff.write(tag, p, 4, "ascii");
    woff.writeUInt32BE(at, p + 4);
    woff.writeUInt32BE(data.length, p + 8);
    woff.writeUInt32BE(original.length, p + 12);
    // head checksum is calculated with checksumAdjustment zero, per OpenType.
    woff.writeUInt32BE(
      tag === "head"
        ? (checksum(original) - adjustment) >>> 0
        : checksum(original),
      p + 16,
    );
    data.copy(woff, at);
    at += align(data.length);
  });
  return woff;
}
