import { beforeAll, expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import {
  prepareSchematicDrawing,
  type PreparedSchematicDrawing,
} from "../src/renderer.js";
import { compileCoreFixture } from "./fixtures.js";
import {
  gangAnchor,
  gangReservationBand,
  isPowerSwitchingPole,
  visibleRootedGangs,
} from "../src/symbols/gang-geometry.js";
import { reserveGangAnnotations } from "../src/presentation/gang-annotations.js";
import {
  contactCaptionRegion,
  verticalContactCaption,
} from "../src/presentation/contact-caption.js";
import {
  compareVerticalPowerPorts,
  sortedLeafPorts,
} from "../src/layout/adapter-ordering.js";
import { emitSchematicSvg } from "../src/svg/emitter.js";
import { rootedGangSegments } from "../src/symbols/rooted-gangs.js";
import type { SymbolPresentationNode } from "../src/types.js";

let ir: ElectricalIr, p: PreparedSchematicDrawing;
beforeAll(async () => {
  ir = await compileCoreFixture();
  const r = await prepareSchematicDrawing(ir, {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "M1" },
    family: "power",
    flow: "top-to-bottom",
  });
  if (!r.ok) throw Error(r.error.message);
  p = r.value;
});
const pole = () =>
  p.graph.nodes.find(
    (n): n is SymbolPresentationNode =>
      n.kind === "symbol" && n.symbolId === "ais:contact-no",
  )!;

it("classifies power roles without designation or caption matching", () => {
  const n = pole();
  expect(isPowerSwitchingPole(n, ir)).toBe(true);
  expect(
    isPowerSwitchingPole({ ...n, designation: "Auxiliary", labels: [] }, ir),
  ).toBe(true);
  expect(
    isPowerSwitchingPole({ ...n, classification: "control-contact" }, ir),
  ).toBe(false);
  expect(
    isPowerSwitchingPole(
      {
        ...n,
        symbolId: "ais:pushbutton-no",
        classification: "command",
      },
      ir,
    ),
  ).toBe(false);
  const auxiliary = structuredClone(ir);
  for (const t of auxiliary.terminals)
    if (
      n.ports.some(
        (p) =>
          p.terminal.deviceUid === t.id.deviceUid &&
          p.terminal.terminalKey === t.id.terminalKey,
      )
    )
      t.role = "aux";
  expect(isPowerSwitchingPole(n, auxiliary)).toBe(false);
  const groups = visibleRootedGangs(ir, {
    ...p.graph,
    view: { ...p.graph.view, family: "control" },
  });
  expect(groups.every((g) => !g.mandatory)).toBe(true);
});

it("uses drawn nodes for both membership and caption reservations when functions collapse", () => {
  const g = structuredClone(p.graph),
    members = g.nodes.filter(
      (n): n is SymbolPresentationNode =>
        n.kind === "symbol" && n.deviceUid === pole().deviceUid,
    );
  const first = members[0]!,
    collapsed = {
      ...first,
      functionIds: members.flatMap((n) => n.functionIds),
    };
  const graph = {
    ...g,
    nodes: [
      ...g.nodes.filter((n) => !members.some((m) => m.id === n.id)),
      collapsed,
    ],
  };
  expect(
    visibleRootedGangs(ir, graph).some((g) =>
      g.members.some((n) => n.id === first.id),
    ),
  ).toBe(false);
  const annotated = reserveGangAnnotations(ir, graph),
    node = annotated.nodes.find((n) => n.id === first.id)!;
  expect(node.kind === "symbol" && node.mechanicalGangId).toBeUndefined();
  const header = collapsed.labels.find((l) => l.role === "function")!;
  const slot = contactCaptionRegion(
    {
      ...collapsed,
      mechanicalGangId: undefined,
    } as unknown as SymbolPresentationNode,
    header,
  )!;
  expect(slot.y + slot.height / 2).toBe(
    collapsed.primitiveOrigin.y + collapsed.symbolSize.height / 2,
  );
});

it("keys contact-caption clearance on glyph identity even when printable words change", () => {
  const node = pole(),
    header = {
      ...node.labels.find((l) => l.role === "function")!,
      printableText: "OPEN",
    };
  expect(
    verticalContactCaption("top-to-bottom", header, "ais:contact-no"),
  ).toBe(true);
  expect(
    verticalContactCaption(
      "top-to-bottom",
      { ...header, printableText: "NO" },
      "ais:coil",
    ),
  ).toBe(false);
  const region = contactCaptionRegion(node, header)!,
    anchor = gangAnchor(node)!;
  expect(region.y - node.primitiveOrigin.y - anchor.y).toBeGreaterThanOrEqual(
    3,
  );
});

it("bounds each pre-layout gang band to the prospective owner inside its device group", () => {
  const n = pole(),
    bounds = { x: -12, y: 0, width: 140, height: 100 };
  const band = gangReservationBand(n, bounds)!;
  expect(band.x).toBe(-14.5);
  expect(band.width).toBe(145);
  expect(band.x + band.width).toBeLessThan(200);
  const horizontal = gangReservationBand(
    { ...n, orientation: "left-to-right" },
    bounds,
  )!;
  expect(horizontal.y).toBe(-2.5);
  expect(horizontal.height).toBe(105);
  expect(
    gangReservationBand(
      {
        ...n,
        mechanicalGangId: undefined,
      } as unknown as SymbolPresentationNode,
      bounds,
    ),
  ).toBeUndefined();
});

it("orders sides consistently and rejects mixed-side vertical lane families", () => {
  const n = p.graph.nodes.find(
    (n): n is SymbolPresentationNode =>
      n.kind === "symbol" && n.symbolId === "ais:power-source-3ph",
  )!;
  const [a, b] = n.ports;
  const north = { ...a!, side: "north" as const },
    south = { ...b!, side: "south" as const };
  expect(compareVerticalPowerPorts(north, south)).toBeLessThan(0);
  expect(compareVerticalPowerPorts(south, north)).toBeGreaterThan(0);
  expect(() =>
    sortedLeafPorts(p.graph, { ...n, ports: [north, south] }),
  ).toThrow("single north or south");
});

it("refuses a gang-capable SVG without electrical IR, rather than bypassing the guard", () => {
  const r = emitSchematicSvg(p.graph, p.layout, p.titleContext);
  expect(r).toMatchObject({
    ok: false,
    error: { code: "R006", details: { reason: "mechanical-gang-ir-required" } },
  });
  expect("value" in r).toBe(false);
});

it("leaves an unsupported non-switching gang optional in a power view", () => {
  const graph = {
    ...p.graph,
    nodes: p.graph.nodes.map((n) =>
      n.kind === "symbol" && n.symbolId === "ais:breaker-pole"
        ? {
            ...n,
            symbolId: "ais:pushbutton-no" as const,
            classification: "command" as const,
          }
        : n,
    ),
  };
  const r = rootedGangSegments(ir, graph, p.layout);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value).toHaveLength(2);
});
