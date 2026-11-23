import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type { DocumentationTable } from "@thermite/query";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { measureText, printableTextMetrics } from "../text-metrics.js";
import { required } from "../presentation/util.js";
import { stripFacts, stripTerminalKey } from "./terminal-strip-facts.js";
import {
  stripApproaches,
  stripStubElbow,
  type StripApproaches,
} from "./terminal-strip-approaches.js";
import {
  placeStripBridgeTags,
  type BridgeGeometry,
  type StripRect,
  type StripSegment,
} from "./terminal-strip-bridge-tags.js";
import {
  fragmentAnchors,
  paginateStrip,
  stripLines,
  type StripFragment,
  type StripLabel,
  type StripPlan,
  type StripRow,
} from "./terminal-strip-layout.js";
import { fieldTextLeft, n, text } from "./svg.js";
import { bounds, zone } from "./page.js";
import type { DrawingBounds, Draft, PaperPage } from "./types.js";

export type StripDrawing = Pick<
  StripPlan,
  "bounds" | "notes" | "columns" | "pages"
>;
export interface TerminalStripSheet {
  plan: StripDrawing;
  page: number;
}
type Locate = (key: string) => { sheet: number; zone: string };
const destination = (where: ReturnType<Locate>) =>
  `${String(where.sheet).padStart(2, "0")}.${where.zone}`;
function bridgePeer(label: StripLabel): TerminalId {
  if (!label.peer) throw Error("Missing native jumper peer");
  return label.peer;
}
function rowLabels(
  part: StripFragment,
  row: StripRow,
  x: number,
  cy: number,
  y: number,
  locate: Locate,
  approaches: StripApproaches,
  rightStubSegments: StripSegment[],
) {
  const m = part.model,
    out: string[] = [];
  row.sides.forEach((side, i) => {
    let baseline = y + 3.5;
    side.forEach((label, index) => {
      const remote =
        label.bridge &&
        !part.rows.some(
          (r) => r.terminal.key === stripTerminalKey(bridgePeer(label)),
        );
      const value =
        label.label +
        (remote
          ? `; continued on sheet ${destination(locate(stripTerminalKey(bridgePeer(label))))}`
          : "");
      const lines = stripLines(value, m.labelW);
      const start = i === 0 ? x : x + m.terminalW,
        end = i === 0 ? x - 6 : x + m.terminalW + m.gutter + 6;
      const half = Math.ceil(side.length / 2);
      const offset =
        index < half
          ? (-3.2 * (half - index)) / (half + 1)
          : (3.2 * (index - half + 1)) / (side.length - half + 1);
      const separate = approaches.rightStubs.get(label);
      const anchor = separate ?? cy + offset;
      const elbow =
        separate === undefined
          ? start +
            (i === 0 ? -1 : 1) * (2 + (3 * (index + 1)) / (side.length + 1))
          : stripStubElbow(end, index, side.length, anchor, baseline - 1);
      out.push(labelGroup(label, row.terminal.key, !!remote));
      if (!label.bridge || remote) {
        out.push(
          `<path d="M ${n(start)} ${n(anchor)} H ${n(elbow)} V ${n(baseline - 1)} H ${n(end)}" fill="none" stroke="#344054" stroke-width="0.4"/>`,
        );
        if (i === 1)
          rightStubSegments.push(
            { x1: start, y1: anchor, x2: elbow, y2: anchor },
            { x1: elbow, y1: anchor, x2: elbow, y2: baseline - 1 },
            { x1: elbow, y1: baseline - 1, x2: end, y2: baseline - 1 },
          );
      }
      lines.forEach((line, j) =>
        out.push(
          text(
            i === 0 ? part.x + m.labelW : end + 2,
            baseline + j * 3.5,
            line,
            2.5,
            i === 0 ? "end" : "start",
          ),
        ),
      );
      out.push("</g>");
      baseline += label.lines.length * 3.5;
    });
  });
  return out;
}
function labelGroup(label: StripLabel, at: string, remote: boolean) {
  if (label.bridge)
    return `<g ${remote ? `data-strip-jumper="${attr(label.bridge.uid)}" data-strip-jumper-end="${label.bridge.end}"` : `data-strip-bridge-label="${attr(label.bridge.uid)}"`} data-strip-at="${attr(at)}" data-strip-peer="${attr(stripTerminalKey(bridgePeer(label)))}">`;
  return `<g data-strip-incidence="${attr(label.identity)}" data-strip-at="${attr(at)}">`;
}
function terminalSvg(
  part: StripFragment,
  row: StripRow,
  y: number,
  locate: Locate,
  approaches: StripApproaches,
  rightStubSegments: StripSegment[],
  terminalRects: StripRect[],
) {
  const m = part.model,
    t = row.terminal,
    x = part.x + m.labelW + 8,
    cy = y + row.height / 2;
  terminalRects.push({ x, y: cy - 4, w: m.terminalW, h: 8 });
  return [
    `<g data-strip-terminal="${attr(t.key)}" data-device-uid="${attr(t.id.deviceUid)}" data-terminal-key="${attr(t.id.terminalKey)}" data-strip-ref="${attr(t.ref)}" data-inventory-row="${attr(t.key)}">`,
    `<rect x="${n(x)}" y="${n(cy - 4)}" width="${n(m.terminalW)}" height="8" fill="#fff" stroke="#344054" stroke-width="0.35"/>`,
    text(x + m.terminalW / 2, cy - 0.5, t.id.terminalKey, 2.5, "middle", 700),
    text(x + m.terminalW / 2, cy + 2.8, t.ref, 2.5, "middle").replace(
      "<text ",
      `<text data-strip-inventory-label="${attr(t.key)}" `,
    ),
    "</g>",
    ...rowLabels(part, row, x, cy, y, locate, approaches, rightStubSegments),
  ].join("\n");
}
function bridgeSvg(
  part: StripFragment,
  { bridges }: StripApproaches,
  rightStubSegments: readonly StripSegment[],
  terminalRects: readonly StripRect[],
) {
  const edge = part.x + part.model.labelW + 8 + part.model.terminalW;
  const step = part.model.laneStep;
  const geometries: BridgeGeometry[] = bridges.map((bridge) => {
    const x = edge + step * bridge.lane;
    const yLo = Math.min(bridge.from.y, bridge.to.y);
    const yHi = Math.max(bridge.from.y, bridge.to.y);
    return {
      bridge,
      x,
      yLo,
      yHi,
      segments: [
        { x1: edge, y1: bridge.from.y, x2: x, y2: bridge.from.y },
        { x1: x, y1: yLo, x2: x, y2: yHi },
        { x1: edge, y1: bridge.to.y, x2: x, y2: bridge.to.y },
      ],
    };
  });
  const placements = placeStripBridgeTags(
    geometries,
    step,
    rightStubSegments,
    terminalRects,
  );
  return geometries
    .map(({ bridge: { uid, number, from, to }, x }) => {
      const placement = required(
        placements.get(uid),
        "Missing bridge tag placement",
      );
      return [
        `<g data-strip-jumper="${attr(uid)}"><path d="M ${n(edge)} ${n(from.y)} H ${n(x)} V ${n(to.y)} H ${n(edge)}" fill="none" stroke="#18212b" stroke-width="0.5"/>`,
        text(
          placement.tx,
          placement.baseline,
          `B${number}`,
          2.5,
          placement.anchor,
        ).replace("<text ", `<text data-strip-bridge-tag="${attr(uid)}" `),
        "</g>",
      ].join("\n");
    })
    .join("\n");
}
function orderMarker(
  part: StripFragment,
  direction: "from" | "on",
  y: number,
  locate: Locate,
) {
  const target = direction === "from" ? part.from : part.to;
  if (!target) return [];
  const at =
    direction === "from" ? part.rows[0]?.terminal : part.rows.at(-1)?.terminal;
  const value = `${part.model.group.device.designation} continued ${direction} sheet ${destination(locate(target.key))} at terminal ${target.id.terminalKey}`;
  return [
    `<g data-strip-continuation="${direction}" data-strip-at="${attr(required(at, "Missing strip boundary").key)}" data-strip-target="${attr(target.key)}" data-device-uid="${attr(part.model.group.device.uid)}">`,
    ...stripLines(value, part.model.width).map((line, i) =>
      text(part.x, y + 3 + i * 3.5, line, 2.5),
    ),
    "</g>",
  ];
}
function fragmentSvg(part: StripFragment, locate: Locate) {
  const m = part.model,
    out = [`<g data-terminal-strip="${attr(m.group.device.uid)}">`];
  m.heading.forEach((line, i) =>
    out.push(text(part.x, part.y + 3 + i * 3.5, line, 2.5, "start", 700)),
  );
  const headingsY = part.y + m.heading.length * 3.5 + 4;
  m.sideHeadings.forEach((lines, side) =>
    lines.forEach((line, i) =>
      out.push(
        text(
          side === 0
            ? part.x
            : part.x + m.labelW + 8 + m.terminalW + m.gutter + 8,
          headingsY + i * 3.5,
          line,
          2.5,
        ),
      ),
    ),
  );
  const approaches = stripApproaches(part);
  const rightStubSegments: StripSegment[] = [];
  const terminalRects: StripRect[] = [];
  let y = part.y + m.headerH;
  out.push(...orderMarker(part, "from", y, locate));
  if (part.from) y += m.markerH;
  for (const row of part.rows) {
    out.push(
      terminalSvg(
        part,
        row,
        y,
        locate,
        approaches,
        rightStubSegments,
        terminalRects,
      ),
    );
    y += row.height;
  }
  out.push(
    bridgeSvg(part, approaches, rightStubSegments, terminalRects),
    ...orderMarker(part, "on", y + 1, locate),
    "</g>",
  );
  return out.join("\n");
}
function stripContent(
  plan: StripDrawing,
  page: number,
  title: string,
  locate: Locate,
) {
  const b = plan.bounds;
  const heading = `${title} — graphical strip`;
  return [
    `<g data-sheet-kind="terminal-strip">`,
    text(
      Math.max(b.x + 0.5, fieldTextLeft(b.x, heading, 4, true)),
      b.y + 3,
      heading,
      4,
      "start",
      700,
    ),
    ...(plan.pages[page] ?? []).map((part) => fragmentSvg(part, locate)),
    ...plan.notes.map((line, i) =>
      text(
        Math.max(b.x + 0.5, fieldTextLeft(b.x, line, 2.5)),
        b.y + b.h - (plan.notes.length - 1 - i) * 3.5,
        line,
        2.5,
      ),
    ),
    "</g>",
  ].join("\n");
}
export function terminalStrip(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  b: DrawingBounds,
) {
  return table.kind === "terminals" && table.rows.length
    ? paginateStrip(stripFacts(ir, table), b)
    : undefined;
}
export function stripReferenceColumnWidth(strip: StripPlan, size = 2.6) {
  const widthOf = (value: string, bold = false) =>
    Math.max(
      measureText(value, size).width,
      printableTextMetrics(value, size, bold).advance,
    );
  const headerW = Math.max(widthOf("Strip", true), widthOf("row", true));
  const refW = Math.max(
    0,
    ...[...strip.facts.terminals.values()].map((t) => widthOf(t.ref)),
  );
  return Math.max(10.5, Math.ceil((Math.max(headerW, refW) + 3.2) * 2) / 2);
}
export function stripColumnHeaderLines(width: number, size: number) {
  const single = Math.max(
    measureText("Strip row", size).width,
    printableTextMetrics("Strip row", size, true).advance,
  );
  return single + 3.2 <= width ? ["Strip row"] : ["Strip", "row"];
}
export function stripColumnHeaderSvg(
  lines: readonly string[],
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  baseline: number,
  lineHeight: number,
) {
  return [
    '<g data-strip-column-header="true">',
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="#e9eef4" stroke="#9ba6b4" stroke-width="0.2"/>`,
    ...lines.map((line, j) =>
      text(x + 1.4, y + baseline + j * lineHeight, line, size, "start", 700),
    ),
    "</g>",
  ].join("\n");
}
export function stripRowCellSvg(
  ref: string | undefined,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
  baseline: number,
) {
  return [
    `<g data-strip-row-cell="${attr(key)}">`,
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="white" stroke="#9ba6b4" stroke-width="0.2"/>`,
    ...(ref
      ? [
          text(x + 1.4, y + baseline, ref, size).replace(
            "<text ",
            `<text data-strip-row="${attr(key)}" data-strip-ref="${attr(ref)}" `,
          ),
        ]
      : []),
    "</g>",
  ].join("\n");
}
export function stripRowReference(
  ref: string | undefined,
  key: string,
  x: number,
  y: number,
) {
  return ref
    ? text(x - 0.7 - measureText(ref, 2.5).width, y, ref, 2.5).replace(
        "<text ",
        `<text data-strip-row="${attr(key)}" data-strip-ref="${attr(ref)}" `,
      )
    : "";
}
export function stripDraft(
  base: Pick<Draft, "view" | "title">,
  plan: StripDrawing,
  page: number,
): Draft {
  return {
    ...base,
    view: {
      format: "documentation-view/0.1",
      kind: "terminal-strip",
      title: "title" in base.view ? base.view.title : "Terminal strip",
    },
    terminalStrip: {
      plan: {
        bounds: plan.bounds,
        notes: plan.notes,
        columns: plan.columns,
        pages: plan.pages,
      },
      page,
    },
    drawingBounds: plan.bounds,
    content: "",
    links: [],
    references: [],
    note: "Graphical strip · Tn/Rn: inventory row · Bn: bridge · Snn: inventory sheet",
    documentationTable: true,
  };
}
export function resolveTerminalStripLocations(
  drafts: readonly Draft[],
  page: PaperPage,
) {
  const locations = new Map<string, ReturnType<Locate>>();
  const scope = (draft: Draft) =>
    draft.navigationView?.key ?? JSON.stringify(draft.views ?? []);
  drafts.forEach((draft, index) => {
    const strip = draft.terminalStrip;
    if (!strip) return;
    for (const part of strip.plan.pages[strip.page] ?? [])
      for (const anchor of fragmentAnchors(part))
        locations.set(JSON.stringify([scope(draft), anchor.key]), {
          sheet: index + 1,
          zone: zone(
            anchor.x,
            anchor.y,
            draft.drawingBounds ?? bounds(draft.title, page),
          ),
        });
  });
  for (const draft of drafts) {
    const strip = draft.terminalStrip;
    if (!strip) continue;
    const locate: Locate = (key) =>
      required(
        locations.get(JSON.stringify([scope(draft), key])),
        `Missing native strip destination ${key}`,
      );
    const content = stripContent(
      strip.plan,
      strip.page,
      "title" in draft.view ? draft.view.title : "Terminal strip",
      locate,
    );
    draft.content = draft.navigationView
      ? `<g data-navigation-view="${attr(draft.navigationView.key)}">${content}</g>`
      : content;
  }
}

export function stripDrawing(plan: StripPlan): StripDrawing {
  return {
    bounds: plan.bounds,
    notes: plan.notes,
    columns: plan.columns,
    pages: plan.pages,
  };
}
/** Append only the requested projections after complete native inventories.
 * Existing non-strip sheets keep their authored order and physical numbers. */
export function appendTerminalStrips(drafts: Draft[]): Draft[] {
  const strips: Draft[] = [];
  for (const draft of drafts) {
    const plan = draft.terminalStripPlan;
    if (!plan) continue;
    for (const [page] of plan.pages.entries())
      strips.push({
        ...stripDraft(draft, plan, page),
        ...(draft.views ? { views: draft.views } : {}),
        ...(draft.navigationView
          ? { navigationView: draft.navigationView }
          : {}),
        ...(draft.navigationInputs
          ? { navigationInputs: draft.navigationInputs }
          : {}),
        ...(draft.resolvedTitle ? { resolvedTitle: draft.resolvedTitle } : {}),
      });
  }
  return [...drafts, ...strips];
}
