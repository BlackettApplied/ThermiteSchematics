import { expect, it, vi } from "vitest";
import {
  continuationHeaderWidth,
  continuationLabel,
  continuationLabelSvg,
} from "../src/packet/continuation-label.js";
import { continuationBanks } from "../src/packet/continuation-bank.js";
import * as plans from "../src/packet/rooted-plans.js";
import * as packing from "../src/packet/continuation-pack.js";
import { fitContinuations } from "../src/packet/continuation-fit.js";
import { labelMetrics } from "../src/packet/label-text.js";
import type { Draft, Link } from "../src/packet/types.js";
import type { PreparedSchematicDrawing } from "../src/renderer.js";

const link = (conductor = "PLC1-DO0-STOP", id = "C999"): Link => ({
  id,
  conductor,
  to: 100,
  toZone: "D6",
  netId: "N",
  x: 100,
  y: 100,
  side: "right",
});
const bank = {
  width: 18,
  headerWidth: continuationHeaderWidth(1000),
  single: false,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};
const page = {
  size: "tabloid" as const,
  orientation: "landscape" as const,
  widthMm: 431.8,
  heightMm: 279.4,
  marginMm: 10,
};
const draft = (links: Link[]): Draft =>
  ({
    links,
    view: {
      format: "schematic-view/0.1",
      family: "control",
      flow: "left-to-right",
      root: { deviceUid: "k", designation: "K1" },
    },
    title: { projectName: "Synthetic", revision: "A", lines: [] },
    drawingBounds: { x: 28, y: 47, w: 375.8, h: 180 },
    rootedShapes: [],
  }) as unknown as Draft;

it.each([
  "PLC1-DO0-STOP",
  "LONG-HYPHENATED-AUTHORED-CONDUCTOR-NUMBER",
  "Åe\u0301 Ω∑",
  "W".repeat(140),
])(
  "keeps %s indivisible at both serial widths and both bank forms",
  (conductor) => {
    for (const id of ["C999", "C1000"])
      for (const single of [false, true]) {
        const l = link(conductor, id),
          label = continuationLabel(
            l,
            18,
            continuationHeaderWidth(1000),
            single,
          );
        const svg = continuationLabelSvg({ ...l, label });
        expect(label.rows).toHaveLength(single ? 1 : 2);
        expect(label.rows.at(-1)?.text).toBe(
          single ? `${id} / 100.D6 / ${conductor}` : conductor,
        );
        expect(label.bounds.w).toBeGreaterThanOrEqual(
          labelMetrics(conductor).width,
        );
        expect(svg).not.toContain("textLength");
        expect(svg).toContain('font-size="2.5"');
        expect(label.bounds.w).toBeLessThan(page.widthMm - 2 * page.marginMm);
      }
  },
);

it("kills a row break that conserves every authored byte", () => {
  const l = link(),
    label = continuationLabel(l, 18, bank.headerWidth);
  const body = label.rows[1]!;
  label.rows.splice(
    1,
    1,
    { ...body, text: "PLC1-DO0-" },
    { ...body, text: "STOP", y: body.y + 3.5 },
  );
  expect(
    label.rows
      .slice(1)
      .map((r) => r.text)
      .join(""),
  ).toBe(l.conductor);
  expect(() => continuationLabelSvg({ ...l, label })).toThrow(/one line/u);
});

it("kills a mixed inline/two-level bank instead of accepting a descriptor exception", () => {
  const a = link("W1"),
    b = { ...link("jumper-uid", "C1000"), descriptor: "JUMPER", y: 140 };
  expect(
    fitContinuations([draft([a, b])], page, { ...bank, single: true }, true),
  ).toContain("same form");
});

it("rejects a neighbour moved inside the gap even if packing is bypassed", () => {
  const a = link("W1"),
    height = continuationLabel(a, 18, bank.headerWidth).bounds.h;
  const b = { ...link("W2", "C1000"), y: a.y + height + 2.0 };
  const pack = vi
    .spyOn(packing, "packContinuationLabels")
    .mockReturnValue(true);
  try {
    expect(fitContinuations([draft([a, b])], page, bank, true)).toContain(
      "2.5 mm between continuation blocks",
    );
  } finally {
    pack.mockRestore();
  }
});

it("rejects actual zone-glyph ink occupying a continuation reservation", () => {
  const l = { ...link("W1"), x: 33, y: 69.5, side: "left" as const };
  const label = continuationLabel(l, 18, bank.headerWidth);
  expect(label.bounds.x).toBeGreaterThan(page.marginMm + 1.2);
  // The actual generated A glyph is at (13, 69.5), inside this reservation.
  expect(fitContinuations([draft([l])], page, bank, true)).toContain(
    "clear ink",
  );
});

it("does not make an uncut long identity widen another block's bank", () => {
  const edge = (id: string, name: string) => ({
    id,
    elementIds: [{ kind: "wire", uid: id }],
    conductor: { kind: "wire", uid: id, designation: name },
    label: { text: name },
  });
  const p = {
    graph: { edges: [edge("cut", "W1")] },
    layout: {
      edges: [
        {
          id: "cut",
          points: [
            { x: 0, y: 50 },
            { x: 200, y: 50 },
          ],
        },
      ],
    },
  } as unknown as PreparedSchematicDrawing;
  const seed = vi
    .spyOn(plans, "rootedGrids")
    .mockReturnValue([{ xs: [0, 100, 200], ys: [0, 100] }]);
  try {
    const b = { x: 28, y: 47, w: 376, h: 180 },
      before = continuationBanks(p, b, 0.25);
    const wide = {
      ...p,
      graph: {
        ...p.graph,
        edges: [...p.graph.edges, edge("uncut", "W".repeat(120))],
      },
      layout: {
        ...p.layout,
        edges: [
          ...p.layout.edges,
          {
            id: "uncut",
            points: [
              { x: 0, y: 60 },
              { x: 20, y: 60 },
            ],
          },
        ],
      },
    } as unknown as PreparedSchematicDrawing;
    const after = continuationBanks(wide, b, 0.25);
    expect(
      after.map(({ left, right, top, bottom }) => ({
        left,
        right,
        top,
        bottom,
      })),
    ).toEqual(
      before.map(({ left, right, top, bottom }) => ({
        left,
        right,
        top,
        bottom,
      })),
    );
  } finally {
    seed.mockRestore();
  }
});

it("fits a full-width identity on the largest paper without a smaller face", () => {
  const l = {
    ...link("W".repeat(140), "C1000"),
    side: "bottom" as const,
    x: page.widthMm / 2,
  };
  for (const single of [false, true]) {
    const d = draft([{ ...l }]);
    expect(
      fitContinuations([d], page, { ...bank, width: 400, single }, true),
    ).toBeUndefined();
    const label = d.links[0]!.label!;
    expect(label.bounds.x).toBeGreaterThan(page.marginMm + 1.2);
    expect(label.bounds.x + label.bounds.w).toBeLessThan(
      page.widthMm - page.marginMm - 1.2,
    );
    expect(continuationLabelSvg(d.links[0]!)).toContain('font-size="2.5"');
  }
});
