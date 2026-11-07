import type { ElectricalIr } from "@thermite/compiler";
import type { DocumentationTable } from "@thermite/query";
import { describeCodePoint, measureText } from "../text-metrics.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { n, text } from "./svg.js";
import {
  reportColumns,
  reportTokens,
  reportTextSegments,
  reportHeaderParts,
  type ReportName,
} from "./report-column-widths.js";
import type { PaperPage } from "./types.js";

const REPORT_CELL_SIZE = 2.6;

/** The fixed-size measured cell policy, including contextual row/column diagnostics. */
export function reportCells(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  width: number,
  page?: PaperPage,
) {
  const cellSize = REPORT_CELL_SIZE;
  const designations = new Map(
    [...ir.devices, ...ir.wires, ...ir.jumpers, ...ir.cables].map((entity) => [
      entity.uid,
      entity.designation,
    ]),
  );
  const names: ReportName[] = [
    ...[...designations.values(), ...ir.relations.map((r) => r.designation)]
      .filter((v): v is string => !!v)
      .map((value) => ({
        value: value.normalize("NFC"),
        kind: "designation" as const,
      })),
    ...[
      ...ir.devices.map((d) => d.location),
      ...ir.cables.flatMap((c) => [c.fromLocation, c.toLocation]),
    ].flatMap((location) =>
      location
        ? [{ value: location.normalize("NFC"), kind: "location" as const }]
        : [],
    ),
  ];
  const allocation = reportColumns(table, width, cellSize, names);
  const { widths, padding } = allocation;
  const maxMargin = (minimum: number) => {
    if (!page) return undefined;
    // Bounds reserve 18 mm at each side in addition to the page margin.
    return Math.floor((page.widthMm - 36 - minimum) * 500) / 1000;
  };
  const headerMargin = maxMargin(allocation.wholeWidth);
  const headerNote = allocation.hyphenate
    ? headerMargin !== undefined && headerMargin >= 5
      ? `Hyphenated headers; whole words at margins ≤ ${headerMargin} mm.`
      : page?.orientation === "landscape"
        ? "Hyphenated headers; use larger paper for whole words."
        : "Hyphenated headers; use larger paper or landscape for whole words."
    : undefined;
  const fits = (s: string, w: number) =>
    measureText(s.trim(), cellSize).width <= w;
  const wrapHeader = (value: string, w: number, column: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of value.match(/\S+/gu) ?? []) {
      if (fits(line ? line + " " + word : word, w)) {
        line += (line ? " " : "") + word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      const parts = allocation.hyphenatedColumns[column]
        ? reportHeaderParts(word, w, cellSize)
        : fits(word, w)
          ? [word]
          : undefined;
      if (!parts)
        throw Error("A header word cannot fit with readable hyphen fragments.");
      lines.push(...parts.slice(0, -1));
      line = parts.at(-1)!;
    }
    return [...lines, line];
  };
  const wrapCell = (value: string, w: number): string[] =>
    value
      .normalize("NFC")
      .split(/\r\n|[\n\r\u2028\u2029]/u)
      .flatMap((paragraph) => {
        // Tokenize/protect once. Each line visits only its own clusters, rather
        // than searching or measuring the entire remaining name-dense string.
        const spans = reportTokens(paragraph, names);
        const blocked = new Uint8Array(paragraph.length + 1);
        const aspect = new Set<number>();
        for (const hit of spans) {
          blocked.fill(1, hit.start + 1, hit.end);
          if (hit.kind === "designation" && /^[=+-]/u.test(hit.value))
            aspect.add(hit.start);
        }
        const safe = (i: number) =>
          !blocked[i] &&
          (!/[-/.:_]/u.test(paragraph[i] ?? "") || aspect.has(i));
        const units: { value: string; start: number }[] = [];
        let cursor = 0;
        for (const m of paragraph.matchAll(/\s+/gu)) {
          if (blocked[m.index]) continue;
          if (m.index > cursor)
            units.push({
              value: paragraph.slice(cursor, m.index),
              start: cursor,
            });
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
          if (fits(line + unit, w)) {
            line += unit;
            continue;
          }
          if (line.trim()) {
            lines.push(line.trim());
            line = "";
          }
          const clusters = [...reportTextSegments(unit)];
          let first = 0;
          while (first < clusters.length) {
            const begin = clusters[first]!.index;
            let last = first,
              fallback = -1,
              separator = -1,
              edge = -1;
            for (; last < clusters.length; last++) {
              const part = clusters[last]!,
                end = part.index + part.segment.length;
              if (!fits(unit.slice(begin, end), w)) break;
              const absolute = start + end;
              if (!safe(absolute)) continue;
              fallback = last + 1;
              if (/[-/.:_]$/u.test(part.segment)) separator = last + 1;
              if (aspect.has(absolute)) edge = last + 1;
            }
            if (last === clusters.length) {
              line = unit.slice(begin);
              break;
            }
            const next =
              separator >= 0 ? separator : edge >= 0 ? edge : fallback;
            if (next < 0)
              throw Error(
                "An authored designation or location cannot fit without splitting.",
              );
            const end =
              next < clusters.length ? clusters[next]!.index : unit.length;
            lines.push(unit.slice(begin, end).trim());
            first = next;
          }
        }
        return [...lines, line.trim()];
      });
  // Restore each 2 mm inset only if every cell keeps its line count. Thus the
  // compact allocation retains exactly its row/sheet capacity, column by column.
  const insets = widths.map((w, i) => {
    if (padding === 2) return 2;
    const compact = w - 2.01,
      normal = w - 4.01;
    if (normal <= 0) return 1;
    if (
      !allocation.hyphenatedColumns[i] &&
      (table.columns[i]!.match(/\S+/gu) ?? []).some(
        (word) => !fits(word, normal),
      )
    )
      return 1;
    try {
      if (
        wrapHeader(table.columns[i]!, normal, i).length !==
        wrapHeader(table.columns[i]!, compact, i).length
      )
        return 1;
      if (
        table.rows.some(
          (row) =>
            wrapCell(row.cells[i]!, normal).length >
            wrapCell(row.cells[i]!, compact).length,
        )
      )
        return 1;
      return 2;
    } catch {
      return 1;
    }
  });
  const rowDesignation = (index: number) => {
    const source = table.rows[index]!;
    let name = designations.get(source.key);
    if (!name) {
      // Terminal/core report keys contain an owner UUID and terminal/core key.
      try {
        const key: unknown = JSON.parse(source.key);
        if (
          Array.isArray(key) &&
          typeof key[0] === "string" &&
          designations.get(key[0])
        )
          name = [designations.get(key[0]), ...key.slice(1)].join(" / ");
      } catch {
        /* Other reports use ordinary string keys. */
      }
    }
    name ??=
      designations.get(source.deviceUids[0] ?? "") ??
      source.cells[0]?.split(/\r?\n/u)[0] ??
      source.key;
    return name;
  };
  const rowName = (index: number) =>
    `${index + 1} (${JSON.stringify(rowDesignation(index))})`;
  const unknownReason = (value: string) => {
    const unknown = measureText(value, cellSize).unknownGlyphs;
    return unknown.length
      ? ` Unknown glyphs use bounded fallback metrics: ${unknown.map(describeCodePoint).join(", ")}. Check these characters in the label; their browser fallback metrics are estimates.`
      : "";
  };
  const context = (row: string, column: number) =>
    `Report ${JSON.stringify(table.title)} (${table.kind}), row ${row}, column ${column + 1} ${JSON.stringify(table.columns[column])}`;
  const split = (cells: readonly string[], row: string): string[][] => {
    // Allocation failures describe the actual driver, outside the per-cell catch.
    if (allocation.error) {
      const driver = allocation.driver!;
      const shorter =
        driver.kind === "designation" ? ", or a shorter designation" : "";
      // Width alone cannot prove that a smaller margin also fits the rows.
      const advice =
        page?.orientation === "landscape"
          ? "Use larger paper or shorter authored text."
          : `Use larger paper, landscape${shorter}.`;
      throw Error(
        `Report ${JSON.stringify(table.title)} (${table.kind}), column ${driver.column + 1} ${JSON.stringify(table.columns[driver.column])}: ${driver.kind} ${JSON.stringify(driver.authoredName)} drives a minimum table width of ${allocation.minimumWidth.toFixed(3)} mm; only ${width.toFixed(3)} mm is available. ${advice}`,
      );
    }
    return cells.map((value, i) => {
      try {
        return row === "header"
          ? wrapHeader(value, widths[i]! - 2 * insets[i]! - 0.01, i)
          : wrapCell(value, widths[i]! - 2 * insets[i]! - 0.01);
      } catch (error) {
        throw Error(
          `${context(row, i)}: ${error instanceof Error ? error.message : "Text cannot fit."}${unknownReason(value)} ${page?.orientation === "landscape" ? "Use larger paper or shorter authored text" : "Use larger paper, landscape, or shorter authored text"}; text is never shrunk below the fixed ${cellSize} mm size (minimum 2.5 mm).`,
        );
      }
    });
  };
  const geometry = (cells: string[][], heading = false) => {
    const metrics = cells.flat().map((value) => measureText(value, cellSize)),
      ascent = Math.max(0, ...metrics.map((m) => m.ascent)),
      descent = Math.max(0, ...metrics.map((m) => m.descent)),
      lineHeight = Math.max(3.6, ascent + descent + 0.6),
      baseline = Math.max(4, ascent + 1),
      count = Math.max(...cells.map((c) => c.length));
    return {
      padding,
      insets,
      headerNote: heading ? headerNote : undefined,
      noteHeight: heading && headerNote ? 4 : 0,
      baseline,
      lineHeight,
      height:
        (heading && headerNote ? 4 : 0) +
        Math.max(
          count * 3.6 + (heading ? 5 : 4),
          baseline + (count - 1) * lineHeight + descent + 1,
        ),
    };
  };
  return {
    widths,
    cellSize,
    rowDesignation,
    rowName,
    unknownReason,
    context,
    split,
    geometry,
  };
}

export function emitReportRow(
  cells: string[][],
  height: number,
  widths: readonly number[],
  columns: readonly string[],
  left: number,
  y: number,
  geometry: ReturnType<typeof reportCells>["geometry"],
  heading = false,
): string[] {
  const content: string[] = [],
    cellSize = REPORT_CELL_SIZE;
  const { baseline, lineHeight, insets, noteHeight, headerNote } = geometry(
    cells,
    heading,
  );
  let x = left;
  // Paint the entire row before any text, so no later background can erase it.
  cells.forEach((_, i) => {
    content.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(widths[i]!)}" height="${n(height - noteHeight)}" fill="${heading ? "#e9eef4" : "white"}" stroke="#9ba6b4" stroke-width="0.2"/>`,
    );
    x += widths[i]!;
  });
  x = left;
  cells.forEach((lines, i) => {
    content.push(
      `<g data-report-column="${i + 1}" data-column-name="${attr(columns[i]!)}" data-cell-x="${n(x)}" data-cell-y="${n(y)}" data-cell-width="${n(widths[i]!)}" data-cell-height="${n(height - noteHeight)}">`,
    );
    lines.forEach((value, j) =>
      content.push(
        text(
          x + insets[i]!,
          y + baseline + j * lineHeight,
          value.trim(),
          cellSize,
          "start",
          heading ? 700 : 400,
        ).replace("<text ", '<text xml:space="preserve" '),
      ),
    );
    content.push("</g>");
    x += widths[i]!;
  });
  if (headerNote)
    content.push(
      `<g data-report-header-note="true">${text(left, y + height - 0.8, headerNote, 2.5)}</g>`,
    );
  return content;
}
