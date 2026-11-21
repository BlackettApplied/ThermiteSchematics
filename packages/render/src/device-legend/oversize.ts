import type { LegendTag } from "./reference.js";
import type { Rect } from "./geometry.js";
import { legendColumns } from "./placement.js";
import { required } from "../presentation/util.js";
/** Diagnose an indivisible entry against the whole drawing area before naming
 * an unrelated neighbour whose accumulated column offset happened to overflow. */
export function oversizedLegendEntry(
  variants: readonly (readonly LegendTag[])[],
  area: Rect,
) {
  for (const original of variants[0] ?? []) {
    const options = variants
      .flatMap((tags) => tags.filter((t) => t.ownerUid === original.ownerUid))
      .map((tag) => ({ tag, box: legendColumns([tag], 1).box }));
    if (options.some((o) => o.box.w <= area.w && o.box.h <= area.h)) continue;
    const best = required(
        options.sort(
          (a, b) =>
            Math.max(a.box.w / area.w, a.box.h / area.h) -
            Math.max(b.box.w / area.w, b.box.h / area.h),
        )[0],
        "Missing oversized entry",
      ),
      horizontal = best.box.w > area.w,
      row = best.tag.rows.find((r) =>
        horizontal
          ? r.ink.x + r.ink.w + 3 > area.w
          : 6 + r.ink.y + r.ink.h + 1.5 > area.h,
      );
    return {
      device: required(
        best.tag.fields.find((f) => f.field === "designation"),
        "Missing oversized designation",
      ).value,
      field: row?.field ?? "legend heading",
      width: best.box.w,
      height: best.box.h,
    };
  }
}
