import type { ElectricalIr } from "@thermite/compiler";
import { expect, it } from "vitest";
import { terminalPeerReferences } from "../src/packet/terminal-peer-references.js";
import type { Draft, PaperPage, RenderedSheet } from "../src/packet/types.js";
import { escapeXmlAttribute as attr } from "../src/svg/escape.js";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { parseSvg } from "./off-view-fixtures.js";

const PAGE: PaperPage = {
  size: "tabloid",
  orientation: "landscape",
  widthMm: 431.8,
  heightMm: 279.4,
  marginMm: 10,
};
const FIELD = { x: 28, y: 24, w: 360, h: 240 };

function twoWireIr(): ElectricalIr {
  const ir = createTerminalIr([
    { uid: "ps1", designation: "PS1", terminalKeys: ["+"] },
    { uid: "s2", designation: "S2", terminalKeys: ["11", "12"] },
  ]);
  const source = ir.devices[0]!.source;
  ir.wires = [
    {
      uid: "w12",
      designation: "W-CTL-012",
      endpoints: [
        { terminal: { deviceUid: "ps1", terminalKey: "+" } },
        { terminal: { deviceUid: "s2", terminalKey: "11" } },
      ],
      source,
    },
  ];
  return ir;
}

function sheetSvg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="431.8mm" height="279.4mm" viewBox="0 0 431.8 279.4">${body}</svg>`;
}

function cardAndCircuitSheets(attachmentMarkup: string) {
  const s1Svg = sheetSvg(
    `<g data-device-uid="ps1"><circle data-terminal-marker="true" data-terminal-key="+" cx="60" cy="82" r="0.65" fill="white" stroke="#17212b" stroke-width="0.3"/></g>` +
      `<g class="off-view-annotation" data-off-view-terminal-id="${attr(JSON.stringify({ deviceUid: "ps1", terminalKey: "+" }))}" data-off-view-conductors="${attr(JSON.stringify([{ kind: "wire", uid: "w12" }]))}">` +
      `<rect class="off-view-card" x="130" y="30" width="60" height="16" fill="white" stroke="#17212b" stroke-width="0.3"/>` +
      `<text class="off-view-heading" x="132" y="35" font-size="2.6">Off-view at PS1.+</text>` +
      `<text class="off-view-row" x="132" y="42" font-size="2.6">W-CTL-012 → S2.11</text>` +
      `</g>`,
  );
  const s2Svg = sheetSvg(
    `<g data-device-uid="ps1"><g data-layout-port="p0" data-terminal-id="${attr(JSON.stringify(["ps1", "+"]))}" data-terminal-key="+"><circle data-terminal-marker="true" cx="54" cy="96" r="0.65" fill="white" stroke="#17212b" stroke-width="0.3"/></g>${attachmentMarkup}</g>` +
      `<g data-device-uid="s2"><circle data-terminal-marker="true" data-terminal-key="11" cx="103" cy="96" r="0.65" fill="white" stroke="#17212b" stroke-width="0.3"/><circle data-terminal-marker="true" data-terminal-key="12" cx="129" cy="96" r="0.65" fill="white" stroke="#17212b" stroke-width="0.3"/></g>` +
      `<g data-circuit-conductor="w12"><path d="M 72 96 H 103" fill="none" stroke="#17212b" stroke-width="0.35"/></g>`,
  );
  const view: Draft["view"] = {
    format: "documentation-view/0.1",
    kind: "wiring",
  };
  const drafts: Draft[] = [
    { title: "S1", svg: s1Svg, view, drawingBounds: FIELD },
    { title: "S2", svg: s2Svg, view, drawingBounds: FIELD },
  ];
  const sheets: RenderedSheet[] = [
    { number: 1, title: "S1", svg: s1Svg, view, continuations: [] },
    { number: 2, title: "S2", svg: s2Svg, view, continuations: [] },
  ];
  return { drafts, sheets };
}

function leadMarkup(
  terminal: [string, string],
  pathAttrs: string,
  groupAttrs = "",
  extra = "",
) {
  return (
    `<g data-terminal-attachment="${attr(JSON.stringify(terminal))}"${groupAttrs}>` +
    `<path ${pathAttrs}/></g>${extra}`
  );
}

it("#571 suppresses same-sheet reciprocal peer notes when a drawn attachment lead connects marker to route tip", () => {
  const ir = twoWireIr();
  const drawnLead = leadMarkup(
    ["ps1", "+"],
    `d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"`,
  );
  const { drafts, sheets } = cardAndCircuitSheets(drawnLead);
  const out = terminalPeerReferences(ir, drafts, sheets, PAGE);
  const s1Doc = parseSvg(out[0]!.svg);
  const s2Doc = parseSvg(out[1]!.svg);
  // Off-view card on sheet 1 still receives its destination zone on sheet 2.
  const cardRow = s1Doc.querySelector(".off-view-row")?.textContent ?? "";
  expect(cardRow).toMatch(/W-CTL-012 → S2\.11 02\.[A-D][1-6]/u);
  // Sheet 2 draws the full conductor via the attachment lead: no reciprocal or same-sheet peer notes.
  expect(s2Doc.querySelectorAll("[data-peer-reference]")).toHaveLength(0);
});

it("#571 allows a continuous multi-subpath attachment lead whose M joins end-to-start within 0.05 mm", () => {
  const ir = twoWireIr();
  const joinedLead = leadMarkup(
    ["ps1", "+"],
    `d="M 54 96 H 60 M 60 96 H 72" fill="none" stroke="#17212b" stroke-width="0.32"`,
  );
  const { drafts, sheets } = cardAndCircuitSheets(joinedLead);
  const out = terminalPeerReferences(ir, drafts, sheets, PAGE);
  const s2Doc = parseSvg(out[1]!.svg);
  expect(s2Doc.querySelectorAll("[data-peer-reference]")).toHaveLength(0);
});

it.each([
  ["missing-lead", ""],
  [
    "stroke-none",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 L 72 96" fill="none" stroke="none" stroke-width="0.32"`,
    ),
  ],
  [
    "stroke-white",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 L 72 96" fill="none" stroke="white" stroke-width="0.32"`,
    ),
  ],
  [
    "opacity-zero",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"`,
      ` opacity="0"`,
    ),
  ],
  [
    "display-none",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"`,
      ` display="none"`,
    ),
  ],
  [
    "wrong-terminal",
    leadMarkup(
      ["s2", "12"],
      `d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"`,
    ),
  ],
  [
    "disconnected-from-marker",
    leadMarkup(
      ["ps1", "+"],
      `d="M 60 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"`,
    ),
  ],
  [
    "occluded-in-middle",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"`,
      "",
      `<rect x="61" y="92" width="4" height="8" fill="white"/>`,
    ),
  ],
  [
    "untagged-opaque-circle-cover",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 H 72" fill="none" stroke="#17212b" stroke-width="0.32"`,
      "",
      `<circle cx="63" cy="96" r="2" fill="white"/>`,
    ),
  ],
  [
    "near-tip-0.22mm-gap",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 H 72" fill="none" stroke="#17212b" stroke-width="0.32"`,
      "",
      `<rect x="71.78" y="94" width="0.27" height="4" fill="white"/>`,
    ),
  ],
  [
    "dashed-lead",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 H 72" fill="none" stroke="#17212b" stroke-width="0.32" stroke-dasharray="2 2"`,
    ),
  ],
  [
    "disconnected-subpaths",
    leadMarkup(
      ["ps1", "+"],
      `d="M54 96 H60 M66 96 H72" fill="none" stroke="#17212b" stroke-width="0.32"`,
    ),
  ],
  [
    "opaque-polygon-cover",
    leadMarkup(
      ["ps1", "+"],
      `d="M 54 96 H 72" fill="none" stroke="#17212b" stroke-width="0.32"`,
      "",
      `<polygon points="61,93 65,93 63,99" fill="white"/>`,
    ),
  ],
])(
  "#571 does not count %s as painted through an attachment lead",
  (_label, markup) => {
    const ir = twoWireIr();
    const { drafts, sheets } = cardAndCircuitSheets(markup);
    const out = terminalPeerReferences(ir, drafts, sheets, PAGE);
    const s2Doc = parseSvg(out[1]!.svg);
    expect(
      s2Doc.querySelectorAll("[data-peer-reference]").length,
    ).toBeGreaterThan(0);
  },
);
