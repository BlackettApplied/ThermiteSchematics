import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import {
  coincidentWireLabels,
  wireCaptionFindings,
  wireCaptionObservation,
} from "./coincident-wire-labels.mjs";
import { observation } from "./evaluate.mjs";

let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});

const route = (id, d) =>
  `<g data-circuit-conductor="${id}" data-net-id="same-net"><path d="${d}" stroke="black" stroke-width=".32" fill="none"/></g>`;
const group = (id, body) => `<g data-circuit-group="${id}">${body}</g>`;
const caption =
  '<g data-wire-label="A" data-circuit-caption-fallback="fully-coincident"><text x="15" y="20">FIXED2</text></g>';
function geometry(body) {
  return openSheet(
    page,
    `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">${body}</svg>`,
  );
}
async function measure(own, foreign, outside = "") {
  return coincidentWireLabels(
    await geometry(group("g1", caption + route("A", own) + foreign) + outside),
  );
}

it("flags a caption when reversed and stitched foreign runs cover its entire route", async () => {
  expect(
    await measure(
      "M 10 25 H 50 V 40",
      route("B", "M 35 25 H 10") + route("C", "M 35 25 H 50 V 40"),
    ),
  ).toEqual([
    expect.objectContaining({
      kind: "fully-coincident-wire-label",
      wire: "A",
      text: "FIXED2",
    }),
  ]);
});

it("counts sub-stroke tails, gaps and offsets as covered", async () => {
  for (const variant of [
    route("B", "M 10 25 H 50 V 39.99"),
    route("B", "M 10 25 H 30") + route("C", "M 30.01 25 H 50 V 40"),
    route("B", "M 10 25.1 H 49.9 V 40"),
  ]) {
    expect(await measure("M 10 25 H 50 V 40", variant)).toHaveLength(1);
  }
});

it("clears a route with a visible uncovered tail, gap, or offset", async () => {
  for (const variant of [
    route("B", "M 10 25 H 50 V 39.5"),
    route("B", "M 10 25 H 30") + route("C", "M 30.5 25 H 50 V 40"),
    route("B", "M 10 26.25 H 50 V 40"),
    route("A", "M 10 25 H 50 V 40"),
  ]) {
    expect(await measure("M 10 25 H 50 V 40", variant)).toEqual([]);
  }
});

it("reports every fallback marker, including duplicate owners and hidden or unknown markers", async () => {
  const partial = caption
    .replace("fully-coincident", "unhostable")
    .replace("FIXED2", "FIXED3");
  const hidden =
    '<g data-wire-label="C" data-circuit-caption-fallback="unknown" display="none"/>';
  const g = await geometry(
    group(
      "g1",
      caption +
        partial +
        hidden +
        route("A", "M 10 25 H 50") +
        route("B", "M 10 25 H 50"),
    ),
  );
  const findings = wireCaptionFindings(g, []);
  const fallback = findings.filter(
    (f) => f.kind === "circuit-caption-fallback",
  );
  expect(
    fallback.map(({ wire, circuitGroup, fallback, text }) => [
      wire,
      circuitGroup,
      fallback,
      text,
    ]),
  ).toEqual([
    ["A", "g1", "fully-coincident", "FIXED2"],
    ["A", "g1", "unhostable", "FIXED3"],
    ["C", "g1", "unknown", ""],
  ]);
  expect(new Set(fallback.map((f) => f.element)).size).toBe(3);
  expect(
    findings.filter((f) => f.kind === "fully-coincident-wire-label"),
  ).toHaveLength(1);
});

it("does not borrow coverage from other circuit groups", async () => {
  expect(
    await measure(
      "M 10 25 H 50",
      route("B", "M 30 25 V 40"),
      group("g2", route("C", "M 10 25 H 50")),
    ),
  ).toEqual([]);
});

it("keeps marker witnesses in the issued count alongside other label evidence", async () => {
  const hidden =
    '<g data-wire-label="C" data-circuit-caption-fallback="unhostable" display="none"/>';
  const g = await geometry(group("g1", hidden));
  const measurements = [{ visibleIdentityInView: false }];
  const row = wireCaptionObservation(
    g,
    {
      findings: [],
      extra: {
        status: "not-implemented",
        evidence: { findingCount: 0, findings: [], measurements },
      },
    },
    (...args) => observation({ id: "fallback" }, { number: 1 }, ...args),
  );
  expect(row.status).toBe("fail");
  expect(row.evidence).toEqual({
    findingCount: 1,
    findings: [
      expect.objectContaining({
        kind: "circuit-caption-fallback",
        wire: "C",
        fallback: "unhostable",
      }),
    ],
    measurements,
  });
});
