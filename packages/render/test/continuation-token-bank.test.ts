import { expect, it, vi } from "vitest";
import * as plans from "../src/packet/rooted-plans.js";
import { labelMetrics } from "../src/packet/label-text.js";
import { continuationBanks } from "../src/packet/continuation-bank.js";
import { continuationLabel } from "../src/packet/continuation-label.js";
import type { PreparedSchematicDrawing } from "../src/renderer.js";

it("reserves the printed jumper caption and keeps one uniform form in each bank", () => {
  const uid = "15400000-0000-4000-8000-000000000202";
  const prepared = {
    graph: {
      edges: [
        {
          id: "j",
          kind: "conductor",
          elementIds: [{ kind: "jumper", uid }],
          conductor: { kind: "jumper", uid },
        },
      ],
    },
    layout: {
      edges: [
        {
          id: "j",
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
    const banks = continuationBanks(
      prepared,
      { x: 28, y: 47, w: 376, h: 180 },
      0.25,
    );
    expect(banks).toHaveLength(2);
    expect(banks.every((b) => b.width >= labelMetrics("JUMPER").width)).toBe(
      true,
    );
    expect(banks.every((b) => b.width < labelMetrics(uid).width)).toBe(true);
    expect(new Set(banks.map((b) => JSON.stringify(b))).size).toBe(
      banks.length,
    );
    expect(banks.every((b) => b.headerWidth >= 16.314)).toBe(true);
  } finally {
    seed.mockRestore();
  }
});

const crossed = (
  identities: string[],
  kind: "wire" | "jumper",
  vertical = false,
) =>
  ({
    graph: {
      edges: identities.map((identity, i) => ({
        id: `edge-${i}`,
        elementIds: [{ kind, uid: identity }],
        conductor: { kind, uid: identity, designation: identity },
      })),
    },
    layout: {
      edges: identities.map((_, i) => ({
        id: `edge-${i}`,
        points: vertical
          ? [
              { x: 50 + i * 10, y: 0 },
              { x: 50 + i * 10, y: 200 },
            ]
          : [
              { x: 0, y: 50 + i * 10 },
              { x: 200, y: 50 + i * 10 },
            ],
      })),
    },
  }) as unknown as PreparedSchematicDrawing;

it.each([
  ["left", 9.35],
  ["right", 4.35],
] as const)(
  "reserves the full inline header and identity on the %s side",
  (side, inset) => {
    const identities = ["W1", "PLC1-DO0-STOP"],
      seed = vi
        .spyOn(plans, "rootedGrids")
        .mockReturnValue([{ xs: [0, 100, 200], ys: [0, 100] }]);
    try {
      const bank = continuationBanks(
        crossed(identities, "wire"),
        { x: 28, y: 47, w: 376, h: 180 },
        0.25,
        1000,
      ).find((b) => b.single)!;
      const widestInk = Math.max(
        ...identities.map((identity) => {
          const m = labelMetrics(`C1000 / 100.D6 / ${identity}`);
          return m.right - m.left;
        }),
      );
      // The plan adds space beyond the existing 18 mm native side gutter.
      expect(bank[side] + 18).toBeGreaterThanOrEqual(widestInk + inset);
    } finally {
      seed.mockRestore();
    }
  },
);

it("counts the JUMPER caption row in the top bank height", () => {
  const uid = "15400000-0000-4000-8000-000000000202",
    seed = vi
      .spyOn(plans, "rootedGrids")
      .mockReturnValue([{ xs: [0, 100], ys: [0, 100, 200] }]);
  try {
    const bank = continuationBanks(
      crossed([uid], "jumper", true),
      { x: 28, y: 47, w: 376, h: 180 },
      0.25,
    ).find((b) => !b.single)!;
    const label = continuationLabel(
      {
        id: "C999",
        to: 100,
        toZone: "D6",
        conductor: "JUMPER",
        netId: "N",
        x: 100,
        y: 100,
        side: "top",
      },
      bank.width,
      bank.headerWidth,
    );
    expect(label.rows.map((r) => r.text)).toEqual(["C999 / 100.D6", "JUMPER"]);
    const top = Math.min(
        ...label.rows.map((r) => r.y - labelMetrics(r.text).top),
      ),
      bottom = Math.max(
        ...label.rows.map((r) => r.y - labelMetrics(r.text).bottom),
      );
    // The top bank has an 8.96 mm native gutter and a 4.15 mm caption inset.
    expect(bank.top + 8.96).toBeGreaterThanOrEqual(bottom - top + 4.15);
  } finally {
    seed.mockRestore();
  }
});
