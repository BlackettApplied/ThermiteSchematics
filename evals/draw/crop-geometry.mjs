import assert from "node:assert/strict";

// Report coordinates round to 0.001 mm; this is rounding allowance, not padding.
export function assertCropContainsInstance(instance, cropBbox) {
  const box = instance?.bbox;
  assert(
    box &&
      cropBbox &&
      [
        box.x,
        box.y,
        box.w,
        box.h,
        cropBbox.x,
        cropBbox.y,
        cropBbox.w,
        cropBbox.h,
      ].every(Number.isFinite) &&
      box.w >= 0 &&
      box.h >= 0 &&
      cropBbox.w > 0 &&
      cropBbox.h > 0 &&
      box.x >= cropBbox.x - 0.001 &&
      box.y >= cropBbox.y - 0.001 &&
      box.x + box.w <= cropBbox.x + cropBbox.w + 0.001 &&
      box.y + box.h <= cropBbox.y + cropBbox.h + 0.001,
    "Cited instance is outside the source crop; render its own crop before stamping or binding",
  );
}
