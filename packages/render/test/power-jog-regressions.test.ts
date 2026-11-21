import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { drawingDrafts } from "../src/packet/rooted.js";
import { sidePage } from "./helpers/side-candidate.js";
import { lengths } from "./helpers/route-quality.js";
import {
  rootedWinner,
  searchRootedCandidates,
} from "../src/packet/rooted-search.js";
import { candidateUtilisation } from "../src/packet/rooted-score.js";

it.each([
  ["motor-starter", "M1", ["W-PWR-003"], "standard"],
  ["motor-starter", "M1", ["W-PWR-003"], "compact"],
  ["machine-demo", "M2", ["W-PWR-007-M2", "W-PWR-009-M2"], "standard"],
  ["machine-demo", "M2", ["W-PWR-007-M2", "W-PWR-009-M2"], "compact"],
] as const)(
  "repairs %s power jogs without moving them onto another conductor",
  async (project, root, names, mode) => {
    const c = await compileProject("examples/" + project);
    if (!c.ok) throw Error("Compile failed");
    const result = await drawingDrafts(
      c.ir,
      {
        format: "schematic-view-request/0.1",
        family: "power",
        flow: "top-to-bottom",
        root: { by: "designation", value: root },
      },
      c.presentation,
      sidePage,
      mode,
    );
    if (!result.ok) throw Error(JSON.stringify(result));
    const p = result.value[0]!.rootedLegendSource!.prepared;
    for (const edge of p.graph.edges.filter((e) => e.kind === "conductor")) {
      const route = p.layout.edges.find((r) => r.id === edge.id)!;
      expect(
        lengths(route.points)
          .slice(1, -1)
          .map((n) => n * 0.25)
          .filter((n) => n > 0.05 && n < 3 - 1e-8),
        edge.id,
      ).toEqual([]);
    }
    for (const name of names) {
      const uid = c.ir.wires.find((w) => w.designation === name)!.uid;
      const edge = p.graph.edges.find((e) =>
        e.elementIds.some((id) => id.kind === "wire" && id.uid === uid),
      )!;
      const route = p.layout.edges.find((r) => r.id === edge.id)!;
      expect(
        Math.min(...lengths(route.points).slice(1, -1)) * 0.25,
      ).toBeGreaterThanOrEqual(3.125);
      expect(
        p.graph.edges.some((e) =>
          e.elementIds.some((id) => id.kind === "wire" && id.uid === uid),
        ),
      ).toBe(true);
    }
  },
  30000,
);

it.each([
  ["a3", 297, 420],
  ["tabloid", 279.4, 431.8],
] as const)(
  "preserves useful compact %s portrait recovery before trying a jog repair",
  async (size, widthMm, heightMm) => {
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error("Compile failed");
    const page = {
      size,
      orientation: "portrait" as const,
      widthMm,
      heightMm,
      marginMm: 10,
    };
    const run = await searchRootedCandidates(
      c.ir,
      {
        format: "schematic-view-request/0.1",
        family: "power",
        flow: "top-to-bottom",
        root: { by: "designation", value: "M1" },
      },
      c.presentation,
      page,
      true,
    );
    const winner = rootedWinner(run, page)!;
    expect(winner.drafts).toHaveLength(1);
    expect(candidateUtilisation(winner, page)).toBeGreaterThanOrEqual(0.4);
    expect([...winner.jogs.values()].every((n) => n === 0)).toBe(true);
  },
  30000,
);

it.each([
  ["tabloid", "landscape", 431.8, 279.4],
  ["tabloid", "portrait", 279.4, 431.8],
  ["a3", "landscape", 420, 297],
  ["a3", "portrait", 297, 420],
  ["letter", "landscape", 279.4, 215.9],
] as const)(
  "retains the source-jog repair on %s %s within the printed-page guard",
  async (size, orientation, widthMm, heightMm) => {
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error("Compile failed");
    const result = await drawingDrafts(
      c.ir,
      {
        format: "schematic-view-request/0.1",
        family: "power",
        flow: "top-to-bottom",
        root: { by: "designation", value: "M1" },
      },
      c.presentation,
      { size, orientation, widthMm, heightMm, marginMm: 10 },
    );
    if (!result.ok) throw Error(JSON.stringify(result));
    const p = result.value[0]!.rootedLegendSource!.prepared;
    const wire = c.ir.wires.find((w) => w.designation === "W-PWR-003")!;
    const edge = p.graph.edges.find((e) =>
      e.elementIds.some((id) => id.kind === "wire" && id.uid === wire.uid),
    )!;
    const sourceRoute = p.layout.edges.find((r) => r.id === edge.id)!;
    expect(
      Math.min(...lengths(sourceRoute.points).slice(1, -1)) * 0.25,
    ).toBeGreaterThanOrEqual(3.125);
    for (const edge of p.graph.edges.filter((e) => e.kind === "conductor")) {
      const route = p.layout.edges.find((r) => r.id === edge.id)!;
      expect(
        lengths(route.points)
          .slice(1, -1)
          .map((n) => n * 0.25)
          .filter((n) => n > 0.05 && n < 3 - 1e-8),
        edge.id,
      ).toEqual([]);
    }
  },
  30000,
);
