import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { SYMBOL_PROFILES } from "@thermite/schema";
import { compareProject } from "../../../evals/engine/oracle.mjs";
import { renderSchematic } from "../src/renderer.js";
import { prepareCircuitView } from "../src/circuit.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { circuitMark } from "../src/symbols/circuit.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import {
  identityCircuit,
  identityProject,
  mixedDisconnector,
} from "./symbol-identity-fixture.js";
import { contractProject } from "./rooted-profile-contracts.js";
import { unsupportedProfileError } from "../src/preflight.js";

for (const state of ["open", "closed"] as const)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `draws role-authored ${state} disconnector aux without main-blade identity in %s`,
    async (flow) => {
      const f = await identityProject(
        "thermite:disconnector",
        `aux-${state}`,
        "control",
        mixedDisconnector,
      );
      try {
        await compareProject(f.root);
        expect(f.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
        const before = JSON.stringify(f.ir),
          mark = state === "open" ? "contact-no" : "contact-nc";
        const r = await renderSchematic(f.ir, {
          ...(f.request as object),
          flow,
        });
        expect(r.ok, JSON.stringify(r)).toBe(true);
        if (!r.ok) throw Error(r.error.message);
        expect(r.value.svg).toContain(`data-symbol-id="ais:${mark}"`);
        expect(r.value.svg).not.toContain('data-symbol-id="ais:disconnector"');
        expect(r.value.svg).not.toContain(
          'data-mechanical-association="ganged"',
        );
        expect(
          new Set(r.value.summary.conductiveElementIds.map((e) => e.uid)),
        ).toEqual(new Set(f.ir.wires.map((w) => w.uid)));
        const type = f.ir.deviceTypes.find((t) => t.id === "local:dut")!;
        const rules = projectDeviceTypeSymbolMappings(f.ir).find(
          (m) => m.typeId === type.id,
        )!;
        expect(
          rules.functions.find((r) => r.functionKey === "function"),
        ).toMatchObject({
          families: ["control"],
          symbolId: `ais:${mark}`,
          classification: "permissive",
          traversalRole: "permissive-contact",
        });
        const circuit = await prepareCircuitView(
          f.ir,
          identityCircuit(f.ir, flow, true),
        );
        const doc = parseHTML(
          `<svg>${circuit.groups[0]!.content}</svg>`,
        ).document;
        const dut = f.ir.devices.find((d) => d.designation === "DUT")!;
        for (const [key, expected] of [
          ["function", mark],
          ["spare", "contact-nc"],
          ["main1", "disconnector"],
          ["main2", "disconnector"],
        ]) {
          const row = doc.querySelector(
            `[data-function-id='${JSON.stringify([dut.uid, key])}']`,
          )!;
          expect(
            row
              .querySelector("[data-circuit-mark]")
              ?.getAttribute("data-circuit-mark"),
          ).toBe(expected);
        }
        expect(circuit.groups[0]!.coverage.conductorIds).toHaveLength(
          f.ir.wires.length,
        );
        const gangs = [
          ...doc.querySelectorAll('[data-mechanical-association="ganged"]'),
        ];
        expect(gangs).toHaveLength(1);
        expect(
          JSON.parse(gangs[0]!.getAttribute("data-ganged-functions")!)
            .map((f: any) => f.functionKey)
            .sort(),
        ).toEqual(["main1", "main2"]);
        const unganged = structuredClone(f.ir);
        unganged.gangedGroups = [];
        unganged.internalRelations = unganged.internalRelations.filter(
          (r) => r.verb !== "ganged_with",
        );
        unganged.deviceTypes.find((t) => t.id === type.id)!.internalRelations =
          [];
        const separate = await prepareCircuitView(
          unganged,
          identityCircuit(unganged, flow, true),
        );
        expect(separate.groups[0]!.content).not.toContain(
          'data-mechanical-association="ganged"',
        );
        expect(separate.groups[0]!.coverage).toEqual(
          circuit.groups[0]!.coverage,
        );
        const clone = structuredClone(f.ir),
          t = clone.deviceTypes.find((t) => t.id === type.id)!;
        t.id = "local:unrelated";
        t.terminals.reverse();
        t.functions.reverse();
        clone.devices.find((d) => d.uid === dut.uid)!.typeId = t.id;
        clone.devices.find((d) => d.uid === dut.uid)!.designation = "Z91";
        clone.indexes.instanceRefsByTypeId.find((i) => i.key === type.id)!.key =
          t.id;
        clone.indexes.objectRefByDesignation.find((i) => i.key === "DUT")!.key =
          "Z91";
        const actual = await renderSchematic(clone, {
          ...(f.request as object),
          flow,
        });
        expect(actual.ok, JSON.stringify(actual)).toBe(true);
        if (actual.ok) {
          expect(actual.value.svg).toContain(`data-symbol-id="ais:${mark}"`);
          expect(actual.value.summary.netIds).toEqual(r.value.summary.netIds);
        }
        expect(JSON.stringify(f.ir)).toBe(before);
      } finally {
        await f.dispose();
      }
    },
  );

const advice =
  "Check the profile and authored function shape against the symbol catalog; a profile change does not change connectivity.";
const stateCause = "This disconnector binding requires an open contact.";
function prefix(family: string, shape: string) {
  return `Unsupported symbol profile: device "DUT", type "local:dut", profile "thermite:disconnector" has no ${family} rule for function "function" (${shape}; terminals DUT.A, DUT.B).`;
}
const warning =
  'Device "DUT" type "local:dut" symbol "thermite:disconnector". Functions with no cataloged family: "function" (closed contact/2). Supported profiles by family: circuit: ["thermite:sensor-3wire", "thermite:contactor"] and 25 more; rooted power: ["thermite:contactor", "thermite:breaker"] and 9 more; rooted control: ["thermite:sensor-3wire", "thermite:contactor"] and 15 more; rooted loads: ["thermite:sensor-3wire", "thermite:relay"] and 5 more; signal-loop only (not circuit or rooted): ["thermite:pressure-transmitter", "thermite:analog-actuator"] and 1 more. Full IDs: W111.allowed in validate --json. Shapes still apply.';

for (const family of ["power", "control"] as const)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `names closed main state in exact W111, ${family} R002 and circuit R006 in %s`,
    async (flow) => {
      const f = await identityProject(
        "thermite:disconnector",
        "power-closed",
        family,
      );
      try {
        expect(
          f.diagnostics.filter((d) => d.code === "W111").map((d) => d.message),
        ).toEqual([warning]);
        const result = await renderSchematic(f.ir, {
          ...(f.request as object),
          flow,
        });
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "R002",
            reason: "unsupported-symbol-profile",
            message: `${prefix(family, "closed contact/2")} ${stateCause} ${advice}`,
          },
        });
        const request = identityCircuit(f.ir, flow);
        const circuit = await renderSchematicPacket(f.ir, {
          format: "schematic-packet-request/0.1",
          views: [request],
        });
        const uid = f.ir.devices.find((d) => d.designation === "DUT")!.uid;
        expect(circuit).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            message: `Packet view[0] "Authored function identities": ${prefix("circuit", "closed contact/2")} Unsupported circuit function local:dut/function: thermite:disconnector does not map closed contact/2. ${advice} Selected circuit keys: identity: functions ${uid}/function; conductors none.`,
          },
        });
      } finally {
        await f.dispose();
      }
    },
  );

for (const roles of [
  ["aux", "aux"],
  ["aux", "passive"],
  ["passive", "aux"],
  [undefined, undefined],
])
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `closed disconnector ${roles.join("/")} gates the exception by both roles in %s`,
    async (flow) => {
      const f = await contractProject(
        "thermite:disconnector",
        "aux-closed",
        "control",
      );
      try {
        const type = f.ir.deviceTypes.find((t) => t.id === "local:dut")!;
        type.terminals.forEach((t, i) => {
          t.role = roles[i];
        });
        const result = await renderSchematic(f.ir, {
          ...(f.request as object),
          flow,
        });
        expect(result.ok).toBe(roles.every((r) => r === "aux"));
        const fn = f.ir.functions.find((f) => f.id.functionKey === "function")!;
        if (roles.every((r) => r === "aux"))
          expect(circuitMark(type, fn)).toBe("contact-nc");
        else {
          expect(() => circuitMark(type, fn)).toThrow("closed contact/2");
          expect(result).toMatchObject({
            error: {
              code: "R002",
              message: `${prefix("control", "closed contact/2")} ${stateCause} ${advice}`,
            },
          });
        }
      } finally {
        await f.dispose();
      }
    },
  );

for (const mode of ["aux-closed", "contact-closed"])
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `keeps ${mode} role-only power refusal and explicit circuit override messages truthful in %s`,
    async (flow) => {
      const f = await identityProject(
        "thermite:disconnector",
        mode,
        "power",
        (t) => {
          t.circuitSymbols = { function: "contact-nc" };
        },
      );
      try {
        expect(f.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
        const result = await renderSchematic(f.ir, {
          ...(f.request as object),
          flow,
        });
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "R002",
            message: `${prefix("power", "contact/2")} ${advice}`,
          },
        });
        const circuit = await prepareCircuitView(
          f.ir,
          identityCircuit(f.ir, flow),
        );
        expect(circuit.groups[0]!.content).toContain(
          'data-circuit-mark="contact-nc"',
        );
      } finally {
        await f.dispose();
      }
    },
  );

it.each(["thermite:switch", "thermite:pushbutton"])(
  "names the state-constrained %s profile in the fallback cause",
  async (id) => {
    const f = await contractProject(id, "contact-closed", "control");
    const profile = SYMBOL_PROFILES.find((p) => p.id === id)!;
    const original = profile.support;
    try {
      // Simulate a future open-only catalog requirement, without changing the IR.
      Object.assign(profile, {
        support: original.map((s) =>
          s.family === "control"
            ? {
                ...s,
                functions: s.functions.map((shape) =>
                  shape.kind === "contact"
                    ? { ...shape, normalState: "open" }
                    : shape,
                ),
              }
            : s,
        ),
      });
      const device = f.ir.devices.find((d) => d.designation === "DUT")!;
      const fn = f.ir.functions.find((v) => v.id.deviceUid === device.uid)!;
      const error = unsupportedProfileError(
        f.ir,
        {
          code: "R002",
          root: "K1",
          family: "control",
          message: "incomplete",
        },
        device,
        fn,
        "control",
      );
      const cause = `This ${id.slice("thermite:".length)} binding requires an open contact.`;
      expect(error.message).toBe(
        `Unsupported symbol profile: device "DUT", type "local:dut", profile "${id}" has no control rule for function "function" (closed contact/2; terminals DUT.A, DUT.B). ${cause} ${advice}`,
      );
      expect(error.details?.cause).toBe(cause);
    } finally {
      Object.assign(profile, { support: original });
      await f.dispose();
    }
  },
);

it("does not label unrelated arity or unknown-profile failures as state failures, or grow loads", async () => {
  const f = await contractProject(
    "thermite:disconnector",
    "power-closed",
    "power",
  );
  try {
    const device = f.ir.devices.find((d) => d.designation === "DUT")!;
    const fn = f.ir.functions.find((v) => v.id.deviceUid === device.uid)!;
    const error = {
      code: "R002" as const,
      root: "M1",
      family: "power" as const,
      message: "incomplete",
    };
    const one = { ...fn, terminals: fn.terminals.slice(0, 1) };
    const r = unsupportedProfileError(f.ir, error, device, one, "power");
    expect(r.message).toBe(
      `Unsupported symbol profile: device "DUT", type "local:dut", profile "thermite:disconnector" has no power rule for function "function" (contact/1; terminals DUT.A). ${advice}`,
    );
    f.ir.deviceTypes.find((t) => t.id === device.typeId)!.symbol =
      "site:unknown";
    expect(
      unsupportedProfileError(f.ir, error, device, fn, "power").message,
    ).toBe(
      `Unsupported symbol profile: device "DUT", type "local:dut", profile "site:unknown" has no power rule for function "function" (contact/2; terminals DUT.A, DUT.B). ${advice}`,
    );
    expect(
      SYMBOL_PROFILES.find(
        (p) => p.id === "thermite:disconnector",
      )!.support.filter((s) => s.family === "loads"),
    ).toEqual([]);
  } finally {
    await f.dispose();
  }
});
