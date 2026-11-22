import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import { fixture, binding } from "./m3-fixture.mjs";
import { m3Delivery } from "./m3-delivery.mjs";
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
function svg({ style = "", clip = "", cover = "", caption = false } = {}) {
  if (caption)
    return '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="200mm" viewBox="0 0 210 200"><g data-navigation-view="native-view" id="caption-ink"><text x="25" y="25" font-size="3.5">Port protocol, status and unconnected ports: network inventory 02.A3 (A: P).</text></g></svg>';
  const columns = [
      "Link",
      "Protocol / medium",
      "End A / location",
      "End B / location",
      "Status",
    ],
    values = ["--", "ethernet", "A: P", "Unconnected", "Unspecified"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="200mm" viewBox="0 0 210 200"><defs><clipPath id="blankcut"><rect x="25" y="40" width="128" height="10"/></clipPath><clipPath id="cut"><rect x="25" y="40" width="52" height="10"/></clipPath></defs>${Array.from({ length: 6 }, (_, i) => `<text font-size="3.5" x="${30 + i * 30}" y="12">${i + 1}</text>`).join("")}${Array.from("ABCD", (v, i) => `<text font-size="3.5" x="10" y="${42 + i * 40}">${v}</text>`).join("")}<text x="25" y="22" font-size="3.5">network inventory</text><g data-document-id="auto-document/1/native" data-document-origin="auto" font-size="3.5">${columns.map((c, i) => `<rect x="${25 + i * 26}" y="27" width="26" height="10" fill="white" stroke="#9ba6b4"/><g data-report-column="${i + 1}" data-column-name="${c}"><text x="${26 + i * 26}" y="32">${c}</text></g>`).join("")}<g id="row-ink" data-report-row='["a","P"]' style="${style}" ${clip}>${values.map((v, i) => `<rect x="${25 + i * 26}" y="40" width="26" height="10" fill="white" stroke="#9ba6b4"/><g data-report-column="${i + 1}" data-column-name="${columns[i]}"><text x="${26 + i * 26}" y="46">${v}</text></g>`).join("")}</g></g>${cover}</svg>`;
}
it("measures real SVG cell regions and visible native delivery without a renderer oracle", async () => {
  const f = fixture();
  const source = await openSheet(page, svg({ caption: true }));
  source.devices = [{ deviceUid: "a" }];
  const report = await openSheet(page, svg());
  const result = m3Delivery(
    f.packet.sheets[0],
    f.packet,
    source,
    [source, report],
    f.ir,
    f.request,
    { binding, tables: f.tables },
  );
  expect(result.findings).toEqual([]);
  expect(result.targetFindings).toEqual([]);
  expect(result.measurement.obligations[0].rows[0].anchor).toEqual({
    x: 90,
    y: 45,
  });
});
it.each([
  { style: "display:none" },
  { style: "opacity:0" },
  { style: "fill:white" },
  { clip: 'clip-path="url(#cut)"' },
  { cover: '<rect x="25" y="40" width="130" height="10" fill="white"/>' },
])(
  "rejects actual hidden, transparent, clipped or covered row ink %j",
  async (change) => {
    const f = fixture(),
      report = await openSheet(page, svg(change));
    const result = m3Delivery(
      f.packet.sheets[0],
      f.packet,
      f.source,
      [f.source, report],
      f.ir,
      f.request,
      { binding, tables: f.tables },
    );
    expect(result.findings.length).toBeGreaterThan(0);
  },
);

it("rejects a clipped blank row edge even when all native text remains painted", async () => {
  const f = fixture(),
    report = await openSheet(page, svg({ clip: 'clip-path="url(#blankcut)"' }));
  expect(report.texts.filter((t) => t.row).every((t) => t.reviewPainted)).toBe(
    true,
  );
  const result = m3Delivery(
    f.packet.sheets[0],
    f.packet,
    f.source,
    [f.source, report],
    f.ir,
    f.request,
    { binding, tables: f.tables },
  );
  expect(result.findings.length).toBeGreaterThan(0);
});
