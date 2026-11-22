import { escapeXmlAttribute as attr } from "../svg/escape.js";
import type { Rect } from "../device-legend/geometry.js";
import { printableTextMetrics } from "../text-metrics.js";
import { required } from "../presentation/util.js";
import {
  placePeerNotes,
  type PeerNotePlacement,
} from "./peer-note-placement.js";
import type { NavigationShape } from "./navigation-types.js";
import { text } from "./svg.js";
import type { RenderedSheet } from "./types.js";

const FONT_MM = 2.5;
const LINE_MM = 3.5;
const METRIC_PAD_MM = 0.02;

export interface PeerReference {
  kind:
    | "attachment"
    | "assembly-inventory"
    | "conductor-peer"
    | "terminal-interface";
  identity: readonly unknown[];
  value: string;
  compact: string;
  destination: string;
  owner: Rect;
  along?: readonly Rect[];
  captions?: readonly Rect[];
  ownerLabel?: string;
}

const advance = (value: string) => printableTextMetrics(value, FONT_MM).advance;

function twoLines(value: string) {
  let narrowest = Infinity;
  let result: string[] = [];
  for (const { index } of value.matchAll(/ (?=\S)/gu)) {
    const lines = [value.slice(0, index).trimEnd(), value.slice(index + 1)];
    if (!lines[0]) continue;
    const width = Math.max(...lines.map(advance));
    if (width >= narrowest) continue;
    narrowest = width;
    result = lines;
  }
  return result;
}

function printedBounds(lines: readonly string[]) {
  const metrics = lines.map((line) => printableTextMetrics(line, FONT_MM));
  const left = Math.min(...metrics.map((ink) => ink.left));
  const right = Math.max(...metrics.map((ink) => ink.right));
  const top = Math.min(...metrics.map((ink, i) => i * LINE_MM - ink.top));
  const bottom = Math.max(...metrics.map((ink, i) => i * LINE_MM - ink.bottom));
  return { left, top, w: right - left, h: bottom - top };
}

function shape(id: string, lines: readonly string[]): NavigationShape {
  const ink = printedBounds(lines);
  return {
    id,
    mode: "local",
    inkMm: {
      x: 0,
      y: 0,
      w: ink.w + 2 * METRIC_PAD_MM,
      h: ink.h + 2 * METRIC_PAD_MM,
    },
    maximumForms: lines,
    wrapWidthMm: ink.w,
  };
}

function noteShapes(
  entry: PeerReference,
  unique: boolean,
  uniqueForOwner: boolean,
) {
  const forms = [
    shape("full", [entry.value]),
    shape("compact", [entry.compact]),
  ];
  if (entry.ownerLabel)
    forms.push(
      shape("named-compact", [`${entry.ownerLabel} ${entry.compact}`]),
    );
  if (unique) forms.push(shape("locator", [`→ ${entry.destination}`]));
  if (uniqueForOwner && entry.ownerLabel) {
    const destination = `→ ${entry.destination}`;
    forms.push(shape("qualified", [`${entry.ownerLabel} ${destination}`]));
    forms.push(shape("qualified-wrapped", [entry.ownerLabel, destination]));
  }
  if (entry.ownerLabel) {
    const wrappedCompact = twoLines(`${entry.ownerLabel} ${entry.compact}`);
    if (wrappedCompact.length)
      forms.push(shape("named-compact-wrapped", wrappedCompact));
  }
  const wrapped = twoLines(entry.value);
  if (wrapped.length) forms.push(shape("wrapped", wrapped));
  return forms;
}

function noteInk(
  { kind, identity }: PeerReference,
  { lines, box }: PeerNotePlacement,
) {
  const claims = `data-peer-reference="${kind}" data-peer-source="${attr(JSON.stringify(identity))}"`;
  const printed = printedBounds(lines);
  const ink = lines.map((line, i) =>
    text(
      box.x - printed.left + METRIC_PAD_MM,
      box.y - printed.top + METRIC_PAD_MM + i * LINE_MM,
      line,
      FONT_MM,
    ),
  );
  return ink.length === 1
    ? required(ink[0], "Missing peer reference line").replace(
        "<text ",
        `<text ${claims} `,
      )
    : `<g ${claims}>${ink.join("\n")}</g>`;
}

export function emitPeerReferences(
  sheet: RenderedSheet,
  field: Rect,
  entries: readonly PeerReference[],
): RenderedSheet {
  if (!entries.length) return sheet;
  const placements = placePeerNotes(sheet, field, entries, noteShapes);
  const markup = entries
    .map((entry, i) =>
      noteInk(
        entry,
        required(placements[i], "Missing peer reference placement"),
      ),
    )
    .join("");
  return {
    ...sheet,
    svg: sheet.svg.replace(/<\/svg>(\s*)$/u, `${markup}</svg>$1`),
  };
}
