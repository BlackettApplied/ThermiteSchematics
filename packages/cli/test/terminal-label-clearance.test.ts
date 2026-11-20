import { afterAll, beforeAll, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import {
  displaySheet,
  drawingContextOptions,
  evaluateSheetGeometry,
  launch,
  openSheet,
  sheetMeasurementSource,
} from "../../../evals/draw/browser.mjs";
import { terminalLabelFindings } from "../../../evals/draw/caption-mark-clearance.mjs";
import { embedPrintableFont } from "../src/printable-font.js";

let browser: Browser, page: Page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => browser?.close());

function drawing(x: number, sameOwner: boolean) {
  const winding = `<g data-circuit-mark="winding" stroke="black" stroke-width=".65" fill="none">
    <polyline points="10,12 ${x},15 10,18"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="30mm" viewBox="0 0 80 30">
    <g data-device-uid="device" data-circuit-functions="[]">
      ${sameOwner ? winding : ""}
      <g data-terminal-key="X2"><text x="21" y="16" font-family="sans-serif" font-size="2.5">X2 [+1]</text></g>
    </g>
    ${sameOwner ? "" : `<g data-device-uid="other">${winding}</g>`}
  </svg>`;
}

it.each([
  { x: 20, sameOwner: true, fails: true },
  { x: 18, sameOwner: true, fails: false },
  { x: 20, sameOwner: false, fails: false },
])(
  "measures the painted winding join beside a suffixed terminal ($x, $sameOwner)",
  async ({ x, sameOwner, fails }) => {
    const findings = terminalLabelFindings(
      await openSheet(page, drawing(x, sameOwner)),
    );
    expect(findings).toEqual(
      fails
        ? [
            expect.objectContaining({
              kind: "terminal-label-body-clearance",
              terminalKey: "X2",
              text: "X2 [+1]",
              minimumMm: 0.5,
            }),
          ]
        : [],
    );
  },
);

function transformerSecondary(points: string, labelX: number) {
  return embedPrintableFont(
    `<svg xmlns="http://www.w3.org/2000/svg" width="431.8mm" height="279.4mm" viewBox="0 0 431.8 279.4">
      <g data-circuit-functions="[]" transform="translate(90.063 51.928)">
        <g data-circuit-mark="winding" stroke="#17212b" stroke-width="0.4" fill="none">
          <polyline points="${points}"/>
        </g>
        <g data-terminal-key="X2">
          <text x="${labelX}" y="12.5" text-anchor="end" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="2.5" font-weight="400" fill="#17212b">X2 [+1]</text>
        </g>
      </g>
    </svg>`,
  );
}

// Secondary winding and suffixed terminal extracted from functional-symbols LTR sheet 1.
const roundOneWinding =
  "26,6 16,6 14.4,7 16,8 14.4,9 16,10 14.4,11 16,12 14.4,13 16,14 26,14";
const roundTwoWinding =
  "26.959,6 16.48,6 14.88,7 16.48,8 14.88,9 16.48,10 14.88,11 16.48,12 14.88,13 16.48,14 26.959,14";

it("catches the round-one T1 terminal label next to the secondary winding", async () => {
  const findings = terminalLabelFindings(
    await openSheet(page, transformerSecondary(roundOneWinding, 24.5)),
  );
  expect(findings).toEqual([
    expect.objectContaining({
      kind: "terminal-label-body-clearance",
      terminalKey: "X2",
      text: "X2 [+1]",
      minimumMm: 0.5,
    }),
  ]);
  expect(findings[0].gapMm).toBeLessThan(0.36);
});

const measureFixtureGap = sheetMeasurementSource((options, h) => {
  const c = { options, h };
  h.prepareGeometry(c);
  h.prepareTerminals(c);
  h.prepareText(c);
  h.preparePaint(c);
  // Calibrate against the same painted ink beyond the review cutoff, too.
  return h.terminalLabelClearances(c, 0.8)[0]?.gapMm;
});

async function roundTwoFindingsAtGap(targetGapMm: number, labelX: number) {
  // Start near the target in the embedded font and calibrate against the
  // measured ink to allow for native Chromium differences.
  await displaySheet(page, transformerSecondary(roundTwoWinding, labelX));
  const label = page.locator('[data-terminal-key="X2"] text');
  for (let attempt = 0; attempt < 8; attempt++) {
    const gapMm: number | undefined = await page.evaluate(
      (source) => (0, eval)(source)(),
      measureFixtureGap,
    );
    if (gapMm === undefined)
      throw new Error("Could not measure the X2 ink gap");
    // Keep each fixture at least 0.045 mm from the 0.50 mm cutoff.
    if (Math.abs(targetGapMm - gapMm) < 0.005) {
      return terminalLabelFindings(await evaluateSheetGeometry(page));
    }
    // The winding is slanted, so a horizontal move can change the gap by less.
    labelX += targetGapMm - gapMm;
    await label.evaluate((e, x) => e.setAttribute("x", String(x)), labelX);
  }
  throw new Error(`Could not position X2 at a ${targetGapMm} mm ink gap`);
}

it("catches an X2 label just inside the 0.50 mm clearance", async () => {
  const findings = await roundTwoFindingsAtGap(0.45, 25.189);
  expect(findings).toEqual([
    expect.objectContaining({
      kind: "terminal-label-body-clearance",
      terminalKey: "X2",
      minimumMm: 0.5,
    }),
  ]);
  expect(findings[0].gapMm).toBeCloseTo(0.45, 2);
}, 150_000);

it("accepts an X2 label just outside the 0.50 mm clearance", async () => {
  const findings = await roundTwoFindingsAtGap(0.55, 25.298);
  expect(findings).toEqual([]);
}, 150_000);
