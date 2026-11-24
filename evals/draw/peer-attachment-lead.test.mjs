import { afterAll, beforeAll, expect, it } from "vitest";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { terminalPeerReferences } from "../../packages/render/dist/packet/terminal-peer-references.js";
import { createTerminalIr } from "../../packages/query/test/fixtures.ts";
import { drawingContextOptions, launch, openSheet } from "./browser.mjs";
import { peerReferenceFindings } from "./issued-reference-audit.mjs";
import { fixture } from "./m3-fixture.mjs";
import { nativeRows } from "./m3-native.mjs";
import { terminalPeerObligations } from "./terminal-peer-oracle.mjs";

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

const svg = (body) =>
  embedPrintableFont(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200" font-family="Thermite Sans, sans-serif">${body}</svg>`,
  );
const text = (x, y, value, extra = "") =>
  `<text x="${x}" y="${y}" font-size="2.5"${extra}>${value}</text>`;

function zoneGrid() {
  return (
    Array.from({ length: 6 }, (_, i) =>
      text(30 + i * 30, 12, String(i + 1)),
    ).join("") + [..."ABCD"].map((t, i) => text(10, 42 + i * 40, t)).join("")
  );
}

function attachmentOracleFixture() {
  const ir = fixture().ir;
  ir.devices = [
    { uid: "ps1", designation: "PS1", typeId: "t" },
    { uid: "s2", designation: "S2", typeId: "t" },
  ];
  ir.deviceTypes[0].terminals = [
    { key: "+", description: "24V+" },
    { key: "11", description: "NC" },
    { key: "12", description: "NC" },
  ];
  ir.terminals = [
    { id: { deviceUid: "ps1", terminalKey: "+" } },
    { id: { deviceUid: "s2", terminalKey: "11" } },
    { id: { deviceUid: "s2", terminalKey: "12" } },
  ];
  ir.functions = [];
  ir.internalRelations = [];
  ir.wires = [
    {
      uid: "w2",
      designation: "W-CTL-012",
      endpoints: [
        { terminal: { deviceUid: "ps1", terminalKey: "+" } },
        { terminal: { deviceUid: "s2", terminalKey: "11" } },
      ],
    },
  ];
  const s1Card = svg(
    zoneGrid() +
      `<circle class="terminal-marker" data-device-uid="ps1" data-terminal-key="+" cx="60" cy="82" r="1.2" fill="white" stroke="#101828"/>` +
      `<g class="off-view-annotation" data-off-view-terminal-id='{"deviceUid":"ps1","terminalKey":"+"}' data-off-view-conductors='[{"kind":"wire","uid":"w2"}]'>` +
      `<rect x="130" y="30" width="60" height="16" fill="white" stroke="#101828"/>` +
      `<text class="off-view-heading" x="132" y="35" font-size="2.5">Off-view at PS1.+</text>` +
      `<text class="off-view-row" x="132" y="42" font-size="2.5">W-CTL-012 → S2.11 02.B3</text>` +
      `</g>`,
  );
  const makeS2 = (attachmentMarkup) =>
    svg(
      zoneGrid() +
        `<g data-device-uid="ps1"><g data-layout-port="p0" data-terminal-id='["ps1","+"]' data-terminal-key="+"><circle data-terminal-marker="true" cx="54" cy="96" r="0.65" fill="white" stroke="#17212b" stroke-width="0.3"/></g>${attachmentMarkup}</g>` +
        `<g data-device-uid="s2"><g data-layout-port="p2" data-terminal-id='["s2","11"]' data-terminal-key="11"><circle data-terminal-marker="true" cx="103" cy="96" r="0.65" fill="white" stroke="#17212b" stroke-width="0.3"/></g><g data-layout-port="p3" data-terminal-id='["s2","12"]' data-terminal-key="12"><circle data-terminal-marker="true" cx="129" cy="96" r="0.65" fill="white" stroke="#17212b" stroke-width="0.3"/></g></g>` +
        `<g data-circuit-conductor="w2"><path d="M 72 96 H 103" fill="none" stroke="#17212b" stroke-width="0.35"/></g>`,
    );
  const pkt = {
    sheets: [
      { number: 1, view: { kind: "wiring", format: "documentation-view/0.1" } },
      {
        number: 2,
        view: { kind: "circuit", format: "documentation-view/0.1" },
      },
    ],
  };
  return { ir, s1Card, makeS2, pkt };
}

it("#571 oracle counts a drawn attachment lead as painted to that end and rejects missing/unpainted leads", async () => {
  const { ir, s1Card, makeS2, pkt } = attachmentOracleFixture();
  const sources = nativeRows(ir);
  const g1 = await openSheet(page, s1Card);
  const drawnLead = `<g data-terminal-attachment='["ps1","+"]' data-attachment-from='{"x":54,"y":96}' data-attachment-to='{"x":72,"y":96}'><path d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"/></g>`;
  const g2Drawn = await openSheet(page, makeS2(drawnLead));
  const oblsDrawn = terminalPeerObligations(pkt, [g1, g2Drawn], ir, sources);
  expect(oblsDrawn.filter((o) => o.sheet === 1)).toHaveLength(1);
  expect(oblsDrawn.filter((o) => o.sheet === 2)).toHaveLength(0);

  for (const badMarkup of [
    "",
    `<g data-terminal-attachment='["ps1","+"]'><path d="M 54 96 L 72 96" fill="none" stroke="white" stroke-width="0.32"/></g>`,
    `<g data-terminal-attachment='["ps1","+"]'><path d="M 54 96 L 72 96" fill="none" stroke="none" stroke-width="0.32"/></g>`,
    `<g data-terminal-attachment='["ps1","+"]' opacity="0"><path d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"/></g>`,
    `<g data-terminal-attachment='["ps1","+"]'><path d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"/></g><rect x="61" y="92" width="4" height="8" fill="white"/>`,
    `<g data-terminal-attachment='["s2","12"]'><path d="M 54 96 L 72 96" fill="none" stroke="#17212b" stroke-width="0.32"/></g>`,
  ]) {
    const g2Bad = await openSheet(page, makeS2(badMarkup));
    const oblsBad = terminalPeerObligations(pkt, [g1, g2Bad], ir, sources);
    expect(oblsBad.filter((o) => o.sheet === 2).length).toBeGreaterThan(0);
  }
}, 60_000);

const TABLOID = {
  size: "tabloid",
  orientation: "landscape",
  widthMm: 431.8,
  heightMm: 279.4,
  marginMm: 10,
};
const FIELD = { x: 28, y: 24, w: 360, h: 240 };

function round2AttachmentPacket(attachment, cover = "") {
  const ir = createTerminalIr([
    { uid: "ps1", designation: "PS1", terminalKeys: ["+"] },
    { uid: "s2", designation: "S2", terminalKeys: ["11", "12"] },
  ]);
  ir.functions = [];
  ir.internalRelations = [];
  const end = (deviceUid, terminalKey) => ({
    terminal: { deviceUid, terminalKey },
  });
  ir.wires = [
    {
      uid: "w12",
      designation: "W-CTL-012",
      endpoints: [end("ps1", "+"), end("s2", "11")],
      source: ir.devices[0].source,
    },
  ];
  const grid =
    Array.from({ length: 6 }, (_, i) => text(58 + i * 60, 12, i + 1)).join("") +
    Array.from("ABCD", (t, i) => text(10, 54 + i * 60, t)).join("");
  const wrap = (body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" font-family="Thermite Sans, sans-serif" width="431.8mm" height="279.4mm" viewBox="0 0 431.8 279.4">${grid}${body}</svg>`;
  const marker = (device, key, x, y) =>
    `<g data-device-uid="${device}"><circle class="terminal-marker" data-terminal-marker="true" data-terminal-key="${key}" cx="${x}" cy="${y}" r="0.65" fill="white" stroke="#17212b" stroke-width="0.3"/></g>`;
  const first = wrap(
    marker("ps1", "+", 60, 82) +
      `<g class="off-view-annotation" data-off-view-terminal-id="{&quot;deviceUid&quot;:&quot;ps1&quot;,&quot;terminalKey&quot;:&quot;+&quot;}" data-off-view-conductors="[{&quot;kind&quot;:&quot;wire&quot;,&quot;uid&quot;:&quot;w12&quot;}]"><rect class="off-view-card" x="130" y="30" width="60" height="16" fill="white" stroke="#101828"/><text class="off-view-heading" x="132" y="35" font-size="2.6">Off-view at PS1.+</text><text class="off-view-row" x="132" y="42" font-size="2.6">W-CTL-012 → S2.11</text></g>`,
  );
  const second = wrap(
    marker("ps1", "+", 54, 96) +
      marker("s2", "11", 103, 96) +
      marker("s2", "12", 129, 86) +
      attachment +
      cover +
      `<g data-circuit-conductor="w12"><path d="M72 96 H103" fill="none" stroke="#17212b" stroke-width="0.35"/></g>`,
  );
  const view = { format: "documentation-view/0.1", kind: "wiring" };
  const svgs = [first, second];
  const sheets = svgs.map((s, i) => ({
    number: i + 1,
    title: `Sheet ${i + 1}`,
    svg: s,
    view,
    continuations: [],
  }));
  const drafts = svgs.map((s, i) => ({
    title: `Sheet ${i + 1}`,
    svg: s,
    view,
    drawingBounds: FIELD,
  }));
  return { ir, issued: terminalPeerReferences(ir, drafts, sheets, TABLOID) };
}

const leadPath = (d, extra = "") =>
  `<g data-terminal-attachment="[&quot;ps1&quot;,&quot;+&quot;]"><path d="${d}" fill="none" stroke="#17212b" stroke-width="0.32" ${extra}/></g>`;

const ROUND2_ATTACHMENT_CASES = [
  { name: "solid", attachment: leadPath("M54 96 H72"), expectNotes: 0 },
  {
    name: "joined-subpaths",
    attachment: leadPath("M54 96 H60 M60 96 H72"),
    expectNotes: 0,
  },
  {
    name: "untagged-circle-cover",
    attachment: leadPath("M54 96 H72"),
    cover: '<circle cx="63" cy="96" r="2" fill="white"/>',
    expectNotes: 2,
  },
  {
    name: "near-tip-0.22mm-gap",
    attachment: leadPath("M54 96 H72"),
    cover: '<rect x="71.78" y="94" width="0.27" height="4" fill="white"/>',
    expectNotes: 2,
  },
  {
    name: "dashed-lead",
    attachment: leadPath("M54 96 H72", 'stroke-dasharray="2 2"'),
    expectNotes: 2,
  },
  {
    name: "disconnected-subpaths",
    attachment: leadPath("M54 96 H60 M66 96 H72"),
    expectNotes: 2,
    expectSplitInk: true,
  },
];

it("#571 renderer and Chromium DQ-08 agree on conservative attachment-lead continuity", async () => {
  for (const c of ROUND2_ATTACHMENT_CASES) {
    const { ir, issued } = round2AttachmentPacket(c.attachment, c.cover);
    const geoms = [];
    for (const s of issued)
      geoms.push(await openSheet(page, embedPrintableFont(s.svg)));
    const obls = terminalPeerObligations(
      { sheets: issued },
      geoms,
      ir,
      nativeRows(ir),
    );
    const findings = issued.flatMap((s, i) =>
      peerReferenceFindings(
        s.number,
        geoms[i],
        obls.filter((o) => o.sheet === s.number),
      ),
    );
    const s2Notes = geoms[1].texts.filter(
      (t) => t.peerReference === "conductor-peer",
    );
    expect(s2Notes, c.name).toHaveLength(c.expectNotes);
    expect(
      obls.filter((o) => o.sheet === 2),
      c.name,
    ).toHaveLength(c.expectNotes);
    expect(findings, c.name).toEqual([]);
    if (c.expectSplitInk) {
      const leadShape = geoms[1].shapes.find((s) => s.attachment);
      expect(leadShape.inkSegments.length).toBeGreaterThanOrEqual(2);
    }
  }
}, 60_000);
