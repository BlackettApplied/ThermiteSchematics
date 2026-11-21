import {
  captionHostFixture as fixture,
  captionHostWitness as nativeWitness,
} from "./helpers/circuit-caption-host.js";
import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import * as placement from "../src/circuit/caption-placement.js";
import * as blocks from "../src/circuit/caption-block.js";
import * as loops from "../src/circuit/separate-loops.js";
import { plannedCircuitCaption } from "../src/circuit/caption-plan.js";
import { unhostableCaptionFallback } from "../src/circuit/caption-fallback.js";
import { uncoveredCaptionRuns } from "../src/circuit/caption-uncovered.js";
import {
  leaderCaptionPositions,
  CAPTION_POSITIONS_PER_UNCOVERED_RUN,
} from "../src/circuit/caption-leader-positions.js";
import { InlineLabelCollisionError } from "../src/layout/inline-label-error.js";
import { required } from "./fixtures.js";
import type { CircuitLabelState } from "../src/circuit/layout-routes.js";
import { printableTextWidth } from "../src/text-metrics.js";
type Segment = CircuitLabelState["segments"][number];
const label = { index: 0, width: 10.375, height: 3.8 };
function sharedRun(length: number, vertical = false): Segment[] {
  const p = (n: number) => (vertical ? { x: 0, y: n } : { x: n, y: 0 });
  return [
    { index: 0, a: p(0), b: p(30) },
    { index: 1, a: p(0), b: p(10) },
    { index: 2, a: p(10 + length), b: p(30) },
  ];
}
it("keeps a hostable run fail-closed at the exact unchanged block boundary", () => {
  expect(
    unhostableCaptionFallback(label, sharedRun(label.width), true, false),
  ).toBe(false);
  expect(
    unhostableCaptionFallback(
      label,
      sharedRun(label.width - 0.001),
      true,
      false,
    ),
  ).toBe(true);
  expect(
    unhostableCaptionFallback(
      label,
      sharedRun(label.width + 0.001),
      true,
      false,
    ),
  ).toBe(false);
  expect(
    unhostableCaptionFallback(
      label,
      sharedRun(label.height, true),
      true,
      false,
    ),
  ).toBe(false);
  expect(
    unhostableCaptionFallback(
      label,
      sharedRun(label.height - 0.001, true),
      true,
      false,
    ),
  ).toBe(true);
  expect(unhostableCaptionFallback(label, sharedRun(8), false, false)).toBe(
    false,
  );
  expect(unhostableCaptionFallback(label, sharedRun(8), true, true)).toBe(
    false,
  );
  expect(
    unhostableCaptionFallback(label, [required(sharedRun(8)[0])], true, false),
  ).toBe(false);
  expect(unhostableCaptionFallback(label, [], true, false)).toBe(false);
  expect(
    unhostableCaptionFallback(
      label,
      [{ index: 0, a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }],
      true,
      false,
    ),
  ).toBe(false);
});
it("uses the native caption fallback after a non-label failure in the separated attempt", async () => {
  const separate = loops.separateCoincidentLoops;
  const separationSpy = vi
    .spyOn(loops, "separateCoincidentLoops")
    .mockImplementation((...args) => {
      const separation = separate(...args);
      if (!separation) return;
      const bad = structuredClone(separation);
      const edge = required(
        bad.graph.edges?.find((edge) => bad.nestedEdges.has(edge.id)),
      );
      const section = required(edge.sections?.[0]);
      section.startPoint.x += 0.5;
      section.startPoint.y += 0.5;
      return bad;
    });
  const original = blocks.recoverLeaderCaptionBlocks;
  const receipts: ReturnType<typeof original>["recoveryReceipts"] = [];
  const spy = vi
    .spyOn(blocks, "recoverLeaderCaptionBlocks")
    .mockImplementation((...args) => {
      const r = original(...args);
      if (args[0].group.id === "g2") receipts.push(...r.recoveryReceipts);
      return r;
    });
  try {
    const r = await fixture();
    expect(r.ok).toBe(true);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.sheets).toHaveLength(3);
    expect(
      separationSpy.mock.results.some(
        (result) => result.value?.nestedEdges.size,
      ),
    ).toBe(true);
    const { document } = parseHTML(required(r.value.sheets[0]).svg);
    const group = required(document.querySelector('[data-circuit-group="g2"]'));
    expect(group.querySelector("[data-circuit-fan-in]")).toBeNull();
    const owner = required(
      group.querySelector('[data-conductor-designation="FIXED4"]'),
    ).getAttribute("data-circuit-conductor");
    const placed = required(
      group.querySelector(`[data-wire-label="${owner}"]`),
    );
    const printed = required(placed.querySelector("text"));
    expect(placed.getAttribute("data-circuit-caption-fallback")).toBe(
      "unhostable",
    );
    expect(printed.textContent).toBe("FIXED4");
    expect(printed.getAttribute("font-size")).toBe("2.5");
    expect(
      Number(placed.querySelector("rect")?.getAttribute("width")),
    ).toBeCloseTo(printableTextWidth("FIXED4", 2.5) + 1.5, 3);
    const receipt = required(receipts.find((r) => r.index === 4));
    expect(receipt.fallback).toBe(true);
    expect(receipt.checkedLeaderFound).toBe(false);
    expect(receipt.attempts).toBeGreaterThan(1);
  } finally {
    spy.mockRestore();
    separationSpy.mockRestore();
  }
});
it("does not fall back for a partly covered owner with a real hostable owned run", async () => {
  const [line, i, l, state] = await nativeWitness(true),
    partial = {
      ...state,
      segments: [
        ...state.segments,
        { index: l.index, a: { x: 140, y: 100 }, b: { x: 165, y: 100 } },
      ],
    },
    hosted = { ...l, x: 145, y: 98.1 },
    hostState = {
      ...partial,
      labels: partial.labels.map((t) => (t === l ? hosted : t)),
    };
  expect(
    placement.circuitCaptionPlacement(line, i, hosted, hostState),
  ).toBeDefined();
  expect(unhostableCaptionFallback(l, partial.segments, true, false)).toBe(
    false,
  );
  expect(() => plannedCircuitCaption(line, i, l, partial)).toThrow(
    InlineLabelCollisionError,
  );
});
it("admits a checked leader on a short owned run before considering the fallback", async () => {
  const [, , l, state] = await nativeWitness(true),
    drop = new Set([0, 2]),
    open = {
      ...state,
      cs: state.cs.map((c) => ({ ...c, jumper: true })),
      labels: state.labels.filter((t) => !drop.has(t.index)),
      segments: state.segments.filter((s) => !drop.has(s.index)),
      graph: {
        ...state.graph,
        edges: state.graph.edges?.filter(
          (e) => !drop.has(Number(e.id.slice(1))),
        ),
      },
    },
    before = JSON.stringify(open.graph),
    r = blocks.recoverLeaderCaptionBlocks(open, open.labels),
    result = required(r.labels.find((t) => t.index === l.index)),
    plan = placement.circuitCaptionPlacement(result.text, 0, result, {
      ...open,
      labels: r.labels,
    });
  expect(plan).toBeDefined();
  const p = required(plan);
  expect(r.baseFallbacks.has(l.index)).toBe(false);
  expect(
    required(r.recoveryReceipts.find((t) => t.index === l.index))
      .checkedLeaderFound,
  ).toBe(true);
  expect(p.points).toBeDefined();
  const tip = required(required(p.points).at(-1)),
    on = (s: Segment) =>
      Math.abs(s.a.x - s.b.x) < 1e-7
        ? Math.abs(tip.x - s.a.x) < 1e-7 &&
          tip.y >= Math.min(s.a.y, s.b.y) &&
          tip.y <= Math.max(s.a.y, s.b.y)
        : Math.abs(tip.y - s.a.y) < 1e-7 &&
          tip.x >= Math.min(s.a.x, s.b.x) &&
          tip.x <= Math.max(s.a.x, s.b.x);
  expect(open.segments.filter((s) => s.index === l.index).some(on)).toBe(true);
  expect(open.segments.filter((s) => s.index !== l.index).some(on)).toBe(false);
  expect(JSON.stringify(open.graph)).toBe(before);
  expect(result.width).toBe(l.width);
  expect(result.height).toBe(l.height);
  const positions = leaderCaptionPositions(l.index, l, open),
    runs = required(uncoveredCaptionRuns(l.index, open.segments));
  expect(positions).toHaveLength(
    CAPTION_POSITIONS_PER_UNCOVERED_RUN * runs.runs.length,
  );
});

it("uses full coincidence only when the entire owned run is covered", async () => {
  const [line, i, label, state] = await nativeWitness();
  const owner = { ...label, x: 145, y: 98.1 };
  const a = { x: 140, y: 100 },
    b = { x: 165, y: 100 };
  const withCoverage = (endX: number) => ({
    ...state,
    labels: [owner],
    segments: [
      { index: label.index, a, b },
      { index: 0, a, b: { x: endX, y: 100 } },
    ],
  });
  expect(
    plannedCircuitCaption(line, i, owner, withCoverage(165)).fallback,
  ).toBe("fully-coincident");
  expect(() =>
    plannedCircuitCaption(line, i, owner, withCoverage(164.75)),
  ).toThrow(InlineLabelCollisionError);
  expect(
    placement.circuitCaptionPlacement(line, i, owner, withCoverage(142)),
  ).toBeDefined();
  expect(
    plannedCircuitCaption(line, i, owner, withCoverage(142)).fallback,
  ).toBeUndefined();
});
