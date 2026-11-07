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
