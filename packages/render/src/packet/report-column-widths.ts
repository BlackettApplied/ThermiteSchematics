import type { DocumentationTable } from "@thermite/query";
import { measureText } from "../text-metrics.js";

export interface ReportName {
  value: string;
  kind: "designation" | "location";
}
export interface ReportToken extends ReportName {
  start: number;
  end: number;
  authoredName: string;
}

/** Deterministic mark/joiner/modifier clusters, without host locale data. */
export function* reportTextSegments(value: string) {
  let segment = "",
    index = 0,
    cursor = 0;
  for (const char of value) {
    const attaches =
      segment &&
      (/\p{Mark}|\p{Emoji_Modifier}/u.test(char) ||
        char === "\u200d" ||
        segment.endsWith("\u200d") ||
        (/\p{Regional_Indicator}/u.test(char) &&
          /^\p{Regional_Indicator}$/u.test(segment)));
    if (attaches) segment += char;
    else {
      if (segment) yield { segment, index };
      segment = char;
      index = cursor;
    }
    cursor += char.length;
  }
  if (segment) yield { segment, index };
}

/** Longest matching names, then the indivisible aspects/words they protect. */
export function reportTokens(
  value: string,
  names: readonly ReportName[],
): ReportToken[] {
  const hits: ReportToken[] = [];
  for (const name of names) {
    let start = value.indexOf(name.value);
    while (start >= 0) {
      const end = start + name.value.length;
      // Inspect only the adjacent code point, never copy the whole prefix.
      if (
        !/[\p{L}\p{N}]$/u.test(value.slice(Math.max(0, start - 2), start)) &&
        !/^[\p{L}\p{N}]/u.test(value.slice(end, end + 2))
      )
        hits.push({ ...name, start, end, authoredName: name.value });
      start = value.indexOf(name.value, start + 1);
    }
  }
  const result: ReportToken[] = [];
  let previousEnd = -1;
  for (const hit of hits.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (hit.start < previousEnd) continue;
    previousEnd = hit.end;
    const breaks =
      hit.kind === "location"
        ? [...hit.value.matchAll(/\s+|(?<=[-/.:_])/gu)].flatMap((m) =>
            /\s/u.test(m[0]) ? [m.index, m.index + m[0].length] : [m.index],
          )
        : /^[=+-][\p{L}\p{N}]/u.test(hit.value)
          ? [...hit.value.matchAll(/[=+-](?=[\p{L}\p{N}])/gu)]
              .map((m) => m.index)
              .filter((i) => i > 0)
          : [];
    const boundaries = [...new Set([0, ...breaks, hit.value.length])].sort(
      (a, b) => a - b,
    );
    for (let i = 1; i < boundaries.length; i++) {
      const start = hit.start + boundaries[i - 1]!,
        end = hit.start + boundaries[i]!;
      const part = value.slice(start, end);
      if (part.trim()) result.push({ ...hit, start, end, value: part });
    }
  }
  return result;
}

/** One visible split: >=2 clusters before the hyphen, >=3 after it. */
export function reportHeaderParts(
  word: string,
  width: number,
  size: number,
): string[] | undefined {
  if (measureText(word, size).width <= width) return [word];
  const parts = [...reportTextSegments(word)];
  if (parts.length < 5) return undefined;
  for (let i = parts.length - 3; i >= 2; i--) {
    const end = parts[i]!.index;
    const a = word.slice(0, end) + "-",
      b = word.slice(end);
    if (
      measureText(a, size).width <= width &&
      measureText(b, size).width <= width
    )
      return [a, b];
  }
  return undefined;
}
function headerMinimum(word: string, size: number): number {
  const parts = [...reportTextSegments(word)];
  let minimum = measureText(word, size).width;
  for (let i = 2; i <= parts.length - 3; i++) {
    const end = parts[i]!.index;
    minimum = Math.min(
      minimum,
      Math.max(
        measureText(word.slice(0, end) + "-", size).width,
        measureText(word.slice(end), size).width,
      ),
    );
  }
  return minimum;
}

/** Release header minima by largest saving, stopping at the first fitting set. */
export function reportColumns(
  table: DocumentationTable,
  width: number,
  size: number,
  projectNames: readonly (ReportName | string)[],
) {
  const names = projectNames
    .map((name) =>
      typeof name === "string"
        ? { value: name.normalize("NFC"), kind: "designation" as const }
        : { ...name, value: name.value.normalize("NFC") },
    )
    .filter((name) => name.value);
  const headers = table.columns.map((header) =>
    (header.match(/\S+/gu) ?? []).map((token) => ({
      token,
      kind: "header" as const,
      authoredName: token,
      width: measureText(token, size).width,
    })),
  );
  const body = table.columns.map((_, i) =>
    table.rows.flatMap((row) => {
      const value = row.cells[i]!.normalize("NFC");
      const starts = new Uint32Array(value.length),
        ends = new Uint32Array(value.length);
      const nonEdge = new Uint32Array(value.length + 1);
      for (let j = 0; j < value.length; j++)
        nonEdge[j + 1] =
          nonEdge[j]! + (/[,;:()[\]{}<>!?'"/._-]/u.test(value[j]!) ? 0 : 1);
      for (const m of value.matchAll(/\S+/gu)) {
        starts.fill(m.index, m.index, m.index + m[0].length);
        ends.fill(m.index + m[0].length, m.index, m.index + m[0].length);
      }
      return reportTokens(value, names).map((hit) => {
        const start = starts[hit.start]!,
          end = ends[hit.end - 1]!;
        const onlyEdges =
          start <= hit.start &&
          end >= hit.end &&
          nonEdge[hit.start]! -
            nonEdge[start]! +
            nonEdge[end]! -
            nonEdge[hit.end]! ===
            0;
        const suffix = /^[.:][^\s/.:]+$/u.test(value.slice(hit.end, end));
        const token = onlyEdges
          ? value.slice(start, end)
          : hit.value + (suffix ? value[hit.end] : "");
        return {
          token,
          kind: hit.kind,
          authoredName: hit.authoredName,
          width: measureText(token, size).width,
        };
      });
    }),
  );
  const largest = <T extends { width: number }>(values: T[], fallback: T): T =>
    values.reduce((best, v) => (v.width > best.width ? v : best), fallback);
  const empty = {
    token: "",
    kind: "header" as const,
    authoredName: "",
    width: 0,
  };
  const required = headers.map((words, i) =>
    largest([...words, ...body[i]!], empty),
  );
  const wholeMinimum = required.map((v) => v.width + 2.02);
  const wholeWidth = wholeMinimum.reduce((a, b) => a + b, 0);
  const relaxed = headers.map(
    (words, i) =>
      Math.max(
        0,
        ...words.map((v) => headerMinimum(v.token, size)),
        ...body[i]!.map((v) => v.width),
      ) + 2.02,
  );
  const hyphenatedColumns = table.columns.map(() => false);
  const minimum = [...wholeMinimum];
  let total = wholeWidth;
  const releases = minimum
    .map((v, i) => ({ i, saving: v - relaxed[i]! }))
    .filter((v) => v.saving > 0)
    .sort((a, b) => b.saving - a.saving || a.i - b.i);
  for (const { i, saving } of releases) {
    if (total <= width) break;
    hyphenatedColumns[i] = true;
    minimum[i] = relaxed[i]!;
    total -= saving;
  }
  const hyphenate = hyphenatedColumns.some(Boolean);
  const driver = required
    .map((value, column) => ({
      ...(hyphenatedColumns[column]
        ? largest(
            [
              ...body[column]!,
              ...headers[column]!.map((v) => ({
                ...v,
                width: headerMinimum(v.token, size),
              })),
            ],
            empty,
          )
        : value),
      column,
    }))
    .filter((v) => v.token)
    .sort((a, b) => b.width - a.width || a.column - b.column)[0];
  const common = {
    padding: 1,
    hyphenate,
    hyphenatedColumns,
    wholeWidth,
    wholeMinimum,
    minimums: minimum,
    minimumWidth: total,
    driver,
  };
  if (total > width)
    return { ...common, widths: minimum, error: true as const };
  const widths = [...minimum],
    fixed = new Set<number>();
  let available = width;
  while (fixed.size < widths.length) {
    const weight = table.widths.reduce(
      (sum, w, i) => sum + (fixed.has(i) ? 0 : w),
      0,
    );
    const constrained = minimum
      .map((_, i) => i)
      .filter(
        (i) =>
          !fixed.has(i) &&
          (available * table.widths[i]!) / weight < minimum[i]!,
      );
    if (!constrained.length) {
      for (let i = 0; i < widths.length; i++)
        if (!fixed.has(i)) widths[i] = (available * table.widths[i]!) / weight;
      break;
    }
    for (const i of constrained) {
      fixed.add(i);
      available -= minimum[i]!;
    }
  }
  return { ...common, widths, error: false as const };
}
