import { afterAll, beforeAll, expect, it } from "vitest";
import { drawingContextOptions, launch, openSheet } from "./browser.mjs";
import { internalVocabulary } from "./checks.mjs";

let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => browser?.close());

const uid = "fb000000-0000-4000-8000-000000000001";
const ir = { devices: [], relations: [{ uid }], functions: [] };
const request = {
  views: [
    {
      format: "circuit-view-request/0.1",
      title: "Power and control",
      groups: [
        { id: "psu-feed", label: "Power supply input" },
        { id: "coil", lineReference: "200" },
        { id: "dc-power" },
      ],
    },
  ],
};
const drawing = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="140mm" height="65mm" viewBox="0 0 140 65">${body}</svg>`;
const line = (y, text) => `<text x="5" y="${y}" font-size="2.7">${text}</text>`;
const cell = (content) =>
  `<g data-report-row="${uid}"><rect x="2" y="4" width="130" height="18" fill="white" stroke="#9ba6b4"/><g data-report-column="1">${content}</g></g>`;

it("DQ-05 measures a painted report UUID whole and across wrapped runs", async () => {
  for (const lines of [[uid], [uid.slice(0, 19), uid.slice(19)]]) {
    const g = await openSheet(
      page,
      drawing(cell(lines.map((t, i) => line(10 + 4 * i, t)).join(""))),
    );
    expect(internalVocabulary(g, ir)).toEqual([
      expect.objectContaining({ mechanism: "raw-uuid", key: uid }),
    ]);
  }
  const g = await openSheet(
    page,
    drawing(cell(`${line(10, "PLC1: ETH ↔ HMI1: ETH")}<title>${uid}</title>`)),
  );
  expect(internalVocabulary(g, ir)).toEqual([]);
});

it("DQ-05 joins wrapped circuit captions and individual device tag fields", async () => {
  const first = uid.slice(0, 19),
    second = uid.slice(19);
  const tag = (y, value, field = "description") =>
    line(y, value).replace("<text ", `<text data-tag-field="${field}" `);
  const g = await openSheet(
    page,
    drawing(
      `<g data-circuit-functions="[]" data-related-functions="[{}]">${line(10, `coil: ${first}`)}${line(14, second)}</g>` +
        `<g data-tag-owner-uid="${uid}">${tag(23, first)}${tag(27, second)}</g>` +
        `<g data-tag-owner-uid="${uid}">${tag(36, first)}${tag(40, second, "part")}</g>` +
        line(50, first) +
        line(54, second),
    ),
  );
  expect(internalVocabulary(g, ir)).toEqual([
    expect.objectContaining({ mechanism: "raw-uuid", key: uid }),
    expect.objectContaining({ mechanism: "raw-uuid", key: uid }),
  ]);
});

it("DQ-05 checks printed group headings and relation destinations against the request", async () => {
  const circuit = (caption, heading) =>
    drawing(
      `<text x="5" y="8" data-circuit-source-heading="dc-power">${heading}</text><g data-circuit-group="dc-power"><g data-circuit-functions="[]" data-related-functions="[{&quot;destinations&quot;:[&quot;200&quot;]}]">${caption.map((t, i) => line(20 + 4 * i, t)).join("")}</g></g>`,
    );
  const bad = await openSheet(
    page,
    circuit(["L–N: psu-", "feed", "coil: coil"], "dc-power"),
  );
  expect(internalVocabulary(bad, ir, { request }).map((f) => f.key)).toEqual([
    "dc-power",
    "psu-feed",
    "coil",
  ]);
  const good = await openSheet(
    page,
    circuit(
      ["L–N: Power supply", "input, Power and control", "coil: 200"],
      "Part 1/2",
    ),
  );
  expect(internalVocabulary(good, ir, { request })).toEqual([]);
});
