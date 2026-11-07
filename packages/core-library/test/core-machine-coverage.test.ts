import { beforeAll, describe, expect, it } from "vitest";
import { SYMBOL_PROFILES } from "@thermite/schema";
import { symbolFunctionMatchesShape } from "@thermite/compiler";
import { renderSchematic } from "../../render/src/renderer.js";
import { coreTypes, machineProbe } from "./machine-fixtures.js";
import { probeMachineCircuit } from "./machine-circuit.js";
import matrix from "./fixtures/machine-render-matrix.json";

let types: any[];
beforeAll(async () => {
  types = await coreTypes();
});
it("inventories every 0.2.0 type exactly once in the reviewed matrix", () => {
  expect(types.map((t) => t.id.slice(5)).sort()).toEqual(
    matrix.map((t) => t.type).sort(),
  );
  expect(types).toHaveLength(33);
});

for (const row of matrix)
  describe(`core:${row.type} / ${row.profile ?? "physical cable cores"}`, () => {
    it("conforms to the exact catalog function × family contract", () => {
      const type = types.find((t) => t.id === `core:${row.type}`)!;
      if (type.kind === "cable_type") {
        expect(row.reason).toContain(
          "cable_type has no profile/coverage fields",
        );
        expect(type.symbol).toBeUndefined();
        expect(type.connectionCoverage).toBeUndefined();
        return;
      }
      expect(type.symbol).toBe(row.profile);
      const profile = SYMBOL_PROFILES.find(
        (p) => p.id === type.symbol || p.aliases.includes(type.symbol),
      );
      expect(profile).toBeDefined();
      if (!profile) throw Error(`Missing profile: ${type.symbol}`);
      if ("functionShapes" in row)
        expect(
          Object.fromEntries(
            Object.entries(type.functions).map(([key, f]: [string, any]) => [
              key,
              `${f.kind}/${f.terminals.length}`,
            ]),
          ),
        ).toEqual(row.functionShapes);
      for (const family of ["circuit", "power", "control", "loads"] as const) {
        const actual = Object.entries(type.functions)
          .filter(
            ([, f]: any) =>
              f.kind !== "mechanism" &&
              profile.support.some(
                (s) =>
                  s.family === family &&
                  s.functions.some((shape) =>
                    symbolFunctionMatchesShape(type, f, shape),
                  ),
              ),
          )
          .map(([key]) => key)
          .sort();
        expect(actual, `${type.id}/${family}`).toEqual(row.bindings![family]);
      }
    });
    it.each(["left-to-right", "top-to-bottom"] as const)(
      "pins all circuit functions and packet support in %s, including a new-ID clone",
      async (flow) => {
        const type = types.find((t) => t.id === `core:${row.type}`);
        await probeMachineCircuit(type, row, flow);
      },
      30000,
    );
    if (row.probes)
      for (const family of ["power", "control", "loads"] as const) {
        const cases = [
          row.probes[family],
          ...(row.additionalProbes ?? []).filter((p) => p.family === family),
        ];
        for (const expected of cases)
          it.each(["left-to-right", "top-to-bottom"] as const)(
            `${family}/${expected.key}: ${expected.outcome} in %s`,
            async (flow) => {
              const type = types.find((t) => t.id === `core:${row.type}`)!;
              const fixture = await machineProbe(type, family, expected.key);
              try {
                const result = await renderSchematic(fixture.ir, {
                  ...fixture.request,
                  flow,
                });
                expect(
                  result.ok,
                  `${type.id}/${family}: ${JSON.stringify(result.ok ? {} : result)}`,
                ).toBe(expected.outcome === "renders");
                if (result.ok) {
                  if (type.kind === "cable_type")
                    expect(result.value.svg).toContain(
                      fixture.ir.cables[0]!.uid,
                    );
                  else
                    expect(result.value.summary.deviceUids).toContain(
                      fixture.ir.devices.find((d) => d.designation === "DUT")!
                        .uid,
                    );
                } else {
                  expect(result.error.code).toBe(expected.code);
                  expect(
                    "reason" in result.error ? result.error.reason : null,
                  ).toBe(expected.reason);
                  if (expected.reason === "unsupported-symbol-profile")
                    expect(result.error).toMatchObject({
                      unsupported: {
                        designation: "DUT",
                        typeId: type.id,
                        profile: type.symbol,
                        functionKey: expected.functionKey,
                        family: family === "loads" ? "control" : family,
                      },
                    });
                  else expect(result.error.message).toBe(expected.message);
                }
              } finally {
                await fixture.dispose();
              }
            },
            30000,
          );
      }
  });
