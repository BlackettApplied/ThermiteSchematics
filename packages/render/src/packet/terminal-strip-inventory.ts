import type { Draft, RenderedSheet } from "./types.js";
import type { IssuedDocument } from "./document-types.js";
import { navigationGeometry } from "./navigation-walk.js";
import { printableTextMetrics } from "../text-metrics.js";
import { n, text } from "./svg.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";

function scope(draft: Draft) {
  return draft.navigationView?.key ?? JSON.stringify(draft.views ?? []);
}

export function terminalInventoryPointers(
  drafts: readonly Draft[],
  sheets: readonly RenderedSheet[],
  documents: readonly IssuedDocument[],
): RenderedSheet[] {
  const inventories = documents
    .filter((d) => d.kind === "terminals" || d.kind === "terminal-strip")
    .flatMap((d) => d.rows);
  const measurements = new Map<number, ReturnType<typeof navigationGeometry>>();
  return sheets.map((sheet, index) => {
    const draft = drafts[index];
    if (!draft?.terminalStrip) return sheet;
    const targets = new Map<string, { sheet: number; ref: string }>();
    const duplicate = new Set<string>();
    for (const row of inventories) {
      const owner = drafts[row.sheet - 1];
      const issued = sheets[row.sheet - 1];
      if (!owner || !issued || scope(owner) !== scope(draft)) continue;
      const geometry =
        measurements.get(row.sheet) ?? navigationGeometry(issued.svg);
      measurements.set(row.sheet, geometry);
      const marks = geometry.filter(
        (g) =>
          g.visible &&
          Number(g.style?.opacity ?? 1) > 0 &&
          g.node.attrs["data-strip-row"] === row.nativeKey,
      );
      const ref = marks[0]?.node.text;
      if (marks.length !== 1 || !ref) continue;
      if (targets.has(row.nativeKey)) duplicate.add(row.nativeKey);
      targets.set(row.nativeKey, {
        sheet: row.sheet,
        ref,
      });
    }
    for (const key of duplicate) targets.delete(key);
    if (!targets.size) return sheet;
    return { ...sheet, svg: stripInventoryInk(sheet.svg, targets) };
  });
}

interface StripPointerInk {
  labels: string;
  terminalBaseline?: number;
}

function inventoryLabel(
  sheet: number,
  value: string,
  x: number,
  y: number,
  anchor: "end" | "middle",
) {
  return text(x, y, value, 2.5, anchor).replace(
    "<text ",
    `<text data-strip-inventory="${sheet}" `,
  );
}

interface StripLabelFrame {
  x: number;
  w: number;
  y: number;
  h: number;
  baseline: number;
}

function inventoryLabelPair(
  target: { sheet: number; ref: string },
  { x, w, y, h, baseline }: StripLabelFrame,
  terminal: string,
): StripPointerInk {
  const token = `S${String(target.sheet).padStart(2, "0")}`;
  const rowInk = printableTextMetrics(target.ref, 2.5);
  const sheetInk = printableTextMetrics(token, 2.5);
  if (rowInk.advance + sheetInk.advance + 2.1 <= w) {
    return {
      labels:
        text(x + 0.7, baseline, target.ref, 2.5) +
        inventoryLabel(target.sheet, token, x + w - 0.7, baseline, "end"),
    };
  }
  // Fit three lines using painted extents, between the existing 0.35 mm rules.
  const terminalInk = printableTextMetrics(terminal, 2.5, true);
  const height = [terminalInk, rowInk, sheetInk].reduce(
    (sum, ink) => sum + ink.top - ink.bottom,
    0,
  );
  const gap = (h - 0.35 - height) / 4;
  const terminalBaseline = y + 0.175 + gap + terminalInk.top;
  const rowBaseline = terminalBaseline - terminalInk.bottom + gap + rowInk.top;
  const sheetBaseline = rowBaseline - rowInk.bottom + gap + sheetInk.top;
  const center = x + w / 2;
  return {
    terminalBaseline,
    labels:
      text(center, rowBaseline, target.ref, 2.5, "middle") +
      inventoryLabel(target.sheet, token, center, sheetBaseline, "middle"),
  };
}

function stripInventoryInk(
  svg: string,
  targets: ReadonlyMap<string, { sheet: number; ref: string }>,
) {
  const replacements = new Map<string, StripPointerInk>();
  for (const { node, visible } of navigationGeometry(svg)) {
    const key = node.attrs["data-strip-terminal"];
    const target = key === undefined ? undefined : targets.get(key);
    if (!visible || key === undefined || target === undefined) continue;
    const label = node.children.find(
      (n) => n.attrs["data-strip-inventory-label"] === key,
    );
    const body = node.children.find((n) => n.name === "rect")?.attrs;
    const terminal = node.children.find(
      (n) => n.name === "text" && n !== label,
    );
    const ref = node.attrs["data-strip-ref"];
    if (
      !body ||
      !terminal?.text ||
      !ref ||
      label?.text !== ref ||
      target.ref !== ref
    )
      continue;
    replacements.set(
      attr(key),
      inventoryLabelPair(
        target,
        {
          x: Number(body.x),
          w: Number(body.width),
          y: Number(body.y),
          h: Number(body.height),
          baseline: Number(label.attrs.y),
        },
        terminal.text,
      ),
    );
  }
  // The marker selects the generated Tn/Rn and the terminal label beside it.
  // The terminal body, conductor stubs and jumper approaches stay in place.
  return svg.replace(
    /(<text\b[^>]*>[^<]*<\/text>)(\s*)<text\b[^>]*data-strip-inventory-label="([^"]*)"[^>]*>[^<]*<\/text>/gu,
    (match, terminal: string, space: string, key: string) => {
      const replacement = replacements.get(key);
      if (!replacement) return match;
      const top =
        replacement.terminalBaseline === undefined
          ? terminal
          : terminal.replace(
              /\by="[^"]+"/u,
              `y="${n(replacement.terminalBaseline)}"`,
            );
      return top + space + replacement.labels;
    },
  );
}
