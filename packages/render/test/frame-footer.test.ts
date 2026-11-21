import { expect, it } from "vitest";
import type { CompiledProjectPresentation } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { stackSections } from "../src/packet/fold-stack.js";
import { useCompactFrame } from "../src/packet/frame-profile.js";
import { frame, normalizePaperPage } from "../src/packet/page.js";
import type { Draft } from "../src/packet/types.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import {
  control,
  foldedControlFixture,
  parseSvg,
} from "./off-view-fixtures.js";

const foldNote = "Folded circuit sections; follow paired conductor references.";
const stamp = "Thermite 0.3.0-alpha.2";

function footerInk(svg: string, value: string) {
  const doc = parseSvg(svg).documentElement;
  const border = [...doc.children].find(
    (element) =>
      element.localName === "rect" &&
      element.getAttribute("stroke-width") === "0.4",
  );
  const label = [...doc.children].find(
    (element) => element.localName === "text" && element.textContent === value,
  );
  if (!border || !label) throw Error(`Missing frame or footer text: ${value}`);
  const left = Number(border.getAttribute("x"));
  const right = left + Number(border.getAttribute("width"));
  const bottom =
    Number(border.getAttribute("y")) + Number(border.getAttribute("height"));
  const ink = textInk(label);
  expect(ink.left).toBeGreaterThan(left);
  expect(ink.right).toBeLessThan(right);
  expect(ink.bottom, value).toBeLessThan(bottom);
  return { ...ink, frameBottom: bottom };
}

function textInk(element: Element) {
  const value = element.textContent ?? "";
  const x = Number(element.getAttribute("x"));
  const y = Number(element.getAttribute("y"));
  const size = Number(element.getAttribute("font-size"));
  const ink = printableTextMetrics(
    value,
    size,
    element.getAttribute("font-weight") === "700",
  );
  const start =
    element.getAttribute("text-anchor") === "end" ? x - ink.advance : x;
  expect(size).toBeGreaterThanOrEqual(2.5);
  return {
    left: start + ink.left,
    right: start + ink.right,
    top: y - ink.top,
    bottom: y - ink.bottom,
  };
}

function assertCompactFooter(svg: string, note: string) {
  const fold = footerInk(svg, note);
  const history = footerInk(svg, "Revision history: UNSPECIFIED");
  const generator = footerInk(svg, stamp);
  const gaps = [
    fold.top - (fold.frameBottom - 6 + 0.125),
    Math.min(history.top, generator.top) - fold.bottom,
    fold.frameBottom - 0.2 - Math.max(history.bottom, generator.bottom),
  ];
  expect(Math.min(...gaps)).toBeGreaterThan(0);
  // Baselines and strokes are serialized to a thousandth of a millimetre.
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.002);
  expect(history.right).toBeLessThan(generator.left);
  for (const cell of parseSvg(svg).querySelectorAll(
    'rect[stroke-width="0.25"]',
  )) {
    const edge =
      Number(cell.getAttribute("y")) + Number(cell.getAttribute("height"));
    expect(edge).toBeLessThanOrEqual(fold.frameBottom - 6 + 0.001);
  }
}

const presentation: CompiledProjectPresentation = {
  format: "project-presentation/0.3",
  revision: "UNSPECIFIED",
  backgroundColor: "#ffffff",
  titleBlockLines: [],
};

it.each(["standard", "compact"] as const)(
  "prints the folded Tabloid landscape 10 mm footer inside the compact frame (%s layout)",
  async (layout) => {
    const fixture = await foldedControlFixture();
    try {
      const result = await renderSchematicPacket(
        fixture.ir,
        {
          format: "schematic-packet-request/0.1",
          page: { size: "tabloid", orientation: "landscape", marginMm: 10 },
          layout,
          views: [control()],
        },
        presentation,
      );
      if (!result.ok) throw Error(result.error.message);
      expect(result.value.sheets.length).toBeGreaterThan(1);
      for (const sheet of result.value.sheets)
        assertCompactFooter(sheet.svg, foldNote);
    } finally {
      await fixture.dispose();
    }
  },
);

const sizes = ["letter", "tabloid", "a4", "a3"] as const;
const orientations = ["landscape", "portrait"] as const;
const papers = sizes.flatMap((size) =>
  orientations.flatMap((orientation) =>
    [5, 10, 25].map((marginMm) => ({ size, orientation, marginMm })),
  ),
);

it.each(papers)(
  "keeps folded footer ink in the frame on $size $orientation, margin $marginMm mm",
  (paper) => {
    const page = normalizePaperPage(paper);
    if (!page.ok) throw Error(page.error.message);
    const unfolded = sampleDraft("");
    const draft = stackSections([unfolded, unfolded], [10, 10], [[0, 1]], {
      x: 40,
      y: 40,
      w: 100,
      h: 50,
    })[0]!;
    const legacy = frame(draft, page.value, 1, 1);
    expect(legacy).toContain("Folded circuit sections;");
    footerInk(legacy, stamp);
    useCompactFrame(page.value);
    assertCompactFooter(frame(draft, page.value, 1, 1), foldNote);
  },
);

function sampleDraft(note: string): Draft {
  return {
    title: {
      ...presentation,
      projectName: "Fold test",
      toolVersion: "test",
      lines: [],
    },
    view: {
      format: "documentation-view/0.1",
      kind: "bom",
      title: "Fold test",
    },
    content: "",
    links: [],
    note,
  };
}

it.each([
  "Circuit parts · [+N]: outside part · P/S: repeated physical terminal · full wires retained · Device and function references S100",
  "123 of 456 authored links in this part; boundary devices included; see communication schedule for status and unconnected ports.",
])(
  "fits the full long sheet note on A4 portrait with 25 mm margins: %s",
  (note) => {
    const paper = normalizePaperPage({
      size: "a4",
      orientation: "portrait",
      marginMm: 25,
    });
    if (!paper.ok) throw Error(paper.error.message);
    useCompactFrame(paper.value);
    assertCompactFooter(frame(sampleDraft(note), paper.value, 100, 100), note);
  },
);

it("keeps the right title labels and values inside the shortened cells", () => {
  const paper = normalizePaperPage({
    size: "a4",
    orientation: "portrait",
    marginMm: 25,
  });
  if (!paper.ok) throw Error(paper.error.message);
  useCompactFrame(paper.value);
  const draft = sampleDraft(foldNote);
  const values = [
    ["drawingNumber", "DWG NO", "TEST-100"],
    ["customer", "Customer", "gyp"],
    ["revision", "REV", "gyp"],
    ["sheetNumber", "Sheet", "100 of 100"],
  ] as const;
  draft.resolvedTitle = {
    sheetKey: "fixture",
    fields: values.map(([slot, label, text]) => ({
      key: slot,
      slot,
      label,
      text,
      fact: {
        value: text,
        known: true,
        source: "request-defaults",
        pointer: null,
      },
    })),
    revisionRows: { value: null, known: false, source: null, pointer: null },
    history: [],
  };
  const doc = parseSvg(frame(draft, paper.value, 100, 100)).documentElement;
  const cells = [...doc.children].filter(
    (node) =>
      node.localName === "rect" &&
      node.getAttribute("stroke-width") === "0.25" &&
      node.getAttribute("width") === "66",
  );
  expect(cells).toHaveLength(4);
  for (const [index, cell] of cells.entries()) {
    const label = cell.nextElementSibling;
    const value = label?.nextElementSibling;
    expect(label?.textContent).toBe(values[index]![1] + ":");
    expect(value?.textContent).toBe(values[index]![2]);
    const x = Number(cell.getAttribute("x"));
    const y = Number(cell.getAttribute("y"));
    const bottom = y + Number(cell.getAttribute("height"));
    for (const element of [label!, value!]) {
      const ink = textInk(element);
      expect(ink.left).toBeGreaterThan(x + 0.125);
      expect(ink.right).toBeLessThan(x + 66 - 0.125);
      expect(ink.top).toBeGreaterThan(y + 0.125);
      expect(ink.bottom).toBeLessThan(bottom - 0.125);
    }
  }
});
