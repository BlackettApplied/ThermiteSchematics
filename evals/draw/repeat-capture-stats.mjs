import assert from "node:assert/strict";
import { decodePng } from "./png-ink.mjs";
import { SOURCE_TOLERANCE, sourcePixelStats } from "./crop-source-pixels.mjs";
import { hash } from "./support.mjs";

export function repeatPixelStats(a, b) {
  const stats = sourcePixelStats(a, b),
    left = decodePng(a),
    right = decodePng(b);
  let overChannel = 0;
  for (let i = 0; i < left.rgba.length; i += 4)
    if (
      [0, 1, 2].some(
        (k) =>
          Math.abs(left.rgba[i + k] - right.rgba[i + k]) >
          SOURCE_TOLERANCE.channel,
      )
    )
      overChannel++;
  return {
    ...stats,
    changedFraction: stats.changed / stats.pixels,
    overChannel,
    overChannelFraction: overChannel / stats.pixels,
    meanError: stats.absoluteError / stats.pixels,
  };
}

export function compareRepeats(samples) {
  assert(samples.length >= 2, "Repeat comparison needs at least two captures");
  const variants = [
      ...new Map(samples.map((bytes) => [hash(bytes), bytes])).values(),
    ],
    worst = repeatPixelStats(samples[0], samples[0]);
  // All pairs, not only against the first: the first could sit between extremes.
  for (let i = 0; i < variants.length; i++)
    for (let j = i + 1; j < variants.length; j++) {
      const stats = repeatPixelStats(variants[i], variants[j]);
      for (const key of Object.keys(worst))
        worst[key] = Math.max(worst[key], stats[key]);
    }
  return {
    captures: samples.length,
    sampleSha256: samples.map(hash),
    variants: variants.length,
    worst,
    limits: SOURCE_TOLERANCE,
    margin: {
      channel: SOURCE_TOLERANCE.channel - worst.maximum,
      fraction: SOURCE_TOLERANCE.fraction - worst.changedFraction,
      mean: SOURCE_TOLERANCE.mean - worst.meanError,
    },
    withinBindLimits:
      worst.maximum <= SOURCE_TOLERANCE.channel &&
      worst.changedFraction <= SOURCE_TOLERANCE.fraction &&
      worst.meanError <= SOURCE_TOLERANCE.mean,
  };
}
