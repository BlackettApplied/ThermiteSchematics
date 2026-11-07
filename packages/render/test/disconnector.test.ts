import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { SYMBOL_PROFILES } from "@thermite/schema";
import {
  compileProject,
  symbolFunctionMatchesShape,
  type ElectricalIr,
} from "@thermite/compiler";
import {
  writeGapProject,
  disconnectCircuit,
} from "../../core-library/test/automation-gap-fixtures.js";
import {
  coreTypes,
  machineProbe,
} from "../../core-library/test/machine-fixtures.js";
import { prepareSchematicDrawing, renderSchematic } from "../src/renderer.js";
import { prepareCircuitView } from "../src/circuit.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import { circuitMark, emitCircuitMark } from "../src/symbols/circuit.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { rootedGangSegments } from "../src/symbols/rooted-gangs.js";
import { sharedMarkPrimitives } from "../src/symbols/printable-policy.js";

let ir: ElectricalIr;
let root: string;
const powerRequest = {
  format: "schematic-view-request/0.1" as const,
  root: { by: "designation" as const, value: "M1" },
  family: "power" as const,
};
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "thermite-disconnector-"));
  ir = (await writeGapProject(root, "disconnect")).ir;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
const typeOf = (v: ElectricalIr) =>
  v.deviceTypes.find(
    (t) => t.id === v.devices.find((d) => d.designation === "DS1")!.typeId,
  )!;
const poleOf = (v: ElectricalIr) =>
  v.functions.find(
    (f) =>
      f.id.deviceUid === v.devices.find((d) => d.designation === "DS1")!.uid &&
      f.id.functionKey === "pole1",
  )!;

it("has one canonical profile, open shapes, no loads or loop, and no operator primitives", () => {
  const profile = SYMBOL_PROFILES.find(
    (p) => p.id === "thermite:disconnector",
  )!;
  expect(profile.aliases).toEqual([]);
  expect(profile.coreAliases).toEqual([]);
  expect(profile.support.map((s) => s.family)).toEqual([
    "power",
    "control",
    "circuit",
  ]);
  const type = typeOf(ir);
  const fn = type.functions.find((f) => f.key === "pole1")!;
  for (const support of profile.support) {
    const fits = (f: typeof fn) =>
      support.functions.some((s) => symbolFunctionMatchesShape(type, f, s));
    expect(fits(fn)).toBe(true);
    expect(fits({ ...fn, normal_state: "closed" })).toBe(false);
    expect(fits({ ...fn, normal_state: undefined })).toBe(false);
  }
  const ink = sharedMarkPrimitives("disconnector");
  expect(ink).toHaveLength(4);
  expect(ink.every((p) => p.kind === "line" && p.style === "body")).toBe(true);
  expect(ink).toContainEqual({
    kind: "line",
    from: { x: 30, y: 6 },
    to: { x: 30, y: 14 },
    style: "body",
  });
  expect(ink).not.toEqual(sharedMarkPrimitives("breaker"));
  expect(ink).not.toEqual(sharedMarkPrimitives("switch-no"));
  expect(
    SYMBOL_CATALOG.find((s) => s.id === "ais:disconnector")!.primitives,
  ).toEqual(ink);
  expect(emitCircuitMark("disconnector")).toContain(
    'data-circuit-mark="disconnector"',
  );
  const rules = projectDeviceTypeSymbolMappings(ir)
    .find((m) => m.typeId === type.id)!
    .functions.filter((f) => f.functionKey === "pole1");
  expect(
    rules.map((r) => [r.families, r.classification, r.traversalRole]),
  ).toEqual([
    [["control"], "permissive", "permissive-contact"],
    [["power"], "power-contact", "power-contact"],
  ]);
  expect(
    rules.every(
      (r) =>
        JSON.stringify(r.bindings) ===
        JSON.stringify([
          { portId: "in", terminalKey: "1/L1" },
          { portId: "out", terminalKey: "2/T1" },
        ]),
    ),
  ).toBe(true);
  const reversed = structuredClone(ir);
  typeOf(reversed)
    .functions.find((f) => f.key === "pole1")!
    .terminalKeys.reverse();
  const reversedRules = projectDeviceTypeSymbolMappings(reversed)
    .find((m) => m.typeId === type.id)!
    .functions.filter((f) => f.functionKey === "pole1");
  expect(reversedRules.map((r) => r.families)).toEqual([["control"]]);
  expect(reversedRules[0]!.bindings[0]!.terminalKey).toBe("2/T1");
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "preserves all seven physical nets, phase/PE inventory, and authored gang ink in %s",
  async (flow) => {
    const before = JSON.stringify(ir);
    const names = new Map(ir.devices.map((d) => [d.uid, d.designation]));
    const partitions = ir.nets
      .map((n) =>
        n.terminalIds
          .map((t) => `${names.get(t.deviceUid)}.${t.terminalKey}`)
          .sort(),
      )
      .sort();
    expect(partitions).toEqual(
      [
        ["DS1.1/L1", "SRC1.L1"],
        ["DS1.2/T1", "M1.U"],
        ["DS1.3/L2", "SRC1.L2"],
        ["DS1.4/T2", "M1.V"],
        ["DS1.5/L3", "SRC1.L3"],
        ["DS1.6/T3", "M1.W"],
        ["M1.PE", "SRC1.PE"],
      ].sort(),
    );
    expect(ir.wires).toHaveLength(7);
    const drawing = await prepareSchematicDrawing(ir, {
      ...powerRequest,
      flow,
    });
    expect(drawing.ok, JSON.stringify(drawing)).toBe(true);
    if (!drawing.ok) throw Error(drawing.error.message);
    const { graph, layout } = drawing.value;
    // Real ELK output, including every caption and conductor, must retain both
    // authored associations. The open-state ink needs no NO caption.
    expect(rootedGangSegments(ir, graph, layout)).toHaveLength(2);
    const rendered = await renderSchematic(ir, { ...powerRequest, flow });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) throw Error(rendered.error.message);
    expect(
      parseHTML(rendered.value.svg).document.querySelectorAll(
        'line[data-mechanical-association="ganged"]',
      ),
    ).toHaveLength(2);
    expect(
      graph.nodes.filter(
        (n) => n.kind === "symbol" && n.symbolId === "ais:disconnector",
      ),
    ).toHaveLength(3);
    expect(
      new Set(
        graph.edges
          .flatMap((e) => e.elementIds)
          .map((e) => (e.kind === "wire" ? e.uid : "unexpected conductor")),
      ),
    ).toEqual(new Set(ir.wires.map((w) => w.uid)));
    // Synthetic guard case: remove unrelated obstacles, then deliberately shift
    // one pole to verify that misalignment suppresses the whole gang.
    const gangGraph = {
      ...graph,
      nodes: graph.nodes.filter(
        (n) => n.kind === "symbol" && n.symbolId === "ais:disconnector",
      ),
      locationGroups: [],
      deviceGroups: [],
      edges: [],
    };
    const gangLayout = structuredClone(layout);
    gangLayout.nodes = gangLayout.nodes.filter((n) =>
      gangGraph.nodes.some((p) => p.id === n.id),
    );
    gangLayout.labels = [];
    gangLayout.edges = [];
    gangLayout.nodes.forEach((n, i) => {
      n.x = flow === "left-to-right" ? 0 : i * 100;
      n.y = flow === "left-to-right" ? i * 100 : 0;
      n.primitiveOrigin = { x: n.x, y: n.y };
    });
    expect(rootedGangSegments(ir, gangGraph, gangLayout)).toHaveLength(2);
    expect(
      rootedGangSegments({ ...ir, gangedGroups: [] }, gangGraph, gangLayout),
    ).toEqual([]);
    const shifted = structuredClone(gangLayout);
    const pole = gangGraph.nodes.find(
      (n) => n.kind === "symbol" && n.symbolId === "ais:disconnector",
    )!;
    const placed = shifted.nodes.find((n) => n.id === pole.id)!;
    if (!placed.primitiveOrigin) throw Error("Missing primitive origin");
    const axis = flow === "left-to-right" ? "x" : "y";
    placed.primitiveOrigin[axis] += 5;
    expect(rootedGangSegments(ir, gangGraph, shifted)).toEqual([]);
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "a3", orientation: "landscape", marginMm: 10 },
      views: [
        { ...powerRequest, flow },
        { ...disconnectCircuit, flow },
      ],
    });
    expect(packet.ok, JSON.stringify(packet.ok ? {} : packet)).toBe(true);
    if (!packet.ok) throw Error(packet.error.message);
    for (const key of ["pole1", "pole2", "pole3"])
      expect(JSON.stringify(packet.value.coverage)).toContain(key);
    expect(JSON.stringify(ir)).toBe(before);
  },
);

it.each(["power", "control"] as const)(
  "refuses a closed %s disconnector with existing R002",
  async (family) => {
    const type = (await coreTypes()).find((t) => t.id === "core:disconnect-3p");
    const fixture = await machineProbe(type, family, "pole1");
    try {
      const v = structuredClone(fixture.ir);
      const t = v.deviceTypes.find((t) => t.id === type.id)!;
      t.functions.find((f) => f.key === "pole1")!.normal_state = "closed";
      const uid = v.devices.find((d) => d.designation === "DUT")!.uid;
      v.functions.find(
        (f) => f.id.deviceUid === uid && f.id.functionKey === "pole1",
      )!.normal_state = "closed";
      const r = await renderSchematic(v, fixture.request);
      expect(r).toMatchObject({
        ok: false,
        error: {
          code: "R002",
          reason: "unsupported-symbol-profile",
          unsupported: {
            profile: "thermite:disconnector",
            family,
            functionKey: "pole1",
          },
        },
      });
    } finally {
      await fixture.dispose();
    }
    const closed = { ...poleOf(ir), normal_state: "closed" as const };
    expect(() => circuitMark(typeOf(ir), closed)).toThrow();
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "draws circuit disconnector ink and only authored gangs attached to its blades in %s",
  async (flow) => {
    const ink = (element: Element) =>
      [...element.children].map((p) => ({
        kind: p.tagName.toLowerCase(),
        points: ["x1", "y1", "x2", "y2"].map((a) => Number(p.getAttribute(a))),
      }));
    const expectedInk = [
      { kind: "line", points: [0, 6, 3, 6] },
      { kind: "line", points: [3, 6, 8.1, 3.9] },
      { kind: "line", points: [9, 6, 12, 6] },
      { kind: "line", points: [9, 4.8, 9, 7.2] },
    ];
    for (const relation of ["none", "partial", "all"] as const) {
      const variant = structuredClone(ir);
      if (relation !== "all") {
        variant.internalRelations = variant.internalRelations.filter(
          (r) =>
            r.verb !== "ganged_with" ||
            (relation === "partial" &&
              r.from.functionKey !== "pole3" &&
              r.to.functionKey !== "pole3"),
        );
        typeOf(variant).internalRelations = typeOf(
          variant,
        ).internalRelations.filter(
          (r) =>
            r.verb !== "ganged_with" ||
            (relation === "partial" &&
              r.fromFunctionKey !== "pole3" &&
              r.toFunctionKey !== "pole3"),
        );
      }
      if (relation === "none") variant.gangedGroups = [];
      if (relation === "partial")
        variant.gangedGroups[0]!.functionIds =
          variant.gangedGroups[0]!.functionIds.filter(
            (f) => f.functionKey !== "pole3",
          );
      const prepared = await prepareCircuitView(variant, {
        ...disconnectCircuit,
        flow,
      });
      const doc = parseHTML(
        `<svg>${prepared.groups[0]!.content}</svg>`,
      ).document;
      const marks = [
        ...doc.querySelectorAll('[data-circuit-mark="disconnector"]'),
      ];
      expect(marks).toHaveLength(3);
      const midpoints = new Map<string, { x: number; y: number }>();
      for (const mark of marks) {
        expect(ink(mark)).toEqual(expectedInk);
        const transform = mark
          .parentElement!.getAttribute("transform")!
          .match(/^translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)$/)!;
        expect(transform).not.toBeNull();
        const [x, y, scale] = transform.slice(1).map(Number);
        // Midpoint of the independently specified blade, transformed into the
        // device's coordinates. Vertical marks rotate around their 12-unit box.
        const local = flow === "left-to-right" ? [5.55, 4.95] : [7.05, 5.55];
        expect(mark.getAttribute("transform")).toBe(
          flow === "left-to-right" ? null : "translate(12 0) rotate(90)",
        );
        midpoints.set(
          mark.closest("[data-function-id]")!.getAttribute("data-function-id")!,
          {
            x: x! + local[0]! * scale!,
            y: y! + local[1]! * scale!,
          },
        );
      }
      const gangs = [
        ...doc.querySelectorAll('line[data-mechanical-association="ganged"]'),
      ];
      expect(gangs).toHaveLength(
        relation === "none" ? 0 : relation === "partial" ? 1 : 2,
      );
      for (const gang of gangs) {
        expect(gang.getAttribute("stroke")).toBe("#17212b");
        expect(Number(gang.getAttribute("stroke-width"))).toBe(0.25);
        expect(gang.getAttribute("stroke-dasharray")).toBe("1.5 1");
        const functions = JSON.parse(
          gang.getAttribute("data-ganged-functions")!,
        ) as { deviceUid: string; functionKey: string }[];
        expect(functions).toHaveLength(2);
        functions.forEach((f, i) => {
          const midpoint = midpoints.get(
            JSON.stringify([f.deviceUid, f.functionKey]),
          )!;
          expect(midpoint).toBeDefined();
          expect(Number(gang.getAttribute(`x${i + 1}`))).toBeCloseTo(
            midpoint.x,
            3,
          );
          expect(Number(gang.getAttribute(`y${i + 1}`))).toBeCloseTo(
            midpoint.y,
            3,
          );
        });
      }
    }
  },
);

it.each(["U", "PE"])(
  "refuses a power path with its %s conductor missing",
  async (terminal) => {
    const scratch = await mkdtemp(
      join(tmpdir(), "thermite-disconnector-missing-"),
    );
    try {
      await cp(root, scratch, { recursive: true });
      const path = join(scratch, "source.json");
      const source = JSON.parse(await readFile(path, "utf8"));
      source.objects = source.objects.filter(
        (o: any) =>
          !(
            o.kind === "wire" &&
            o.endpoints.some(
              (e: any) => e.device === "M1" && e.terminal === terminal,
            )
          ),
      );
      await writeFile(path, JSON.stringify(source));
      const compiled = await compileProject(scratch);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      expect(compiled.ir.wires).toHaveLength(6);
      const result = await renderSchematic(compiled.ir, powerRequest);
      expect(result).toMatchObject({ ok: false, error: { code: "R002" } });
      expect(
        compiled.ir.nets.find((n) =>
          n.terminalIds.some(
            (t) =>
              t.deviceUid ===
                compiled.ir.devices.find((d) => d.designation === "M1")!.uid &&
              t.terminalKey === terminal,
          ),
        )!.terminalIds,
      ).toHaveLength(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "uses authored identity after a new type ID and designation in %s",
  async (flow) => {
    const clone = structuredClone(ir);
    const type = typeOf(clone);
    const oldId = type.id;
    type.id = "local:unrelated";
    const device = clone.devices.find((d) => d.designation === "DS1")!;
    device.typeId = type.id;
    clone.indexes.instanceRefsByTypeId.find((i) => i.key === oldId)!.key =
      type.id;
    const normalize = (v: unknown) =>
      JSON.stringify(v).replaceAll(type.id, oldId).replaceAll("Q77", "DS1");
    const original = await renderSchematic(ir, { ...powerRequest, flow });
    const cloned = await renderSchematic(clone, { ...powerRequest, flow });
    expect(cloned.ok).toBe(true);
    expect(normalize(cloned) === normalize(original)).toBe(true);
    device.designation = "Q77";
    clone.indexes.objectRefByDesignation.find((i) => i.key === "DS1")!.key =
      "Q77";
    const renamed = await renderSchematic(clone, { ...powerRequest, flow });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok || !original.ok) throw Error("Missing clone rendering");
    const glyphs = (svg: string) =>
      [
        ...parseHTML(svg).document.querySelectorAll(
          '[data-symbol-id="ais:disconnector"]',
        ),
      ].map((g) => g.innerHTML);
    expect(normalize(glyphs(renamed.value.svg))).toEqual(
      normalize(glyphs(original.value.svg)),
    );
    expect(renamed.value.summary.netIds).toEqual(original.value.summary.netIds);
    const renamedCircuit = structuredClone(disconnectCircuit);
    for (const f of renamedCircuit.groups[0]!.functions) f.device.value = "Q77";
    const circuit = await prepareCircuitView(clone, {
      ...renamedCircuit,
      flow,
    });
    expect(
      circuit.groups.flatMap((g) =>
        [...g.content.matchAll(/data-circuit-mark="([^"]+)"/g)].map(
          (m) => m[1],
        ),
      ),
    ).toEqual(["disconnector", "disconnector", "disconnector"]);
  },
);
