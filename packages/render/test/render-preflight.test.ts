import { createHash } from "node:crypto";
import { orderingMetrics } from "./layout-metrics.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { compileProject } from "@thermite/compiler";
import { compileCoreFixture } from "./fixtures.js";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";

import { sideBranch } from "./profile-side-branch-fixture.js";
import { preflightRootedProfiles } from "../src/preflight.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
const actuation = {
  format: "schematic-view-request/0.1",
  family: "control",
  root: { by: "designation", value: "K1" },
} as const;
function plc(profile: string) {
  const copy = structuredClone(ir);
  const device = copy.devices.find((d) => d.designation === "PLC1")!;
  const type = copy.deviceTypes.find((t) => t.id === device.typeId)!;
  copy.indexes.instanceRefsByTypeId.find((e) => e.key === type.id)!.key =
    "local:plc";
  type.id = device.typeId = "local:plc";
  type.symbol = profile;
  return copy;
}
// Full successful-value fingerprints after semantic ordering.
const semanticSideBranchSignatures = orderingMetrics.sideBranches;
describe("render profile preflight", () => {
  it("names a missing CB1 profile without printing the sentinel in the appended sentence", async () => {
    const copy = structuredClone(ir);
    delete copy.deviceTypes.find((t) => t.id === "core:breaker-3p")!.symbol;
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const r = await renderSchematic(copy, {
        format: "schematic-view-request/0.1",
        family: "power",
        root: { by: "designation", value: "M1" },
        flow,
      });
      expect(r).toMatchObject({
        ok: false,
        error: {
          code: "R002",
          unsupported: { designation: "CB1", profile: "<missing>" },
        },
      });
      if (!r.ok) {
        expect(r.error.message).toBe(
          'Incomplete power view: lane "U" does not reach a required boundary. Device "M1", function "motor_load". Path stopped at PS1.L (function ac_input). Additional profile limitation: device "CB1" has no rendering profile for this view.',
        );
        expect(r.error.message).not.toContain("<missing>");
      }
    }
  });
  it.each(["iec:indicator-light", "thermite:lamp"])(
    "adds the unsupported CB1 profile to the incomplete power message: %s",
    async (profile) => {
      const copy = structuredClone(ir);
      copy.deviceTypes.find((t) => t.id === "core:breaker-3p")!.symbol =
        profile;
      const r = await renderSchematic(copy, {
        format: "schematic-view-request/0.1",
        family: "power",
        root: { by: "designation", value: "M1" },
      });
      expect(r).toMatchObject({
        ok: false,
        error: {
          code: "R002",
          lane: "U",
          root: "M1",
          unsupported: { designation: "CB1", profile },
          details: {
            profileNote: expect.stringContaining(profile),
            stoppedAt: [{ designation: "PS1", terminalKey: "L" }],
          },
        },
      });
      if (!r.ok) {
        const prefix =
          'Incomplete power view: lane "U" does not reach a required boundary. Device "M1", function "motor_load". Path stopped at PS1.L (function ac_input).';
        expect(r.error.message).toBe(
          `${prefix} Additional profile limitation: device "CB1" uses profile "${profile}", which is unsupported for this view.`,
        );
        expect(r.error).not.toHaveProperty("reason");
        expect(r.error).not.toHaveProperty("typeId");
        expect(r.error).not.toHaveProperty("functionKey");
      }
    },
  );
  it.each([
    "thermite:pressure-transmitter",
    "iec:indicator-light",
    "thermite:lamp",
  ])(
    "names unsupported upstream profile/shape %s after failed traversal",
    async (profile) => {
      const result = await renderSchematic(plc(profile), actuation);
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "R002",
          reason: "unsupported-symbol-profile",
          deviceUid: ir.devices.find((d) => d.designation === "K1")!.uid,
          unsupported: {
            deviceUid: ir.devices.find((d) => d.designation === "PLC1")!.uid,
            designation: "PLC1",
            typeId: "local:plc",
            profile,
            functionKey: "do0",
            family: "control",
          },
          details: { designation: "PLC1", profile, family: "control" },
        },
      });
    },
  );
  it("names a root shape mismatch with the existing R001 classification", async () => {
    const copy = structuredClone(ir);
    const type = copy.deviceTypes.find(
      (t) => t.id === "core:contactor-3p-1no",
    )!;
    type.symbol = "thermite:lamp";
    expect(await renderSchematic(copy, actuation)).toMatchObject({
      ok: false,
      error: {
        code: "R001",
        reason: "unsupported-symbol-profile",
        unsupported: {
          designation: "K1",
          functionKey: "coil",
          family: "control",
        },
        details: {
          reason: "unsupported-symbol-profile",
          designation: "K1",
          profile: "thermite:lamp",
          family: "control",
        },
      },
    });
  });
  it.each([
    ["PB1", "power"],
    ["PLC1", "power"],
    ["M1", "control"],
    ["CB1", "control"],
    ["PB1", "control"],
    ["LS1", "control"],
    ["SRC1", "loads"],
    ["K1", "loads"],
    ["K1", "trace"],
  ])(
    "classifies a valid %s requested as %s as a wrong root",
    async (designation, family) => {
      const result = await renderSchematic(
        ir,
        family === "loads" || family === "trace"
          ? {
              format: "schematic-view-request/0.2",
              root: { by: "designation", value: designation },
              intent:
                family === "loads"
                  ? { kind: "loads" }
                  : {
                      kind: "trace",
                      to: { by: "designation", value: "PLC1" },
                      includePower: false,
                    },
            }
          : {
              format: "schematic-view-request/0.1",
              root: { by: "designation", value: designation },
              family: family as "power" | "control",
            },
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "R001",
          reason: "root-not-accepted",
          details: {
            reason: "root-not-accepted",
            designation,
            acceptedRoots: expect.any(Array),
            rootFamilies: expect.any(Array),
          },
        },
      });
      if (!result.ok) {
        if ((result.error.details?.rootFamilies as string[]).length)
          expect(result.error.message).toContain(
            "Choose another root or family",
          );
        else {
          expect(result.error.message).toContain(
            "Choose a different root device",
          );
          expect(result.error.message).not.toContain(
            "Choose another root or family",
          );
        }
        expect(result.error.message).not.toContain("Check the profile");
        for (const accepted of result.error.details?.acceptedRoots as {
          profile: string;
          aliases: string[];
          shapes: string[];
        }[]) {
          expect(Object.keys(accepted).sort()).toEqual([
            "aliases",
            "profile",
            "shapes",
          ]);
          expect(accepted.shapes.length).toBeGreaterThan(0);
          expect(accepted.shapes.every((s) => typeof s === "string")).toBe(
            true,
          );
        }
        expect(result.error.details?.family).toBe(
          "family" in result.error ? result.error.family : undefined,
        );
      }
    },
  );
  it.each([
    ["M1", "PE"],
    ["SRC1", "PE"],
    ["TB1", "3"],
  ])(
    "renders an unprofiled branch on %s.%s in both flows",
    async (device, terminal) => {
      const copy = await sideBranch(device!, terminal!);
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const views =
          device === "TB1"
            ? [false, true].map((includePower) => ({
                format: "schematic-view-request/0.2" as const,
                root: { by: "designation" as const, value: "LS1" },
                flow,
                intent: {
                  kind: "trace" as const,
                  to: { by: "designation" as const, value: "PLC1" },
                  includePower,
                },
              }))
            : [
                {
                  format: "schematic-view-request/0.1" as const,
                  root: { by: "designation" as const, value: "M1" },
                  family: "power" as const,
                  flow,
                },
              ];
        for (const view of views) {
          const rendered = await renderSchematic(copy, view);
          expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
          if (rendered.ok)
            expect(
              createHash("sha256")
                .update(JSON.stringify(rendered.value))
                .digest("hex"),
            ).toBe(
              semanticSideBranchSignatures[
                [
                  device,
                  flow,
                  "intent" in view ? view.intent.includePower : false,
                ].join("|")
              ],
            );
          const profiled = structuredClone(copy);
          const unused = profiled.deviceTypes.find(
            (t) => t.id === "local:pe-bar",
          )!;
          unused.symbol = "thermite:terminal-strip";
          const reference = await renderSchematic(profiled, view);
          expect(reference.ok, JSON.stringify(reference)).toBe(true);
          expect(rendered).toEqual(reference);
        }
      }
    },
  );
  it("suppresses a reachable unsupported control side branch once the arm reaches a supported boundary", async () => {
    const copy = await sideBranch("PB1", "12");
    const uid = copy.devices.find((d) => d.designation === "K1")!.uid;
    expect(
      preflightRootedProfiles(
        copy,
        {
          format: "schematic-view/0.1",
          family: "control",
          root: { deviceUid: uid, designation: "K1" },
          flow: "left-to-right",
        },
        projectDeviceTypeSymbolMappings(copy),
      ),
    ).toBeUndefined();
  });
  it("keeps a real control break and its stops when an unsupported contact is on a side branch", async () => {
    const copy = await sideBranch("PB1", "12", {
      contact: true,
      removeWire: "W-CTL-005",
    });
    const r = await renderSchematic(copy, actuation);
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R002",
        pathSide: "input",
        unsupported: {
          designation: "X1",
          typeId: "local:aux-contact",
          functionKey: "c",
          family: "control",
        },
        details: {
          profileNote: expect.stringContaining("X1"),
          stoppedAt: expect.arrayContaining([
            expect.objectContaining({ designation: "X1", terminalKey: "1" }),
            expect.objectContaining({ designation: "PB1", terminalKey: "11" }),
          ]),
        },
      },
    });
    if (!r.ok) {
      expect(r.error).not.toHaveProperty("reason");
      expect(r.error.message).toContain(
        "Incomplete control view: no input path reaches a required boundary.",
      );
      expect(r.error.message).toContain("Path stopped at");
      expect(r.error.message).toContain(
        'device "X1" uses profile "iec:indicator-light"',
      );
      expect(r.error).not.toHaveProperty("typeId");
      expect(r.error).not.toHaveProperty("functionKey");
    }
    const repaired = await sideBranch("PB1", "12", { contact: true });
    expect((await renderSchematic(repaired, actuation)).ok).toBe(true);
  });
  it.each([false, true])(
    "keeps a broken trace and its stops despite an unprofiled side branch; power=%s",
    async (includePower) => {
      const copy = await sideBranch("TB1", "3", { removeWire: "W-FLD-001" });
      const r = await renderSchematic(copy, {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower,
        },
      });
      expect(r).toMatchObject({
        ok: false,
        error: {
          code: "R002",
          segment: "signal",
          unsupported: { designation: "PE1" },
          details: {
            profileNote: expect.stringContaining("PE1"),
            stoppedAt: expect.any(Array),
          },
        },
      });
      if (!r.ok) {
        expect(r.error).not.toHaveProperty("reason");
        expect(r.error.message).toContain(
          "Incomplete trace view: no signal path connects the requested devices.",
        );
        expect(r.error.message).toContain("Path stopped at");
        expect(r.error.message).toContain(
          'device "PE1" has no rendering profile for this view.',
        );
      }
    },
  );
  it("recognizes the PE arm while diagnosing an independent broken power lane", async () => {
    const copy = await sideBranch("M1", "PE", { removeWire: "W-PWR-010" });
    const rootUid = copy.devices.find((d) => d.designation === "M1")!.uid;
    expect(
      preflightRootedProfiles(
        copy,
        {
          format: "schematic-view/0.1",
          family: "power",
          root: { deviceUid: rootUid, designation: "M1" },
          flow: "left-to-right",
        },
        projectDeviceTypeSymbolMappings(copy),
      ),
    ).toBeUndefined();
    const noPotential = structuredClone(copy);
    noPotential.potentials = noPotential.potentials.filter(
      (p) => p.electrical.polarity !== "protective_earth",
    );
    const potentialOnly = projectDeviceTypeSymbolMappings(copy).map((m) => ({
      ...m,
      boundaryTerminals: m.boundaryTerminals.filter(
        (b) => b.boundaryKind !== "protective-earth-source",
      ),
    }));
    for (const [facts, maps] of [
      [noPotential, projectDeviceTypeSymbolMappings(noPotential)],
      [copy, potentialOnly],
    ] as const)
      expect(
        preflightRootedProfiles(
          facts,
          {
            format: "schematic-view/0.1",
            family: "power",
            root: { deviceUid: rootUid, designation: "M1" },
            flow: "left-to-right",
          },
          maps,
        ),
      ).toBeUndefined();
    const r = await renderSchematic(copy, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M1" },
      family: "power",
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R002",
        lane: "U",
        details: {
          stoppedAt: expect.arrayContaining([
            expect.objectContaining({ designation: "M1", terminalKey: "U" }),
          ]),
        },
      },
    });
    if (!r.ok) {
      expect(r.error).not.toHaveProperty("unsupported");
      expect(r.error.details).not.toHaveProperty("profileNote");
      expect(r.error).not.toHaveProperty("reason");
    }
  });
  it("carries the trace-root supply-role cause even when signal power is not requested", async () => {
    const c = await compileProject("examples/conveyor-line");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    c.ir.deviceTypes
      .find((t) => t.id === "core:prox-pnp-3wire")!
      .terminals.find((t) => t.key === "3")!.role = "0v";
    const r = await renderSchematic(c.ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PX1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: false,
      },
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R001",
        reason: "unsupported-symbol-profile",
        unsupported: {
          designation: "PX1",
          functionKey: "supply",
          family: "control",
        },
        details: { cause: expect.stringContaining("supply_return") },
      },
    });
    if (!r.ok) {
      expect(r.error.message).toContain("Invalid sensor supply roles");
      expect(r.error.message).toContain("Invalid trace root:");
    }
  });
  it.each([
    ["K1", "thermite:lamp"],
    ["PB1", "iec:indicator-light"],
  ])(
    "diagnoses %s's own invalid profile with no power-root function",
    async (designation, profile) => {
      const copy = structuredClone(ir);
      const device = copy.devices.find((d) => d.designation === designation)!;
      copy.deviceTypes.find((t) => t.id === device.typeId)!.symbol = profile;
      const r = await renderSchematic(copy, {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: designation! },
        family: "power",
      });
      expect(r).toMatchObject({
        ok: false,
        error: {
          code: "R001",
          reason: "unsupported-symbol-profile",
          unsupported: {
            deviceUid: device.uid,
            designation,
            profile,
            family: "power",
          },
        },
      });
      if (!r.ok) {
        expect(r.error.message).toContain("Invalid power root:");
        expect(r.error.message).toContain("Accepted profiles and shapes:");
        expect(r.error.unsupported).not.toHaveProperty("functionKey");
      }
    },
  );
  it("treats missing symbol metadata as eligibility for both root and input target", async () => {
    const missingRoot = structuredClone(ir);
    const pb = missingRoot.devices.find((d) => d.designation === "PB1")!;
    delete missingRoot.deviceTypes.find((t) => t.id === pb.typeId)!.symbol;
    const root = await renderSchematic(missingRoot, {
      format: "schematic-view-request/0.1",
      family: "power",
      root: { by: "designation", value: "PB1" },
    });
    expect(root).toMatchObject({
      ok: false,
      error: {
        code: "R001",
        reason: "root-not-accepted",
        details: { profile: "<missing>" },
      },
    });
    if (!root.ok) expect(root.error).not.toHaveProperty("unsupported");
    const missingTarget = structuredClone(ir);
    const plc = missingTarget.devices.find((d) => d.designation === "PLC1")!;
    delete missingTarget.deviceTypes.find((t) => t.id === plc.typeId)!.symbol;
    const target = await renderSchematic(missingTarget, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: false,
      },
    });
    expect(target).toMatchObject({
      ok: false,
      error: {
        code: "R001",
        reason: "target-not-accepted",
        deviceUid: ir.devices.find((d) => d.designation === "LS1")!.uid,
        targetDeviceUid: plc.uid,
        details: { profile: "<missing>", targetDesignation: "PLC1" },
      },
    });
    if (!target.ok) {
      expect(target.error).not.toHaveProperty("unsupported");
      expect(target.error.message).toContain(
        "Choose a different target device",
      );
    }
  });
  it("keeps disconnected supported control as R002", async () => {
    const copy = structuredClone(ir);
    const uid = copy.devices.find((d) => d.designation === "K1")!.uid;
    const removed = new Set(
      copy.wires
        .filter((w) =>
          w.endpoints.some(
            (e) =>
              e.terminal.deviceUid === uid && e.terminal.terminalKey === "A1",
          ),
        )
        .map((w) => w.uid),
    );
    copy.wires = copy.wires.filter((w) => !removed.has(w.uid));
    for (const net of copy.nets)
      net.conductiveElementIds = net.conductiveElementIds.filter(
        (e) => e.kind !== "wire" || !removed.has(e.uid),
      );
    copy.indexes.terminalIdsByConductiveElement =
      copy.indexes.terminalIdsByConductiveElement.filter(
        (e) => e.key.kind !== "wire" || !removed.has(e.key.uid),
      );
    for (const e of copy.indexes.conductiveElementIdsByTerminal)
      e.value = e.value.filter((v) => v.kind !== "wire" || !removed.has(v.uid));
    copy.indexes.objectRefByUid = copy.indexes.objectRefByUid.filter(
      (e) => e.value.kind !== "wire" || !removed.has(e.value.uid),
    );
    copy.indexes.objectRefByDesignation =
      copy.indexes.objectRefByDesignation.filter(
        (e) => e.value.kind !== "wire" || !removed.has(e.value.uid),
      );
    const result = await renderSchematic(copy, actuation);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "R002", pathSide: "input" },
    });
    if (!result.ok) {
      expect(result.error).not.toHaveProperty(
        "reason",
        "unsupported-symbol-profile",
      );
      expect(result.error.message).toContain('Device "K1", function "coil"');
      expect(result.error).toMatchObject({
        details: {
          stoppedAt: [
            expect.objectContaining({
              designation: "K1",
              terminalKey: "A1",
              functionKeys: ["coil"],
            }),
          ],
        },
      });
    }
  });
  it("ignores unsupported devices outside the selected circuit", async () => {
    const copy = structuredClone(ir);
    copy.deviceTypes.find((t) => t.id === "core:limit-switch-2wire")!.symbol =
      "iec:indicator-light";
    const r = await renderSchematic(copy, actuation);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
  it("renders a supported clone and a metadata-only correction without changing connectivity", async () => {
    const copy = plc("iec:indicator-light");
    const before = JSON.stringify({
      wires: copy.wires,
      functions: copy.functions,
      nets: copy.nets,
      indexes: copy.indexes,
    });
    expect((await renderSchematic(copy, actuation)).ok).toBe(false);
    copy.deviceTypes.find((t) => t.id === "local:plc")!.symbol = "iec:plc";
    const rendered = await renderSchematic(copy, actuation);
    expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
    expect(
      JSON.stringify({
        wires: copy.wires,
        functions: copy.functions,
        nets: copy.nets,
        indexes: copy.indexes,
      }),
    ).toBe(before);
    const original = await renderSchematic(ir, actuation);
    if (rendered.ok && original.ok)
      expect(rendered.value.summary).toEqual(original.value.summary);
  });
  it.each([
    "iec:indicator-light",
    "thermite:pressure-transmitter",
    "thermite:lamp",
  ])("preflights selected circuit functions with R006: %s", async (profile) => {
    const result = await renderSchematicPacket(plc(profile), {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "Output circuit",
          groups: [
            {
              id: "output",
              functions: [
                { device: { by: "designation", value: "PLC1" }, key: "do0" },
              ],
              conductors: [],
            },
          ],
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        reason: "unprintable-layout",
        unsupported: {
          designation: "PLC1",
          typeId: "local:plc",
          functionKey: "do0",
          family: "circuit",
          profile,
        },
        details: {
          reason: "unsupported-symbol-profile",
          designation: "PLC1",
          typeId: "local:plc",
          profile,
          family: "circuit",
        },
      },
    });
  });
});
