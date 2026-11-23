import { measureText } from "../text-metrics.js";
import { ReportMeasurementError } from "./report-measurement.js";
import { identifierSpans } from "./report-identifiers.js";
import {
  reportTokens,
  reportTextSegments,
  type ReportName,
} from "./report-column-widths.js";

function wrapParagraph(
  paragraph: string,
  width: number,
  size: number,
  names: readonly ReportName[],
  identifiers: readonly string[],
  measureWidth: (line: string) => number = (s) => measureText(s, size).width,
) {
  const fits = (s: string) => measureWidth(s.trim()) <= width;
  const blocked = new Uint8Array(paragraph.length + 1),
    aspect = new Set<number>();
  for (const hit of reportTokens(paragraph, names)) {
    blocked.fill(1, hit.start + 1, hit.end);
    if (hit.kind === "designation" && /^[=+-]/u.test(hit.value))
      aspect.add(hit.start);
  }
  for (const span of identifierSpans(paragraph, identifiers))
    blocked.fill(1, span.start + 1, span.end);
  const safe = (i: number) =>
    !blocked[i] && (!/[-/.:_]/u.test(paragraph[i] ?? "") || aspect.has(i));
  const units: { value: string; start: number }[] = [];
  let cursor = 0;
  for (const m of paragraph.matchAll(/\s+/gu)) {
    if (blocked[m.index]) continue;
    if (m.index > cursor)
      units.push({ value: paragraph.slice(cursor, m.index), start: cursor });
    units.push({ value: m[0], start: m.index });
    cursor = m.index + m[0].length;
  }
  if (cursor < paragraph.length)
    units.push({ value: paragraph.slice(cursor), start: cursor });
  const lines: string[] = [];
  let line = "";
  for (const { value: unit, start } of units) {
    if (/^\s+$/u.test(unit)) {
      if (line) line += unit;
      continue;
    }
    if (fits(line + unit)) {
      line += unit;
      continue;
    }
    if (line.trim()) {
      lines.push(line.trim());
      line = "";
    }
    const fragments = splitUnit(unit, start, fits, safe, aspect);
    lines.push(...fragments.slice(0, -1));
    line = fragments.at(-1) ?? "";
  }
  return [...lines, line.trim()];
}

function splitUnit(
  unit: string,
  start: number,
  fits: (s: string) => boolean,
  safe: (i: number) => boolean,
  aspect: ReadonlySet<number>,
) {
  const clusters = [...reportTextSegments(unit)],
    lines: string[] = [];
  let first = 0;
  while (first < clusters.length) {
    const firstCluster = clusters[first];
    if (!firstCluster) break;
    const begin = firstCluster.index;
    let last = first,
      fallback = -1,
      separator = -1,
      edge = -1;
    for (; last < clusters.length; last++) {
      const part = clusters[last];
      if (!part) break;
      const end = part.index + part.segment.length;
      if (!fits(unit.slice(begin, end))) break;
      const absolute = start + end;
      if (!safe(absolute)) continue;
      fallback = last + 1;
      if (/[-/.:_]$/u.test(part.segment)) separator = last + 1;
      if (aspect.has(absolute)) edge = last + 1;
    }
    if (last === clusters.length) {
      lines.push(unit.slice(begin));
      break;
    }
    const next = separator >= 0 ? separator : edge >= 0 ? edge : fallback;
    if (next < 0)
      throw new ReportMeasurementError(
        "An authored identifier, designation or location cannot fit without splitting.",
      );
    const end = clusters[next]?.index ?? unit.length;
    lines.push(unit.slice(begin, end).trim());
    first = next;
  }
  return lines;
}

export function wrapReportCell(
  value: string,
  width: number,
  size: number,
  names: readonly ReportName[],
  identifiers: readonly string[] = [],
  measureWidth?: (line: string) => number,
): string[] {
  return value
    .normalize("NFC")
    .split(/\r\n|[\n\r\u2028\u2029]/u)
    .flatMap((paragraph) =>
      wrapParagraph(paragraph, width, size, names, identifiers, measureWidth),
    );
}
