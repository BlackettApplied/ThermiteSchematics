import { expect, it } from "vitest";
import type { CircuitDrawing } from "../src/circuit.js";
import {
  circuitPartRows,
  MAX_CIRCUIT_PART_COLUMNS,
  type CircuitPartField,
} from "../src/packet/circuit-part-packing.js";
import { required } from "./fixtures.js";
import { circuitGroupFootprint } from "../src/packet/circuit-footprint.js";
const field: CircuitPartField = {
  flow: "top-to-bottom",
  columns: 1,
  authoredGroups: 1,
  columnWidth: 375.8,
  fieldWidth: 375.8,
  available: 130,
  noteLines: 0,
};
function parts(total = 2, width = 100, height = 100): CircuitDrawing[] {
  return Array.from({ length: total }, (_, i) => ({
    id: "g",
    label: "Group",
    width,
    height,
    content: `native-part-${i + 1}`,
    references: [],
    coverage: {
      conductorIds: [`wire-${i + 1}`],
      functionIds: [`function-${i + 1}`],
      terminalIds: [],
      boundaryTerminalIds: [],
    },
    pagination: { part: i + 1, total, terminals: [] },
  }));
}
it("keeps every native part rigid, ordered and separated inside the authored column", () => {
  const input = parts().map((p, i) => ({ ...p, height: i ? 70 : 100 })),
    before = JSON.stringify(input),
    rows = circuitPartRows(input, field),
    row = required(rows[0]),
    a = required(row.cells[0]),
    b = required(row.cells[1]);
  expect(rows).toHaveLength(1);
  expect(row.cells.map((c) => c.group)).toEqual(input);
  expect(row.height).toBe(
    Math.max(
      ...row.cells.map((c) => circuitGroupFootprint(c.group, c.width).height),
    ),
  );
  expect(a.group).toBe(input[0]);
  expect(b.group).toBe(input[1]);
  expect(b.x - a.x - a.width).toBe(8);
  expect(b.x + b.width).toBeLessThanOrEqual(field.columnWidth);
  expect(JSON.stringify(input)).toBe(before);
});
it.each([undefined, "left-to-right"] as const)(
  "preserves the original layout for flow %s",
  (flow) => {
    const input = parts(),
      rows = circuitPartRows(input, { ...field, flow });
    expect(rows.map((r) => r.cells.map((c) => c.group))).toEqual(
      input.map((p) => [p]),
    );
  },
);
it("does not share width with another authored column", () => {
  const input = parts(2, 40, 80);
  const rows = circuitPartRows(input, {
    ...field,
    columns: 2,
    columnWidth: (field.fieldWidth - 8) / 2,
  });
  expect(rows.map((r) => r.cells.map((c) => c.group))).toEqual(
    input.map((p) => [p]),
  );
});
it("does not mix native parts of different authored groups", () => {
  const input = [
    ...parts().map((p) => ({ ...p, id: "a" })),
    ...parts().map((p) => ({ ...p, id: "b" })),
  ];
  const rows = circuitPartRows(input, { ...field, authoredGroups: 2 });
  expect(rows.map((r) => r.cells.map((c) => c.group))).toEqual(
    input.map((p) => [p]),
  );
});
it("keeps an incomplete or reordered part set in its original placement", () => {
  const input = parts(3);
  for (const selected of [input.slice(0, 2), [...input].reverse()])
    expect(
      circuitPartRows(selected, field).map((r) => r.cells.map((c) => c.group)),
    ).toEqual(selected.map((p) => [p]));
});
it("includes the existing view-note page cost before accepting an improvement", () => {
  const input = parts(2, 80),
    rows = circuitPartRows(input, {
      ...field,
      columnWidth: 220,
      fieldWidth: 220,
      noteLines: 2,
    });
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.cells.length === 1)).toBe(true);
});
it("rejects a cell that cannot contain its native drawing at readable size", () => {
  const rows = circuitPartRows(parts(), {
    ...field,
    columnWidth: 190,
    fieldWidth: 190,
  });
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.cells.length === 1)).toBe(true);
});
it("rejects the taller reference block caused by narrowing a cell", () => {
  const rows = circuitPartRows(parts(4, 80), {
    ...field,
    columnWidth: 220,
    fieldWidth: 220,
    available: 116,
  });
  expect(rows).toHaveLength(4);
  expect(rows.every((r) => r.cells.length === 1)).toBe(true);
});
it("keeps the original output when packing would only tie its page count", () => {
  const input = parts(),
    rows = circuitPartRows(input, { ...field, available: 300 });
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.cells.length === 1)).toBe(true);
});
it("bounds the width enumeration and retains the first equal-cost candidate", () => {
  const input = parts(5, 80, 70),
    rows = circuitPartRows(input, {
      ...field,
      columnWidth: 1000,
      fieldWidth: 1000,
      available: 100,
    });
  expect(MAX_CIRCUIT_PART_COLUMNS).toBe(4);
  expect(rows.map((r) => r.cells.length)).toEqual([3, 2]);
  expect(rows.flatMap((r) => r.cells.map((c) => c.group))).toEqual(input);
});
