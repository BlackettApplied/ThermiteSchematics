import { expect, it } from "vitest";
import { labelMetrics } from "../src/packet/label-text.js";
import { packContinuationLabels } from "../src/packet/continuation-pack.js";
import { fitContinuations } from "../src/packet/continuation-fit.js";
import {
  continuationHeaderWidth,
  continuationLabel,
} from "../src/packet/continuation-label.js";
import { drawingContinuations } from "../src/packet/rooted-links.js";
import type { Draft, Link } from "../src/packet/types.js";
import type { PresentationEdge } from "../src/types.js";
const page = {
  size: "tabloid" as const,
  orientation: "landscape" as const,
  marginMm: 10,
  widthMm: 431.8,
  heightMm: 279.4,
};
const draft = (links: Link[]) =>
  ({
    links,
    view: {
      format: "schematic-view/0.1",
      family: "control",
      flow: "left-to-right",
      root: { deviceUid: "k", designation: "K1" },
    },
    title: { projectName: "Oracle", revision: "A", lines: [] },
    drawingBounds: { x: 28, y: 47, w: 375.8, h: 180 },
    rootedShapes: [],
  }) as unknown as Draft;
it("packs dense labels in anchor order with 2.5 mm of clear ink", () => {
  const links = [0, 6, 12].map((y, i) => ({
    id: `C00${i}`,
    to: 2,
    conductor: "W1",
    netId: "N",
    x: 100,
    y,
    side: "right" as const,
    label: {
      rows: [
        {
          text: "header",
          x: 103,
          y,
          ink: { x: 103, y: y - 2.7, w: 18, h: 1.8 },
        },
        {
          text: "W1",
          x: 103,
          y: y + 3.5,
          ink: { x: 103, y: y + 0.8, w: 8, h: 1.8 },
        },
      ],
      bounds: { x: 103, y: y - 2.7, w: 18, h: 5.34 },
      width: 18,
      headerWidth: 18,
      single: false,
    },
  }));
  expect(packContinuationLabels(draft(links))).toBe(true);
  for (let i = 1; i < links.length; i++)
    expect(
      links[i]!.label.bounds.y -
        links[i - 1]!.label.bounds.y -
        links[i - 1]!.label.bounds.h,
    ).toBeGreaterThanOrEqual(2.499);
  expect(links.map((l) => l.y)).toEqual([0, 6, 12]);
  expect(
    links.every((l) => Math.abs(l.label.bounds.y - (l.y - 2.7)) <= 3.5),
  ).toBe(true);
});
it("refuses a bank that would need unbounded movement", () => {
  const links = Array.from({ length: 12 }, (_, i) => ({
    id: `C${i}`,
    to: 2,
    conductor: "W1",
    netId: "N",
    x: 100,
    y: i * 3,
    side: "right" as const,
    label: {
      rows: [],
      bounds: { x: 103, y: i * 3, w: 18, h: 10 },
      width: 18,
      headerWidth: 18,
      single: false,
    },
  }));
  expect(packContinuationLabels(draft(links))).toBe(false);
});
it("validates complete label ink after composition against drawing content", () => {
  const d = draft([
    {
      id: "C001",
      to: 2,
      conductor: "W1",
      netId: "N",
      x: 100,
      y: 100,
      side: "right",
    },
  ]);
  d.rootedShapes = [{ x: 104, y: 97, w: 24, h: 10 }];
  const result = fitContinuations(
    [d],
    page,
    {
      width: 18,
      headerWidth: 18,
      single: false,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
    true,
  );
  expect(result).toContain("W1");
  expect(result).toContain("1 mm to drawing content");
  expect(result).toContain("2.5 mm between continuation blocks");
  expect(result).toMatch(/short by [\d.]+ mm/u);
});
it("accepts exact frame clearance and refuses 0.1 mm less without shrinking", () => {
  const link: Link = {
    id: "C001",
    to: 2,
    conductor: "W1",
    netId: "N",
    x: 100,
    y: 100,
    side: "right",
  };
  const bank = {
    width: 18,
    headerWidth: 18,
    single: false,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };
  const box = continuationLabel(link, 18, 18).bounds;
  const exact = { ...page, widthMm: box.x + box.w + page.marginMm + 1.2 };
  expect(
    fitContinuations([draft([{ ...link }])], exact, bank, true),
  ).toBeUndefined();
  const failure = fitContinuations(
    [draft([{ ...link }])],
    { ...exact, widthMm: exact.widthMm - 0.1 },
    bank,
    true,
  );
  expect(failure).toContain("W1");
  expect(failure).toContain("short by 0.10 mm");
});
it("measures the 100th sheet rather than a two-digit placeholder", () => {
  expect(continuationHeaderWidth(1000)).toBeGreaterThanOrEqual(17.744);
});
it("never turns a reference leader or synthetic attachment into a conductor", () => {
  const edge = {
    id: "ref",
    label: { role: "reference", text: "reference only" },
    elementIds: [],
  } as unknown as PresentationEdge;
  const geometry = {
      edges: [
        {
          id: "ref",
          netId: "N",
          points: [
            { x: 0, y: 10 },
            { x: 100, y: 10 },
          ],
        },
      ],
    },
    a = draft([]),
    b = draft([]),
    area = { x: 28, y: 47, w: 100, h: 100 };
  expect(
    drawingContinuations(
      [a, b],
      { edges: [edge] },
      geometry,
      [0, 70, 140],
      [0, 100],
      area,
      1,
    ).ok,
  ).toBe(true);
  expect(a.links).toEqual([]);
  const bad = drawingContinuations(
    [a, b],
    { edges: [{ ...edge, label: undefined } as unknown as PresentationEdge] },
    geometry,
    [0, 70, 140],
    [0, 100],
    area,
    1,
  );
  expect(bad).toMatchObject({ ok: false, error: { code: "R006" } });
});

it.each(["left", "right", "top", "bottom"] as const)(
  "keeps at least 2.5 mm of row-ink gap between adjacent blocks on the %s bank",
  (side) => {
    const axis = side === "left" || side === "right" ? "y" : "x";
    const dimension = axis === "x" ? "w" : "h";
    const base: Link = {
      id: "C001",
      to: 100,
      toZone: "D6",
      conductor: "PLC1-DO0-STOP",
      netId: "N",
      x: 100,
      y: 100,
      side,
    };
    const headerWidth = continuationHeaderWidth(1000);
    const initial = continuationLabel(base, 30, headerWidth);
    // Begin at the former 1 mm spacing so the adopted packer must separate them.
    const links = [0, 1, 2].map((i) => {
      const link = {
        ...base,
        id: `C00${i + 1}`,
        [axis]: 100 + i * (initial.bounds[dimension] + 1),
      };
      return { ...link, label: continuationLabel(link, 30, headerWidth) };
    });
    const anchors = links.map((l) => l[axis]);
    expect(packContinuationLabels(draft(links))).toBe(true);
    const ink = (row: (typeof initial.rows)[number]) => {
      const m = labelMetrics(row.text);
      return {
        x: row.x + m.left,
        y: row.y - m.top,
        w: m.right - m.left,
        h: m.top - m.bottom,
      };
    };
    for (let i = 1; i < links.length; i++) {
      const previous = links[i - 1]!.label.rows.map(ink),
        next = links[i]!.label.rows.map(ink);
      const gap =
        Math.min(...next.map((r) => r[axis])) -
        Math.max(...previous.map((r) => r[axis] + r[dimension]));
      expect(gap).toBeGreaterThanOrEqual(2.5 - 0.000001);
    }
    expect(links.map((l) => l[axis])).toEqual(anchors);
  },
);
