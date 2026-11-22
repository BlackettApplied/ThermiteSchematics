/** R2's shared model bounds individual glyphs, not OpenType layout features.
 * Use identical, feature-free font data for exact ink metrics, SVG and PDF.
 * Unicode fallback positioning remains Fontkit/browser behaviour; NFC is shared.
 * Outlines, cmap, hinting and every glyph advance remain original. */
export function unshapedPrintableFont(source: Uint8Array): Buffer {
  const bytes = Buffer.from(source),
    omitted = new Set(["GPOS", "GSUB", "GDEF", "kern", "kerx", "morx", "mort"]),
    entries: { tag: string; data: Buffer }[] = [];
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const p = 12 + i * 16,
      tag = bytes.toString("ascii", p, p + 4);
    if (omitted.has(tag) || tag === "DSIG") continue;
    const start = bytes.readUInt32BE(p + 8),
      size = bytes.readUInt32BE(p + 12),
      data = Buffer.from(bytes.subarray(start, start + size));
    if (tag === "head") data.writeUInt32BE(0, 8);
    entries.push({ tag, data });
  }
  entries.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const align = (n: number) => (n + 3) & ~3,
    sum = (b: Buffer) => {
      let result = 0;
      for (let i = 0; i < b.length; i += 4)
        result =
          (result +
            ((b[i] ?? 0) * 0x1000000 +
              (b[i + 1] ?? 0) * 0x10000 +
              (b[i + 2] ?? 0) * 0x100 +
              (b[i + 3] ?? 0))) >>>
          0;
      return result;
    },
    n = entries.length,
    power = 2 ** Math.floor(Math.log2(n)),
    output = Buffer.alloc(
      12 + n * 16 + entries.reduce((s, e) => s + align(e.data.length), 0),
    );
  output.writeUInt32BE(bytes.readUInt32BE(0));
  output.writeUInt16BE(n, 4);
  output.writeUInt16BE(power * 16, 6);
  output.writeUInt16BE(Math.log2(power), 8);
  output.writeUInt16BE(n * 16 - power * 16, 10);
  let at = 12 + n * 16,
    head = 0;
  entries.forEach(({ tag, data }, i) => {
    const p = 12 + i * 16;
    output.write(tag, p, 4, "ascii");
    output.writeUInt32BE(sum(data), p + 4);
    output.writeUInt32BE(at, p + 8);
    output.writeUInt32BE(data.length, p + 12);
    data.copy(output, at);
    if (tag === "head") head = at;
    at += align(data.length);
  });
  output.writeUInt32BE((0xb1b0afba - sum(output)) >>> 0, head + 8);
  return output;
}
