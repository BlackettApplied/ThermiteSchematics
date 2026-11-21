import { expect, it } from "vitest";
import { compareProject } from "../../../evals/engine/oracle.mjs";
import { renderSchematic } from "../src/renderer.js";
import { prepareCircuitView } from "../src/circuit.js";
import { circuitMark } from "../src/symbols/circuit.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { identityCircuit, identityProject } from "./symbol-identity-fixture.js";
import { contractProject } from "./rooted-profile-contracts.js";

// Independent acceptance oracle: every circuit contact mark, both normal states.
// Do not derive identities, classes or roles from the production resolver.
const acceptance = [
  [undefined, "ais:overload-pole", "overload", "overload-pole"],
  ["overload", "ais:overload-pole", "overload", "overload-pole"],
  ["fuse", "ais:fuse", "protection", "breaker-pole"],
  ["breaker", "ais:breaker-pole", "protection", "breaker-pole"],
  ["contact-no", "ais:contact-no", "power-contact", "power-contact"],
  ["contact-nc", "ais:contact-nc", "power-contact", "power-contact"],
  ["switch-no", "ais:switch-no", "power-contact", "power-contact"],
  ["switch-nc", "ais:switch-nc", "power-contact", "power-contact"],
  ["pushbutton-no", "ais:pushbutton-no", "power-contact", "power-contact"],
  ["pushbutton-nc", "ais:pushbutton-nc", "power-contact", "power-contact"],
  ["pressure-no", undefined, undefined, undefined],
  ["pressure-nc", undefined, undefined, undefined],
  ["level-no", undefined, undefined, undefined],
  ["level-nc", undefined, undefined, undefined],
] as const;
const flows = ["left-to-right", "top-to-bottom"] as const;
const advice =
  "Check the profile and authored function shape against the symbol catalog; a profile change does not change connectivity.";
function refusal(state: string, mark: string, kind = "contact") {
  const cause = `Unsupported power protection identity: normal_state=${kind === "contact" ? JSON.stringify(state) : "not applicable"}, circuitSymbols=${JSON.stringify(mark)}. No rooted power primitive for this authored mark. Use a circuit view to retain the authored identity.`;
  return {
    cause,
    message: `Unsupported symbol profile: device "DUT", type "local:dut", profile "thermite:overload" has no power rule for function "function" (${kind}/2; terminals DUT.A, DUT.B). ${cause} ${advice}`,
  };
}

for (const state of ["open", "closed"] as const)
  for (const [mark, symbolId, classification, traversalRole] of acceptance)
    it.each(flows)(
      `overload power ${state}/${mark ?? "unmarked"} pins the complete rule in %s`,
      async (flow) => {
        const wrongState =
          (mark?.endsWith("-no") && state !== "open") ||
          (mark?.endsWith("-nc") && state !== "closed");
        const f = await identityProject(
          "thermite:overload",
          `power-${state}`,
          "power",
          (t) => {
            if (mark && !wrongState) t.circuitSymbols = { function: mark };
          },
        );
        try {
          const type = f.ir.deviceTypes.find((t) => t.id === "local:dut")!;
          // State-inconsistent source is rejected by the compiler. Inject it only
          // in this IR robustness case to pin the renderer's existing refusal.
          if (wrongState) type.circuitSymbols = { function: mark! };
          const before = JSON.stringify(f.ir);
          const fn = f.ir.functions.find(
            (v) => v.id.functionKey === "function",
          )!;
          expect(
            projectDeviceTypeSymbolMappings(f.ir)
              .find((m) => m.typeId === type.id)!
              .functions.filter((r) => r.families.includes("power")),
          ).toEqual(
            symbolId
              ? [
                  {
                    functionKey: "function",
                    families: ["power"],
                    symbolId,
                    classification,
                    traversalRole,
                    bindings: [
                      { portId: "in", terminalKey: "A" },
                      { portId: "out", terminalKey: "B" },
                    ],
                  },
                ]
              : [],
          );
          const result = await renderSchematic(f.ir, {
            ...(f.request as object),
            flow,
          });
          if (!symbolId) {
            const expected = refusal(state, mark!);
            expect(result).toMatchObject({
              ok: false,
              error: {
                code: "R002",
                reason: "unsupported-symbol-profile",
                message: expected.message,
                details: { cause: expected.cause },
              },
            });
          } else if (wrongState) {
            expect(result).toMatchObject({
              ok: false,
              error: { code: "R003" },
            });
          } else {
            expect(result.ok, JSON.stringify(result)).toBe(true);
            if (!result.ok) throw Error(result.error.message);
            expect(result.value.svg).toContain(`data-symbol-id="${symbolId}"`);
            expect(result.value.summary.conductiveElementIds).toEqual(
              f.ir.wires
                .map((w) => ({ kind: "wire", uid: w.uid }))
                .sort((a, b) => a.uid.localeCompare(b.uid)),
            );
          }
          // Circuit identity and its state compatibility remain independent.
          if (wrongState)
            expect(() => circuitMark(type, fn)).toThrow(
              "incompatible with its declared function",
            );
          else {
            expect(circuitMark(type, fn)).toBe(mark ?? "overload");
            const circuit = await prepareCircuitView(
              f.ir,
              identityCircuit(f.ir, flow),
            );
            expect(circuit.groups[0]!.content).toContain(
              `data-circuit-mark="${mark ?? "overload"}"`,
            );
            expect(circuit.groups[0]!.coverage.functionIds).toEqual([
              JSON.stringify([fn.id.deviceUid, fn.id.functionKey]),
            ]);
          }
          expect(JSON.stringify(f.ir)).toBe(before);
        } finally {
          await f.dispose();
        }
      },
    );

for (const state of ["open", "closed"] as const)
  it.each(flows)(
    `overload auxiliary ${state} control ignores power identity overrides in %s`,
    async (flow) => {
      const f = await contractProject(
        "thermite:overload",
        `aux-${state}`,
        "control",
      );
      try {
        const type = f.ir.deviceTypes.find((t) => t.id === "local:dut")!;
        const fn = f.ir.functions.find((v) => v.id.functionKey === "function")!;
        const symbolId =
          state === "open" ? "ais:contact-no" : "ais:overload-contact-nc";
        for (const [mark] of acceptance) {
          type.circuitSymbols = mark ? { function: mark } : undefined;
          const before = JSON.stringify(f.ir);
          const mapping = projectDeviceTypeSymbolMappings(f.ir).find(
            (m) => m.typeId === type.id,
          )!;
          expect(mapping.functions).toEqual([
            {
              functionKey: "function",
              families: ["control"],
              symbolId,
              bindings: [
                { portId: "in", terminalKey: "A" },
                { portId: "out", terminalKey: "B" },
              ],
              classification: "protection",
              traversalRole: "protection-contact",
            },
          ]);
          const result = await renderSchematic(f.ir, {
            ...(f.request as object),
            flow,
          });
          expect(result.ok, JSON.stringify(result)).toBe(true);
          if (result.ok)
            expect(result.value.svg).toContain(`data-symbol-id="${symbolId}"`);
          const wrongState =
            (mark?.endsWith("-no") && state !== "open") ||
            (mark?.endsWith("-nc") && state !== "closed");
          if (!wrongState)
            expect(circuitMark(type, fn)).toBe(
              mark ?? (state === "open" ? "contact-no" : "contact-nc"),
            );
          expect(JSON.stringify(f.ir)).toBe(before);
        }
      } finally {
        await f.dispose();
      }
    },
  );

for (const mark of [
  "fuse",
  "interface",
  "thermocouple",
  "level-sensor",
  "conductivity-probe",
] as const)
  it.each(flows)(
    `overload other/2 ${mark} keeps its refusal with a specific cause in %s`,
    async (flow) => {
      const f = await identityProject(
        "thermite:overload",
        "other",
        "power",
        (t) => {
          t.circuitSymbols = { function: mark };
        },
      );
      try {
        const expected = refusal("", mark, "other");
        const r = await renderSchematic(f.ir, {
          ...(f.request as object),
          flow,
        });
        expect(r).toMatchObject({
          ok: false,
          error: {
            code: "R002",
            reason: "unsupported-symbol-profile",
            message: expected.message,
            details: { cause: expected.cause },
          },
        });
        expect(
          projectDeviceTypeSymbolMappings(f.ir).find(
            (m) => m.typeId === "local:dut",
          )!.functions,
        ).toEqual([]);
        const circuit = await prepareCircuitView(
          f.ir,
          identityCircuit(f.ir, flow),
        );
        expect(circuit.groups[0]!.content).toContain(
          `data-circuit-mark="${mark}"`,
        );
      } finally {
        await f.dispose();
      }
    },
  );

it("overload power marks do not grant unsupported shapes or terminal roles", async () => {
  const f = await contractProject("thermite:overload", "power-closed", "power");
  try {
    const type = f.ir.deviceTypes.find((t) => t.id === "local:dut")!;
    type.circuitSymbols = { function: "fuse" };
    const main = type.functions.find((fn) => fn.key === "function")!;
    const powerRules = () =>
      projectDeviceTypeSymbolMappings(f.ir)
        .find((m) => m.typeId === type.id)!
        .functions.filter((r) => r.families.includes("power"));
    for (const roles of [
      [undefined, undefined],
      ["aux", "aux"],
      ["power_output", "power_input"],
      ["power_input", "aux"],
    ]) {
      type.terminals.forEach((t, i) => (t.role = roles[i]));
      expect(powerRules()).toEqual([]);
    }
    type.terminals.forEach(
      (t, i) => (t.role = i === 0 ? "power_input" : "power_output"),
    );
    main.terminalKeys = ["A"];
    expect(powerRules()).toEqual([]);
  } finally {
    await f.dispose();
  }
});

it.each(flows)(
  "overload mixed functions preserve source nets, clones and per-function marks in %s",
  async (flow) => {
    const f = await identityProject(
      "thermite:overload",
      "power-open",
      "power",
      (t) => {
        t.terminals.C = { role: "power_input" };
        t.terminals.D = { role: "power_output" };
        t.terminals.E = { role: "aux" };
        t.terminals.F = { role: "aux" };
        t.functions.spare = {
          kind: "contact",
          normal_state: "closed",
          terminals: ["C", "D"],
        };
        t.functions.aux = {
          kind: "contact",
          normal_state: "closed",
          terminals: ["E", "F"],
        };
        t.circuitSymbols = {
          function: "contact-no",
          spare: "fuse",
          aux: "fuse",
        };
      },
    );
    try {
      await compareProject(f.root);
      const before = JSON.stringify(f.ir);
      const rules = (ir: typeof f.ir) =>
        projectDeviceTypeSymbolMappings(ir).find(
          (m) => m.typeId === "local:dut",
        )!.functions;
      const original = rules(f.ir).sort((a, b) =>
        a.functionKey.localeCompare(b.functionKey),
      );
      expect(original.map((r) => [r.functionKey, r.symbolId])).toEqual([
        ["aux", "ais:overload-contact-nc"],
        ["function", "ais:contact-no"],
        ["spare", "ais:fuse"],
      ]);
      const r = await renderSchematic(f.ir, { ...(f.request as object), flow });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) throw Error(r.error.message);
      const clone = structuredClone(f.ir);
      const type = clone.deviceTypes.find((t) => t.id === "local:dut")!;
      type.terminals.reverse();
      type.functions.reverse();
      type.circuitSymbols = Object.fromEntries(
        Object.entries(type.circuitSymbols!).reverse(),
      );
      expect(
        rules(clone).sort((a, b) => a.functionKey.localeCompare(b.functionKey)),
      ).toEqual(original);
      const again = await renderSchematic(clone, {
        ...(f.request as object),
        flow,
      });
      expect(again).toEqual(r);
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  },
);
