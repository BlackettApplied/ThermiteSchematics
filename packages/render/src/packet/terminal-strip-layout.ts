import type { TerminalId } from "@thermite/compiler";
import { measureText } from "../text-metrics.js";
import { wrapReportCell } from "./report-wrapping.js";
import { fieldTextBounds } from "./svg.js";
import { stripTerminalKey, type StripFacts } from "./terminal-strip-facts.js";
import type { DrawingBounds } from "./types.js";

export type StripGroup = StripFacts["groups"][number];
export type StripTerminal = StripGroup["terminals"][number];
export const stripLines = (value: string, width: number) =>
  wrapReportCell(value, width, 2.5, [], []);
export interface StripLabel {
  identity: string;
  label: string;
  peer: TerminalId | null;
  bridge?: { uid: string; end: number; token: string };
  lines: string[];
  continuedLines: string[];
}
export interface StripRow {
  terminal: StripTerminal;
  sides: StripLabel[][];
  height: number;
}
export interface StripModel {
  group: StripGroup;
  width: number;
  terminalW: number;
  laneStep: number;
  gutter: number;
  bridgeCapacity: number;
  labelW: number;
  bridges: StripFacts["bridges"];
  heading: string[];
  sideHeadings: string[][];
  rows: StripRow[];
  headerH: number;
  markerH: number;
  height: number;
}
export interface StripFragment {
  model: StripModel;
  rows: StripRow[];
  x: number;
  y: number;
  height: number;
  from?: StripTerminal | undefined;
  to?: StripTerminal | undefined;
}
export interface StripPlan {
  facts: StripFacts;
  bounds: DrawingBounds;
  notes: string[];
  columns: number;
  pages: StripFragment[][];
}
function bridgeLabels(
  t: StripTerminal,
  group: StripGroup,
  bridges: StripFacts["bridges"],
) {
  return bridges.flatMap((j, index) =>
    j.endpoints.flatMap((e, end) => {
      if (stripTerminalKey(e.terminal) !== t.key) return [];
      const peer = j.endpoints[end === 0 ? 1 : 0].terminal;
      return [
        {
          identity: j.uid,
          peer,
          sameLocation: group.device.location !== undefined,
          label: `B${index + 1} ${j.designation ?? "Jumper"} → ${group.device.designation}.${peer.terminalKey}`,
          bridge: { uid: j.uid, end, token: `B${index + 1}` },
        },
      ];
    }),
  );
}
function measuredRows(
  group: StripGroup,
  bridges: StripFacts["bridges"],
  width: number,
): StripRow[] {
  return group.terminals.map((terminal) => {
    const labels = [
      ...terminal.incidences,
      ...bridgeLabels(terminal, group, bridges),
    ];
    const sides = [true, false].map((same) =>
      labels
        .filter((i) => i.sameLocation === same)
        .map((i) => ({
          ...i,
          lines: stripLines(i.label, width),
          continuedLines: stripLines(
            i.label + ("bridge" in i ? "; continued on sheet 888.D6" : ""),
            width,
          ),
        })),
    );
    const count = Math.max(
      ...sides.map((s) => s.reduce((sum, i) => sum + i.lines.length, 0)),
    );
    return { terminal, sides, height: Math.max(10, count * 3.5 + 3) };
  });
}
function measuredModel(
  group: StripGroup,
  facts: StripFacts,
  width: number,
): StripModel {
  const bridges = facts.bridges.filter(
    (j) => j.endpoints[0].terminal.deviceUid === group.device.uid,
  );
  const terminalW = Math.max(
    16,
    ...group.terminals.map((t) => measureText(t.id.terminalKey, 2.5).width + 4),
  );
  const laneStep = 6;
  const bridgeCapacity = Math.max(
    0,
    Math.floor((width - terminalW - 20 - 24 - 4) / laneStep),
  );
  const gutter = Math.min(bridges.length, bridgeCapacity) * laneStep + 4,
    labelW = (width - terminalW - gutter - 20) / 2;
  if (labelW < 12) throw Error("Strip labels do not fit this column width.");
  const heading = stripLines(
    `${group.device.designation} — ${group.ordered ? "authored order" : "order unspecified; declaration listing"}`,
    width,
  );
  const sideHeadings = [
    stripLines("Same location", labelW),
    stripLines("Other / unknown location", labelW),
  ];
  const headerH =
    heading.length * 3.5 +
    Math.max(...sideHeadings.map((h) => h.length)) * 3.5 +
    5;
  const markerH =
    Math.max(
      1,
      ...group.terminals.map(
        (t) =>
          stripLines(
            `${group.device.designation} continued from sheet 888.D6 at terminal ${t.id.terminalKey}`,
            width,
          ).length,
      ),
    ) *
      3.5 +
    2;
  const rows = measuredRows(group, bridges, labelW);
  return {
    group,
    width,
    terminalW,
    laneStep,
    gutter,
    bridgeCapacity,
    labelW,
    bridges,
    heading,
    rows,
    sideHeadings,
    headerH,
    markerH,
    height: headerH + rows.reduce((sum, r) => sum + r.height, 0) + 4,
  };
}
function fragment(
  model: StripModel,
  first: number,
  end: number,
  x: number,
  y: number,
): StripFragment {
  const selected = model.rows.slice(first, end);
  const keys = new Set(selected.map((r) => r.terminal.key));
  const rows = selected.map((row) => {
    const sides = row.sides.map((side) =>
      side.map((label) =>
        label.bridge && label.peer && !keys.has(stripTerminalKey(label.peer))
          ? { ...label, lines: label.continuedLines }
          : label,
      ),
    );
    const count = Math.max(
      ...sides.map((side) =>
        side.reduce((sum, label) => sum + label.lines.length, 0),
      ),
    );
    return { ...row, sides, height: Math.max(10, count * 3.5 + 3) };
  });
  const from = first ? model.rows[first - 1]?.terminal : undefined,
    to = model.rows[end]?.terminal;
  const bridgeOverflow =
    model.bridges.filter((j) =>
      j.endpoints.every((e) => keys.has(stripTerminalKey(e.terminal))),
    ).length > model.bridgeCapacity;
  return {
    model,
    rows,
    x,
    y,
    from,
    to,
    height: bridgeOverflow
      ? Infinity
      : model.headerH +
        rows.reduce((s, r) => s + r.height, 0) +
        (from ? model.markerH : 0) +
        (to ? model.markerH : 0) +
        4,
  };
}
function packModels(
  models: StripModel[],
  area: DrawingBounds,
  columns: number,
) {
  const pages: StripFragment[][] = [[]];
  let column = 0,
    y = area.y;
  const advance = () => {
    column++;
    y = area.y;
    if (column === columns) {
      column = 0;
      pages.push([]);
    }
  };
  for (const model of models) {
    if (
      model.height <= area.h &&
      model.bridges.length <= model.bridgeCapacity
    ) {
      if (y + model.height > area.y + area.h) advance();
      pages[pages.length - 1]?.push(
        fragment(
          model,
          0,
          model.rows.length,
          area.x + column * (model.width + 8),
          y,
        ),
      );
      y += model.height + 5;
      continue;
    }
    if (y !== area.y) advance();
    let first = 0;
    while (first < model.rows.length) {
      const x = area.x + column * (model.width + 8);
      let end = first;
      for (
        let candidate = first + 1;
        candidate <= model.rows.length;
        candidate++
      )
        if (fragment(model, first, candidate, x, y).height <= area.h)
          end = candidate;
      if (end === first)
        throw Error(
          `Terminal ${model.group.device.designation}.${model.rows[first]?.terminal.id.terminalKey}: one row with its stubs cannot fit ${area.h.toFixed(3)} mm at 2.5 mm.`,
        );
      const part = fragment(model, first, end, x, y);
      pages[pages.length - 1]?.push(part);
      y += part.height + 5;
      first = end;
      if (first < model.rows.length) advance();
    }
  }
  return pages;
}
export function paginateStrip(facts: StripFacts, b: DrawingBounds): StripPlan {
  const textArea = fieldTextBounds(b);
  const notes = stripLines(
    "Schematic projection; hardware unspecified; dimensions unspecified. Location groups do not assign installation sides. Tn/Rn: inventory row; Bn: jumper bridge.",
    textArea.w,
  );
  const area = {
    ...textArea,
    y: b.y + 9,
    h: b.h - 13 - notes.length * 3.5,
  };
  let best: StripPlan | undefined, failure: unknown;
  for (const columns of [1, 2, 3, 4]) {
    try {
      const width = (area.w - (columns - 1) * 8) / columns;
      const pages = packModels(
        facts.groups.map((g) => measuredModel(g, facts, width)),
        area,
        columns,
      );
      if (!best || pages.length < best.pages.length)
        best = { facts, bounds: b, notes, columns, pages };
    } catch (error) {
      if (columns === 1) failure = error;
    }
  }
  if (!best) throw failure ?? Error("A terminal row cannot fit at 2.5 mm.");
  return best;
}
export function fragmentAnchors(part: StripFragment) {
  let y = part.y + part.model.headerH + (part.from ? part.model.markerH : 0);
  return part.rows.map((row) => {
    const anchor = {
      key: row.terminal.key,
      x: part.x + part.model.labelW + 8 + part.model.terminalW / 2,
      y: y + row.height / 2,
    };
    y += row.height;
    return anchor;
  });
}
