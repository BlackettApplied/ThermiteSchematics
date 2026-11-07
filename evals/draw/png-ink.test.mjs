import { it, expect } from "vitest";
import { inflateSync, deflateSync } from "node:zlib";
import { decodePng, drawingHash } from "./png-ink.mjs";
import { pngFixture, pngChunk } from "./png-fixture.mjs";
const chunks = (b) => {
  const out = [];
  for (let o = 8; o < b.length;) {
    const n = b.readUInt32BE(o);
    out.push([b.toString("ascii", o + 4, o + 8), b.subarray(o + 8, o + 8 + n)]);
    o += n + 12;
  }
  return out;
};
const encode = (cs) =>
  Buffer.concat([
    pngFixture().subarray(0, 8),
    ...cs.map(([t, b]) => pngChunk(t, b)),
  ]);
it.each([0, 1, 2, 3, 4])("decodes PNG filter %s in RGB and RGBA", (filter) => {
  for (const channels of [3, 4])
    expect(decodePng(pngFixture({ channels, filter }))).toEqual(
      decodePng(pngFixture({ channels, filter: 0 })),
    );
});
it("matches the reviewed RGBA-body/dimensions hash definition", () => {
  const p = pngFixture({ stamped: true }),
    d = decodePng(p);
  expect(drawingHash(p, 86)).toBe(
    "b0c6459923b854504883fc045a7a7b1e753537296cdc333bcaa682176539f425",
  );
  expect(d.rgba.length).toBe(d.width * d.height * 4);
});
it("groups headers only when explicitly declared, and keeps real ink distinct", () => {
  const a = pngFixture({ stamped: true }),
    b = pngFixture({ header: 2, stamped: true });
  expect(drawingHash(a, 86)).toBe(drawingHash(b, 86));
  expect(drawingHash(a, 0)).not.toBe(drawingHash(b, 0));
  expect(drawingHash(a, 86)).not.toBe(
    drawingHash(pngFixture({ seed: 2, stamped: true }), 86),
  );
});
it.each([-1, 1, 85, 87, "86", undefined])(
  "refuses unsupported header %s",
  (h) => {
    if (h === undefined)
      expect(() => drawingHash(pngFixture({ height: 86 }), 86)).toThrow(
        /no drawing/,
      );
    else expect(() => drawingHash(pngFixture(), h)).toThrow(/header/);
  },
);
it.each([
  "signature",
  "crc",
  "truncated chunk",
  "truncated data",
  "trailing",
  "missing end",
  "IHDR order",
  "duplicate IHDR",
  "short IHDR",
  "size",
  "depth",
  "color",
  "compression",
  "filter method",
  "interlace",
  "unknown chunk",
  "significant bits",
  "noncontiguous",
  "empty data",
  "scan length",
  "filter",
  "inflate",
])("refuses undecodable PNG: %s", (kind) => {
  let b = pngFixture(),
    cs = chunks(b);
  if (kind === "signature") b[0] = 0;
  else if (kind === "crc") b[30] ^= 1;
  else if (kind === "truncated chunk") b = b.subarray(0, 10);
  else if (kind === "truncated data") b = b.subarray(0, 35);
  else if (kind === "trailing")
    b = Buffer.concat([b, pngChunk("IEND", Buffer.alloc(0))]);
  else {
    if (kind === "missing end") cs.pop();
    if (kind === "IHDR order") cs.unshift(["sRGB", Buffer.from([0])]);
    if (kind === "duplicate IHDR") cs.splice(1, 0, cs[0]);
    if (kind === "short IHDR") cs[0][1] = Buffer.alloc(12);
    if (kind === "size") cs[0][1].writeUInt32BE(0);
    if (kind === "depth") cs[0][1][8] = 16;
    if (kind === "color") cs[0][1][9] = 3;
    if (kind === "compression") cs[0][1][10] = 1;
    if (kind === "filter method") cs[0][1][11] = 1;
    if (kind === "interlace") cs[0][1][12] = 1;
    if (kind === "unknown chunk") cs.splice(1, 0, ["tRNS", Buffer.alloc(6)]);
    if (kind === "significant bits")
      cs.splice(1, 0, ["sBIT", Buffer.from([7, 8, 8, 8])]);
    if (kind === "noncontiguous")
      cs.splice(2, 0, ["sRGB", Buffer.from([0])], cs[1]);
    if (kind === "empty data") cs = [cs[0], cs[2]];
    if (kind === "scan length") cs[1][1] = deflateSync(Buffer.alloc(5));
    if (kind === "filter") {
      const r = inflateSync(cs[1][1]);
      r[0] = 5;
      cs[1][1] = deflateSync(r);
    }
    if (kind === "inflate") cs[1][1] = Buffer.from("bad zlib");
    b = encode(cs);
  }
  expect(() => decodePng(b)).toThrow();
});
it("accepts the tool's eight-bit sBIT metadata and multiple adjacent IDATs", () => {
  const cs = chunks(pngFixture()),
    d = cs[1][1],
    split = d.length >> 1;
  cs.splice(
    1,
    1,
    ["sBIT", Buffer.from([8, 8, 8, 8])],
    ["IDAT", d.subarray(0, split)],
    ["IDAT", d.subarray(split)],
  );
  expect(decodePng(encode(cs))).toEqual(decodePng(pngFixture()));
});
it("requires an exact IHDR length even when all defined fields are valid", () => {
  const cs = chunks(pngFixture());
  cs[0][1] = Buffer.concat([cs[0][1], Buffer.from([0])]);
  expect(() => decodePng(encode(cs))).toThrow(/Invalid PNG IHDR/);
});
it("does not interpret a different first chunk as an IHDR", () => {
  const cs = chunks(pngFixture());
  cs[0][0] = "tEXt";
  expect(() => decodePng(encode(cs))).toThrow(/must start with IHDR/);
});
it("requires IEND to have no payload", () => {
  const cs = chunks(pngFixture());
  cs.at(-1)[1] = Buffer.from([0]);
  expect(() => decodePng(encode(cs))).toThrow(/Invalid PNG IEND/);
});
it("rejects a short single scanline before absent samples can become zero pixels", () => {
  const cs = chunks(pngFixture({ height: 1 }));
  cs[1][1] = deflateSync(Buffer.from([0]));
  expect(() => decodePng(encode(cs))).toThrow(/Wrong PNG scanline length/);
});
it("bounds the parsed image dimensions before decompression and allocation", async () => {
  const { pngData } = await import("./png-chunks.mjs"),
    cs = chunks(pngFixture());
  cs[0][1].writeUInt32BE(20000001);
  cs[0][1].writeUInt32BE(1, 4);
  expect(() => pngData(encode(cs))).toThrow(/dimensions exceed/);
});
it("gives a PNG diagnostic instead of a native bounds error for a short chunk", () => {
  expect(() => decodePng(pngFixture().subarray(0, 10))).toThrow(
    /^Truncated PNG chunk$/,
  );
});
it("gives a PNG diagnostic instead of a native bounds error for short payload data", () => {
  expect(() => decodePng(pngFixture().subarray(0, 32))).toThrow(
    /^Truncated PNG data$/,
  );
});
it.each([
  "blank",
  "colour",
  "red-green mismatch",
  "green-blue mismatch",
  "alpha",
  "gap",
])("refuses a false stamped header: %s", (kind) => {
  const pixel = (x, y) => {
    if (y >= 86) return [24, 48, 72, 255];
    if (kind === "blank") return [255, 255, 255, 255];
    if (x === 1 && y === (kind === "gap" ? 80 : 5))
      return kind === "colour"
        ? [200, 0, 0, 255]
        : kind === "red-green mismatch"
          ? [50, 60, 60, 255]
          : kind === "green-blue mismatch"
            ? [60, 60, 50, 255]
            : kind === "alpha"
              ? [60, 60, 60, 128]
              : [60, 60, 60, 255];
    return [255, 255, 255, 255];
  };
  expect(() => drawingHash(pngFixture({ pixel }), 86)).toThrow(
    /Stamped header/,
  );
});
it("header check accepts valid grey ink through row 79 with white rows 80–85", () => {
  const pixel = (x, y) =>
    y === 79 && x === 1 ? [90, 90, 90, 255] : [255, 255, 255, 255];
  expect(() => drawingHash(pngFixture({ pixel }), 86)).not.toThrow();
});
it("drawing identity includes alpha, even when RGB and dimensions match", () => {
  const opaque = pngFixture({ stamped: true }),
    transparent = pngFixture({ stamped: true, bodyAlpha: 128 });
  expect(drawingHash(opaque, 86)).not.toBe(drawingHash(transparent, 86));
  expect(decodePng(transparent).rgba[86 * 4 * 4 + 3]).toBe(128);
});
it.each(["gAMA", "cHRM", "eXIf"])(
  "refuses appearance-changing %s metadata",
  (type) => {
    expect(() =>
      drawingHash(pngFixture({ extra: [pngChunk(type, Buffer.alloc(32))] })),
    ).toThrow(new RegExp("Unsupported PNG chunk: " + type));
  },
);
it.each(["trailing bytes", "second stream"])(
  "refuses %s inside PNG IDAT",
  (kind) => {
    const cs = chunks(pngFixture());
    cs[1][1] = Buffer.concat([
      cs[1][1],
      kind === "trailing bytes"
        ? Buffer.from("hidden")
        : deflateSync(Buffer.from("another stream")),
    ]);
    expect(() => decodePng(encode(cs))).toThrow(/Trailing PNG zlib data/);
  },
);
