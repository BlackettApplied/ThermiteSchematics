import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ValidatedDeviceType } from "@thermite/schema";
import {
  compileProject,
  expandResolvedProject,
  loadProject,
  resolveLoadedProject,
  serializeIr,
  writeLibraryLock,
  type ElectricalIr,
  type IrDeviceTypeFunction,
} from "../src/index.js";
import { circuitSymbolsRule } from "../src/rules/circuit-symbols.js";
import { createRuleContext } from "../src/rules/context.js";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/rules/invalid-circuit-symbol",
);
let root: string;
let baseline: ElectricalIr;
const sourceType: ValidatedDeviceType = {
  kind: "device_type",
  id: "fixture:module",
  symbol: "thermite:breaker",
  terminals: { I: {}, O: {}, "95": {}, "96": {}, "13": {}, "14": {}, PE: {} },
  functions: {
    power: { kind: "contact", normal_state: "closed", terminals: ["I", "O"] },
    "aux/~": {
      kind: "contact",
      normal_state: "closed",
      terminals: ["95", "96"],
    },
    trip: { kind: "contact", normal_state: "open", terminals: ["13", "14"] },
    bond: { kind: "bus", terminals: ["PE"] },
  },
  circuitSymbols: {
    trip: "contact-no",
    power: "breaker",
    "aux/~": "contact-nc",
    bond: "earth",
  },
};
async function writeType(type: ValidatedDeviceType) {
  await writeFile(
    join(root, "library/types/module.json"),
    JSON.stringify({ types: [type] }, null, 2) + "\n",
  );
  const loaded = await loadProject(root);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  await writeLibraryLock(loaded.project);
  return loaded.project;
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "thermite-circuit-symbols-"));
  await cp(fixture, root, { recursive: true });
  await writeType(sourceType);
  const result = await compileProject(root);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  baseline = result.ir;
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

type Mark = NonNullable<ValidatedDeviceType["circuitSymbols"]>[string];
function evaluateShape(
  kind: IrDeviceTypeFunction["kind"],
  count: number,
  mark: Mark,
  state: "open" | "closed" = "open",
) {
  const ir = structuredClone(baseline);
  const type = ir.deviceTypes[0]!;
  const f = {
    key: "shape",
    kind,
    terminalKeys: Array.from({ length: count }, (_, i) => String(i)),
    source: type.source,
    ...(kind === "contact" ? { normal_state: state } : {}),
    ...(kind === "channel" ? { direction: "input" as const } : {}),
  } as IrDeviceTypeFunction;
  type.functions = [f];
  type.circuitSymbols = { shape: mark };
  return circuitSymbolsRule.evaluate(createRuleContext(ir));
}

describe("explicit circuit symbol bindings", () => {
  it("rejects an unknown function at the exact escaped source pointer", async () => {
    const result = await compileProject(fixture);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      JSON.parse(await readFile(join(fixture, "expected.json"), "utf8")),
    );
    expect(result.diagnostics[0]).toMatchObject({
      code: "E206",
      line: 17,
      column: 22,
      jsonPointer: "/types/0/circuitSymbols/missing~1~0",
    });
  });

  it.each([
    ["contact", 2, "contact-no", "closed"],
    ["contact", 2, "contact-nc", "open"],
    ["contact", 2, "switch-no", "closed"],
    ["contact", 2, "switch-nc", "open"],
    ["contact", 2, "pushbutton-no", "closed"],
    ["contact", 2, "pushbutton-nc", "open"],
    ["load", 2, "coil"],
    ["coil", 2, "load"],
    ["bus", 2, "earth"],
    ["bus", 2, "terminal"],
    ["load", 1, "motor"],
    ["load", 4, "motor"],
    ["load", 3, "lamp"],
    ["load", 3, "winding"],
    ["source", 5, "source"],
    ["source", 3, "winding"],
    ["channel", 2, "thermocouple"],
    ["other", 0, "interface"],
    ["other", 9, "interface"],
    ["other", 1, "fuse"],
    ["mechanism", 0, "interface"],
  ] as const)("rejects %s/%i with %s (%s)", (kind, count, mark, state) => {
    expect(evaluateShape(kind, count, mark, state)).toMatchObject([
      { code: "E206", message: expect.stringContaining("incompatible") },
    ]);
  });

  it.each([
    ["contact", 2, "contact-no", "open"],
    ["contact", 2, "contact-nc", "closed"],
    ["contact", 2, "switch-no", "open"],
    ["contact", 2, "switch-nc", "closed"],
    ["contact", 2, "pushbutton-no", "open"],
    ["contact", 2, "pushbutton-nc", "closed"],
    ["contact", 2, "breaker"],
    ["contact", 2, "overload"],
    ["contact", 2, "fuse"],
    ["coil", 2, "coil"],
    ["coil", 2, "solenoid"],
    ["load", 2, "motor"],
    ["load", 3, "motor"],
    ["load", 2, "heater"],
    ["load", 3, "heater"],
    ["load", 2, "load"],
    ["load", 3, "load"],
    ["load", 2, "lamp"],
    ["load", 2, "winding"],
    ["source", 2, "winding"],
    ["source", 1, "source"],
    ["source", 4, "source"],
    ["bus", 1, "terminal"],
    ["bus", 1, "earth"],
    ["channel", 1, "interface"],
    ["channel", 2, "interface"],
    ["other", 1, "interface"],
    ["other", 8, "interface"],
    ["other", 2, "fuse"],
    ["other", 2, "thermocouple"],
  ] as const)("accepts %s/%i with %s (%s)", (kind, count, mark, state) => {
    expect(evaluateShape(kind, count, mark, state)).toEqual([]);
  });

  it("detaches authored marks and source provenance during expansion and serialization", async () => {
    const loaded = await loadProject(root);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    const resolution = resolveLoadedProject(loaded.project);
    const expanded = expandResolvedProject(resolution);
    const authored = loaded.project.libraries[0]!.sources[0]!.value
      .types[0]! as ValidatedDeviceType;
    const type = expanded.deviceTypes[0]!;
    expect(type.circuitSymbols).toEqual(sourceType.circuitSymbols);
    expect(type.circuitSymbols).not.toBe(authored.circuitSymbols);
    authored.circuitSymbols!.power = "contact-nc";
    expect(type.circuitSymbols!.power).toBe("breaker");
    type.circuitSymbols!["aux/~"] = "switch-nc";
    expect(authored.circuitSymbols!["aux/~"]).toBe("contact-nc");

    const bytes = serializeIr(baseline);
    const roundtrip = JSON.parse(bytes) as ElectricalIr;
    expect(roundtrip.deviceTypes[0]!.circuitSymbols).toEqual(
      sourceType.circuitSymbols,
    );
    expect(
      roundtrip.deviceTypes[0]!.circuitSymbolSources!["aux/~"]!.jsonPointer,
    ).toBe("/types/0/circuitSymbols/aux~1~0");
    expect(serializeIr(roundtrip)).toBe(bytes);
    roundtrip.deviceTypes[0]!.circuitSymbols = Object.fromEntries(
      Object.entries(roundtrip.deviceTypes[0]!.circuitSymbols!).reverse(),
    );
    expect(serializeIr(roundtrip)).toBe(bytes);
    roundtrip.deviceTypes[0]!.circuitSymbolSources!["aux/~"]!.line = 999;
    expect(
      baseline.deviceTypes[0]!.circuitSymbolSources!["aux/~"]!.line,
    ).not.toBe(999);
  });

  it("retains separate diagnostics and exact provenance after an IR roundtrip", () => {
    const ir = JSON.parse(serializeIr(baseline)) as ElectricalIr;
    ir.deviceTypes[0]!.circuitSymbols!["aux/~"] = "contact-no";
    ir.deviceTypes[0]!.circuitSymbols!.trip = "contact-nc";
    const before = serializeIr(ir);
    const errors = circuitSymbolsRule.evaluate(createRuleContext(ir));
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toMatchObject({
        code: "E206",
        file: "library/types/module.json",
      });
      expect(error.line).toBeGreaterThan(20);
      expect(error.jsonPointer).toMatch(/^\/types\/0\/circuitSymbols\//);
    }
    expect(errors[0]!.jsonPointer).toBe("/types/0/circuitSymbols/aux~1~0");
    expect(errors[0]!.related![0]!.note).toContain('"aux/~"');
    expect(serializeIr(ir)).toBe(before);
  });

  it("never changes physical nets or functions, and omits absent optional metadata", async () => {
    const withoutMarks = structuredClone(sourceType);
    delete withoutMarks.circuitSymbols;
    await writeType(withoutMarks);
    const result = await compileProject(root);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.ir.nets).toEqual(baseline.nets);
    expect(result.ir.functions).toEqual(baseline.functions);
    expect(result.ir.nets).toHaveLength(7);
    expect(result.ir.nets.every((net) => net.terminalIds.length === 1)).toBe(
      true,
    );
    expect(result.ir.deviceTypes[0]).not.toHaveProperty("circuitSymbols");
    expect(result.ir.deviceTypes[0]).not.toHaveProperty("circuitSymbolSources");
    expect(serializeIr(result.ir)).not.toContain("circuitSymbol");
  });
});
