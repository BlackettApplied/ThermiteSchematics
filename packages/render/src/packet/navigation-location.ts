import type { DrawingBounds } from "./types.js";
export const navigationQuantumMm = 0.01;
function decimalShift(v: number, places: number) {
  const [mantissa, exponent = "0"] = String(v).split("e");
  return Number(`${mantissa}e${Number(exponent) + places}`);
}
/** Decimal half-up at Q: exact decimal ties round away from zero (1.005 → 1.01). */
export const roundNavigation = (v: number) => {
  if (!Number.isFinite(v)) return v;
  return (
    Math.sign(v) * decimalShift(Math.round(decimalShift(Math.abs(v), 2)), -2)
  );
};
/** Quantize the anchor and field BEFORE half-open classification; the outer edge is closed. */
export function navigationZone(
  x: number,
  y: number,
  area: DrawingBounds,
): string {
  const b = {
    x: roundNavigation(area.x),
    y: roundNavigation(area.y),
    w: roundNavigation(area.w),
    h: roundNavigation(area.h),
  };
  x = roundNavigation(x);
  y = roundNavigation(y);
  if (area.frameService) {
    const s = area.frameService;
    if (
      x >= roundNavigation(s.x) &&
      x <= roundNavigation(s.x + s.w) &&
      y >= roundNavigation(s.y) &&
      y <= roundNavigation(s.y + s.h)
    ) {
      x = Math.max(b.x, Math.min(roundNavigation(b.x + b.w), x));
      y = Math.max(b.y, Math.min(roundNavigation(b.y + b.h), y));
    }
  }
  if (
    ![x, y, b.x, b.y, b.w, b.h].every(Number.isFinite) ||
    b.w <= 0 ||
    b.h <= 0 ||
    x < b.x ||
    y < b.y ||
    x > roundNavigation(b.x + b.w) ||
    y > roundNavigation(b.y + b.h)
  )
    throw Error("Navigation anchor outside drawing field");
  const column = Array.from({ length: 5 }, (_, i) =>
    roundNavigation(b.x + (b.w * (i + 1)) / 6),
  ).filter((v) => x >= v).length;
  const row = Array.from({ length: 3 }, (_, i) =>
    roundNavigation(b.y + (b.h * (i + 1)) / 4),
  ).filter((v) => y >= v).length;
  return `${"ABCD"[row]}${column + 1}`;
}
export const destinationToken = (d: { sheet: number; zone: string }) =>
  `${String(d.sheet).padStart(2, "0")}.${d.zone}`;
