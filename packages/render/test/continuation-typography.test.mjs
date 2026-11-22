import { afterAll, beforeAll, expect, it } from "vitest";
import { launchBrowser } from "../../cli/test/helpers/pdf-raster.ts";
import { embedPrintableFont } from "../../cli/src/printable-font.ts";
import {
  drawingContextOptions,
  openSheet,
} from "../../../evals/draw/browser.mjs";
import { continuationTypography } from "../../../evals/draw/continuation-typography.mjs";

let browser, page;
beforeAll(async () => {
  browser = await launchBrowser();
  const context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await browser?.close();
});
const identity = "PLC1-DO0-STOP Åe\u0301 Ω∑";
const ir = {
  wires: [
    { uid: "w", designation: "W1", properties: { label: identity } },
    { uid: "foreign", designation: "W2" },
  ],
};
const c = {
  id: "C1000",
  toSheet: 100,
  conductor: identity,
  netId: "N",
  sourceElement: { kind: "wire", uid: "w" },
};
const sheet = { number: 1, continuations: [c] };
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="431.8mm" height="279.4mm" viewBox="0 0 431.8 279.4" font-family="Thermite Sans, Thermite Math, sans-serif"><a href="#sheet-100"><path d="M 30 40 L 32 40" stroke="black"/><text x="35" y="40" font-size="2.5">C1000 / 100.D6</text>${body}</a></svg>`;
const body =
  '<text x="35" y="43.5" font-size="2.5" xml:space="preserve">PLC1-DO0-<tspan font-family="Thermite Math, Thermite Sans, sans-serif">STOP Åe\u0301 Ω∑</tspan></text>';
async function visibleBodyLine() {
  return page.evaluate(() => {
    const t = document.querySelector("a text:last-of-type");
    const ys = Array.from(
      { length: t.getNumberOfChars() },
      (_, i) => t.getStartPositionOfChar(i).y,
    );
    return {
      text: t.textContent,
      baselineCount: new Set(ys.map((y) => Math.round(y * 100))).size,
    };
  });
}
it("accepts adjacent mixed-font fragments on one measured Unicode baseline", async () => {
  const g = await openSheet(page, embedPrintableFont(svg(body)));
  expect(continuationTypography(sheet, g, ir).findings).toEqual([]);
  expect(await visibleBodyLine()).toEqual({ text: identity, baselineCount: 1 });
});
it("kills a baseline break with identical identifier bytes", async () => {
  const split = body
    .replace(
      "<tspan font-family=",
      '</text><text x="35" y="47" font-size="2.5" xml:space="preserve" font-family=',
    )
    .replace("</tspan></text>", "</text>");
  const g = await openSheet(page, embedPrintableFont(svg(split)));
  expect(
    continuationTypography(sheet, g, ir).findings.some(
      (f) => f.kind === "continuation-identifier-split",
    ),
  ).toBe(true);
});
it("kills falsified native ownership even while the correct label stays visible", async () => {
  const g = await openSheet(page, embedPrintableFont(svg(body)));
  const forged = {
    ...sheet,
    continuations: [{ ...c, sourceElement: { kind: "wire", uid: "foreign" } }],
  };
  expect(
    continuationTypography(forged, g, ir).findings.some(
      (f) => f.kind === "continuation-typography-owner-or-identity",
    ),
  ).toBe(true);
});

it("independently kills a tspan line break with unchanged authored bytes", async () => {
  const split = body.replace(
    "<tspan font-family=",
    '<tspan x="35" y="47" font-family=',
  );
  await openSheet(page, embedPrintableFont(svg(split)));
  expect(await visibleBodyLine()).toEqual({ text: identity, baselineCount: 2 });
});
