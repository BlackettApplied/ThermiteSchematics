export const MAX_SVG_MAGNITUDE = 1_000_000_000;

export function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_SVG_MAGNITUDE) {
    throw new RangeError(
      `SVG number must be finite and within ±${MAX_SVG_MAGNITUDE}.`,
    );
  }

  const fixed = value.toFixed(3);
  const normalized = Number(fixed);
  if (
    !Number.isFinite(normalized) ||
    Math.abs(normalized) > MAX_SVG_MAGNITUDE
  ) {
    throw new RangeError(
      `SVG number must quantize within ±${MAX_SVG_MAGNITUDE}.`,
    );
  }
  if (fixed === "-0.000") return "0";
  return fixed.replace(/(?:\.0+|(?:(\.[0-9]*?[1-9]))0+)$/, "$1");
}
