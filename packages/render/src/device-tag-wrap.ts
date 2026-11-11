import { textClusters } from "./text-metrics.js";
import { fittingEnd } from "./packet/label-wrap.js";

const separator = (s: string) => /^[-/._:–—\s]$/u.test(s);

/** Descriptions prefer words, then retained separators, then graphemes.
 * Parts prefer retained separators. Never insert or discard a character. */
export function wrapDeviceTagText(
  value: string,
  width: number,
  measure: (s: string) => number,
  description: boolean,
): string[] {
  const fits = (s: string) => measure(s) <= width + 0.001;
  if (!value || fits(value)) return [value];
  const chars = textClusters(value),
    rows: string[] = [];
  for (let start = 0; start < chars.length;) {
    let end = fittingEnd(chars, start, fits);
    if (end < chars.length) {
      const breaks = [
        ...(description ? [(s: string) => /^\s$/u.test(s)] : []),
        separator,
      ];
      for (const preferred of breaks) {
        let cut = end;
        while (cut > start && !preferred(chars[cut - 1] ?? "")) cut--;
        if (cut > start) {
          end = cut;
          break;
        }
      }
    }
    rows.push(chars.slice(start, end).join(""));
    start = end;
  }
  return rows;
}
