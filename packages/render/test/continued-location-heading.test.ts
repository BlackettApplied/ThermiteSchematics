import { beforeAll, expect, it } from "vitest";
import {
  compileProject,
  type ElectricalIr,
  type CompiledProjectPresentation,
} from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { rootedDraft } from "../src/packet/rooted-draft.js";
import {
  omitUnpaintedLocationHeadings,
  rootedLocationContent,
} from "../src/packet/location-headings.js";
import { printableLabelGeometry } from "../src/symbols/printable-label.js";
import { svgSemanticId } from "../src/svg/escape.js";
import { parseSvg } from "./off-view-fixtures.js";
import type { LayoutLabel } from "../src/types.js";
import type { PreparedSchematicDrawing } from "../src/renderer.js";

const label: LayoutLabel = {
  id: "location-label",
  ownerKind: "location",
  ownerId: "location",
  role: "location",
  text: "MAIN-PANEL",
  x: 0,
  y: 0,
  width: 80,
  height: 14,
};
const replacement = { label, text: label.text, capacity: 74 };
const clip = svgSemanticId("clip", [label.id]);
const original = `<text class="label-text label-location" clip-path="url(#${clip})" x="3" y="9.68">MAIN-PANEL</text>`;
const unrelated =
  '<text class="label-text label-device" clip-path="url(#other)">MAIN-PANEL</text>';
const furniture =
  '<rect class="label-background label-location"/><text>CONTINUED LOCATION: MAIN-PANEL</text>';
const content = original + unrelated + furniture;
const ink = printableLabelGeometry(label, label.text, 74).ink;
const full = { x: -10, y: -10, w: 200, h: 200 };

it.each([
  { x: ink.right + 1, y: -10, w: 100, h: 100 },
  { x: ink.left - 101, y: -10, w: 100, h: 100 },
  { x: -10, y: ink.bottom + 1, w: 100, h: 100 },
  { x: -10, y: ink.top - 101, w: 100, h: 100 },
])("omits only the wholly hidden replacement heading at $x / $y", (view) => {
  expect(omitUnpaintedLocationHeadings(content, [replacement], [view])).toBe(
    unrelated + furniture,
  );
});

it.each([
  { x: ink.left + 1, y: -10, w: 100, h: 100 },
  { x: ink.right - 101, y: -10, w: 100, h: 100 },
  { x: -10, y: ink.top + 1, w: 100, h: 100 },
  { x: -10, y: ink.bottom - 101, w: 100, h: 100 },
  full,
])("keeps every partly or fully visible original at $x / $y", (view) => {
  expect(omitUnpaintedLocationHeadings(content, [replacement], [view])).toBe(
    content,
  );
});

it("keeps touching ink through SVG coordinate quantisation", () => {
  expect(
    omitUnpaintedLocationHeadings(
      content,
      [replacement],
      [
        {
          x: ink.right + 0.001,
          y: -10,
          w: 100,
          h: 100,
        },
      ],
    ),
  ).toBe(content);
});

it("requires a matching location replacement, independent of literal text", () => {
  const outside = { x: 500, y: 500, w: 100, h: 100 };
  expect(omitUnpaintedLocationHeadings(content, [], [outside])).toBe(content);
  expect(omitUnpaintedLocationHeadings(content, [replacement], [])).toBe(
    content,
  );
  expect(
    omitUnpaintedLocationHeadings(
      content,
      [
        {
          ...replacement,
          label: { ...label, role: "device", ownerKind: "device" },
        },
      ],
      [outside],
    ),
  ).toBe(content);
});

const sectionContent = content.replace('x="3" y="9.68"', 'x="63" y="49.68"');
function section(x: number, y: number, w: number, h: number, xs = [x, x + w]) {
  const heading = { ...label, x: 40, y: 20 };
  const p = {
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: "K1", designation: "K1" },
      flow: "left-to-right",
    },
    titleContext: {
      projectName: "Heading fixture",
      revision: "A",
      toolVersion: "test",
      lines: [],
    },
    graph: {
      nodes: [],
      edges: [],
      locationGroups: [
        { id: "location", label: { ...heading, textLength: 74 } },
      ],
    },
    layout: {
      nodes: [
        {
          id: "location",
          kind: "location",
          x: 0,
          y: 0,
          width: 400,
          height: 400,
        },
      ],
      labels: [heading],
      edges: [],
    },
  } as unknown as PreparedSchematicDrawing;
  const drafts = xs
    .slice(0, -1)
    .map((_, col) =>
      rootedDraft(
        p,
        { xs, ys: [y, y + h] },
        col,
        0,
        { x: 28, y: 47, w: 300, h: 300 },
        0.25,
        sectionContent,
      ),
    );
  const filtered = rootedLocationContent(sectionContent, p, drafts);
  const draft = drafts[xs.indexOf(x)]!;
  draft.content = draft.content.replace(sectionContent, filtered);
  return draft;
}

it("leaves an unfolded full view byte-for-byte unchanged", () => {
  const d = section(0, 0, 500, 500);
  expect(d.continuedCaption).toBe("");
  expect(
    d.content.slice(d.content.indexOf('overflow="hidden">') + 18, -6),
  ).toBe(sectionContent);
});

it("retains a partly painted heading alongside the continued caption", () => {
  const d = section(65, 0, 100, 200);
  expect(d.continuedCaption).toBe("CONTINUED LOCATION: MAIN-PANEL");
  expect(d.content).toContain(sectionContent);
});

it("keeps the shared original if another section paints any part of it", () => {
  const d = section(200, 0, 200, 200, [0, 200, 400]);
  expect(d.continuedCaption).toBe("CONTINUED LOCATION: MAIN-PANEL");
  expect(d.content).toContain(sectionContent);
});

it("omits an entirely unpainted heading consistently from every section", () => {
  for (const x of [200, 300]) {
    const d = section(x, 0, 100, 200, [200, 300, 400]);
    expect(d.continuedCaption).toBe("CONTINUED LOCATION: MAIN-PANEL");
    expect(d.content).not.toContain('class="label-text label-location"');
    expect(d.content).toContain(unrelated);
    expect(d.content).toContain(furniture);
  }
});

let ir: ElectricalIr;
let presentation: CompiledProjectPresentation | undefined;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c));
  ir = c.ir;
  presentation = c.presentation;
});
const witnesses = [
  ["landscape", "compact", "left-to-right", false],
  ["landscape", "compact", "top-to-bottom", true],
  ["landscape", "standard", "left-to-right", false],
  ["portrait", "compact", "top-to-bottom", true],
  ["portrait", "standard", "top-to-bottom", true],
] as const;
for (const witness of witnesses)
  it.each([witness])(
    "keeps only painted SVG/HTML heading copies: letter %s %s %s",
    async (orientation, layout, flow, originalVisible) => {
      const r = await renderSchematicPacket(
        ir,
        {
          format: "schematic-packet-request/0.1",
          page: { size: "letter", orientation },
          layout,
          views: [
            {
              format: "schematic-view-request/0.1",
              root: { by: "designation", value: "M1" },
              family: "power",
              flow,
            },
            {
              format: "schematic-view-request/0.1",
              root: { by: "designation", value: "K1" },
              family: "control",
              flow,
            },
          ],
        },
        presentation,
      );
      if (!r.ok) throw Error(JSON.stringify(r));
      const svg = parseSvg(r.value.sheets[0]!.svg),
        html = parseSvg(r.value.html);
      for (const doc of [svg, html.querySelector("#sheet-1")!]) {
        expect(
          [...doc.querySelectorAll("text.label-location")].some(
            (t) => t.textContent === "MAIN-PANEL",
          ),
        ).toBe(originalVisible);
        expect(
          [...doc.querySelectorAll("text")].some(
            (t) => t.textContent === "CONTINUED LOCATION: MAIN-PANEL",
          ),
        ).toBe(!originalVisible);
      }
    },
    witness[0] === "landscape" &&
      witness[1] === "compact" &&
      witness[2] === "left-to-right"
      ? 60000
      : 30000,
  );
