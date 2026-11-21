import { printedFunction } from "../src/print-projection.js";
import { printedPort, formatTerminalSet } from "@thermite/query";
import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { referenceTables } from "../src/packet/references.js";
import { printableCaption } from "../src/symbols/printable-policy.js";
import { prepareCommunicationDrawing } from "../src/communication.js";
import { parseHTML } from "linkedom";

let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/machine-demo");
  if (!c.ok) throw Error("compile");
  ir = c.ir;
});
const visible = (svg: string) =>
  [...parseHTML(`<svg>${svg}</svg>`).document.querySelectorAll("text")].map(
    (e) => e.textContent,
  );
it("projects arbitrary function selectors using kind, state and bound terminals only", () => {
  const base = ir.functions.find((f) => f.kind === "contact")!;
  const fn = {
    ...base,
    id: { ...base.id, functionKey: "aux95_main_999" },
    terminals: [
      { deviceUid: base.id.deviceUid, terminalKey: "13" },
      { deviceUid: base.id.deviceUid, terminalKey: "14" },
    ],
  };
  expect(
    printedFunction({ ...fn, kind: "contact", normal_state: "open" }),
  ).toBe("NO contact 13–14");
  expect(
    printedFunction({ ...fn, kind: "contact", normal_state: "closed" }),
  ).toBe("NC contact 13–14");
  expect(printedFunction({ ...fn, kind: "coil" })).toBe("Coil 13–14");
  expect(printedFunction({ ...fn, kind: "other", terminals: [] })).toBe(
    "Other",
  );
  expect(
    printedFunction({
      ...fn,
      kind: "coil",
      terminals: [
        { deviceUid: fn.id.deviceUid, terminalKey: "A–B" },
        { deviceUid: fn.id.deviceUid, terminalKey: "<&>" },
      ],
    }),
  ).toBe("Coil A–B / <&>");
});
it("keeps reference row identity and IR intact while printing semantic function facts", () => {
  const before = JSON.stringify(ir);
  const fn = ir.functions.find((f) => f.kind === "coil")!;
  const d = ir.devices.find((d) => d.uid === fn.id.deviceUid)!;
  const tables = referenceTables(
    ir,
    [
      {
        view: {
          format: "documentation-view/0.1",
          kind: "io",
          title: "Synthetic",
        },
        references: [
          {
            deviceUid: d.uid,
            designation: d.designation,
            functions: [fn.id.functionKey],
            zone: "A1",
          },
        ],
      },
    ],
    {},
    undefined,
  ).tables;
  const row = tables[1]!.rows[0]!;
  expect(row.key).toBe(JSON.stringify([d.uid, [fn.id.functionKey]]));
  expect(row.cells[1]).toBe(printedFunction(fn));
  expect(JSON.stringify(ir)).toBe(before);
});
it("prints I/O addresses or terminal identities; CSV retains channel lookup keys", () => {
  const input = structuredClone(ir);
  const fn = input.functions.find((f) => f.kind === "channel")!;
  const d = input.devices.find((d) => d.uid === fn.id.deviceUid)!;
  const report = (output: "print" | "csv") =>
    buildDocumentation(
      input,
      { format: "documentation-view-request/0.1", kind: "io" },
      undefined,
      { output },
    ).rows.find((r) => r.key === JSON.stringify([d.uid, fn.id.functionKey]))!;
  d.io = {
    addressSpace: "PLC",
    channels: {
      [fn.id.functionKey]: {
        address: "Q0.0",
        signal: "coil core: authored prose",
      },
    },
  };
  expect(report("print").cells[1]).toBe("Q0.0");
  expect(report("print").cells[5]).toBe("coil core: authored prose");
  expect(report("csv").cells[1]).toBe(fn.id.functionKey);
  expect(report("csv").cells[6]).toBe(
    fn.terminals.map((t) => `${d.designation}.${t.terminalKey}`).join(", "),
  );
  expect(report("print").cells[6]).toBe(
    formatTerminalSet(
      fn.terminals.map((t) => t.terminalKey),
      (key) => `${d.designation}.${key}`,
    ),
  );
  delete d.io;
  expect(report("print").cells[1]).toBe(
    formatTerminalSet(fn.terminals.map((t) => t.terminalKey)),
  );
});
it("prints authored port identities with optional supplemental descriptions", () => {
  expect(
    printedPort(
      {
        ports: {
          arbitrary: {
            medium: "ethernet",
            connector: "RJ45",
            description: "coil core: reader text",
          },
        },
      },
      "arbitrary",
    ),
  ).toBe("arbitrary — coil core: reader text");
  expect(
    printedPort(
      { ports: { arbitrary: { medium: "ethernet", connector: "RJ45" } } },
      "arbitrary",
    ),
  ).toBe("arbitrary");
  expect(printedPort(undefined, "arbitrary")).toBe("arbitrary");
});
it("never manufactures a part or rating when type descriptions are missing", () => {
  const input = structuredClone(ir);
  for (const t of input.deviceTypes) delete t.description;
  for (const t of input.cableTypes) delete t.description;
  const table = buildDocumentation(input, {
    format: "documentation-view-request/0.1",
    kind: "bom",
  });
  for (const row of table.rows)
    expect(row.cells[5]).toBe("Type description not specified");
  expect(table.notes.join(" ")).not.toContain("type ID shown");
  const csv = buildDocumentation(
    input,
    { format: "documentation-view-request/0.1", kind: "bom" },
    undefined,
    { output: "csv" },
  );
  expect(
    csv.rows.some((r) => input.deviceTypes.some((t) => r.cells[5] === t.id)),
  ).toBe(true);
});
it("keeps transformer source-winding captions independent of selector spelling", () => {
  const fn = ir.functions.find((f) => f.kind === "source")!;
  const type = ir.deviceTypes.find(
    (t) => t.id === ir.devices.find((d) => d.uid === fn.id.deviceUid)!.typeId,
  )!;
  for (const key of ["secondary", "output", "nested.arbitrary_44"])
    expect(
      printableCaption({
        kind: "function",
        fn: { ...fn, id: { ...fn.id, functionKey: key } },
        type,
        mark: "ais:source-winding",
      }),
    ).toBe("source");
});

it("consistent function renames preserve reference and I/O print cells, not source row keys", () => {
  const renamed = structuredClone(ir),
    rename = (key: string) => `nested.${key}_938`;
  for (const fn of renamed.functions)
    fn.id.functionKey = rename(fn.id.functionKey);
  for (const relation of renamed.internalRelations) {
    relation.from.functionKey = rename(relation.from.functionKey);
    relation.to.functionKey = rename(relation.to.functionKey);
  }
  for (const group of renamed.gangedGroups)
    for (const fn of group.functionIds) fn.functionKey = rename(fn.functionKey);
  for (const type of renamed.deviceTypes) {
    for (const fn of type.functions) fn.key = rename(fn.key);
    for (const relation of type.internalRelations) {
      relation.fromFunctionKey = rename(relation.fromFunctionKey);
      relation.toFunctionKey = rename(relation.toFunctionKey);
    }
    if (type.circuitSymbols)
      type.circuitSymbols = Object.fromEntries(
        Object.entries(type.circuitSymbols).map(([key, value]) => [
          rename(key),
          value,
        ]),
      );
    if (type.circuitSymbolSources)
      type.circuitSymbolSources = Object.fromEntries(
        Object.entries(type.circuitSymbolSources).map(([key, value]) => [
          rename(key),
          value,
        ]),
      );
  }
  for (const d of renamed.devices)
    if (d.io)
      d.io.channels = Object.fromEntries(
        Object.entries(d.io.channels).map(([k, v]) => [rename(k), v]),
      );
  const refs = (input: ElectricalIr) =>
    referenceTables(
      input,
      [
        {
          view: {
            format: "documentation-view/0.1",
            kind: "io",
            title: "Synthetic",
          },
          references: input.devices.map((d) => ({
            deviceUid: d.uid,
            designation: d.designation,
            functions: input.functions
              .filter((f) => f.id.deviceUid === d.uid)
              .map((f) => f.id.functionKey),
            zone: "A1",
          })),
        },
      ],
      {},
      undefined,
    ).tables[1]!;
  expect(refs(renamed).rows.map((r) => r.cells)).toEqual(
    refs(ir).rows.map((r) => r.cells),
  );
  const report = (input: ElectricalIr) =>
    buildDocumentation(input, {
      format: "documentation-view-request/0.1",
      kind: "io",
    });
  expect(report(renamed).rows.map((r) => r.cells)).toEqual(
    report(ir).rows.map((r) => r.cells),
  );
  expect(report(renamed).rows.map((r) => r.key)).not.toEqual(
    report(ir).rows.map((r) => r.key),
  );
});

it("retains conventional source/load pairs and lists separated numeric suffixes", () => {
  const base = ir.functions.find((f) => f.kind === "source");
  if (!base) throw Error("Missing source fixture");
  for (const [keys, expected] of [
    [["H1", "H2"], "H1–H2"],
    [["X1", "X2"], "X1–X2"],
    [["L", "N"], "L–N"],
    [["AI3", "AI7"], "AI3 / AI7"],
    [["9", "13"], "9 / 13"],
  ] as const) {
    const fn = {
      ...base,
      terminals: keys.map((terminalKey) => ({
        deviceUid: base.id.deviceUid,
        terminalKey,
      })),
    };
    expect(printedFunction(fn)).toBe(`Source ${expected}`);
  }
});
