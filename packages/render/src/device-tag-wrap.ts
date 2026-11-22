import { textClusters } from "./text-metrics.js";
import { fittingEnd } from "./packet/label-wrap.js";

const separator = (s: string) => /^[-/._:–—\s]$/u.test(s);

/** Descriptions prefer words, then retained separators, then graphemes.
 * Parts prefer retained separators. Retain source spans; discard only ink-less
 * trailing whitespace from the measured and emitted row. */
export function wrappedDeviceTagRows(
  value: string,
  width: number,
  measure: (s: string) => number,
  description: boolean,
): { text: string; start: number; end: number }[] {
  const fits = (s: string) => measure(s) <= width + 0.001;
  if (!value || fits(value))
    return [{ text: value.trimEnd(), start: 0, end: value.length }];
  const chars = textClusters(value),
    rows: { text: string; start: number; end: number }[] = [];
  let offset = 0;
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
    const raw = chars.slice(start, end).join("");
    rows.push({ text: raw.trimEnd(), start: offset, end: offset + raw.length });
    offset += raw.length;
    start = end;
  }
  return rows;
}

export function wrapDeviceTagText(
  value: string,
  width: number,
  measure: (s: string) => number,
  description: boolean,
): string[] {
  return wrappedDeviceTagRows(value, width, measure, description).map(
    (row) => row.text,
  );
}
