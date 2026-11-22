import { expect, it } from "vitest";
import { expandHeadings } from "../src/packet/strip-envelope.js";
import { rootedDraft } from "../src/packet/rooted-draft.js";
import { postTrimCaptionConstraint } from "../src/packet/rooted-caption.js";
import type { PreparedSchematicDrawing } from "../src/renderer.js";
const page = {
  size: "letter",
  orientation: "portrait",
  widthMm: 215.9,
  heightMm: 279.4,
  marginMm: 10,
} as const;
it("expands a chain of newly intersected headings to a fixed point", () => {
  const result = expandHeadings(
    { x: 0, y: 100, w: 100, h: 20 },
    [
      { x: 0, y: 75, w: 50, h: 14 },
      { x: 0, y: 90, w: 50, h: 14 },
    ],
    300,
  );
  expect(result.y).toBe(71);
  expect(result.y + result.h).toBe(120);
});
it("keeps touching and near-touching heading ink through coordinate rounding", () => {
  const result = expandHeadings(
    { x: 0, y: 100, w: 100, h: 20 },
    [{ x: 0, y: 80, w: 50, h: 19.999 }],
    300,
  );
  expect(result.y).toBe(76);
});
it("rejects a caption that lengthens only after trimming, including wrapped notice ink", () => {
  const groups = Array.from({ length: 6 }, (_, i) => ({
    id: "g" + i,
    label: { id: "l" + i, text: "LOCATION-LONG-" + i, textLength: 120 },
  }));
  const p = {
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: "K", designation: "K" },
      flow: "left-to-right",
    },
    titleContext: { lines: [] },
    graph: { nodes: [], edges: [], locationGroups: groups },
    layout: {
      nodes: groups.map((g) => ({
        id: g.id,
        kind: "location",
        x: 0,
        y: 0,
        width: 500,
        height: 300,
      })),
      labels: groups.map((g, i) => ({
        id: g.label.id,
        ownerKind: "location",
        ownerId: g.id,
        role: "location",
        text: g.label.text,
        x: 0,
        y: i * 14,
        width: 150,
        height: 14,
      })),
      edges: [],
    },
  } as unknown as PreparedSchematicDrawing;
  const b = { x: 28, y: 80, w: 120, h: 180 };
  const before = rootedDraft(
    p,
    { xs: [0, 500], ys: [0, 350] },
    0,
    0,
    b,
    0.25,
    "",
  );
  expect(before.continuedCaption).toBe("");
  expect(postTrimCaptionConstraint([before], page)).toBeUndefined();
  const after = rootedDraft(
    p,
    { xs: [0, 500], ys: [150, 350] },
    0,
    0,
    b,
    0.25,
    "",
  );
  expect(after.continuedCaption).toContain("LOCATION-LONG-5");
  expect(postTrimCaptionConstraint([after], page)).toContain(
    "exceeds its header width",
  );
});

it("does not charge a wholly unpainted far heading to every strip", async () => {
  const { stripEnvelope } = await import("../src/packet/strip-envelope.js");
  const label = {
    id: "heading",
    ownerKind: "location",
    ownerId: "location",
    role: "location",
    text: "FIELD",
    x: 0,
    y: 0,
    width: 90,
    height: 14,
  };
  const p = {
    graph: { locationGroups: [{ label: { ...label, textLength: 84 } }] },
    layout: {
      nodes: [
        { id: "leaf", kind: "symbol", x: 0, y: 100, width: 50, height: 20 },
      ],
      labels: [label],
      ports: [],
      edges: [],
    },
  } as unknown as PreparedSchematicDrawing;
  expect(stripEnvelope(p, -20, 100, 300)!.y).toBeGreaterThan(90);
});
it.each(["card", "marker"] as const)(
  "includes independent %s ink in the strip envelope",
  async (kind) => {
    const { stripEnvelope } = await import("../src/packet/strip-envelope.js");
    const p = {
      graph: { locationGroups: [] },
      layout: {
        nodes: [
          { id: "leaf", kind: "symbol", x: 0, y: 100, width: 50, height: 20 },
        ],
        labels:
          kind === "card"
            ? [{ x: 0, y: 200, width: 50, height: 20, role: "reference" }]
            : [],
        ports: kind === "marker" ? [{ x: 0, y: 200, width: 0, height: 0 }] : [],
        edges: [],
      },
    } as unknown as PreparedSchematicDrawing;
    const result = stripEnvelope(p, -20, 100, 300)!;
    expect(result.y + result.h).toBeCloseTo(
      kind === "card" ? 224.75 : 206.75,
      8,
    );
  },
);

it("falls back before accepting a fold whose rebuilt caption exceeds paper width", async () => {
  const { vi } = await import("vitest");
  const plans = await import("../src/packet/rooted-plans.js");
  const { buildRootedCandidates } =
    await import("../src/packet/rooted-build.js");
  const groups = Array.from({ length: 12 }, (_, i) => ({
    id: "g" + i,
    label: { id: "l" + i, text: "LOCATION-LONG-" + i, textLength: 120 },
  }));
  const nodes = [0, 1].map((i) => ({
    id: "n" + i,
    kind: "symbol",
    deviceUid: "d" + i,
    designation: "D" + i,
    functionIds: [],
    labels: [],
    symbolSize: { width: 20, height: 20 },
    primitiveOrigin: { x: 0, y: 0 },
  }));
  const p = {
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: "K", designation: "K" },
      flow: "left-to-right",
    },
    titleContext: {
      projectName: "Trim caption",
      revision: "A",
      toolVersion: "test",
      lines: [],
    },
    graph: { nodes, edges: [], locationGroups: groups },
    layout: {
      width: 600,
      height: 400,
      ports: [],
      edges: [],
      nodes: [
        ...nodes.map((n, i) => ({
          id: n.id,
          kind: "symbol",
          x: 20 + i * 300,
          y: 250,
          width: 20,
          height: 20,
        })),
        ...groups.map((g) => ({
          id: g.id,
          kind: "location",
          x: 0,
          y: 0,
          width: 200,
          height: 380,
        })),
      ],
      labels: groups.map((g, i) => ({
        id: g.label.id,
        ownerKind: "location",
        ownerId: g.id,
        role: "location",
        text: g.label.text,
        x: 0,
        y: i * 14,
        width: 150,
        height: 14,
      })),
    },
  } as unknown as PreparedSchematicDrawing;
  const spy = vi
    .spyOn(plans, "rootedGrids")
    .mockReturnValue([{ xs: [0, 300, 600], ys: [0, 400] }]);
  try {
    const result = buildRootedCandidates({} as never, p, page);
    if (!result.ok) throw Error(JSON.stringify(result));
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.every((c) => c.drafts.length === 2)).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
