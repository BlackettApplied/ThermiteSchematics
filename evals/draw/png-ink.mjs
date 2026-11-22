// Decode the tool's non-interlaced, eight-bit RGB/RGBA crops. Fail closed otherwise.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { pngData } from "./png-chunks.mjs";
const paeth = (a, b, c) => {
  const p = a + b - c,
    x = Math.abs(p - a),
    y = Math.abs(p - b),
    z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
};
export function decodePng(bytes) {
  const { width, height, channels, compressed } = pngData(bytes);
  const stride = width * channels,
    size = (stride + 1) * height;
  const { buffer: raw, engine } = inflateSync(compressed, {
    maxOutputLength: size,
    info: true,
  });
  assert(engine.bytesWritten === compressed.length, "Trailing PNG zlib data");
  assert(raw.length === size, "Wrong PNG scanline length");
  const scan = Buffer.alloc(stride * height),
    rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert(filter <= 4, "Unsupported PNG filter");
    for (let x = 0; x < stride; x++) {
      const pos = y * stride + x,
        a = x < channels ? 0 : scan[pos - channels],
        b = y ? scan[pos - stride] : 0,
        c = y && x >= channels ? scan[pos - stride - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][
        filter
      ];
      scan[pos] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  for (let n = 0; n < width * height; n++) {
    scan.copy(rgba, n * 4, n * channels, n * channels + 3);
    rgba[n * 4 + 3] = channels === 4 ? scan[n * channels + 3] : 255;
  }
  return { width, height, rgba };
}
function stampedHeader(width, rgba) {
  let any = false;
  for (let y = 0; y < 86; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        [r, g, b, a] = rgba.subarray(i, i + 4);
      if (r === 255 && g === 255 && b === 255 && a === 255) continue;
      assert(y < 80, "Stamped header rows 80–85 must be white");
      assert(
        r === g && g === b && a === 255,
        "Stamped header ink must be opaque grey",
      );
      any = true;
    }
  assert(any, "Stamped header band must not be blank");
}
export function drawingHash(bytes, headerPixels = 0) {
  assert([0, 86].includes(headerPixels), "Crop header must be 0 or 86 pixels");
  const { width, height, rgba } = decodePng(bytes);
  assert(headerPixels < height, "Crop has no drawing below header");
  if (headerPixels === 86) stampedHeader(width, rgba);
  // R4 R5-L2: RGBA pixels below the 86-pixel header, then original dimensions.
  return createHash("sha256")
    .update(rgba.subarray(width * headerPixels * 4))
    .update(`${width}x${height}`)
    .digest("hex");
}
