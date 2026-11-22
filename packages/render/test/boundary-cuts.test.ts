import { afterEach, expect, it } from "vitest";
import { prepareSchematicDrawing } from "../src/renderer.js";
import type { PreparedSchematicDrawing } from "../src/renderer.js";
import type { LayoutEdge } from "../src/types.js";
import { rootedGrids, gridLinks } from "../src/packet/rooted-plans.js";
import { rootedBankGrids } from "../src/packet/rooted-bank-grids.js";
import { continuationBanks } from "../src/packet/continuation-bank.js";
import { rootedCrossings } from "../src/packet/rooted-crossings.js";
import { continuationIdentity } from "../src/packet/continuation-identity.js";
import { dolFixture, actuation } from "./dol-control-junctions-fixture.js";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const remove of dispose.splice(0)) await remove();
});

function inputRoute(
  route: LayoutEdge,
  id: string,
  points: LayoutEdge["points"],
): LayoutEdge {
  return { ...route, id, points, sectionIds: [id], sections: [{ id, points }] };
}

// Neutral geometry contract, not a circuit golden. Only the saved, unpatched
// fixture supplies typed metadata. These literal boxes/points are grid input;
// production routing is neither mocked nor edited by the cut planner.
async function geometry(axis: "x" | "y", authored = false, extraCount = 0) {
  const f = await dolFixture("saved");
  dispose.push(f.dispose);
  const result = await prepareSchematicDrawing(
    f.ir,
    actuation("R1", "top-to-bottom"),
  );
  if (!result.ok) throw new Error(result.error.message);
  const p = result.value;
  const semantic = p.graph.edges.find((e) =>
    authored ? !!continuationIdentity(e) : e.kind === "boundary-segment",
  );
  const route = p.layout.edges.find((e) => e.id === semantic?.id);
  if (!semantic || !route) throw new Error("Missing neutral edge metadata");
  const extra = p.graph.edges
    .filter((e) => !!continuationIdentity(e))
    .slice(0, extraCount);
  const extraRoutes = extra.map((edge, i) => {
    const original = p.layout.edges.find((e) => e.id === edge.id);
    if (!original) throw new Error("Missing authored neutral route metadata");
    return inputRoute(original, edge.id, [
      { x: 10 + i * 10, y: 0 },
      { x: 10 + i * 10, y: 300 },
    ]);
  });
  const points =
    axis === "y"
      ? [
          { x: 50, y: 150 },
          { x: 50, y: 250 },
        ]
      : [
          { x: 150, y: 50 },
          { x: 250, y: 50 },
        ];
  const fixture: PreparedSchematicDrawing = {
    ...p,
    graph: {
      ...p.graph,
      edges: [{ ...semantic, id: "neutral-edge" }, ...extra],
    },
    layout: {
      ...p.layout,
      width: axis === "x" ? 300 : 100,
      height: axis === "y" ? 300 : 100,
      nodes: [],
      labels: [],
      edges: [inputRoute(route, "neutral-edge", points), ...extraRoutes],
    },
  };
  return fixture;
}

const axes: ("x" | "y")[] = ["x", "y"];
it.each(axes)(
  "keeps a presentation-only segment whole at a greedy %s cut",
  async (axis) => {
    const p = await geometry(axis);
    const before = JSON.stringify(p);
    const b = { x: 0, y: 0, w: 200, h: 200 };
    const plans = rootedGrids(p, b, 1, false);
    expect(plans).toHaveLength(1);
    const grid = plans[0];
    if (!grid) throw new Error("Missing safe grid");
    expect(axis === "x" ? grid.xs : grid.ys).toEqual([0, 164, 340]);
    for (const edge of p.layout.edges)
      expect(rootedCrossings(edge, grid.xs, grid.ys, b, 1)).toEqual([]);
    expect(gridLinks(p, grid, b, 1)).toBe(true);
    expect(p.graph.edges[0]?.elementIds).toEqual([]);
    expect(p.graph.edges[0]?.conductor).toBeUndefined();
    expect(JSON.stringify(p)).toBe(before);
  },
);

it("retains the original cut and authored identity for a real conductor", async () => {
  const p = await geometry("y", true);
  const plans = rootedGrids(p, { x: 0, y: 0, w: 200, h: 200 }, 1, false);
  expect(plans[0]?.ys).toEqual([0, 200, 340]);
  const edge = p.graph.edges[0];
  if (!edge) throw new Error("Missing authored edge");
  expect(continuationIdentity(edge)).toBeDefined();
});

it("explains why an unavoidable presentation-only cut cannot be labelled", async () => {
  const p = await geometry("y");
  let message = "";
  expect(
    gridLinks(
      p,
      { xs: [0, 140], ys: [0, 200, 340] },
      { x: 0, y: 0, w: 200, h: 200 },
      1,
      undefined,
      (error) => {
        message = error.message;
      },
    ),
  ).toBe(false);
  expect(message).toContain("presentation-only boundary segment");
  expect(message).toContain("must remain uncut");
  expect(message).not.toContain("Provide a usable authored printed identity");
});

it("keeps the refusal when the uncuttable segment cannot fit any legal strip", async () => {
  const p = await geometry("y");
  const edge = p.layout.edges[0];
  if (!edge) throw new Error("Missing neutral edge");
  const long = {
    ...p,
    layout: {
      ...p.layout,
      edges: [
        inputRoute(edge, edge.id, [
          { x: 50, y: 0 },
          { x: 50, y: 300 },
        ]),
      ],
    },
  };
  expect(rootedGrids(long, { x: 0, y: 0, w: 200, h: 100 }, 1)).toEqual([]);
  expect(long.graph.edges[0]?.conductor).toBeUndefined();
  expect(long.graph.edges[0]?.elementIds).toEqual([]);
});

it("rejects the boundary-safe proposal when authored continuation labels are too close", async () => {
  const p = await geometry("y", false, 2);
  const messages: string[] = [];
  expect(
    rootedGrids(p, { x: 0, y: 0, w: 200, h: 200 }, 1, false, false, (error) =>
      messages.push(error.message),
    ),
  ).toEqual([]);
  expect(
    messages.some((message) =>
      message.includes("Continuation labels are too close"),
    ),
  ).toBe(true);
});

const field = { x: 0, y: 0, w: 200, h: 200 };
const planBanks = (p: PreparedSchematicDrawing) =>
  rootedBankGrids(p, field, 1, continuationBanks(p, field, 1), false);

it("reports the authored conductor that blocks the boundary-safe retry", async () => {
  const p = await geometry("y", false, 1);
  const [boundary, wire] = p.graph.edges;
  if (!boundary || !wire) throw Error("Missing neutral probe edges");
  const hostile = {
    ...p,
    graph: {
      ...p.graph,
      edges: [boundary, { ...wire, conductor: undefined }],
    },
  };
  const { grids, cutFailure } = planBanks(hostile);
  expect(grids).toEqual([]);
  expect(cutFailure).toMatchObject({
    code: "R006",
    root: "packet",
    reason: "unprintable-layout",
    details: {
      continuationIdentity: boundary.id,
      boundaryCutRetry: { continuationIdentity: wire.id },
    },
  });
  expect(cutFailure?.message).toMatch(
    /A candidate cut crosses this conductor\..*Use larger paper.*The original grid also failed\..*boundary segment.*must remain uncut/,
  );
});

it("reports the label spacing that blocks the boundary-safe retry", async () => {
  const p = await geometry("y", false, 2);
  const [boundary, ...wires] = p.graph.edges;
  const { grids, cutFailure } = planBanks(p);
  expect(grids).toEqual([]);
  expect(cutFailure).toMatchObject({
    code: "R006",
    root: "packet",
    reason: "unprintable-layout",
    details: {
      continuationIdentity: boundary?.id,
      boundaryCutRetry: {
        conductorIds: wires.flatMap((wire) => wire.elementIds),
        continuationSpacing: { actualMm: 10, minimumMm: 18 },
      },
    },
  });
  expect(cutFailure?.message).toMatch(
    /Continuation labels are too close.*10\.00 mm apart, 18 mm required.*Change flow, use a larger sheet.*The original grid also failed\..*boundary segment/,
  );
});

it("returns the boundary-safe grid without a failure when the retry succeeds", async () => {
  const p = await geometry("y");
  // The original safe search needs nine rows and ten columns, beyond the
  // 80-cell guard. The protected greedy retry fits in eight rows.
  const wide = { ...p, layout: { ...p.layout, width: 1960, height: 1524 } };
  const { grids, cutFailure } = planBanks(wide);
  expect(grids[0]?.grid).toMatchObject({
    greedy: true,
    ys: [0, 164, 364, 564, 764, 964, 1164, 1364, 1564],
  });
  expect(cutFailure).toBeUndefined();
});
