import { printableTextMetrics } from "../text-metrics.js";

const cache = new Map<string, ReturnType<typeof printableTextMetrics>>();
/** Memoize only pure pinned font tables, never caller geometry or source facts. */
export function pinnedMetrics(text: string, size: number, bold = false) {
  const key = JSON.stringify([size, bold, text]);
  const found = cache.get(key);
  if (found) return found;
  const metrics = printableTextMetrics(text, size, bold);
  if (cache.size >= 8192) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, Object.freeze(metrics));
  return metrics;
}

/** Natural pinned regular/bold/math ink and advance; never compress glyphs. */
export function cardTextMetrics(text: string, size: number, bold = false) {
  const m = pinnedMetrics(text, size, bold);
  const offsetX = -Math.min(0, m.left);
  return {
    width: Math.max(m.advance, m.right) + offsetX,
    ascent: m.top,
    descent: -Math.min(0, m.bottom),
    offsetX,
  };
}

/** Preserve every character, including spaces in authored IDs across line breaks. */
export function wrapCardText(
  text: string,
  width: number,
  size: number,
  bold = false,
): string[] {
  const chars = [...text],
    lines: string[] = [];
  while (chars.length) {
    let end = 0;
    while (
      end < chars.length &&
      cardTextMetrics(chars.slice(0, end + 1).join(""), size, bold).width <=
        width + 0.001
    )
      end++;
    // Preflight reports unsupported/overlength fields; an unfit glyph remains
    // whole so final ink validation refuses it instead of silently dropping it.
    end = Math.max(1, end);
    lines.push(chars.splice(0, end).join(""));
  }
  return lines.length ? lines : [text];
}
