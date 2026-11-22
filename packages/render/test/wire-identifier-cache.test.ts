import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { wireColumnProbe } from "../src/packet/report-cells.js";
import { wireColumnArithmetic } from "../src/packet/wire-column-arithmetic.js";
import { reportIdentifiers } from "../src/packet/report-identifiers.js";
import { pruningFixture } from "./wire-column-pruning-fixture.js";
import { independentHeight } from "./wire-column-arithmetic-fixture.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/machine-demo");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
});

function identifierFixture(source: ElectricalIr) {
  const input = structuredClone(source),
    name = "=LINE / -AUX+24V";
  input.jumpers = [];
  input.cables = [];
  input.cableConductors = [];
  input.wires = input.wires.slice(0, 2).map((wire, i) => ({
    ...wire,
    designation: i ? "=LINE" : name,
    properties: {
      ...wire.properties,
      label: i ? "-AUX+24V / prefix " + name : "prefix " + name,
    },
  }));
  return pruningFixture(input);
}

it("keeps equal text with different protected identifiers separate in the cell cache", () => {
  const f = identifierFixture(ir),
    [free, protectedRow] = f.table.rows;
  if (!free || !protectedRow) throw Error("Missing identifier fixture rows");
  expect(free.cells[0]).toBe(protectedRow.cells[0]);
  const identifiers = reportIdentifiers(f.ir, f.table);
  expect(identifiers.get(free.key)?.[0]).toEqual(["=LINE"]);
  expect(identifiers.get(protectedRow.key)?.[0]).toEqual(["=LINE / -AUX+24V"]);
  const probe = wireColumnProbe(
    f.ir,
    f.table,
    f.width,
    f.page,
    f.first.cellSize,
  );
  const widths = probe.widths.map((width, column) =>
    column === 0
      ? 25
      : column === 4
        ? width + (probe.widths[0] ?? 0) - 25
        : width,
  );
  // Deliberately below the protected token minimum: test cache failure isolation,
  // not an emitted allocation. The free aspect boundaries can still wrap.
  const reference = probe.measure(widths);
  const cells = reference.split(free.cells, "free", free.key);
  expect(() =>
    reference.split(protectedRow.cells, "protected", protectedRow.key),
  ).toThrow("cannot fit without splitting");
  const fresh = wireColumnProbe(
    f.ir,
    f.table,
    f.width,
    f.page,
    f.first.cellSize,
  );
  const cached = wireColumnArithmetic(fresh, f.table).candidate(widths);
  expect(cached.rowHeights[0]).toBe(independentHeight(cells, f.first.cellSize));
  expect(cached.errors.has(0)).toBe(false);
  expect(cached.errors.has(1)).toBe(true);
  expect(Number.isNaN(cached.rowHeights[1])).toBe(true);
});
