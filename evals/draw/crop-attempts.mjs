// Portable v2 attempt policy. No browser or caller-adjustable limits.
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { checkPdfCapture } from "./pdf-source-policy.mjs";
import { decodePng } from "./png-ink.mjs";
import { hash, json } from "./support.mjs";
import {
  sourcePixelStats,
  pixelRefusal,
  SOURCE_TOLERANCE,
} from "./crop-source-pixels.mjs";
export const MAX_SOURCE_ATTEMPTS = 3;
export const CAPTURE_IMPLEMENTATION = "chromium-source/1.0";
const digest = (s) => /^[a-f0-9]{64}$/.test(s ?? "");
export const verificationPath = (sha) => {
  assert(digest(sha), "Invalid verification PNG hash");
  return `verification/${sha}.png`;
};
export function checkAttemptStats(s) {
  assert(
    s &&
      equal(Object.keys(s).sort(), [
        "absoluteError",
        "changed",
        "maximum",
        "pixels",
      ]),
    "Invalid pixel statistic fields",
  );
  assert(
    Object.values(s).every((v) => Number.isSafeInteger(v) && v >= 0) &&
      s.pixels > 0 &&
      s.changed <= s.pixels &&
      s.maximum <= 255 &&
      s.absoluteError <= s.changed * 3 * 255 &&
      (s.changed === 0
        ? s.maximum === 0 && s.absoluteError === 0
        : s.maximum > 0 &&
          s.absoluteError >= s.changed &&
          s.absoluteError >= s.maximum),
    "Pixel statistics require consistent nonnegative integer counts and error sums",
  );
}
export function checkAttempts(v, archivePdf2 = false) {
  assert(
    v.maxAttempts === MAX_SOURCE_ATTEMPTS && equal(v.limits, SOURCE_TOLERANCE),
    "Source verification policy cannot change the attempt cap or limits",
  );
  if (v.medium === "pdf") checkPdfCapture(v, archivePdf2);
  else
    assert(
      v.capture?.implementation === CAPTURE_IMPLEMENTATION &&
        typeof v.capture.browser === "string" &&
        v.capture.browser.length > 0 &&
        typeof v.capture.platform === "string" &&
        v.capture.platform.length > 0 &&
        equal(v.capture.args, []) &&
        v.capture.deviceScaleFactor === 300 / 96,
      "Source verification requires the calibrated capture implementation and environment",
    );
  assert(
    Array.isArray(v.attempts) &&
      v.attempts.length >= 1 &&
      v.attempts.length <= MAX_SOURCE_ATTEMPTS &&
      v.selectedAttempt === v.attempts.length,
    "Source verification needs ordered attempts ending at the selected pass",
  );
  let previous = null;
  for (const [i, a] of v.attempts.entries()) {
    assert(
      equal(Object.keys(a).sort(), [
        "attempt",
        "previousSha256",
        "reason",
        "referenceSha256",
        "stats",
        "verdict",
      ]),
      "Invalid source attempt fields",
    );
    assert(
      a.attempt === i + 1 &&
        a.previousSha256 === previous &&
        digest(a.referenceSha256),
      "Source attempt order or reference hash differs",
    );
    checkAttemptStats(a.stats);
    const reason = pixelRefusal(a.stats);
    assert(
      a.reason === reason && a.verdict === (reason ? "refused" : "pass"),
      "Source attempt verdict differs from its pixel statistics",
    );
    assert(
      (i === v.attempts.length - 1) === (a.verdict === "pass"),
      "Source attempts must stop at the first pass",
    );
    previous = hash(json(a));
  }
}
export async function captureAttempts(
  crop,
  header,
  capture,
  references,
  audit,
) {
  for (let n = 1; n <= MAX_SOURCE_ATTEMPTS; n++) {
    let png, stats;
    try {
      png = await capture(n);
      stats = sourcePixelStats(crop, png, header);
    } catch (error) {
      if (png) references.set(hash(png), png);
      audit.push({
        attempt: n,
        referenceSha256: png ? hash(png) : null,
        stats: null,
        verdict: "error",
        reason: error.message,
      });
      throw error;
    }
    const sha = hash(png);
    references.set(sha, png); // Retain even structural-error rasters for the failure audit.
    const reason = pixelRefusal(stats);
    const a = {
      attempt: n,
      previousSha256: audit.length ? hash(json(audit.at(-1))) : null,
      referenceSha256: sha,
      stats,
      verdict: reason ? "refused" : "pass",
      reason,
    };
    audit.push(a);
    if (!reason) return n;
  }
  throw Error(
    `Source pixels refused after ${MAX_SOURCE_ATTEMPTS} attempts: ${audit.at(-1).reason}`,
  );
}
export function verifyAttemptPixels(
  v,
  crop,
  header,
  references,
  archivePdf2 = false,
) {
  checkAttempts(v, archivePdf2);
  for (const a of v.attempts) {
    const png = references.get(a.referenceSha256);
    assert(
      png && hash(png) === a.referenceSha256,
      "Missing or changed verification PNG",
    );
    if (v.medium === "pdf" && v.format === "thermite-draw-source-crop/3.0") {
      const raster = decodePng(png);
      assert(
        raster.width === Math.ceil((v.sourceBbox.w * 300) / 25.4) &&
          raster.height === Math.ceil((v.sourceBbox.h * 300) / 25.4),
        "PDF reference dimensions differ from ink shape",
      );
    }
    assert(
      equal(sourcePixelStats(crop, png, header), a.stats),
      "Recorded source pixel statistics differ from retained pixels",
    );
  }
}
