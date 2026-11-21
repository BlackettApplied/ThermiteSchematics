import { beforeAll, expect, it } from "vitest";
import {
  compileProject,
  type ElectricalIr,
  type IrFunction,
} from "@thermite/compiler";
import { printedFunction } from "../src/print-projection.js";
import { referenceTables } from "../src/packet/references.js";
import { circuitMark } from "../src/symbols/circuit.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const compiled = await compileProject("examples/machine-demo");
  if (!compiled.ok) throw new Error("fixture compilation failed");
  ir = compiled.ir;
});
function facts(designation: string, terminal: string) {
  const device = ir.devices.find((d) => d.designation === designation);
  if (!device) throw new Error("missing fixture device");
  const type = ir.deviceTypes.find((t) => t.id === device.typeId);
  const fn = ir.functions.find(
    (f) =>
      f.id.deviceUid === device.uid &&
      f.terminals.some((t) => t.terminalKey === terminal),
  );
  if (!type || !fn) throw new Error("missing fixture function/type");
  return { device, type, fn };
}
it("names the drawn protection class without projecting source contact state", () => {
  for (const [device, mark, noun] of [
    ["CB1", "breaker", "Breaker pole"],
    ["OL1", "overload", "Overload element"],
  ]) {
    if (!device) throw new Error("missing designation");
    const { fn, type } = facts(device, "1/L1");
    expect(circuitMark(type, fn)).toBe(mark);
    expect(fn.normal_state).toBe("closed");
    expect(printedFunction(fn, type)).toBe(`${noun} 1/L1–2/T1`);
    expect(printedFunction(fn, type)).not.toMatch(
      /thermal|electronic|NC contact|\(NC\)|\(NO\)/i,
    );
  }
});
it("keeps a real 95–96 auxiliary NC and does not infer construction or role from names", () => {
  const { fn, type } = facts("OL1", "95");
  expect(circuitMark(type, fn)).toBe("contact-nc");
  expect(printedFunction(fn, type)).toBe("NC contact 95–96");
  const renamed = {
    ...fn,
    id: { ...fn.id, functionKey: "breaker_thermal_main" },
  };
  expect(printedFunction(renamed, type)).toBe("NC contact 95–96");
  expect(printedFunction(fn)).toBe("NC contact 95–96");
});
it("honours an explicit contact glyph instead of guessing from a protective profile", () => {
  const { fn, type } = facts("CB1", "1/L1");
  const contactType = {
    ...type,
    circuitSymbols: {
      ...type.circuitSymbols,
      [fn.id.functionKey]: "contact-nc",
    },
  };
  expect(circuitMark(contactType, fn)).toBe("contact-nc");
  expect(printedFunction(fn, contactType)).toBe("NC contact 1/L1–2/T1");
  const renamed: IrFunction = {
    ...fn,
    id: { ...fn.id, functionKey: "arbitrary" },
  };
  expect(printedFunction(renamed, type)).toBe(printedFunction(fn, type));
});
it("prints role-aware reference rows without changing source identities or auxiliary wording", () => {
  const before = JSON.stringify(ir);
  const items = [
    facts("CB1", "1/L1"),
    facts("OL1", "1/L1"),
    facts("OL1", "95"),
  ];
  const tables = referenceTables(
    ir,
    [
      {
        view: { format: "documentation-view/0.1", kind: "io" },
        references: items.map(({ device, fn }) => ({
          deviceUid: device.uid,
          designation: device.designation,
          functions: [fn.id.functionKey],
          zone: "A1",
        })),
      },
    ],
    {},
    undefined,
  ).tables;
  const rows = tables.flatMap((t) => t.rows);
  for (const { device, fn, type } of items) {
    const row = rows.find(
      (r) => r.key === JSON.stringify([device.uid, [fn.id.functionKey]]),
    );
    expect(row?.cells[1]).toBe(printedFunction(fn, type));
  }
  expect(rows.some((r) => r.cells[1] === "Overload element 1/L1–2/T1")).toBe(
    true,
  );
  expect(JSON.stringify(ir)).toBe(before);
});

it("names a declared fuse element without inventing a contact state", () => {
  const { fn, type } = facts("CB1", "1/L1");
  const fuseType = { ...type, symbol: "thermite:fuse", circuitSymbols: {} };
  const element: IrFunction = { ...fn, kind: "other" };
  expect(circuitMark(fuseType, element)).toBe("fuse");
  expect(printedFunction(element, fuseType)).toBe("Fuse element 1/L1–2/T1");
  expect(printedFunction(element)).toBe("Other 1/L1–2/T1");
});

it("omits NO and NC from protective captions while preserving authored state and genuine NO contacts", () => {
  const { fn, type } = facts("CB1", "1/L1");
  for (const normal_state of ["open", "closed"] as const) {
    const element = { ...fn, normal_state };
    const before = JSON.stringify(element);
    expect(printedFunction(element, type)).toBe("Breaker pole 1/L1–2/T1");
    expect(
      printedFunction(element, {
        ...type,
        symbol: "thermite:fuse",
        circuitSymbols: { [fn.id.functionKey]: "fuse" },
      }),
    ).toBe("Fuse element 1/L1–2/T1");
    expect(JSON.stringify(element)).toBe(before);
  }
  const { fn: auxiliary, type: overload } = facts("OL1", "95");
  expect(
    printedFunction({ ...auxiliary, normal_state: "open" }, overload),
  ).toBe("NO contact 95–96");
});
