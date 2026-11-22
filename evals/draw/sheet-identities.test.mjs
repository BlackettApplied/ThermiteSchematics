import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { svgLocators } from "./locators.mjs";
import { attachSheetIdentities } from "./sheet-identities.mjs";

it("keeps per-instance HTML/SVG locators equal across standalone font delivery", () => {
  const html =
      '<svg><g data-device-uid="d"><text>A1</text></g><text class="reference">C005 / 01</text></svg>',
    svg = html.replace(
      "<svg>",
      "<svg><style>@font-face{font-family:Thermite}</style>",
    ),
    ir = { devices: [{ uid: "d", designation: "K1" }] },
    view = { family: "control", root: { designation: "K1" } },
    indexes = {
      svg: svgLocators(svg, ir, view),
      html: svgLocators(html, ir, view),
    },
    rows = [svg, html].map((source, i) => ({
      id: `case/DQ-02/${i ? "html" : "sheet"}-1`,
      dq: "DQ-02",
      medium: i ? "html" : "svg",
      sheet: 1,
      evidence: {
        findings: [
          {
            kind: "text-below-minimum-em",
            font: "Thermite",
            role: "primary",
            instances: [
              ...parseHTML(source)
                .document.querySelector("svg")
                .querySelectorAll("*"),
            ].flatMap((e, n) =>
              e.tagName.toLowerCase() === "text"
                ? [{ element: `text-${n}`, text: e.textContent }]
                : [],
            ),
          },
        ],
      },
    }));
  attachSheetIdentities(rows, indexes, view, ir, "fixture");
  const locators = rows.map((r) =>
    r.evidence.findings[0].instances.map((t) => t.sourceLocator),
  );
  expect(locators[1]).toEqual(locators[0]);
  expect(locators[1]).toEqual(["device/K1/text.", "class/text.reference"]);
  expect(locators.flat()).not.toContain("unexported");
});

it("pins the runner's HTML-index argument on the delivered fixture", async () => {
  const { readFile } = await import("node:fs/promises");
  const assert = (await import("node:assert/strict")).default;
  const source = await readFile(
    new URL("./run-sheet.mjs", import.meta.url),
    "utf8",
  );
  // Execute the actual call-site block without importing the CLI or a browser.
  const start = source.indexOf("const locatorIndexes = {"),
    end = source.indexOf("assert.equal(", start);
  expect(start >= 0 && end > start).toBe(true);
  const run = new Function(
    "svgLocators",
    "assert",
    "s",
    "htmlSvgs",
    "ir",
    "tables",
    source.slice(start, end) + ";return locatorIndexes;",
  );
  const html = '<svg><text class="reference">C005 / 01</text></svg>';
  const svg = html.replace(
    "<svg>",
    "<svg><style>@font-face{font-family:Thermite}</style>",
  );
  const result = run(
    svgLocators,
    assert,
    { svg, number: 1, view: {} },
    [html],
    {},
    [],
  );
  expect(result.html.has("text-0")).toBe(true);
  expect(result.svg.has("text-1")).toBe(true);
});
