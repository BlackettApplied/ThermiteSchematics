import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import {
  searchRootedCandidates,
  rootedWinner,
  MAX_PLACEMENT_LAYOUTS,
} from "../src/packet/rooted-search.js";
import { compareCandidates } from "../src/packet/rooted-score.js";
import type { RootedCandidate } from "../src/packet/rooted-build.js";
import type { LayoutPoint } from "../src/types.js";

const page = {
  size: "tabloid" as const,
  orientation: "landscape" as const,
  widthMm: 431.8,
  heightMm: 279.4,
  marginMm: 10,
};
function interiorLengths(points: readonly LayoutPoint[], scale: number) {
  const turns: LayoutPoint[] = [];
  for (const p of points) {
    while (turns.length >= 2) {
      const a = turns.at(-2)!,
        b = turns.at(-1)!;
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))
        turns.pop();
      else break;
    }
    turns.push(p);
  }
  return turns
    .slice(2, -1)
    .map(
      (b, i) =>
        Math.hypot(b.x - turns[i + 1]!.x, b.y - turns[i + 1]!.y) * scale,
    );
}
it.each([
  ["motor-starter", "control", "K1", "W-CTL-008"],
  ["conveyor-line", "power", "M2", "W-PWR-009"],
  ["machine-demo", "power", "M2", "W-PWR-003-M2"],
] as const)(
  "avoids the new interior jog in %s %s %s (%s)",
  async (project, family, root, wire) => {
    const c = await compileProject("examples/" + project);
    if (!c.ok) throw Error("Compile failed");
    const request = {
      format: "schematic-view-request/0.1" as const,
      family,
      root: { by: "designation" as const, value: root },
      flow: "left-to-right" as const,
    };
    const run = await searchRootedCandidates(
      c.ir,
      request,
      c.presentation,
      page,
      true,
    );
    expect(run.attempts).toBeLessThanOrEqual(MAX_PLACEMENT_LAYOUTS);
    const winner = rootedWinner(run, page);
    if (!winner) throw Error(JSON.stringify(run.errors));
    const uid = c.ir.wires.find((w) => w.designation === wire)!.uid;
    const edge = winner.prepared.graph.edges.find((e) =>
      e.elementIds.some((id) => id.kind === "wire" && id.uid === uid),
    )!;
    expect(edge).toBeDefined();
    const route = winner.prepared.layout.edges.find((e) => e.id === edge.id)!;
    expect(
      interiorLengths(route.points, winner.scale).filter(
        (n) => n > 0.05 && n < 3,
      ),
    ).toEqual([]);
  },
  30000,
);
function candidate(
  pages: number,
  jogs: number,
  area: number,
  proximity: number,
): RootedCandidate {
  return {
    grid: { xs: [0, 100], ys: [0, 100] },
    drafts: Array.from({ length: pages }, () => ({
      rootedShapes: [{ x: 30, y: 40, w: area, h: 1 }],
    })) as RootedCandidate["drafts"],
    jogs: new Map([["wire", jogs]]),
    proximity,
    scale: 0.25,
    prepared: {} as RootedCandidate["prepared"],
  };
}
it("scores no new jog, then page count, soft locality, utilisation and stable ties", () => {
  const base = new Map([["wire", 0]]),
    better = candidate(2, 0, 100, 20);
  expect(
    compareCandidates(better, candidate(1, 1, 200, 1), base, page),
  ).toBeLessThan(0);
  expect(
    compareCandidates(better, candidate(3, 0, 200, 1), base, page),
  ).toBeLessThan(0);
  expect(
    compareCandidates(better, candidate(2, 0, 90, 20), base, page),
  ).toBeLessThan(0);
  expect(
    compareCandidates(better, candidate(2, 0, 200, 30), base, page),
  ).toBeLessThan(0);
  expect(compareCandidates(better, candidate(2, 0, 100, 20), base, page)).toBe(
    0,
  );
  expect(
    compareCandidates(
      candidate(1, 1, 100, 20),
      better,
      new Map([["wire", 1]]),
      page,
    ),
  ).toBeLessThan(0);
});
