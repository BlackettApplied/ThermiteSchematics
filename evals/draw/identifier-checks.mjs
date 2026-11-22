import { IdentifierMeasurementError } from "./identifier-errors.mjs";
import { expectedIdentifierCells } from "./identifier-policy.mjs";

const uncertainty = 0.17; // existing 300 dpi geometry uncertainty, mm
const whitespace = (s) => /\s/u.test(s ?? "");
const centerX = (box) => box.x + box.w / 2;
const paintedBox = (run) => run.paintedBox ?? run.bbox;

function physicalLines(runs, medium) {
  const lines = [];
  const separators = [];
  for (const run of runs)
    if (!Number.isFinite(run.anchor?.y) || !Number.isFinite(run.anchor?.x))
      throw new IdentifierMeasurementError(
        "Identifier measurement: missing physical baseline",
      );
  for (const run of [...runs].sort(
    (a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x,
  )) {
    // PDF.js can infer a space on a baseline with no painted text in this cell.
    // Only character-bearing runs establish PDF lines.
    if (medium === "pdf" && !run.text.trim()) {
      separators.push(run);
      continue;
    }
    let line = lines.find(
      (line) => Math.abs(line.y - run.anchor.y) <= uncertainty,
    );
    if (!line) {
      line = { y: run.anchor.y, runs: [] };
      lines.push(line);
    }
    line.runs.push(run);
  }
  return lines.map((line) => {
    const boxes = line.runs.map(paintedBox);
    const betweenRuns = separators.filter((space) => {
      const x = centerX(space.bbox);
      return (
        Math.abs(line.y - space.anchor.y) <= uncertainty &&
        boxes.some((box) => box.x + box.w <= x) &&
        boxes.some((box) => box.x >= x) &&
        !boxes.some((box) => box.x < x && x < box.x + box.w)
      );
    });
    const position = (run) =>
      medium !== "pdf"
        ? run.anchor.x
        : run.text.trim()
          ? paintedBox(run).x
          : centerX(run.bbox);
    return {
      ...line,
      runs: [...line.runs, ...betweenRuns].sort(
        (a, b) => position(a) - position(b),
      ),
    };
  });
}
function alignCell(expected, lines, medium) {
  const characters = lines.flatMap((line, index) => {
    const chars = line.runs.flatMap((run) =>
      run.text
        .normalize("NFC")
        .split("")
        .map((char) => ({ char, line: index, run })),
    );
    if (medium !== "pdf") return chars;
    return chars.slice(
      chars.findIndex(({ char }) => !whitespace(char)),
      chars.findLastIndex(({ char }) => !whitespace(char)) + 1,
    );
  });
  const mapping = [];
  let cursor = 0;
  for (let offset = 0; offset < expected.length; offset++) {
    const char = expected[offset];
    if (whitespace(char)) {
      const start = offset;
      while (whitespace(expected[offset + 1])) offset++;
      const before = characters[cursor - 1];
      let count = 0;
      while (
        cursor < characters.length &&
        whitespace(characters[cursor].char)
      ) {
        cursor++;
        count++;
      }
      const after = characters[cursor];
      const boundary = !before || !after || before.line !== after.line;
      const gap =
        before && after
          ? after.run.bbox.x - before.run.bbox.x - before.run.bbox.w
          : 0;
      if (
        !/[\r\n\u2028\u2029]/u.test(expected.slice(start, offset + 1)) &&
        !boundary &&
        count !== offset - start + 1 &&
        gap <= uncertainty
      )
        return null;
      for (let i = start; i <= offset; i++) mapping[i] = after ?? before;
    } else {
      if (characters[cursor]?.char !== char) return null;
      mapping[offset] = characters[cursor++];
    }
  }
  return characters.slice(cursor).some((c) => !whitespace(c.char))
    ? null
    : mapping;
}
function sourceSpans(text, identifiers) {
  const spans = identifiers
    .flatMap((identifier) => {
      const found = [];
      let start = text.indexOf(identifier);
      if (start < 0)
        throw new IdentifierMeasurementError(
          `Identifier measurement: source unit ${JSON.stringify(identifier)} is absent from its query cell`,
        );
      while (start >= 0) {
        found.push({ identifier, start, end: start + identifier.length });
        start = text.indexOf(identifier, start + identifier.length);
      }
      return found;
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let end = -1;
  return spans.filter((span) => {
    if (span.start < end) return false;
    end = span.end;
    return true;
  });
}
function cellRuns(g, expected, cell, medium, pdfRuns) {
  if (medium === "pdf") {
    if (!pdfRuns)
      throw new IdentifierMeasurementError(
        "Identifier measurement: PDF runs missing",
      );
    return pdfRuns.filter((run) => {
      const x = centerX(paintedBox(run));
      return (
        x > cell.bbox.x &&
        x < cell.bbox.x + cell.bbox.w &&
        run.anchor.y > cell.bbox.y &&
        run.anchor.y < cell.bbox.y + cell.bbox.h
      );
    });
  }
  return g.texts
    .filter(
      (t) =>
        t.row === expected.row &&
        t.columnIndex === expected.column &&
        t.painted !== false,
    )
    .flatMap((t) => {
      if (!t.reportRuns)
        throw new IdentifierMeasurementError(
          "Identifier measurement: SVG/HTML character line boxes missing",
        );
      return t.reportRuns;
    });
}

/** Reports physical identifier lines separately for SVG, actual HTML and PDF. */
export function identifierFindings(
  g,
  table,
  ir,
  medium = "svg",
  pdfRuns,
  policy = {},
) {
  if (!Array.isArray(g.reportCells))
    throw new IdentifierMeasurementError(
      "Identifier measurement: independently measured cell rectangles missing",
    );
  const findings = [];
  for (const expected of expectedIdentifierCells(ir, table, policy).filter(
    (cell) => g.reportRows.includes(cell.row),
  )) {
    const cells = g.reportCells.filter(
      (cell) =>
        cell.row === expected.row && cell.columnIndex === expected.column,
    );
    if (cells.length !== 1)
      throw new IdentifierMeasurementError(
        `Identifier measurement: missing or ambiguous cell ${expected.row}/${expected.column}`,
      );
    const cell = cells[0],
      runs = cellRuns(g, expected, cell, medium, pdfRuns),
      lines = physicalLines(runs, medium);
    const mapping = alignCell(expected.text, lines, medium);
    const first = g.texts.find(
      (t) => t.row === expected.row && t.columnIndex === expected.column,
    );
    for (const [ordinal, span] of sourceSpans(
      expected.text,
      expected.identifiers,
    ).entries()) {
      const used = mapping
        ? [
            ...new Set(
              mapping
                .slice(span.start, span.end)
                .filter((c) => c && !whitespace(c.char))
                .map((c) => c.line),
            ),
          ]
        : [];
      if (mapping && used.length === 1) continue;
      findings.push({
        kind: mapping ? "identifier-line-break" : "identifier-text-mismatch",
        medium,
        element: first?.element ?? cell.element,
        designation: span.identifier,
        bbox: cell.bbox,
        reportRow: expected.row,
        columnIndex: expected.column,
        columnName: expected.header,
        identifier: span.identifier,
        identifierIndex: ordinal,
        lineCount: used.length,
        baselines: used.map((i) => lines[i].y),
        fragments: lines.map((line) => ({
          baseline: line.y,
          text: line.runs.map((r) => r.text).join(""),
          boxes: line.runs.map((r) => r.bbox),
        })),
        expected: expected.text,
      });
    }
  }
  return findings;
}
