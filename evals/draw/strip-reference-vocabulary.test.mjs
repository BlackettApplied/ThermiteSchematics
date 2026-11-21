import { afterAll, beforeAll, expect, it } from "vitest";
import { openSheet, launch, drawingContextOptions } from "./browser.mjs";
import { functionKeys } from "./checks.mjs";
import { stripInkScript } from "./terminal-strip-ink.mjs";

const stripDevice = { uid: "strip", designation: "TB1", typeId: "tb" };
const motor = { uid: "motor", designation: "M1", typeId: "motor" };
const ir = {
  devices: [stripDevice, motor],
  deviceTypes: [
    { id: "tb", terminals: [{ key: "4" }] },
    { id: "motor", terminals: [{ key: "4" }] },
  ],
  functions: [],
};
const text = (x, y, value) =>
  `<text x="${x}" y="${y}" font-size="2.6">${value}</text>`;
const svg = (number, contents) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="150mm"
    viewBox="0 0 200 150" data-sheet="${number}">${contents}</svg>`;

function stripSvg(number, drawn) {
  const digits = Array.from({ length: 6 }, (_, i) =>
    text(30 + i * 25, 12, i + 1),
  );
  const letters = [..."ABCD"].map((label, i) => text(10, 35 + i * 24, label));
  return svg(
    number,
    [...digits, ...letters].join("") +
      `
    <g data-sheet-kind="terminal-strip"><g data-terminal-strip="strip">
     ${text(30, 25, "TB1 — authored order")}
     <g data-strip-terminal="[&quot;strip&quot;,&quot;4&quot;]">${
       drawn
         ? '<rect x="50" y="56" width="12" height="8" stroke="black" fill="white"/>'
         : ""
     }
     ${text(53, 61, "4")}</g>
    </g></g>`,
  );
}

function referenceSvg(device, addresses, printedDevice) {
  const cells = [printedDevice, "Terminal strip", addresses].map((value, i) => {
    const x = 15 + i * 50;
    return `<rect x="${x}" y="34" width="50" height="10" fill="white" stroke="#9ba6b4"/>
      <g data-report-column="${i + 1}">${text(x + 1, 39, value)}</g>`;
  });
  return svg(
    1,
    `<g data-report-row="[&quot;${device.uid}&quot;,[],&quot;terminal-strip&quot;]">
    ${cells.join("")}</g>`,
  );
}

let browser, context, page;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});

async function assess({
  device = stripDevice,
  printedDevice = device.designation,
  addresses = "2 / B2",
  drawn = true,
  kind = "terminal-strip",
} = {}) {
  const sheet = { number: 1, view: { kind: "references" } };
  const g = await openSheet(
    page,
    referenceSvg(device, addresses, printedDevice),
  );
  const target = await openSheet(page, stripSvg(2, drawn));
  target.terminalStripInk = await page.evaluate(stripInkScript);
  const packet = {
    sheets: [
      sheet,
      {
        number: 2,
        view: { kind },
        references: [
          {
            deviceUid: device.uid,
            functions: [],
            representation: "terminal-strip",
          },
        ],
      },
    ],
  };
  return functionKeys(g, ir, { sheet, packet, geometries: [g, target] });
}

it("accepts a reference to the measured native strip body", async () => {
  expect(await assess()).toEqual([]);
});

it.each([
  ["missing body", { drawn: false }],
  ["wrong zone", { addresses: "2 / C2" }],
  ["mixed correct and incorrect zones", { addresses: "2 / B2; 2 / C2" }],
  ["non-strip device", { device: motor }],
  ["wrong printed device with a real strip owner key", { printedDevice: "M1" }],
  ["non-strip issued sheet", { kind: "terminals" }],
  ["stale sheet number", { addresses: "3 / B2" }],
])("rejects Terminal strip with %s", async (_, options) => {
  expect(await assess(options)).toMatchObject([
    { kind: "printed-function-key" },
  ]);
});
