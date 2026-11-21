import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { emitSchematicSvg } from "../src/svg/emitter.js";
import { cardDistances } from "../src/packet/rooted-locality.js";
import { cardLocalityOracle } from "./helpers/card-locality-oracle.js";
import { launchBrowser } from "../../cli/test/helpers/pdf-raster.js";
it("matches DOM card borders and pinned glyph ink in both flows", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const p = await prepareSchematicDrawing(
        c.ir,
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow,
        },
        c.presentation,
        { packetContinuations: true },
      );
      if (!p.ok) throw Error(JSON.stringify(p.error));
      const svg = emitSchematicSvg(
        p.value.graph,
        p.value.layout,
        p.value.titleContext,
        undefined,
        true,
        0.25,
        c.ir,
      );
      if (!svg.ok) throw Error(JSON.stringify(svg.error));
      const actual = await cardLocalityOracle(page, svg.value);
      expect(actual.length).toBeGreaterThan(0);
      const expected = cardDistances(p.value, 1).sort((a, b) => a - b),
        observed = actual.map((c) => c.distance).sort((a, b) => a - b);
      expect(observed.length).toBe(expected.length);
      observed.forEach((d, i) => expect(d).toBeCloseTo(expected[i]!, 3));
      for (const card of actual)
        for (const ink of card.textInk) {
          expect(ink.left).toBeGreaterThan(card.border.left);
          expect(ink.right).toBeLessThan(card.border.right);
          expect(ink.top).toBeGreaterThan(card.border.top);
          expect(ink.bottom).toBeLessThan(card.border.bottom);
        }
    }
  } finally {
    await browser.close();
  }
}, 30000);

// Independent synthetic geometry: 0.75-unit frame, terminal at the origin.
// The near border is exactly `distance` away, rather than a reservation edge.
function fixture(distance: number, pages = 2, owner = "owner") {
  return {
    prepared: {
      graph: {
        nodes: [
          {
            id: owner,
            labels: [
              {
                id: "card",
                ownerId: "port",
                offView: {
                  terminal: { deviceUid: "physical", terminalKey: "A1" },
                },
              },
            ],
          },
        ],
        edges: [],
      },
      layout: {
        ports: [{ id: "port", x: 0, y: 0, width: 0, height: 0 }],
        labels: [
          { id: "card", x: distance + 0.375, y: -5, width: 10, height: 10 },
        ],
        edges: [],
      },
    },
    drafts: Array.from({ length: pages }, () => ({
      links: [],
      rootedContent: { figures: 1 },
      drawingBounds: { x: 0, y: 0, w: 100, h: 100 },
      rootedShapes: [{ x: 0, y: 0, w: 100, h: distance * 5 }],
    })),
    scale: 1,
    grid: { xs: [0, 100], ys: [0, 100] },
    jogs: new Map(),
    detours: new Map(),
    proximity: distance,
  } as unknown as import("../src/packet/rooted-build.js").RootedCandidate;
}
const paper = {
  size: "tabloid",
  orientation: "landscape",
  marginMm: 10,
  widthMm: 431.8,
  heightMm: 279.4,
} as const;
it("never buys equal-sheet individual locality loss with utilisation, even below the useful guard", async () => {
  const { compareCandidates } = await import("../src/packet/rooted-score.js");
  const { localityRegression } =
    await import("../src/packet/rooted-locality.js");
  const reference = fixture(4.90625),
    replacement = fixture(9.087358);
  expect(localityRegression(replacement, reference)).toBe(true);
  expect(
    compareCandidates(
      replacement,
      reference,
      new Map(),
      paper,
      new Map(),
      undefined,
      reference,
    ),
  ).toBeGreaterThan(0);
  expect(localityRegression(fixture(5.00625), reference)).toBe(false);
  expect(localityRegression(fixture(5.006251), reference)).toBe(true);
});
it("never lets locality defeat physical sheet savings; keys equal-sheet growth by owner and terminal", async () => {
  const { compareCandidates } = await import("../src/packet/rooted-score.js");
  const { localityRegression } =
    await import("../src/packet/rooted-locality.js");
  const reference = fixture(4.90625, 5),
    safe = fixture(6.938485),
    far = fixture(100);
  expect(localityRegression(safe, reference)).toBe(false);
  expect(localityRegression(fixture(15), reference)).toBe(false);
  expect(localityRegression(far, reference)).toBe(false);
  expect(
    localityRegression(fixture(4.90625, 5, "another owner"), reference),
  ).toBe(true);
  expect(
    compareCandidates(
      safe,
      reference,
      new Map(),
      paper,
      new Map(),
      undefined,
      reference,
    ),
  ).toBeLessThan(0);
  expect(
    compareCandidates(
      far,
      reference,
      new Map(),
      paper,
      new Map(),
      undefined,
      reference,
    ),
  ).toBeLessThan(0);
});
it("does not early-exit on locality loss, including when the candidate meets native pages", async () => {
  const { searchSettled } = await import("../src/packet/rooted-settled.js");
  const { localityRegression } =
    await import("../src/packet/rooted-locality.js");
  const reference = fixture(4.90625),
    current = fixture(9.087358);
  const run = {
    candidates: [current],
    native: [current],
    localityReference: reference,
  } as unknown as import("../src/packet/rooted-search.js").RootedSearch;
  expect(searchSettled(run, paper)).toBe(false);
  expect(localityRegression(current, reference)).toBe(true);
  run.candidates = [fixture(6.938485, 1)];
  expect(searchSettled(run, paper)).toBe(true);
  run.candidates = [fixture(100, 1)];
  expect(searchSettled(run, paper)).toBe(true);
});

it("memoizes immutable candidate distances and eligibility separately for each reference", async () => {
  const { localityRegression } =
    await import("../src/packet/rooted-locality.js");
  const candidate = fixture(9),
    near = fixture(4),
    matching = fixture(9);
  const geometry = candidate.prepared.layout.ports;
  let reads = 0;
  Object.defineProperty(candidate.prepared.layout, "ports", {
    get: () => {
      reads++;
      return geometry;
    },
  });
  for (let i = 0; i < 10; i++) {
    expect(localityRegression(candidate, near)).toBe(true);
    expect(localityRegression(candidate, matching)).toBe(false);
  }
  expect(reads).toBe(1);
});
