import { afterAll, beforeAll, expect, it } from "vitest";
import { drawingContextOptions, launch, openSheet } from "./browser.mjs";
import { captionMarkFindings } from "./caption-mark-clearance.mjs";
import { faceStubFindings } from "./symbol-face-isolation.mjs";

let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => browser?.close());

const drawing = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">${body}</svg>`;
const ir = {
  devices: [{ uid: "device", designation: "LS1" }],
  nets: ["+", "-", "S"].map((terminalKey, i) => ({
    id: `native-${i}`,
    terminalIds: [{ deviceUid: "device", terminalKey }],
  })),
};

function face({
  gap = 0,
  vertical = false,
  rooted = false,
  split = false,
} = {}) {
  const pins = [12, 18, 24]
    .map((y, i) =>
      rooted
        ? `<circle class="terminal-marker" cx="5" cy="${y}" r="0.6" data-terminal-key="${["+", "-", "S"][i]}" data-net-id="same-painted-net"/>`
        : `<g data-terminal-id="p${i}" data-terminal-key="${["+", "-", "S"][i]}"><circle cx="5" cy="${y}" r=".6"/></g>`,
    )
    .join("");
  const face = split
    ? '<line x1="20" x2="20" y1="10" y2="16"/><line x1="20" x2="20" y1="20" y2="26"/>'
    : '<rect x="20" y="10" width="8" height="16"/>';
  const strokes = `${face}${[12, 18, 24].map((y) => `<line x1="5" x2="${20 - gap}" y1="${y}" y2="${y}"/>`).join("")}`;
  return drawing(
    `<g data-device-uid="device" transform="${vertical ? "translate(40 0) rotate(90)" : "translate(0 0)"}" stroke="black" stroke-width="0.35" fill="none">${
      rooted
        ? `<g data-symbol-id="ais:dc-load">${strokes}${pins}</g>`
        : `<g data-function-id="load" data-function-key="load"><g data-function-interface="level-sensor">${strokes}</g></g>${pins}`
    }</g>`,
  );
}

it.each([
  { vertical: false, rooted: false },
  { vertical: true, rooted: true },
])(
  "DQ-03 measures a shared face stroke against native nets ($rooted, $vertical)",
  async (options) => {
    const touching = await openSheet(page, face(options));
    expect(faceStubFindings(touching, ir)).toEqual([
      expect.objectContaining({
        kind: "symbol-face-joins-independent-stubs",
        designation: "LS1",
        side: options.vertical ? "north" : "west",
        netIds: ["native-0", "native-1", "native-2"],
      }),
    ]);
    expect(
      faceStubFindings(touching, {
        ...ir,
        nets: [
          { id: "same", terminalIds: ir.nets.flatMap((n) => n.terminalIds) },
        ],
      }),
    ).toEqual([]);
    expect(
      faceStubFindings(await openSheet(page, face({ ...options, gap: 1 })), ir),
    ).toEqual([]);
    expect(
      faceStubFindings(
        await openSheet(page, face({ ...options, split: true })),
        ir,
      ),
    ).toEqual([]);
  },
);

function cable(startY, endY) {
  return drawing(`<g data-cable-uid="cable" data-conductor-id="1" fill="none" stroke="black" stroke-width=".3">
    <path d="M 11 24 L 89 24"/>
    <text x="10" y="${startY}" font-size="2.7" text-anchor="start" fill="black" stroke="none">X UNTERMINATED</text>
    <text x="90" y="${endY}" font-size="2.7" text-anchor="end" fill="black" stroke="none">? UNASSIGNED</text>
    <path d="M 10 23 L 12 25"/><path d="M 10 25 L 12 23"/>
    <path d="M 88 23 L 90 25"/><path d="M 88 25 L 90 23"/>
  </g>`);
}

it("DQ-02 requires open-end caption clearance from its own painted X", async () => {
  const closeY = 23;
  // The stroke box starts at 22.85 mm. Leave room for the 1 mm descent
  // reported by Chromium's default Linux font as well as the 0.34 mm gap.
  const clearY = 21.25;
  for (const [startY, endY, text, side] of [
    [closeY, clearY, "X UNTERMINATED", "start"],
    [clearY, closeY, "? UNASSIGNED", "end"],
  ]) {
    const geometry = await openSheet(page, cable(startY, endY));
    const findings = captionMarkFindings(geometry);
    expect(findings).toEqual([
      expect.objectContaining({
        kind: "caption-mark-clearance",
        text,
        cableUid: "cable",
        conductorId: "1",
        side,
        minimumMm: 0.34,
      }),
    ]);
    expect(findings[0].gapMm).toBeLessThan(0.05);
  }
  expect(
    captionMarkFindings(await openSheet(page, cable(clearY, clearY))),
  ).toEqual([]);
});
