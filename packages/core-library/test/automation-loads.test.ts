import { expect, it } from "vitest";
import { DOMParser } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { coreTypes, machineProbe } from "./machine-fixtures.js";
import { renderSchematic } from "../../render/src/renderer.js";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "renders RM1's core-only power, actuation and PS1 loads deliverables in %s",
  async (flow) => {
    const compiled = await compileProject(
      "packages/core-library/test/fixtures/rm1",
    );
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.diagnostics.filter((d) => d.severity !== "info")).toEqual(
      [],
    );
    expect(compiled.ir.devices.every((d) => d.typeId.startsWith("core:"))).toBe(
      true,
    );
    for (const [root, family] of [
      ["M1", "power"],
      ["K1", "control"],
    ] as const) {
      const result = await renderSchematic(compiled.ir, {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: root },
        family,
        flow,
      });
      expect(result.ok, JSON.stringify(result.ok ? {} : result)).toBe(true);
    }
    const result = await renderSchematic(compiled.ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
      flow,
    });
    expect(result.ok, JSON.stringify(result.ok ? {} : result)).toBe(true);
    if (!result.ok) throw Error(result.error.message);
    expect(result.value.summary.deviceUids).toContain(
      compiled.ir.devices.find((d) => d.designation === "PLC1")?.uid,
    );
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "renders RM3's combined loads and each supply binding in %s",
  async (flow) => {
    const compiled = await compileProject(
      "packages/core-library/test/fixtures/rm3",
    );
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const result = await renderSchematic(compiled.ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
      flow,
    });
    expect(result.ok, JSON.stringify(result.ok ? {} : result)).toBe(true);
    if (!result.ok) throw Error(result.error.message);
    for (const name of ["B1", "HMI1", "PLC1"]) {
      const device = compiled.ir.devices.find((d) => d.designation === name)!;
      expect(result.value.summary.deviceUids).toContain(device.uid);
      expect(result.value.svg).toContain(`data-designation="${name}"`);
    }
    const svg = new DOMParser().parseFromString(
      result.value.svg,
      "image/svg+xml",
    );
    for (const name of ["W1012", "W1014"]) {
      const wire = compiled.ir.wires.find((w) => w.designation === name)!;
      expect(result.value.summary.conductiveElementIds).toContainEqual({
        kind: "wire",
        uid: wire.uid,
      });
      const paths = svg.querySelectorAll(`path[data-wire-uid="${wire.uid}"]`);
      expect(paths).toHaveLength(1);
      const endpoints = ["source", "target"].map((end) => ({
        deviceUid: paths[0]!.getAttribute(`data-${end}-device-uid`),
        terminalKey: paths[0]!.getAttribute(`data-${end}-terminal-key`),
      }));
      expect(endpoints).toEqual(
        expect.arrayContaining(wire.endpoints.map((e) => e.terminal)),
      );
    }
    // Retain the separate probes of each supply binding as well.
    // Probe each exact RM3 type alone without changing the committed topology.
    const types = await coreTypes();
    for (const name of ["HMI1", "PLC1"]) {
      const typeId = compiled.ir.devices.find(
        (d) => d.designation === name,
      )?.typeId;
      const fixture = await machineProbe(
        types.find((t) => t.id === typeId),
        "loads",
        "supply",
      );
      try {
        const single = await renderSchematic(fixture.ir, {
          ...fixture.request,
          flow,
        });
        expect(single.ok, JSON.stringify(single.ok ? {} : single)).toBe(true);
        if (!single.ok) throw Error(single.error.message);
        expect(single.value.summary.functionIds).toContainEqual({
          deviceUid: fixture.ir.devices.find((d) => d.designation === "DUT")
            ?.uid,
          functionKey: "supply",
        });
      } finally {
        await fixture.dispose();
      }
    }
  },
);
