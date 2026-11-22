import { beforeAll, afterAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { launchBrowser } from "../../packages/cli/test/helpers/pdf-raster.ts";
import { drawingContextOptions, openSheet } from "./browser.mjs";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { continuationTypography } from "./continuation-typography.mjs";
import { repeatNavigation } from "./repeat-navigation.mjs";
import { titleFields } from "./title-fields.mjs";
import { compactRevisionSource } from "./title-revision-source.mjs";
import {
  applyCompactFrameRequest,
  compactFrameCases,
} from "./corpus/compact-frames.mjs";
import { evaluateSheet } from "./evaluate.mjs";
let browser, context, page;
beforeAll(async () => {
  browser = await launchBrowser();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const svg = (body) =>
  embedPrintableFont(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200" font-family="Thermite Sans, Thermite Math, sans-serif">${body}</svg>`,
  );
const measure = (body) => openSheet(page, svg(body));
const identity = "PLC1-DO0-STOP";
const continuation = (text) =>
  `<a href="#sheet-2"><path d="M20 40 H28" stroke="black"/><text x="30" y="40" font-size="2.5">C001 / 02.D6</text>${text}</a>`;
function typography(g) {
  return continuationTypography(
    {
      number: 1,
      continuations: [
        {
          id: "C001",
          toSheet: 2,
          conductor: identity,
          sourceElement: { kind: "wire", uid: "w" },
        },
      ],
    },
    g,
    {
      wires: [{ uid: "w", designation: "W1", properties: { label: identity } }],
    },
  );
}
it("#240 actual positioned tspan glyph baselines reject a split identity; adjacent spans and intact rows pass", async () => {
  for (const body of [
    `<text x="30" y="43.5" font-size="2.5">${identity}</text>`,
    '<text font-size="2.5"><tspan x="30" y="43.5">PLC1-DO0-</tspan><tspan>STOP</tspan></text>',
  ])
    expect(typography(await measure(continuation(body))).findings).toEqual([]);
  const g = await measure(
    continuation(
      '<text x="30" y="43.5" font-size="2.5">PLC1-DO0-<tspan x="30" y="47">STOP</tspan></text>',
    ),
  );
  const runs = g.texts.find((t) => t.text === identity).continuationRuns;
  expect(runs).toHaveLength(2);
  expect(runs[0].anchor.y).toBeCloseTo(43.5);
  expect(runs[1].anchor.y).toBeCloseTo(47);
  expect(typography(g).findings.map((f) => f.kind)).toContain(
    "continuation-identifier-split",
  );
  // Every span is on one parent baseline attribute; actual glyph positions win.
  const forged = await measure(
    continuation(
      '<text x="30" y="43.5" font-size="2.5"><tspan>PLC1-DO0-</tspan><tspan dy="3.5">STOP</tspan></text>',
    ),
  );
  expect(typography(forged).findings.map((f) => f.kind)).toContain(
    "continuation-identifier-split",
  );
});
it("DQ-18 actual NAV-like 'not drawn' ink above the title rule cannot credit a field", async () => {
  const frame =
    '<rect x="10" y="10" width="180" height="180" fill="none" stroke="black"/><path d="M10 25 H190" stroke="black"/><path d="M10 170 H190" stroke="black"/>';
  const labels =
    '<text x="15" y="180" font-size="2.5">Drawing number: 1 Checked: B Approved: C Customer: D REV A</text><text x="15" y="185" font-size="2.5">Revision history</text>';
  const g = await measure(
    frame + labels + '<text x="15" y="160" font-size="2.5">not drawn</text>',
  );
  expect(g.titleBlock.y).toBeCloseTo(170);
  expect(titleFields(g)[0].missing).toEqual(["drawn"]);
  expect(
    titleFields(
      await measure(
        frame +
          labels +
          '<text x="120" y="185" font-size="2.5">Drawn by: A</text>',
      ),
    ),
  ).toEqual([]);
});
const compactTitleFrame =
  '<rect x="10" y="10" width="180" height="180" fill="none" stroke="black"/><path d="M10 25 H190" stroke="black"/><path d="M10 170 H190" stroke="black"/>';
const compactCell = (y) =>
  `<rect x="124" y="${y}" width="66" height="5" fill="none" stroke="black"/>`;
const otherCompactCells = [170, 175, 185].map(compactCell).join("");
const compactTitleFurniture =
  '<text x="13" y="174" font-size="2.5">Drawing number: 1 Drawn by: A Checked: B Approved: C</text><text x="13" y="186" font-size="2.5">Customer: D Revision history REV DEMO A</text>';
const compactHeading = (label = "REV:", x = 126) =>
  `<text x="${x}" y="183.5" font-size="2.5">${label}</text>`;
const compactValue = (value = "DEMO A", x = 149, y = 183.5) =>
  `<text x="${x}" y="${y}" font-size="2.7">${value}</text>`;
const compactRevisionGeometry = (ink, cell = compactCell(180)) =>
  measure(
    compactTitleFrame + otherCompactCells + compactTitleFurniture + cell + ink,
  );
function authoredRevision(value = "DEMO A") {
  return compactRevisionSource(
    { format: "project-presentation/0.3", revision: value },
    {},
    { number: 1, view: {} },
    {},
  );
}
function expectRevisionFailure(geometry, revision, bbox) {
  expect(titleFields(geometry, revision)).toEqual([
    expect.objectContaining({
      missing: ["revision"],
      bbox,
      revision: { expected: revision.value },
    }),
  ]);
}
it("DQ-18 #459 accepts the authored pair in the measured cell", async () => {
  const g = await compactRevisionGeometry(compactHeading() + compactValue());
  expect(g.revisionCell).toBeDefined();
  expect(titleFields(g, authoredRevision())).toEqual([]);
});
it("DQ-18 #459 locates a missing cell in the title panel", async () => {
  const g = await compactRevisionGeometry(
    compactHeading() + compactValue(),
    "",
  );
  expect(g.revisionCell).toBeUndefined();
  expect(g.titleBlock).toBeDefined();
  expectRevisionFailure(g, authoredRevision(), g.titleBlock);
});
it.each([
  ["missing painted value", compactHeading()],
  ["incorrect value", compactHeading() + compactValue("DEMO B")],
  [
    "printed UNSPECIFIED against an authored revision",
    compactHeading() + compactValue("UNSPECIFIED"),
  ],
  [
    "A1 value in the fourth cell",
    compactHeading() + compactValue("DEMO A", 149, 188.5),
  ],
  [
    "A6 value before the label",
    compactHeading("REV:", 160) + compactValue("DEMO A", 126),
  ],
  [
    "A7 value off the baseline",
    compactHeading() + compactValue("DEMO A", 149, 183),
  ],
  ["A8 wrong label case", compactHeading("Rev:") + compactValue()],
  ["A9 missing label colon", compactHeading("REV") + compactValue()],
  [
    "A10 extra text in the cell",
    compactHeading() + compactValue() + compactValue("*", 180),
  ],
  ["A19 value with a suffix", compactHeading() + compactValue("DEMO A1")],
  [
    "A20 value overlapping the label",
    compactHeading() + compactValue("DEMO A", 127),
  ],
])("DQ-18 #459 rejects %s", async (_case, ink) => {
  const g = await compactRevisionGeometry(ink);
  expect(g.revisionCell).toBeDefined();
  expectRevisionFailure(g, authoredRevision(), g.revisionCell);
});
it("DQ-18 #459 rejects a painted UNSPECIFIED source value", async () => {
  const g = await compactRevisionGeometry(
    compactHeading() + compactValue("UNSPECIFIED"),
  );
  expect(g.revisionCell).toBeDefined();
  expectRevisionFailure(g, authoredRevision("UNSPECIFIED"), g.revisionCell);
});
it("DQ-18 #459 rejects an issued SVG with only the revision value removed", async () => {
  const spec = compactFrameCases(["left-to-right"]).find(
    (c) => c.id === "p03-machine-demo-tabloid-landscape-standard-left-to-right",
  );
  const project = new URL("../../examples/machine-demo/", import.meta.url);
  const compiled = await compileProject(fileURLToPath(project));
  expect(compiled.ok).toBe(true);
  const presentation = JSON.parse(
    await readFile(new URL("presentation.json", project), "utf8"),
  );
  presentation.format = "project-presentation/0.3";
  const request = JSON.parse(
    await readFile(new URL("packet.request.json", project), "utf8"),
  );
  applyCompactFrameRequest(spec, request);
  const rendered = await renderSchematicPacket(compiled.ir, request, {
    ...compiled.presentation,
    format: presentation.format,
    compactFrame: presentation,
  });
  expect(rendered.ok, JSON.stringify(rendered.ok ? null : rendered.error)).toBe(
    true,
  );
  const issued = rendered.value.sheets[0];
  const revision = compactRevisionSource(
    presentation,
    rendered.value,
    issued,
    request,
  );
  const before = await openSheet(page, embedPrintableFont(issued.svg));
  expect(before.revisionCell).toBeDefined();
  expect(titleFields(before, revision)).toEqual([]);
  const mutated = await page.evaluate((value) => {
    const svg = document.querySelector("body>svg");
    const matches = [...svg.children].filter(
      (element) => element.matches("text") && element.textContent === value,
    );
    if (matches.length !== 1) throw Error("Expected one issued revision value");
    matches[0].remove();
    return svg.outerHTML;
  }, revision.value);
  const after = await openSheet(page, mutated);
  expect(after.revisionCell).toEqual(before.revisionCell);
  expectRevisionFailure(after, revision, before.revisionCell);
});
const native = {
  devices: [{ uid: "d", designation: "D" }],
  functions: [
    {
      id: { deviceUid: "d", functionKey: "f" },
      kind: "coil",
      terminals: [
        { deviceUid: "d", terminalKey: "1" },
        { deviceUid: "d", terminalKey: "2" },
      ],
    },
  ],
};
const request = { views: [{ title: "One" }, { title: "Two" }] };
const packet = {
  sheets: [
    { number: 1, view: { title: "One" } },
    { number: 2, view: { title: "Two" } },
  ],
  navigation: {
    annotations: [
      { id: "a0", ownerOccurrence: "o0" },
      { id: "a1", ownerOccurrence: "o1" },
    ],
    occurrences: [0, 1].map((i) => ({
      id: "o" + i,
      source: { deviceUid: "d", functionKey: "f" },
      provenance: { view: { authoredOrder: i, key: `view/1/selected-${i}` } },
    })),
  },
};
const grid =
  [1, 2, 3, 4, 5, 6]
    .map((n) => `<text x="${n * 30}" y="20" font-size="2.5">${n}</text>`)
    .join("") +
  ["A", "B", "C", "D"]
    .map(
      (n, i) => `<text x="10" y="${40 + i * 40}" font-size="2.5">${n}</text>`,
    )
    .join("");
const repeatBody = (i, options = {}) =>
  grid +
  `<g data-navigation-view="view/1/selected-${i}"><g data-device-uid="d"><rect class="device-frame" x="20" y="30" width="30" height="25" fill="none" stroke="black"/><g class="symbol" data-symbol-id="coil"><rect x="30" y="36" width="10" height="8" fill="none" stroke="black"/><circle class="terminal-marker" data-terminal-key="1" cx="30" cy="40" r=".4"/><circle class="terminal-marker" data-terminal-key="2" cx="40" cy="40" r=".4"/></g></g></g><g ${options.stripped ? "" : `data-navigation-annotation="a${i}"`}><text x="${options.distant ? 130 : 30}" y="${options.distant ? 150 : 70}" font-size="2.5">${i ? `D: Repeat of ${options.zone ? "01.D6" : "01.A1"} (same function)` : "D: Also shown 02.A1"}</text></g>`;
it("M5 browser oracle survives stripped/forged exports and checks distant ink", async () => {
  const first = await measure(repeatBody(0));
  const check = async (options) =>
    repeatNavigation(
      packet,
      [first, await measure(repeatBody(1, options))],
      native,
      request,
    );
  expect((await check({})).findings).toEqual([]);
  for (const options of [{ stripped: true }, { zone: true }, { distant: true }])
    expect((await check(options)).findings.length).toBeGreaterThan(0);
  const hidden = await measure(
    repeatBody(1).replace(
      'data-navigation-annotation="a1"',
      'data-navigation-annotation="a1" opacity="0"',
    ),
  );
  expect(
    repeatNavigation(packet, [first, hidden], native, request).findings.map(
      (f) => f.kind,
    ),
  ).toContain("repeat-label-count");
});
it("M5 follows a bent visible conductor rather than its endpoint chord", async () => {
  const first = await measure(repeatBody(0)),
    body = repeatBody(1);
  const bent = await measure(
    body +
      '<path d="M20 68 V90 H100 V68" fill="none" stroke="black" stroke-width=".32"/>',
  );
  expect(
    repeatNavigation(packet, [first, bent], native, request).findings,
  ).toEqual([]);
  const near = await measure(
    body +
      '<path d="M20 69 H100" fill="none" stroke="black" stroke-width=".32"/>',
  );
  expect(
    repeatNavigation(packet, [first, near], native, request).findings.map(
      (f) => f.kind,
    ),
  ).toContain("repeat-ink-clearance");
});
it("M5 clearance includes filled non-text ink without a stroke", async () => {
  const first = await measure(repeatBody(0));
  const near = await measure(
    repeatBody(1) +
      '<rect x="30" y="71" width="50" height="1" fill="black" stroke="none"/>',
  );
  expect(
    repeatNavigation(packet, [first, near], native, request).findings.map(
      (f) => f.kind,
    ),
  ).toContain("repeat-ink-clearance");
});
it("M5 stripping symbol/function locators cannot erase the native repeated appearance", async () => {
  const first = await measure(repeatBody(0));
  const stripped = await measure(
    repeatBody(1)
      .replace('data-symbol-id="coil"', "")
      .replace(
        'data-navigation-annotation="a1"',
        'data-navigation-annotation="a1" opacity="0"',
      ),
  );
  const result = repeatNavigation(packet, [first, stripped], native, request);
  expect(result.repeatCount).toBe(2);
  expect(result.findings.map((f) => f.kind)).toContain("repeat-label-count");
});

it("M5 production results belong to DQ-07 alongside independently measured mirror scope", async () => {
  const gs = [await measure(repeatBody(0)), await measure(repeatBody(1))];
  const pk = {
    ...packet,
    sheets: packet.sheets.map((s) => ({
      ...s,
      references: [],
      view: { ...s.view, format: "documentation-view/0.1", kind: "drawing" },
    })),
  };
  const ir = {
    ...native,
    terminals: [],
    deviceTypes: [],
    wires: [],
    jumpers: [],
    cables: [],
    cableConductors: [],
    nets: [],
    relations: [],
  };
  const rows = evaluateSheet(
    { id: "native-repeat", flow: "left-to-right" },
    pk.sheets[0],
    pk,
    gs[0],
    ir,
    [],
    [],
    [],
    [],
    gs,
    request,
  );
  expect(
    rows.find((r) => r.id === "native-repeat/DQ-07/repeats-1"),
  ).toMatchObject({ dq: "DQ-07", status: "pass" });
  expect(
    rows
      .filter((r) => r.dq === "DQ-07")
      .some((r) => r.status === "not-implemented"),
  ).toBe(false);
});
it("DQ-18 title-panel geometry explicitly assumes one full-width title row", async () => {
  // Until a native title-panel boundary exists, the last full-width rule is the
  // panel top. Multi-row layouts with full-width internals are not supported.
  const frame =
    '<rect x="10" y="10" width="180" height="180" fill="none" stroke="black"/><path d="M10 25 H190" stroke="black"/><path d="M10 170 H190" stroke="black"/><path d="M10 180 H190" stroke="black"/>';
  const g = await measure(
    frame +
      '<text x="15" y="177" font-size="2.5">Drawn by: A</text><text x="15" y="187" font-size="2.5">Revision history</text>',
  );
  expect(g.titleBlock.y).toBeCloseTo(180);
  expect(titleFields(g)[0].missing).toContain("drawn");
});
