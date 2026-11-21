import assert from "node:assert/strict";
import { decodePng } from "./png-ink.mjs";
export async function verifyStampHeaders(index, crops) {
  const stamped = index.crops.filter((c) => c.headerPixels === 86);
  if (!stamped.length) return;
  const { stampDrawingCrop } =
    await import("../../scripts/stamp-drawing-crop.mjs");
  const errors = [];
  for (const c of stamped) {
    try {
      const bytes = crops.get(c.path),
        actual = decodePng(bytes);
      const rebuilt = decodePng(
        await stampDrawingCrop(bytes, c.headerLines, true, {
          instance: { bbox: c.instanceBbox },
          cropBbox: c.sourceBbox,
        }),
      );
      assert(
        actual.rgba
          .subarray(0, actual.width * 86 * 4)
          .equals(rebuilt.rgba.subarray(0, rebuilt.width * 86 * 4)),
        `Stamped header pixels differ from report header: ${c.path}`,
      );
    } catch (e) {
      errors.push(c.path + ": " + e.message);
    }
  }
  assert(!errors.length, "Stamp refusals:\n" + errors.join("\n"));
}
