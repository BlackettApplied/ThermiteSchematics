import assert from "node:assert/strict";
import { decodePng, drawingHash } from "./png-ink.mjs";

// A measured envelope: full-corpus maxima were 60, 2.698% and 0.487 RGB error/pixel.
export const SOURCE_TOLERANCE = Object.freeze({
  channel: 64,
  fraction: 0.03,
  mean: 1,
});
export function sourcePixelStats(cropBytes, sourceBytes, headerPixels = 0) {
  drawingHash(cropBytes, headerPixels); // Includes stamp validation.
  const crop = decodePng(cropBytes),
    source = decodePng(sourceBytes);
  assert(
    crop.height - headerPixels === source.height &&
      crop.width ===
        (headerPixels ? Math.max(760, source.width) : source.width),
    "Crop/source raster dimensions differ",
  );
  let changed = 0,
    sum = 0,
    maximum = 0;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const c = ((y + headerPixels) * crop.width + x) * 4;
      if (x >= source.width) {
        assert(
          crop.rgba.subarray(c, c + 4).every((v) => v === 255),
          "Stamp padding hides foreign ink",
        );
        continue;
      }
      const s = (y * source.width + x) * 4;
      assert(
        crop.rgba[c + 3] === source.rgba[s + 3],
        "Crop/source alpha differs",
      );
      let any = false;
      for (let k = 0; k < 3; k++) {
        const delta = Math.abs(crop.rgba[c + k] - source.rgba[s + k]);
        any ||= delta > 0;
        maximum = Math.max(maximum, delta);
        sum += delta;
      }
      if (any) changed++;
    }
  }
  const pixels = source.width * source.height;
  return { pixels, changed, maximum, absoluteError: sum };
}

export function pixelRefusal({ pixels, changed, maximum, absoluteError }) {
  if (maximum > SOURCE_TOLERANCE.channel)
    return "Crop/source pixel delta exceeds antialiasing tolerance";
  if (changed / pixels > SOURCE_TOLERANCE.fraction)
    return "Crop/source differing pixel fraction exceeds tolerance";
  if (absoluteError / pixels > SOURCE_TOLERANCE.mean)
    return "Crop/source mean pixel error exceeds tolerance";
  return null;
}
export function compareSourcePixels(cropBytes, sourceBytes, headerPixels = 0) {
  const {
    pixels,
    changed,
    maximum,
    absoluteError: sum,
  } = sourcePixelStats(cropBytes, sourceBytes, headerPixels);
  assert(
    maximum <= SOURCE_TOLERANCE.channel,
    "Crop/source pixel delta exceeds antialiasing tolerance",
  );
  assert(
    changed / pixels <= SOURCE_TOLERANCE.fraction,
    "Crop/source differing pixel fraction exceeds tolerance",
  );
  assert(
    sum / pixels <= SOURCE_TOLERANCE.mean,
    "Crop/source mean pixel error exceeds tolerance",
  );
  return { pixels, changed, maximum, absoluteError: sum };
}
