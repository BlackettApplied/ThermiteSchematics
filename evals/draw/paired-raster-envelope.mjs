// Gate-only base calibration; draw scoring and published capture are unchanged.
import assert from "node:assert/strict";
import { compareSamples } from "./paired-raster-plan.mjs";

export function checkSampleCount(N = 10) {
  assert(Number.isSafeInteger(N) && N >= 10, "N must be an integer >= 10");
  return N;
}

function distance(row) {
  return {
    changedPixels: row.changedPixels,
    maxChannelDelta: row.maxChannelDelta,
  };
}

function calibration(base, samples, N) {
  assert(samples.length === N, "Base self-sample count differs from N");
  const rows = samples.map((sample) => {
    assert(sample.sourceSha256 === base.sourceSha256, "Base source changed");
    return compareSamples(base, sample);
  });
  const envelope = { changedPixels: 0, maxChannelDelta: 0 },
    pairs = [];
  for (let i = 0; i < samples.length; i++)
    for (let j = i + 1; j < samples.length; j++) {
      const d = distance(compareSamples(samples[i], samples[j]));
      envelope.changedPixels = Math.max(
        envelope.changedPixels,
        d.changedPixels,
      );
      envelope.maxChannelDelta = Math.max(
        envelope.maxChannelDelta,
        d.maxChannelDelta,
      );
      pairs.push({ first: i, second: j, ...d });
    }
  return {
    envelope,
    baseVariantCount: new Set(rows.map((row) => row.headPngSha256)).size,
    baseSamples: rows.map((row, sample) => ({
      sample,
      pngSha256: row.headPngSha256,
      ...distance(row),
    })),
    basePairs: pairs,
  };
}

export function evaluateEnvelope(base, head, samples = [], N = 10) {
  checkSampleCount(N);
  const pair = compareSamples(base, head),
    headDistance = distance(pair),
    evidence = pair.byteIdentical
      ? {
          envelope: { changedPixels: 0, maxChannelDelta: 0 },
          baseVariantCount: 1,
          baseSamples: [],
          basePairs: [],
        }
      : calibration(base, samples, N),
    variantMatch =
      !pair.byteIdentical &&
      samples.some((sample) => sample.png.equals(head.png)),
    withinEnvelope =
      headDistance.changedPixels <= evidence.envelope.changedPixels &&
      headDistance.maxChannelDelta <= evidence.envelope.maxChannelDelta,
    pass = pair.byteIdentical || variantMatch || withinEnvelope;
  return {
    ...pair,
    N: pair.byteIdentical ? 0 : N,
    baseReferenceSha256: pair.basePngSha256,
    ...evidence,
    headDistance,
    pass,
    verdict: pass ? "pass" : "fail",
    acceptance: pair.byteIdentical
      ? "byte-identical"
      : variantMatch
        ? "base-variant"
        : withinEnvelope
          ? "base-envelope"
          : "outside-base-envelope",
  };
}
