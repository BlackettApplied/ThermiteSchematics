import { afterAll, beforeAll, expect, it } from "vitest";
import { compileProject } from "../../../packages/compiler/dist/index.js";
import { renderSchematicPacket } from "../../../packages/render/dist/index.js";
import { conveyorRequest } from "../../../packages/render/test/packet-navigation-review-fixture.ts";
import { repeatRequest } from "../../../packages/render/test/wire-column-search-fixture.ts";
import { drawingContextOptions, launch } from "../browser.mjs";
import { nativeRows } from "../m3-native.mjs";
import { inOwnerReach } from "../peer-owner-ink.mjs";
import { peerOwnerMeasurements } from "./peer-owner-geometry.mjs";

// All packets issued at 5c2914a. Counts document that baseline, so an
// R006 on any of these cases is a regression even before measuring the SVG.
const papers = {
  "conveyor-line": [
    ["left-to-right", "letter", "portrait", "standard", 10, 20],
    ["left-to-right", "letter", "portrait", "compact", 10, 20],
    // Exterior legend placement (V5-CLEAR) adds 1 sheet on A4 portrait standard/compact vs 5c2914a (21/19).
    ["left-to-right", "a4", "portrait", "standard", 10, 22],
    ["left-to-right", "a4", "portrait", "compact", 10, 20],
    ["top-to-bottom", "letter", "portrait", "standard", 5, 22],
    ["top-to-bottom", "letter", "portrait", "compact", 5, 20],
    ["top-to-bottom", "a4", "landscape", "standard", 5, 24],
    ["top-to-bottom", "a4", "portrait", "compact", 5, 18],
  ],
  "machine-demo": [
    ["left-to-right", "letter", "portrait", "standard", 10, 37],
    // Left-continuation 1.5 mm zone-rule clearance (V5-CLEAR) adds 1 sheet on compact letter portrait (10 mm margins) vs 5c2914a (35).
    ["left-to-right", "letter", "portrait", "compact", 10, 36],
    ["left-to-right", "a4", "portrait", "standard", 10, 32],
    ["left-to-right", "a4", "portrait", "compact", 10, 32],
    ["top-to-bottom", "letter", "portrait", "standard", 5, 36],
    // Exterior legend placement (V5-CLEAR) uses 36/31 sheets on compact letter/A4 portrait vs 5c2914a (34/31).
    ["top-to-bottom", "letter", "portrait", "compact", 5, 36],
    ["top-to-bottom", "a4", "landscape", "standard", 5, 31],
    ["top-to-bottom", "a4", "portrait", "compact", 5, 31],
  ],
};

function fixtureRequest(project, flow, size, orientation, layout, marginMm) {
  const request =
    project === "conveyor-line" ? conveyorRequest() : repeatRequest(flow);
  const views = request.views.map((view) =>
    "flow" in view ? { ...view, flow } : view,
  );
  // With this paper and flow, the full baseline machine packet reaches
  // an inherited LS1 conductor-only tail. Keep its rooted views and reports.
  const rooted =
    project === "machine-demo" && size === "a4" && orientation === "landscape";
  return {
    ...request,
    views: rooted
      ? views.filter((view) => view.format !== "schematic-view-request/0.2")
      : views,
    layout,
    page: { size, orientation, marginMm },
  };
}

function assertDistances(measurements) {
  const beyondReach = [];
  const closerToAnother = [];
  for (const { sheet, notes } of measurements) {
    expect(
      notes.length,
      `S${sheet} should contain measured note ink`,
    ).toBeGreaterThan(0);
    for (const { text, named, owner, rival } of notes) {
      const limit = named ? 6.1 : 2.1;
      const note = { sheet, text, owner };
      if (!inOwnerReach(owner.distance, named))
        beyondReach.push({ ...note, limit });
      // Put the gap difference at the source-free reach boundary so the
      // checker applies the same Chromium allowance to ties.
      if (
        !named &&
        Number.isFinite(rival.distance) &&
        !inOwnerReach(limit + (owner.distance - rival.distance), false)
      )
        closerToAnother.push({ ...note, rival });
    }
  }
  expect(
    { beyondReach, closerToAnother },
    "peer note owner proximity (mm)",
  ).toEqual({
    beyondReach: [],
    closerToAnother: [],
  });
}

export function testPeerOwnerPacket(project) {
  let browser, page, input, native;
  beforeAll(async () => {
    input = await compileProject(`examples/${project}`);
    if (!input.ok) throw Error(JSON.stringify(input.diagnostics));
    native = {
      wires: nativeRows(input.ir).filter((row) => row.kind === "wires"),
      devices: input.ir.devices.map(({ uid, designation }) => [
        uid,
        designation,
      ]),
    };
    // Accurate Canvas bounds for small-font clearance checks (crbug.com/479240778).
    browser = await launch([
      "--enable-blink-features=CanvasTextMetricsPreciseBounds",
    ]);
    page = await browser.newPage(drawingContextOptions);
  }, 30_000);
  afterAll(async () => browser?.close());

  it.each(papers[project])(
    "measures all issued peer notes: %s %s %s %s, %i mm margins",
    async (flow, size, orientation, layout, marginMm, baseSheets) => {
      const request = fixtureRequest(
        project,
        flow,
        size,
        orientation,
        layout,
        marginMm,
      );
      const packet = await renderSchematicPacket(
        input.ir,
        request,
        input.presentation,
      );
      if (!packet.ok)
        throw Error(
          `Base issued ${baseSheets} sheets. Head refused: ${packet.error.message}`,
        );
      expect(packet.value.sheets.length, "issued sheet count at 5c2914a").toBe(
        baseSheets,
      );
      const measured = await peerOwnerMeasurements(page, packet.value, native);
      assertDistances(measured);
      const cardDestinations = packet.value.sheets.filter((sheet) =>
        /<text class="off-view-row"[^>]*>[^<]*\d{2,}\.[A-D][1-6]/u.test(
          sheet.svg,
        ),
      );
      expect(
        measured.length + cardDestinations.length,
        "packet should carry resolved peer destinations in cards or free notes",
      ).toBeGreaterThan(0);
    },
    // The machine packet renders and measures up to 37 sheets. Native CI
    // timed out at 45 s, and the conveyor packet took as long as 36 s.
    project === "machine-demo" ? 120_000 : 75_000,
  );
}
