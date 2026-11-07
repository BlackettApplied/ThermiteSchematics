// Synthetic pixels and an independent PNG encoder for browser-free decoding tests.
import { deflateSync } from "node:zlib";
export function pngChunk(type, data) {
  const t = Buffer.from(type),
    n = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  let c = 0xffffffff;
  for (const b of Buffer.concat([t, data])) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  n.writeUInt32BE(data.length);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([n, t, data, crc]);
}
function fixturePixels({
  width,
  height,
  channels,
  seed,
  header,
  stamped,
  bodyAlpha,
  pixel,
}) {
  const bytes = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < channels; c++) {
        const n = (y * width + x) * channels + c;
        bytes[n] = pixel
          ? pixel(x, y)[c]
          : c === 3
            ? y >= 86
              ? bodyAlpha
              : 255
            : (n + (y < 86 ? header : seed) * 31) % 251;
        if (stamped && y < 86 && !pixel)
          bytes[n] =
            c === 3
              ? 255
              : y === (header % 70) + 1 && x === 1
                ? 60 + (header % 100)
                : 255;
      }
  return bytes;
}
export function pngFixture({
  width = 4,
  height = 90,
  channels = 4,
  seed = 1,
  header = 1,
  filter = 0,
  extra = [],
  stamped = false,
  bodyAlpha = 255,
  pixel,
} = {}) {
  const pixels = fixturePixels({
      width,
      height,
      channels,
      seed,
      header,
      stamped,
      bodyAlpha,
      pixel,
    }),
    scan = Buffer.alloc((width * channels + 1) * height),
    ihdr = Buffer.alloc(13);
  const stride = width * channels;
  for (let y = 0; y < height; y++) {
    scan[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const p = y * stride + x,
        a = x < channels ? 0 : pixels[p - channels],
        b = y ? pixels[p - stride] : 0,
        c = y && x >= channels ? pixels[p - stride - channels] : 0;
      const z = a + b - c,
        pa = Math.abs(z - a),
        pb = Math.abs(z - b),
        pc = Math.abs(z - c),
        paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      scan[y * (stride + 1) + x + 1] =
        pixels[p] - [0, a, b, Math.floor((a + b) / 2), paeth][filter];
    }
  }
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 3 ? 2 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    ...extra,
    pngChunk("IDAT", deflateSync(scan)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
