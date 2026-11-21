// Gate-only region identity and exact pixel comparison; no scoring or bind policy.
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { hash } from "./support.mjs";
import { decodePng } from "./png-ink.mjs";

export const GATE_MODE = "gpu-raster-disabled";
export const GATE_ARGS = Object.freeze(["--disable-gpu-rasterization"]);

function region(row, path, medium) {
  const box = row.evidence.cropBbox;
  assert(
    typeof path === "string" &&
      path.startsWith(row.case + "/") &&
      path.endsWith(".png") &&
      !path.split(/[\\/]/).includes(".."),
    "Crop region requires a relative case/PNG path",
  );
  assert(
    Number.isSafeInteger(row.sheet) &&
      row.sheet > 0 &&
      row.evidence.cropDpi === 300 &&
      ["svg", "html", "pdf"].includes(medium) &&
      box &&
      [box.x, box.y, box.w, box.h].every(Number.isFinite) &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.w > 0 &&
      box.h > 0,
    "Crop region requires a physical sheet, finite box and 300 dpi",
  );
  assert(
    row.evidence.findings?.[0]?.backend !== "PDFKit",
    "PDFKit crop unsupported by this gate",
  );
  return { file: path, case: row.case, sheet: row.sheet, medium, box };
}

export function cropRegions(report) {
  assert(
    report.mode === "strict" && Array.isArray(report.results),
    "Use a strict report",
  );
  const regions = [];
  for (const row of report.results) {
    if (!row.evidence?.crop) {
      assert(
        !row.evidence?.referenceCrop,
        "Reference crop has no primary region",
      );
      continue;
    }
    const medium =
      row.dq === "DQ-01" || row.evidence.findings?.[0]?.medium === "pdf"
        ? "pdf"
        : (row.medium ?? "svg");
    regions.push(region(row, row.evidence.crop, medium));
    if (row.evidence.referenceCrop)
      regions.push(region(row, row.evidence.referenceCrop, "svg"));
  }
  assert(
    new Set(regions.map((r) => r.file)).size === regions.length,
    "Duplicate crop region",
  );
  return regions.sort((a, b) => a.file.localeCompare(b.file, "en"));
}

export function pairedRegions(base, head) {
  const a = cropRegions(base),
    b = cropRegions(head);
  assert(a.length && b.length, "No PNG crop regions to compare");
  assert(
    equal(
      a.map((r) => r.file),
      b.map((r) => r.file),
    ),
    "Crop inventory differs (missing or extra region)",
  );
  assert(equal(a, b), "Crop boxes, sheets or media differ");
  return a;
}

function checkMode(a, b) {
  for (const sample of [a, b])
    assert(
      sample.capture?.mode === GATE_MODE &&
        equal(sample.capture.args, GATE_ARGS) &&
        typeof sample.capture.browser === "string" &&
        sample.capture.browser.length,
      "Raster mode label or arguments mismatch",
    );
  assert(equal(a.capture, b.capture), "Raster capture environments differ");
}

export function compareSamples(a, b) {
  checkMode(a, b);
  const x = decodePng(a.png),
    y = decodePng(b.png);
  assert(
    x.width === y.width && x.height === y.height,
    "Raster dimensions differ",
  );
  let changedPixels = 0,
    maxChannelDelta = 0;
  for (let i = 0; i < x.rgba.length; i += 4) {
    let delta = 0;
    for (let c = 0; c < 4; c++)
      delta = Math.max(delta, Math.abs(x.rgba[i + c] - y.rgba[i + c]));
    if (delta) changedPixels++;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
  }
  return {
    ...a.capture,
    byteIdentical: a.png.equals(b.png),
    changedPixels,
    maxChannelDelta,
    width: x.width,
    height: x.height,
    basePngSha256: hash(a.png),
    headPngSha256: hash(b.png),
  };
}
