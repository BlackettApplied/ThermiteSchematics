import { expect, it } from "vitest";
import { compareProject } from "../../../evals/engine/oracle.mjs";
import { SYMBOL_PROFILES } from "@thermite/schema";
import {
  createSchematicRendererWithDependencies,
  renderSchematic,
} from "../src/renderer.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { contractProject } from "./rooted-profile-contracts.js";

const cases = [
  ["thermite:fuse", "contact-closed", "ais:fuse", "breaker-pole"],
  ["thermite:fuse", "other", "ais:fuse", "breaker-pole"],
  ["thermite:breaker", "power-closed", "ais:breaker-pole", "breaker-pole"],
  ["thermite:breaker", "aux-open", "ais:contact-no", "power-contact"],
  ["thermite:breaker", "aux-closed", "ais:contact-nc", "power-contact"],
] as const;

for (const [profile, mode, symbol, powerRole] of cases)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `${profile}/${mode} draws authored control ink and preserves physical nets in %s`,
    async (flow) => {
      const fixture = await contractProject(profile, mode, "control");
      try {
        await compareProject(fixture.root);
        const { ir } = fixture;
        const before = JSON.stringify(ir);
        const dut = ir.devices.find((d) => d.designation === "DUT")!;
        const type = ir.deviceTypes.find((t) => t.id === dut.typeId)!;
        const mapping = projectDeviceTypeSymbolMappings(ir).find(
          (m) => m.typeId === type.id,
        )!;
        const control = mapping.functions.find((f) =>
          f.families.includes("control"),
        )!;
        const power = mapping.functions.find((f) =>
          f.families.includes("power"),
        )!;
        expect(control).toMatchObject({
          symbolId: symbol,
          traversalRole: "protection-contact",
        });
        expect(power).toMatchObject({
          symbolId: symbol,
          traversalRole: powerRole,
        });
        const nets = type.functions[0]!.terminalKeys.map(
          (key) =>
            ir.nets.find((n) =>
              n.terminalIds.some(
                (t) => t.deviceUid === dut.uid && t.terminalKey === key,
              ),
            )!.id,
        );
        expect(new Set(nets).size).toBe(2);
        const request = { ...(fixture.request as object), flow };
        const result = await renderSchematic(ir, request);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) throw Error(result.error.message);
        expect(result.value.svg).toContain(`data-symbol-id="${symbol}"`);
        expect(result.value.summary.conductiveElementIds).toEqual(
          expect.arrayContaining(
            ir.wires.map((w) => ({ kind: "wire", uid: w.uid })),
          ),
        );
        expect(result.value.summary.conductiveElementIds).toHaveLength(
          ir.wires.length,
        );
        expect(JSON.stringify(ir)).toBe(before);

        // New type and designation cannot bypass or remove the profile binding.
        const clone = structuredClone(ir);
        const clonedType = clone.deviceTypes.find((t) => t.id === type.id)!;
        clonedType.id = "local:unrelated";
        const clonedDut = clone.devices.find((d) => d.uid === dut.uid)!;
        clonedDut.typeId = clonedType.id;
        clonedDut.designation = "Q77";
        clone.indexes.instanceRefsByTypeId.find((i) => i.key === type.id)!.key =
          clonedType.id;
        clone.indexes.objectRefByDesignation.find((i) => i.key === "DUT")!.key =
          "Q77";
        const cloned = await renderSchematic(clone, request);
        expect(cloned.ok, JSON.stringify(cloned)).toBe(true);
        if (!cloned.ok) throw Error(cloned.error.message);
        expect(cloned.value.svg).toContain(`data-symbol-id="${symbol}"`);
        expect(cloned.value.summary.netIds).toEqual(
          result.value.summary.netIds,
        );
        expect(cloned.value.summary.conductiveElementIds).toEqual(
          result.value.summary.conductiveElementIds,
        );
      } finally {
        await fixture.dispose();
      }
    },
  );

for (const [profile, mode] of cases)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `${profile}/${mode} adds no loads support in %s`,
    async (flow) => {
      expect(
        SYMBOL_PROFILES.find((p) => p.id === profile)!.support.filter(
          (s) => s.family === "loads",
        ),
      ).toEqual([]);
      const fixture = await contractProject(profile, mode, "loads");
      try {
        const result = await renderSchematic(fixture.ir, {
          ...(fixture.request as object),
          flow,
        });
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "R002",
            message:
              'Incomplete loads view: the requested source has no complete renderable load. Device "PS1", function "dc_output".',
          },
        });
      } finally {
        await fixture.dispose();
      }
    },
  );

for (const [profile, mode] of cases)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `${profile}/${mode} refuses invalid control arity in %s`,
    async (flow) => {
      const fixture = await contractProject(profile, mode, "control");
      try {
        for (const count of [1, 3]) {
          const ir = structuredClone(fixture.ir);
          const dut = ir.devices.find((d) => d.designation === "DUT")!;
          const type = ir.deviceTypes.find((t) => t.id === dut.typeId)!;
          const fn = type.functions[0]!;
          const instance = ir.functions.find(
            (f) => f.id.deviceUid === dut.uid,
          )!;
          fn.terminalKeys =
            count === 1 ? fn.terminalKeys.slice(1) : [...fn.terminalKeys, "A"];
          instance.terminals =
            count === 1
              ? instance.terminals.slice(1)
              : [...instance.terminals, instance.terminals[0]!];
          const result = await renderSchematic(ir, {
            ...(fixture.request as object),
            flow,
          });
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: "R002",
              reason: "unsupported-symbol-profile",
              unsupported: {
                profile,
                family: "control",
                functionKey: "function",
              },
            },
          });
        }
      } finally {
        await fixture.dispose();
      }
    },
  );

for (const mode of ["contact-closed", "other"])
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `reverting ${mode} to the power traversal role leaves F1 stopped in %s`,
    async (flow) => {
      const fixture = await contractProject("thermite:fuse", mode, "control");
      try {
        const { ir } = fixture;
        const dut = ir.devices.find((d) => d.designation === "DUT")!;
        dut.designation = "F1";
        ir.indexes.objectRefByDesignation.find((i) => i.key === "DUT")!.key =
          "F1";
        const mappings = structuredClone(projectDeviceTypeSymbolMappings(ir));
        for (const mapping of mappings.filter((m) => m.typeId === dut.typeId))
          for (const rule of mapping.functions.filter((f) =>
            f.families.includes("control"),
          ))
            Object.assign(rule, { traversalRole: "breaker-pole" });
        const result = await createSchematicRendererWithDependencies({
          mappings,
        }).render(ir, { ...(fixture.request as object), flow });
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "R002",
            details: {
              stoppedAt: [
                {
                  designation: "F1",
                  terminalKey: "B",
                  functionKeys: ["function"],
                },
              ],
            },
          },
        });
      } finally {
        await fixture.dispose();
      }
    },
  );

for (const [mode, explicit, symbol] of [
  ["power-open", "contact-no", "ais:contact-no"],
  ["power-closed", "contact-nc", "ais:contact-nc"],
  ["aux-closed", "breaker", "ais:breaker-pole"],
] as const)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `keeps the explicit breaker ${explicit} identity in control in %s`,
    async (flow) => {
      const fixture = await contractProject(
        "thermite:breaker",
        mode,
        "control",
      );
      try {
        fixture.ir.deviceTypes.find(
          (t) => t.id === "local:dut",
        )!.circuitSymbols = { function: explicit };
        const result = await renderSchematic(fixture.ir, {
          ...(fixture.request as object),
          flow,
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) throw Error(result.error.message);
        expect(result.value.svg).toContain(`data-symbol-id="${symbol}"`);
      } finally {
        await fixture.dispose();
      }
    },
  );
