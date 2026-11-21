import { launchBrowser } from "../../packages/cli/test/helpers/pdf-raster.ts";
import { readFileSync } from "node:fs";
import { svgLocators, identities } from "./locators.mjs";
import { evaluateSheet } from "./evaluate.mjs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  drawingContextOptions,
  openSheet,
  evaluateSheetGeometry,
} from "./browser.mjs";
import { continuations, pdfGeometryTexts, legibility } from "./checks.mjs";
import {
  continuationMediaIssues,
  connectorRows,
} from "./continuation-labels.mjs";
import { loadPdfBytes, pdfText } from "./pdf.mjs";
const require = createRequire(import.meta.url),
  PDFDocument = require("pdfkit"),
  SVGtoPDF = require("svg-to-pdfkit");
const font = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
const browserIt = it;
let browser, context, page;
beforeAll(async () => {
  browser = await launchBrowser();
  context = await browser.newContext(drawingContextOptions);
  await context.route("**/*", (r) => r.abort());
  page = await context.newPage();
  await page.emulateMedia({ media: "print" });
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const body =
  '<text x="30" y="40" font-size="2.5">C001 / 02.D6</text><text x="30" y="43.5" font-size="2.5">PE-SRC</text>';
const embeddedFont = readFileSync(font).toString("base64");
const svg = (rows = body) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="250mm" viewBox="0 0 300 250" font-family="Test"><style>@font-face{font-family:Test;src:url(data:font/ttf;base64,' +
  embeddedFont +
  ')}</style><a href="#sheet-2"><path d="M20 40H28" stroke="black"/>' +
  rows +
  "</a></svg>";
const ir = {
  wires: [{ uid: "wire", designation: "W1", properties: { label: "PE-SRC" } }],
};
const c = { id: "C001", toSheet: 2, conductor: "PE-SRC", netId: "net" },
  sheet = { number: 1, continuations: [c] },
  packet = {
    sheets: [sheet, { number: 2, continuations: [{ ...c, toSheet: 1 }] }],
  };
const peer = {
  texts: [
    ...Array.from({ length: 6 }, (_, i) => ({
      text: String(i + 1),
      anchor: { x: 30 + 40 * i, y: 20 },
      bbox: { x: 30 + 40 * i, y: 20, w: 0, h: 0 },
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      text: "ABCD"[i],
      anchor: { x: 10, y: 40 + 40 * i },
      bbox: { x: 10, y: 40 + 40 * i, w: 0, h: 0 },
    })),
  ],
  connectors: [{ id: "C001", toSheet: 1, anchor: { x: 230, y: 160 } }],
};
async function measure(rows, medium = "svg") {
  if (medium === "svg") return openSheet(page, svg(rows));
  await page.setContent('<section id="sheet-1">' + svg(rows) + "</section>");
  await page.evaluate(() => document.fonts.ready);
  return evaluateSheetGeometry(page, {
    selector: "#sheet-1>svg",
    textOnly: true,
  });
}
async function pdf(rows) {
  const doc = new PDFDocument({
      size: [(300 * 72) / 25.4, (250 * 72) / 25.4],
      margin: 0,
    }),
    buffers = [];
  const ready = new Promise((resolve, reject) => {
    doc.on("data", (b) => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });
  doc.registerFont("Test", font);
  SVGtoPDF(doc, svg(rows), 0, 0, {
    width: (300 * 72) / 25.4,
    height: (250 * 72) / 25.4,
    fontCallback: () => "Test",
  });
  doc.end();
  const pdf = await loadPdfBytes(await ready);
  try {
    const p = await pdf.getPage(1);
    const texts = await pdfText(p, pdf.fontFamilies, pdf.fontCaps);
    pdf.assertNoExternalResources();
    return texts;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
const spans =
  '<text font-size="2.5"><tspan x="30" y="40">C001 / 02.D6</tspan><tspan x="30" dy="3.5">PE-SRC</tspan></text>';
const runs =
  '<text font-size="2.5" xml:space="preserve"><tspan x="30" y="40">C001</tspan><tspan> / 02.D6</tspan><tspan x="30" dy="3.5">PE-</tspan><tspan>SRC</tspan></text>';
browserIt.each([
  ["separate rows", body],
  ["positioned spans", spans],
  ["inline font runs", runs],
])("measures %s independently in SVG/HTML/PDF", async (name, rows) => {
  const a = await measure(rows),
    h = await measure(rows, "html");
  expect(connectorRows(a, c, 0).rows).toHaveLength(2);
  const actualRows = connectorRows(a, c, 0).rows;
  expect(
    Math.abs(actualRows[1].bbox.y - actualRows[0].bbox.y - 3.5),
  ).toBeLessThan(0.17);
  expect(continuations(sheet, packet, a, [a, peer], ir)).toEqual([]);
  expect(continuations(sheet, packet, h, [h, peer], ir)).toEqual([]);
  expect(a.texts.every((t) => Math.abs(t.fontSize - 2.5) < 1e-4)).toBe(true);
  expect(continuationMediaIssues(a.texts, h.texts, "html")).toEqual([]);
  const measured = pdfGeometryTexts(a.texts, await pdf(rows));
  expect(measured.length).toBeGreaterThanOrEqual(2);
  expect(legibility({ texts: measured })).toEqual([]);
  expect(continuationMediaIssues(a.texts, measured, "pdf")).toEqual([]);
});
browserIt.each(["svg", "html"])(
  "refuses wrong IDs/zones, missing rows and every small row in %s",
  async (medium) => {
    for (const rows of [
      body.replace("PE-SRC", "WRONG"),
      body.replace("02.D6", "02.A1"),
      body.replace("C001", "C099"),
      body.replace(/<text x="30" y="43.5".*?<\/text>/, ""),
      body.replace('y="43.5"', 'opacity="0" y="43.5"'),
    ]) {
      const g = await measure(rows, medium);
      expect(
        continuations(sheet, packet, g, [g, peer], ir).length,
      ).toBeGreaterThan(0);
    }
    for (const rows of [
      body.replace('y="43.5" font-size="2.5"', 'y="43.5" font-size="2.2"'),
      spans.replace('dy="3.5"', 'dy="3.5" font-size="2.2"'),
    ]) {
      const g = await measure(rows, medium);
      expect(
        legibility(g).some((f) => f.kind === "text-below-minimum-em"),
      ).toBe(true);
    }
  },
);
browserIt(
  "retains PDF actual small runs, refuses missing association and detects wrong PDF rows",
  async () => {
    const a = await measure(body);
    const small = pdfGeometryTexts(
      a.texts,
      await pdf(
        body.replace('y="43.5" font-size="2.5"', 'y="43.5" font-size="2.2"'),
      ),
    );
    expect(legibility({ texts: small }).some((f) => f.fontSizeMm < 2.3)).toBe(
      true,
    );
    await expect(
      pdf(body.replace(/<text x="30" y="43.5".*?<\/text>/, "")).then((p) =>
        pdfGeometryTexts(a.texts, p),
      ),
    ).rejects.toThrow(/missing or unassociated row/);
    for (const rows of [
      body.replace("PE-SRC", "WRONG"),
      body.replace("02.D6", "02.A1"),
      body.replace("C001", "C099"),
    ]) {
      const p = pdfGeometryTexts(a.texts, await pdf(rows));
      expect(continuationMediaIssues(a.texts, p, "pdf")).toHaveLength(1);
    }
  },
);
browserIt(
  "does not let an unowned matching row or hidden duplicate supply an ID",
  async () => {
    const rows = body.replace(/<text x="30" y="43.5".*?<\/text>/, ""),
      raw = svg(rows).replace(
        "</svg>",
        '<text x="30" y="43.5">PE-SRC</text></svg>',
      );
    const g = await openSheet(page, raw);
    expect(continuations(sheet, packet, g, [g, peer], ir)[0].missing).toContain(
      "conductor label on connector",
    );
  },
);

browserIt(
  "production sheet evaluation checks HTML and PDF rows with independent source identity",
  async () => {
    const g = await measure(body),
      h = await measure(body.replace("PE-SRC", "WRONG"), "html");
    const spec = { id: "synthetic", flow: "left-to-right" },
      s = {
        ...sheet,
        view: { format: "documentation-view/0.1", kind: "drawing" },
        references: [],
      },
      pk = { sheets: [s, packet.sheets[1]] },
      source = { ...ir, functions: [], devices: [], nets: [] };
    g.htmlTexts = h.texts;
    const rows = evaluateSheet(
      spec,
      s,
      pk,
      g,
      source,
      await pdf(body),
      [],
      [],
      [],
      [g, peer],
    );
    expect(
      rows
        .find((r) => r.dq === "DQ-08")
        .evidence.findings.some((f) => f.medium === "html"),
    ).toBe(true);
    g.htmlTexts = (await measure(body, "html")).texts;
    const good = evaluateSheet(
      spec,
      s,
      pk,
      g,
      source,
      await pdf(body),
      [],
      [],
      [],
      [g, peer],
    );
    expect(good.find((r) => r.dq === "DQ-08").evidence.findings).toEqual([]);
    const bad = evaluateSheet(
      spec,
      s,
      pk,
      g,
      source,
      await pdf(body.replace("02.D6", "02.A1")),
      [],
      [],
      [],
      [g, peer],
    );
    expect(
      bad
        .find((r) => r.dq === "DQ-08")
        .evidence.findings.some((f) => f.medium === "pdf"),
    ).toBe(true);
  },
);

browserIt(
  "retains the parent text defect locator for each small positioned row",
  async () => {
    const content = spans.replace('dy="3.5"', 'dy="3.5" font-size="2.2"'),
      g = await measure(content);
    const f = legibility(g).find((f) => f.kind === "text-below-minimum-em");
    expect(f.locatorElement).toMatch(/^text-/);
    const ids = identities(
      { id: "synthetic/DQ-02/sheet-001", dq: "DQ-02", sheet: 1, medium: "svg" },
      f,
      svgLocators(svg(content), ir, { kind: "drawing" }),
      { kind: "drawing" },
      ir,
    );
    expect(f.sourceLocator).toBe("class/text.unclassified");
    expect(ids[0].locator).toBe("typography/Test//text-below-minimum-em");
  },
);

browserIt(
  "refuses an unassociated extra PDF row inside the owned text envelope",
  async () => {
    const a = await measure(body),
      extra = body + '<text x="30" y="41.75" font-size="2.5">EXTRA</text>';
    expect(() => pdfGeometryTexts(a.texts, [])).toThrow(
      /missing or unassociated row/,
    );
    const p = await pdf(extra);
    let actual;
    try {
      actual = pdfGeometryTexts(a.texts, p);
    } catch (error) {
      expect(error.message).toMatch(/unassociated extra row/);
      return;
    }
    expect(continuationMediaIssues(a.texts, actual, "pdf")).toHaveLength(1);
  },
);
browserIt(
  "does not treat an ordinary sheet link as a continuation hit target",
  async () => {
    const g = await openSheet(
      page,
      svg(body).replace(
        "</svg>",
        '<a href="#sheet-2"><text x="60" y="60">INDEX</text></a></svg>',
      ),
    );
    expect(
      g.texts.find((t) => t.text === "INDEX").continuationLink,
    ).toBeUndefined();
  },
);

browserIt(
  "refuses complete-looking unowned text when no connector link exists",
  async () => {
    const g = await openSheet(
      page,
      svg(body)
        .replace('<a href="#sheet-2"><path d="M20 40H28" stroke="black"/>', "")
        .replace("</a>", ""),
    );
    expect(g.connectors).toEqual([]);
    expect(continuations(sheet, packet, g, [g, peer], ir)[0].missing).toContain(
      "conductor label on connector",
    );
  },
);
browserIt(
  "matches the same physical HTML connector despite different local DOM ordinals",
  async () => {
    const a = await measure(body);
    await page.setContent(
      '<section id="sheet-1">' +
        svg(body).replace(
          "<a href=",
          "<desc>Harmless wrapper metadata</desc><a href=",
        ) +
        "</section>",
    );
    await page.evaluate(() => document.fonts.ready);
    const h = await evaluateSheetGeometry(page, {
      selector: "#sheet-1>svg",
      textOnly: true,
    });
    expect(h.texts[0].continuationLink).not.toBe(a.texts[0].continuationLink);
    expect(continuationMediaIssues(a.texts, h.texts, "html")).toEqual([]);
  },
);
browserIt("reads physical rows even when their XML order differs", async () => {
  const content = body
    .match(/<text.*?<\/text>/g)
    .reverse()
    .join("");
  const a = await measure(content),
    h = await measure(content, "html");
  expect(continuations(sheet, packet, a, [a, peer], ir)).toEqual([]);
  expect(continuations(sheet, packet, h, [h, peer], ir)).toEqual([]);
  expect(
    continuationMediaIssues(
      a.texts,
      pdfGeometryTexts(a.texts, await pdf(content)),
      "pdf",
    ),
  ).toEqual([]);
});

const orderedRows = (texts) =>
  texts
    .map(
      (text, i) =>
        '<text x="30" y="' +
        (36.5 + 3.5 * i) +
        '" font-size="2.5">' +
        text +
        "</text>",
    )
    .join("");
browserIt.each([
  ["identity above", ["PE-SRC", "C001 / 02.D6"]],
  ["identity below", ["C001 / 02.D6", "PE-SRC"]],
  ["split above", ["PE-", "SRC", "C001 / 02.D6"]],
  ["split below", ["C001 / 02.D6", "PE-", "SRC"]],
  ["split either side", ["PE-", "C001 / 02.D6", "SRC"]],
  ["inline", ["C001 / 02.D6 / PE-SRC"]],
])(
  "reads the reference independent of row position in SVG/HTML/PDF: %s",
  async (name, texts) => {
    const rows = orderedRows(texts),
      a = await measure(rows),
      h = await measure(rows, "html");
    expect(a.connectors).toHaveLength(1);
    expect(continuations(sheet, packet, a, [a, peer], ir)).toEqual([]);
    expect(continuations(sheet, packet, h, [h, peer], ir)).toEqual([]);
    expect(continuationMediaIssues(a.texts, h.texts, "html")).toEqual([]);
    const actual = pdfGeometryTexts(a.texts, await pdf(rows));
    expect(continuationMediaIssues(a.texts, actual, "pdf")).toEqual([]);
  },
);
browserIt.each([
  ["missing reference", ["02.D6", "PE-SRC"]],
  ["duplicate reference", ["C001 / 02.D6", "PE-SRC", "C001 / 02.D6"]],
])("refuses %s in SVG/HTML", async (name, texts) => {
  for (const medium of ["svg", "html"]) {
    const g = await measure(orderedRows(texts), medium);
    expect(g.connectors).toHaveLength(0);
    expect(continuations(sheet, packet, g, [g, peer], ir)[0].missing).toContain(
      "printed connector reference",
    );
  }
});
browserIt(
  "scopes unsupported mixed content to its connector's DQ-08 measurement",
  async () => {
    const mixed =
        '<text x="30" y="40" font-size="2.5">C001 / 02.D6<tspan x="30" dy="3.5">PE-SRC</tspan></text>',
      spec = { id: "synthetic", flow: "left-to-right" },
      s = {
        ...sheet,
        view: { format: "documentation-view/0.1", kind: "drawing" },
        references: [],
      },
      pk = { sheets: [s, packet.sheets[1]] },
      source = { ...ir, functions: [], devices: [], nets: [] };
    const captured = await measure(mixed).then(
      (value) => ({ value }),
      (error) => ({ error: String(error) }),
    );
    expect(captured.error).toBeUndefined();
    const g = captured.value,
      h = await measure(mixed, "html");
    expect(g.texts.some((t) => t.continuationError)).toBe(true);
    expect(continuations(sheet, packet, g, [g, peer], ir)[0].kind).toBe(
      "continuation-measurement-refused",
    );
    expect(
      continuationMediaIssues((await measure(body)).texts, h.texts, "html")[0]
        .kind,
    ).toBe("continuation-measurement-refused");
    const actual = evaluateSheet(
      spec,
      s,
      pk,
      g,
      source,
      await pdf(mixed),
      [],
      [],
      [],
      [g, peer],
    );
    expect(
      actual
        .find((r) => r.dq === "DQ-08")
        .evidence.findings.some(
          (f) => f.kind === "continuation-measurement-refused",
        ),
    ).toBe(true);
    expect(actual.filter((r) => r.dq !== "DQ-08").length).toBeGreaterThan(10);
    expect(
      actual
        .filter((r) => r.dq !== "DQ-08")
        .every((r) => r.status !== "infrastructure-error"),
    ).toBe(true);
    const ordinary = {
      ...g,
      texts: g.texts.map((t) => ({
        ...t,
        continuationLink: undefined,
        continuationError: undefined,
      })),
    };
    const control = evaluateSheet(
      spec,
      s,
      pk,
      ordinary,
      source,
      await pdf(mixed),
      [],
      [],
      [],
      [ordinary, peer],
    );
    expect(actual.filter((r) => r.dq !== "DQ-08")).toEqual(
      control.filter((r) => r.dq !== "DQ-08"),
    );
    // A valid second connector on the same sheet is still independently measured.
    const raw = svg(mixed).replace(
      "</svg>",
      '<a href="#sheet-2"><path d="M20 80H28" stroke="black"/>' +
        body
          .replaceAll('y="40"', 'y="80"')
          .replaceAll('y="43.5"', 'y="83.5"')
          .replaceAll("C001", "C002") +
        "</a></svg>",
    );
    const two = await openSheet(page, raw);
    const peer2 = {
      ...peer,
      connectors: [...peer.connectors, { ...peer.connectors[0], id: "C002" }],
    };
    const s2 = { ...s, continuations: [c, { ...c, id: "C002" }] },
      pk2 = {
        sheets: [
          s2,
          {
            ...pk.sheets[1],
            continuations: [
              ...pk.sheets[1].continuations,
              { ...c, id: "C002", toSheet: 1 },
            ],
          },
        ],
      };
    const issues = continuations(s2, pk2, two, [two, peer2], ir);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("C001");
  },
);
browserIt("ignores unrelated PDF text by the connector stroke", async () => {
  const rows = orderedRows(["C001 / 02.D6", "PE-SRC"]).replace(
      'y="40"',
      'y="50"',
    ),
    g = await measure(rows),
    extra = rows + '<text x="21" y="43" font-size="2.5">X</text>';
  const actual = pdfGeometryTexts(g.texts, await pdf(extra));
  expect(continuationMediaIssues(g.texts, actual, "pdf")).toEqual([]);
});
browserIt(
  "an identity resembling another ID cannot hide the exact reference",
  async () => {
    const rows = body.replace("PE-SRC", "C12/3"),
      g = await measure(rows),
      wire = { ...c, conductor: "W1" },
      s = { ...sheet, continuations: [wire] },
      pk = {
        sheets: [s, { number: 2, continuations: [{ ...wire, toSheet: 1 }] }],
      },
      source = {
        wires: [
          { uid: "wire", designation: "W1", properties: { label: "C12/3" } },
        ],
      };
    expect(g.connectors.filter((p) => p.id === "C001")).toHaveLength(1);
    expect(continuations(s, pk, g, [g, peer], source)).toEqual([]);
    const wrong = await measure(rows.replace("C001", "C099"));
    expect(
      continuations(s, pk, wrong, [wrong, peer], source)[0].missing,
    ).toContain("printed connector reference");
  },
);
