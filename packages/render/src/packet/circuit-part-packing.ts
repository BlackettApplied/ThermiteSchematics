import type { CircuitDrawing } from "../circuit.js";
import { circuitGroupFootprint } from "./circuit-footprint.js";

export const MAX_CIRCUIT_PART_COLUMNS = 4;
export const CIRCUIT_PART_GAP = 8;
export interface CircuitPartCell {
  group: CircuitDrawing;
  width: number;
  x: number;
}
export interface CircuitPartRow {
  width: number;
  height: number;
  cells: CircuitPartCell[];
}
export interface CircuitPartField {
  flow: "left-to-right" | "top-to-bottom" | undefined;
  columns: 1 | 2;
  authoredGroups: number;
  columnWidth: number;
  fieldWidth: number;
  available: number;
  noteLines: number;
}

function legacyRows(
  groups: readonly CircuitDrawing[],
  field: CircuitPartField,
) {
  return groups.map((group) => {
    const width =
      group.width > field.columnWidth + 0.001
        ? field.fieldWidth
        : field.columnWidth;
    return {
      width: group.width,
      height: circuitGroupFootprint(group, width).height,
      cells: [{ group, width, x: 0 }],
    };
  });
}
function viewPages(rows: readonly CircuitPartRow[], field: CircuitPartField) {
  let pages = 1,
    cursor = 0;
  for (const row of rows) {
    if (cursor + row.height > field.available) {
      pages++;
      cursor = 0;
    }
    cursor += row.height;
  }
  if (field.noteLines && cursor + 5 + field.noteLines * 3.5 > field.available)
    pages++;
  return pages;
}
function completePartSet(groups: readonly CircuitDrawing[]) {
  const first = groups[0];
  return (
    groups.length > 1 &&
    first &&
    groups.every(
      (g, i) =>
        g.id === first.id &&
        g.pagination?.part === i + 1 &&
        g.pagination.total === groups.length,
    )
  );
}
function packedRows(
  groups: readonly CircuitDrawing[],
  columns: number,
  field: CircuitPartField,
): CircuitPartRow[] | undefined {
  const width =
    (field.columnWidth - (columns - 1) * CIRCUIT_PART_GAP) / columns;
  if (width <= 0 || groups.some((g) => g.width > width + 0.001))
    return undefined;
  const heights = groups.map((g) => circuitGroupFootprint(g, width).height);
  if (heights.some((h) => !Number.isFinite(h) || h > field.available))
    return undefined;
  const rows: CircuitPartRow[] = [];
  for (let at = 0; at < groups.length; at += columns)
    rows.push({
      width: field.columnWidth,
      height: Math.max(...heights.slice(at, at + columns)),
      cells: groups.slice(at, at + columns).map((group, i) => ({
        group,
        width,
        x: i * (width + CIRCUIT_PART_GAP),
      })),
    });
  const selected = rows.flatMap((row) => row.cells.map((cell) => cell.group));
  return selected.length === groups.length &&
    selected.every((group, i) => group === groups[i])
    ? rows
    : undefined;
}

/** Pack only parts of one authored group inside its one existing column.
 * Whole-group fit and source partitioning run first. No ELK request, route,
 * symbol, caption size or native part identity changes here. The original
 * next-fit placement wins every tie, including the view-note page cost. */
export function circuitPartRows(
  groups: readonly CircuitDrawing[],
  field: CircuitPartField,
) {
  const original = legacyRows(groups, field);
  if (
    field.flow !== "top-to-bottom" ||
    field.columns !== 1 ||
    field.authoredGroups !== 1 ||
    !completePartSet(groups) ||
    (field.noteLines && 5 + field.noteLines * 3.5 > field.available)
  )
    return original;
  let winner = original,
    pages = viewPages(original, field);
  for (
    let columns = 2;
    columns <= Math.min(MAX_CIRCUIT_PART_COLUMNS, groups.length);
    columns++
  ) {
    const rows = packedRows(groups, columns, field);
    if (!rows) continue;
    const cost = viewPages(rows, field);
    if (cost < pages) {
      winner = rows;
      pages = cost;
    }
  }
  return winner;
}
