import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { compileCoreFixture } from "./fixtures.js";
import {
  prepareSchematicDrawing,
  type PreparedSchematicDrawing,
} from "../src/renderer.js";
import {
  powerNativeGuard,
  powerConductorGuard,
} from "../src/layout/power-placement-guard.js";
import * as native from "../src/layout/circuit-native-guard.js";
import { sideCandidate } from "./helpers/side-candidate.js";
import type { RootedCandidate } from "../src/packet/rooted-build.js";
import { circuitHasJogs } from "../src/layout/circuit-route-quality.js";
import { powerRouteGraph } from "../src/layout/power-placement-guard.js";
import {
  circuitLayoutContext,
  circuitInlineContext,
} from "../src/layout/circuit-inline-context.js";
import { circuitLayoutRun } from "../src/layout/circuit-inline.js";
import { rememberPowerPlacement } from "../src/layout/power-placement.js";
import { elkWorkLedger } from "../src/layout/elk-work.js";
import type { RootedSearch } from "../src/packet/rooted-search.js";

let original: PreparedSchematicDrawing;
beforeAll(async () => {
  const result = await prepareSchematicDrawing(await compileCoreFixture(), {
    format: "schematic-view-request/0.1",
    family: "power",
    flow: "left-to-right",
    root: { by: "designation", value: "M1" },
  });
  if (!result.ok) throw Error(JSON.stringify(result));
  original = result.value;
});
afterEach(() => vi.restoreAllMocks());

it.each(["SRC1", "CB1", "K1", "OL1", "M1"])(
  "rejects an explicit LTR %s phase-order reversal, even with coherent routes",
  (designation) => {
    const candidate = structuredClone(original);
    const nodes = candidate.graph.nodes.filter(
      (n) => "designation" in n && n.designation === designation,
    );
    const ports = nodes
      .flatMap((n) => n.ports)
      .filter((p) => !["PE"].includes(p.terminal.terminalKey));
    const owned = new Set(ports.map((p) => p.id));
    const ys = candidate.layout.ports
      .filter((p) => owned.has(p.id))
      .map((p) => p.y);
    const low = Math.min(...ys),
      high = Math.max(...ys);
    candidate.layout = {
      ...candidate.layout,
      nodes: candidate.layout.nodes.map((n) =>
        nodes.some((p) => p.id === n.id)
          ? { ...n, y: low + high - n.y - n.height }
          : n,
      ),
      ports: candidate.layout.ports.map((p) =>
        owned.has(p.id) ? { ...p, y: low + high - p.y } : p,
      ),
    };
    // For distributed poles, translate their fixed local ports with their nodes;
    // source/motor aggregates instead deliberately reverse fixed local phases.
    if (nodes.length > 1)
      candidate.layout = {
        ...candidate.layout,
        ports: candidate.layout.ports.map((port) => {
          const oldNode = original.layout.nodes.find(
            (n) => n.id === port.nodeId,
          )!;
          const node = candidate.layout.nodes.find(
            (n) => n.id === port.nodeId,
          )!;
          const old = original.layout.ports.find((p) => p.id === port.id)!;
          return { ...port, y: old.y + node.y - oldNode.y };
        }),
      };
    candidate.layout = {
      ...candidate.layout,
      edges: candidate.layout.edges.map((edge) => {
        const a = candidate.layout.ports.find(
            (p) => p.id === edge.sourcePortId,
          )!,
          b = candidate.layout.ports.find((p) => p.id === edge.targetPortId)!;
        return {
          ...edge,
          points: [
            { x: a.x, y: a.y },
            { x: (a.x + b.x) / 2, y: a.y },
            { x: (a.x + b.x) / 2, y: b.y },
            { x: b.x, y: b.y },
          ],
        };
      }),
    };
    // Isolate order from the independent crossing veto: either one suffices in
    // production, but this test must kill removal of the phase-order assertion.
    vi.spyOn(native, "circuitCrossingGuard").mockReturnValue(true);
    expect(powerNativeGuard(original, original)).toBe(true);
    expect(powerNativeGuard(candidate, original)).toBe(false);
  },
);

function routes(paths: number[][][], cable = false): RootedCandidate {
  const c = sideCandidate(1);
  c.scale = 1;
  c.prepared = {
    ...c.prepared,
    graph: {
      ...c.prepared.graph,
      edges: paths.map((_, i) => ({
        ...c.prepared.graph.edges[0]!,
        id: `e${i}`,
        elementIds:
          cable && i < 2
            ? [
                {
                  kind: "cable_conductor" as const,
                  cableUid: "same-cable",
                  conductorId: String(i),
                },
              ]
            : [{ kind: "wire" as const, uid: String(i) }],
      })),
    },
    layout: {
      ...c.prepared.layout,
      edges: paths.map((p, i) => ({
        ...c.prepared.layout.edges[0]!,
        id: `e${i}`,
        points: p.map(([x, y]) => ({ x: x!, y: y! })),
      })),
    },
  };
  return c;
}
const jog = [
  [0, 0],
  [10, 0],
  [10, 1],
  [20, 1],
];
const straight = [
  [0, 0],
  [20, 0],
];
it.each([false, true])(
  "refuses a repair paid for by another wire/core (cable=%s), in continuous and clipped populations",
  (cable) => {
    const before = routes([jog, straight, jog], cable);
    expect(
      powerConductorGuard(
        routes([straight, straight, straight], cable),
        before,
      ),
    ).toBe(true);
    expect(
      powerConductorGuard(routes([straight, jog, straight], cable), before),
    ).toBe(false);
    // A new continuous defect remains forbidden when it is outside every clip.
    const after = routes(
      [
        straight,
        [
          [500, 500],
          [510, 500],
          [510, 501],
          [520, 501],
        ],
        straight,
      ],
      cable,
    );
    expect(powerConductorGuard(after, before)).toBe(false);
  },
);

it("does not establish printed eligibility from an unprinted whole-group jog", () => {
  const c = routes([
    [
      [500, 500],
      [510, 500],
      [510, 501],
      [520, 501],
    ],
    straight,
  ]);
  expect(circuitHasJogs(powerRouteGraph(c, false))).toBe(true);
  expect(circuitHasJogs(powerRouteGraph(c))).toBe(false);
});

it("does not pay for a repaired phase with another conductor's bends or excess length", () => {
  const before = routes([jog, straight]);
  expect(
    powerConductorGuard(
      routes([
        straight,
        [
          [0, 0],
          [0, 5],
          [20, 5],
          [20, 0],
        ],
      ]),
      before,
    ),
  ).toBe(false);
  expect(
    powerConductorGuard(
      routes([
        straight,
        [
          [0, 0],
          [31, 0],
        ],
      ]),
      before,
    ),
  ).toBe(false);
});

it("rejects a detour exposed by the final visible clip, even with safe continuous routes", () => {
  const long = [
    [0, 0],
    [100, 0],
    [100, 40],
    [0, 40],
    [0, 80],
    [200, 80],
  ];
  const before = routes([jog, long]),
    after = routes([straight, long]);
  after.drafts = after.drafts.map((d) => ({
    ...d,
    rootedSections: d.rootedSections?.map((s) => ({
      ...s,
      viewport: { x: 0, y: 0, w: 110, h: 41 },
    })),
  }));
  expect(powerConductorGuard(after, before)).toBe(false);
});

it("conserves graph facts, ports and routes and consumes the common crossing veto", () => {
  const changed = structuredClone(original);
  changed.graph = {
    ...changed.graph,
    edges: changed.graph.edges.map((e, i) =>
      i ? e : { ...e, netId: "synthetic wrong net" },
    ),
  };
  expect(powerNativeGuard(changed, original)).toBe(false);
  const missing = structuredClone(original);
  missing.layout = { ...missing.layout, ports: missing.layout.ports.slice(1) };
  expect(powerNativeGuard(missing, original)).toBe(false);
  const route = structuredClone(original);
  route.layout = { ...route.layout, edges: route.layout.edges.slice(1) };
  expect(powerNativeGuard(route, original)).toBe(false);
  vi.spyOn(native, "circuitCrossingGuard").mockReturnValue(false);
  expect(powerNativeGuard(original, original)).toBe(false);
});

it.each([false, true])(
  "only the original pass establishes printed power eligibility (quality=%s)",
  (qualityPhase) => {
    const context = circuitLayoutContext(),
      run = circuitLayoutRun(),
      candidate = routes([jog]);
    context.qualityPhase = qualityPhase;
    const search = {
      attempts: 0,
      elkWork: elkWorkLedger("synthetic", 48),
    } as RootedSearch;
    circuitInlineContext.run(context, () =>
      rememberPowerPlacement(run, candidate, candidate, search),
    );
    expect(run.printed.size).toBe(qualityPhase ? 0 : 1);
    expect(run.baseline.size).toBe(qualityPhase ? 0 : 1);
    expect(!!run.power).toBe(!qualityPhase);
  },
);
