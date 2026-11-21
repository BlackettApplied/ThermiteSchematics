import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { SHIPPED_CORE_VERSIONS } from "../src/index.js";

export const MACHINE_TYPES = [
  "pushbutton-no",
  "estop-nc",
  "selector-2pos",
  "pilot-light",
  "relay-1co",
  "fuse-1p",
  "fuse-2p",
  "fuse-3p",
  "breaker-1p",
  "breaker-2p",
  "control-transformer",
  "terminal-pe",
  "cable-power-4core",
] as const;

it("ships the generic operator, protection and power interfaces in core 0.2.0", async () => {
  const inventory = SHIPPED_CORE_VERSIONS["0.2.0"]!.fileInventory;
  for (const name of MACHINE_TYPES) {
    const path = `versions/0.2.0/types/${name}.json`;
    expect(inventory, name).toContain(path);
    const type = JSON.parse(
      await readFile(`packages/core-library/${path}`, "utf8"),
    ).types[0];
    expect(type.description).toMatch(/provisional generic/i);
    expect(type.catalog).toBeUndefined();
    expect(JSON.stringify(type)).not.toMatch(
      /"rating"|"size"|"manufacturer"|"orderNumber"/,
    );
    if (type.kind === "device_type") {
      expect(type.symbol).toMatch(/^thermite:/);
      expect(type.connectionCoverage.status).toBe("generic");
      expect(type.connectionCoverage.notes).toMatch(
        /^Reviewed generic interface:/,
      );
      expect(type.connectionCoverage.notes).toContain("Unmodeled:");
      expect(type.connectionCoverage.notes).toContain("Optional:");
    }
  }
});

it("pins the universal required points and keeps every device function non-conductive", async () => {
  const { coreTypes, isolatedMachine } = await import("./machine-fixtures.js");
  const { analyzeCompleteness } = await import("@thermite/compiler");
  const required: Record<string, string[]> = {
    "pushbutton-no": ["13", "14"],
    "estop-nc": ["11", "12"],
    "selector-2pos": ["13", "14"],
    "pilot-light": ["X1", "X2"],
    "relay-1co": ["A1", "A2"],
    "fuse-1p": [],
    "fuse-2p": [],
    "fuse-3p": [],
    "breaker-1p": [],
    "breaker-2p": [],
    "control-transformer": ["H1", "H2"],
    "terminal-pe": ["PE"],
  };
  for (const type of await coreTypes()) {
    const name = type.id.slice(5);
    if (!(name in required)) continue;
    expect(
      Object.entries(type.terminals)
        .filter(([, t]: any) => t.required)
        .map(([key]) => key)
        .sort(),
      name,
    ).toEqual(required[name]!.toSorted());
    const fixture = await isolatedMachine(type);
    try {
      expect(
        fixture.diagnostics.filter(
          (d) => d.severity === "error" || d.code === "W111",
        ),
      ).toEqual([]);
      expect(fixture.ir.nets, name).toHaveLength(
        Object.keys(type.terminals).length,
      );
      const report = analyzeCompleteness(fixture.ir);
      expect(report.findings.filter((f) => f.code === "I003")).toEqual([]);
      expect(
        report.findings
          .filter((f) => f.code === "W903")
          .map((f) => f.key)
          .sort(),
        name,
      ).toEqual(required[name]!.toSorted());
      expect(report.findings.filter((f) => f.code === "I005")).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  }
});
