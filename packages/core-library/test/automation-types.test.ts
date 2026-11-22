import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { analyzeCompleteness } from "@thermite/compiler";
import { coreTypes, isolatedMachine } from "./machine-fixtures.js";

const interfaces: Record<string, { profile: string; required: string[] }> = {
  "plc-8di-8do-2ai": { profile: "io-module", required: ["L+", "M"] },
  hmi: { profile: "io-module", required: ["L+", "M"] },
  "transmitter-2wire-4-20ma": {
    profile: "two-wire-transmitter",
    required: ["+", "-"],
  },
  "level-switch-no": { profile: "level-switch", required: ["13", "14"] },
  "disconnect-3p": { profile: "disconnector", required: [] },
};

it("ships reviewed automation interfaces without rating magnitudes with exact required points", async () => {
  const types = await coreTypes();
  for (const [name, expected] of Object.entries(interfaces)) {
    const type = types.find((t) => t.id === `core:${name}`);
    expect(type, name).toBeDefined();
    expect(type.symbol).toBe(`thermite:${expected.profile}`);
    expect(type.description).toMatch(/^Provisional generic/);
    expect(type.description.length).toBeLessThanOrEqual(100);
    expect(type.connectionCoverage.status).toBe("generic");
    expect(type.connectionCoverage.notes).toMatch(
      /^Reviewed generic interface:/,
    );
    expect(type.connectionCoverage.notes).toContain("Optional:");
    expect(type.connectionCoverage.notes).toContain("Unmodeled:");
    expect(type.catalog).toBeUndefined();
    const dc = name === "plc-8di-8do-2ai" || name === "hmi";
    expect(
      Object.entries(type.terminals)
        .filter(([, t]: any) => t.rating)
        .map(([key, t]: any) => [key, t.rating]),
    ).toEqual(
      dc
        ? [
            ["L+", { voltage_type: "DC" }],
            ["M", { voltage_type: "DC" }],
          ]
        : [],
    );
    if (dc)
      expect(type.description).toContain("DC supply; voltage not specified");
    expect(
      Object.entries(type.terminals)
        .filter(([, t]: any) => t.required)
        .map(([key]) => key)
        .sort(),
    ).toEqual(expected.required.toSorted());
    const fixture = await isolatedMachine(type);
    try {
      expect(fixture.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
      // Functions and feed/association relations never short their terminals.
      expect(fixture.ir.nets).toHaveLength(Object.keys(type.terminals).length);
      const findings = analyzeCompleteness(fixture.ir).findings;
      expect(findings.filter((f) => f.code === "I003")).toEqual([]);
      expect(
        findings
          .filter((f) => f.code === "W903")
          .map((f) => f.key)
          .sort(),
      ).toEqual(expected.required.toSorted());
    } finally {
      await fixture.dispose();
    }
  }
});

it("preserves the PLC's distinct DI, DO and paired AI interfaces plus Ethernet", async () => {
  const type = (await coreTypes()).find((t) => t.id === "core:plc-8di-8do-2ai");
  expect(type).toBeDefined();
  for (const [prefix, count, direction] of [
    ["di", 8, "input"],
    ["do", 8, "output"],
    ["ai", 2, "input"],
  ] as const) {
    for (let i = 0; i < count; i++) {
      expect(type.functions[`${prefix}${i}`]).toEqual({
        kind: "channel",
        direction,
        terminals:
          prefix === "ai"
            ? [`AI${i}+`, `AI${i}-`]
            : [`${prefix.toUpperCase()}${i}`],
      });
    }
  }
  expect(Object.keys(type.functions)).toHaveLength(19);
  expect(type.ports).toEqual({
    ETH: { medium: "ethernet", connector: "unspecified" },
  });
  expect(type.internal_relations).toHaveLength(18);
  for (let i = 0; i < 8; i++) {
    expect(type.terminals[`DI${i}`].role).toBe(`digital_input_${i}`);
    expect(type.terminals[`DO${i}`].role).toBe(`digital_output_${i}`);
  }
  for (let i = 0; i < 2; i++) {
    expect(type.terminals[`AI${i}+`].role).toBe(`analog_input_${i}_positive`);
    expect(type.terminals[`AI${i}-`].role).toBe(`analog_input_${i}_negative`);
  }
  expect(type.connectionCoverage.notes).toContain(
    "separate paired inputs; isolation and shared returns unspecified",
  );
});

it("ships unspecified four-core and single-pair cables without claiming shields or pinouts", async () => {
  const types = await coreTypes();
  for (const [name, ids] of [
    ["cordset-sensor-4core", ["1", "2", "3", "4"]],
    ["cable-instrumentation-1pair", ["1+", "1-"]],
  ] as const) {
    const type = types.find((t) => t.id === `core:${name}`);
    expect(type, name).toBeDefined();
    expect(type.description.length).toBeLessThanOrEqual(100);
    expect(type.conductors).toEqual(ids.map((id) => ({ id, color: "" })));
    expect(type.shield).toBeUndefined();
    expect(type.construction).toBeUndefined();
    expect(type.symbol).toBeUndefined();
  }
  const power = types.find((t) => t.id === "core:cable-power-4core");
  expect(power.description.length).toBeLessThanOrEqual(100);
  const readme = await readFile("packages/core-library/README.md", "utf8");
  expect(readme).toContain("shield/drain");
});

it("uses the core NO contact role for both level-switch terminals", async () => {
  const type = (await coreTypes()).find((t) => t.id === "core:level-switch-no");
  expect(type.terminals["13"].role).toBe("no_contact");
  expect(type.terminals["14"].role).toBe("no_contact");
  expect(type.functions.contact13.normal_state).toBe("open");
});
