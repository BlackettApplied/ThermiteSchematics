import { prepareWiringDrawing, type WiringViewRequest } from "./wiring.js";
import {
  circuitFunctionAppearances,
  circuitTextLines,
  prepareCircuitView,
  type CircuitViewRequest,
} from "./circuit.js";
import {
  prepareCommunicationDrawing,
  type CommunicationViewRequest,
} from "./communication.js";
import {
  prepareConnectorAssemblyDrawing,
  type ConnectorAssemblyViewRequest,
} from "./connector-assembly.js";
import {
  prepareSignalLoopDrawing,
  type SignalLoopViewRequest,
} from "./signal-loop.js";
import { PACKET_VIEWER_SCRIPT } from "./packet-viewer.js";
import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import {
  buildDocumentation,
  type DocumentationRequest,
  type DocumentationTable,
  buildCableSchedule,
  createQueryEngine,
} from "@thermite/query";
import type { InvalidSheetError } from "./errors.js";
import { prepareSchematicDrawing } from "./renderer.js";
import { OUTER_SVG_PADDING } from "./symbols/catalog.js";
import { emitSchematicSvg } from "./svg/emitter.js";
import {
  escapeXmlAttribute as attr,
  escapeXmlText as xml,
  preflightTitleRenderText,
} from "./svg/escape.js";
import {
  prepareSchematicTitleContext,
  type SchematicTitleContext,
} from "./title-block.js";
import {
  LAYOUT_CONFIG_VERSION,
  type NormalizedSchematicView,
  type RenderOutcome,
  type SchematicViewRequest,
} from "./types.js";
import { normalizeSchematicView } from "./view-spec.js";

export interface PageSettings {
  readonly size?: "letter" | "tabloid" | "a4" | "a3";
  readonly orientation?: "landscape" | "portrait";
  readonly marginMm?: number;
}
export interface PaperPage {
  readonly size: NonNullable<PageSettings["size"]>;
  readonly orientation: NonNullable<PageSettings["orientation"]>;
  readonly marginMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}
export interface SchematicPacketRequest {
  readonly format: "schematic-packet-request/0.1";
  readonly page?: PageSettings;
  readonly views: readonly (
    | SchematicViewRequest
    | DocumentationRequest
    | CommunicationViewRequest
    | ConnectorAssemblyViewRequest
    | SignalLoopViewRequest
    | WiringViewRequest
    | CircuitViewRequest
  )[];
  readonly index?: boolean;
  readonly layout?: "standard" | "compact";
}
export interface SheetReference {
  readonly deviceUid: string;
  readonly designation: string;
  readonly functions: readonly string[];
  readonly zone: string;
  readonly xMm?: number;
  readonly yMm?: number;
}
export interface NormalizedDocumentationView {
  readonly format: "documentation-view/0.1";
  readonly kind:
    | DocumentationTable["kind"]
    | "communication"
    | "connector-assembly"
    | "signal-loop"
    | "wiring"
    | "circuit";
  readonly title: string;
}
export interface RenderedSheet {
  readonly number: number;
  readonly view: NormalizedSchematicView | NormalizedDocumentationView;
  readonly references: readonly SheetReference[];
  readonly svg: string;
  readonly continuations: readonly {
    readonly id: string;
    readonly toSheet: number;
    readonly conductor: string;
    readonly netId: string;
  }[];
}
export interface RenderedPacket {
  readonly format: "schematic-packet/0.1";
  readonly page: PaperPage;
  readonly sheets: readonly RenderedSheet[];
  readonly html: string;
}
interface Link {
  id: string;
  to: number;
  conductor: string;
  netId: string;
  x: number;
  y: number;
  side: "left" | "right" | "top" | "bottom";
}
interface Draft {
  view: NormalizedSchematicView | NormalizedDocumentationView;
  references?: SheetReference[];
  drawingBounds?: ReturnType<typeof bounds>;
  title: SchematicTitleContext;
  content: string;
  links: Link[];
  note: string;
  communicationHeight?: number;
}
const PAPERS = {
  letter: [215.9, 279.4],
  tabloid: [279.4, 431.8],
  a4: [210, 297],
  a3: [297, 420],
} as const;
const n = (value: number): string => String(Number(value.toFixed(3)));
function failure(
  reason: InvalidSheetError["reason"],
  message: string,
): RenderOutcome<never> {
  return {
    ok: false,
    error: { code: "R006", root: "packet", reason, message },
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
export function normalizePaperPage(
  input: unknown = {},
): RenderOutcome<PaperPage> {
  if (
    !record(input) ||
    Object.keys(input).some(
      (key) => !["size", "orientation", "marginMm"].includes(key),
    )
  )
    return failure(
      "invalid-page",
      "Page must contain only size, orientation and marginMm.",
    );
  const size = input.size ?? "tabloid";
  const orientation = input.orientation ?? "landscape";
  const marginMm = input.marginMm ?? 10;
  if (
    typeof size !== "string" ||
    !Object.hasOwn(PAPERS, size) ||
    !["landscape", "portrait"].includes(String(orientation)) ||
    typeof orientation !== "string" ||
    typeof marginMm !== "number" ||
    !Number.isFinite(marginMm) ||
    marginMm < 5 ||
    marginMm > 25 ||
    Object.values(input).some((value) => value === null || value === undefined)
  )
    return failure(
      "invalid-page",
      "Use letter, tabloid, a4 or a3; landscape or portrait; and a margin from 5 to 25 mm.",
    );
  const [short, long] = PAPERS[size as PaperPage["size"]];
  return {
    ok: true,
    value: {
      size: size as PaperPage["size"],
      orientation: orientation as PaperPage["orientation"],
      marginMm,
      widthMm: orientation === "landscape" ? long : short,
      heightMm: orientation === "landscape" ? short : long,
    },
  };
}
function text(
  x: number,
  y: number,
  value: string,
  size = 2.8,
  anchor = "start",
  weight = 400,
): string {
  return `<text x="${n(x)}" y="${n(y)}" font-family="Arial, Helvetica, sans-serif" font-size="${n(size)}" text-anchor="${anchor}" font-weight="${weight}" fill="#18212b">${xml(value)}</text>`;
}
function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  extra = "",
): string {
  return `<path d="M ${n(x1)} ${n(y1)} L ${n(x2)} ${n(y2)}" fill="none" stroke="#344054" stroke-width="0.3" ${extra}/>`;
}
function wrap(value: string, max: number): string[] {
  const result: string[] = [];
  let current = "";
  for (const char of value) {
    if ([...current].length >= max) {
      result.push(current);
      current = "";
    }
    current += char;
  }
  result.push(current);
  return result;
}
/** Prefer whitespace breaks in reports; split only a token wider than its column. */
function wrapReport(value: string, max: number): string[] {
  const remaining = [...value],
    rows: string[] = [];
  while (remaining.length > max) {
    let cut = max;
    while (cut > 0 && !/\s/u.test(remaining[cut]!)) cut--;
    if (cut === 0) cut = max;
    rows.push(remaining.splice(0, cut).join(""));
    if (remaining[0] === " ") remaining.shift();
  }
  rows.push(remaining.join(""));
  return rows;
}
function titleHeight(title: SchematicTitleContext, page: PaperPage): number {
  const custom = title.lines.filter(
    (entry) => entry.field === "title.authored-line",
  );
  const max = Math.floor((page.widthMm - 2 * page.marginMm - 76) / 1.6);
  const view =
    title.lines.find((entry) => entry.field === "title.view-line")?.value ?? "";
  if (
    title.lines.some(
      (entry) =>
        ["circuit", "connector-assembly"].includes(entry.ownerId) &&
        entry.field === "title.view-line",
    )
  ) {
    const width = page.widthMm - 2 * page.marginMm - 76;
    return Math.max(
      28,
      14 +
        (circuitTextLines(title.projectName, width, 3.2).length +
          circuitTextLines(view, width, 2.7).length +
          custom.flatMap((entry) => circuitTextLines(entry.value, width, 2.5))
            .length) *
          4,
    );
  }
  return Math.max(
    28,
    14 +
      (wrap(title.projectName, max).length +
        wrap(view, max).length +
        custom.flatMap((entry) => wrap(entry.value, max)).length) *
        4,
  );
}
function bounds(title: SchematicTitleContext, page: PaperPage) {
  const m = page.marginMm;
  return {
    x: m + 18,
    y: m + 21,
    w: page.widthMm - 2 * m - 36,
    h: page.heightMm - 2 * m - titleHeight(title, page) - 35,
  };
}
export function sheetLabel(view: RenderedSheet["view"]): string {
  if (view.format === "documentation-view/0.1") return view.title;
  return `${view.root.designation} / ${view.format === "schematic-view/0.1" ? view.family : view.intent === "trace" ? `trace to ${view.target.designation}` : view.intent}`;
}
function zone(x: number, y: number, b: ReturnType<typeof bounds>): string {
  return `${"ABCD"[Math.max(0, Math.min(3, Math.floor(((y - b.y) / b.h) * 4)))]}${1 + Math.max(0, Math.min(5, Math.floor(((x - b.x) / b.w) * 6)))}`;
}
function frame(
  draft: Draft,
  page: PaperPage,
  number: number,
  total: number,
): string {
  const m = page.marginMm,
    w = page.widthMm - 2 * m,
    bottom = page.heightMm - m;
  const titleTop = bottom - titleHeight(draft.title, page);
  const label = sheetLabel(draft.view);
  const prefix = `sheet-${number}-`;
  // Text is XML-escaped by the emitter. Scope rewriting to real tag attributes
  // so a designation containing id="..." or url(#...) remains verbatim.
  const content = draft.content.replace(/<[^>]+>/g, (tag) =>
    tag
      .replace(/(?<=\s)id="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
      .replace(
        /(?<=\s)clip-path="url\(#([^)]+)\)"/g,
        (_, id: string) => `clip-path="url(#${prefix}${id})"`,
      ),
  );
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.widthMm)}mm" height="${n(page.heightMm)}mm" viewBox="0 0 ${n(page.widthMm)} ${n(page.heightMm)}" role="img" aria-label="${attr(`${label}, sheet ${number} of ${total}`)}" data-sheet="${number}" data-total-sheets="${total}" data-paper="${page.size}">`,
    `<title>${xml(label)} - Sheet ${number} of ${total}</title>`,
    `<rect width="${n(page.widthMm)}" height="${n(page.heightMm)}" fill="white"/>`,
    `<rect x="${n(m)}" y="${n(m)}" width="${n(w)}" height="${n(bottom - m)}" fill="none" stroke="#344054" stroke-width="0.4"/>`,
    text(m + 4, m + 5, "THERMITE  /  ELECTRICAL", 2.6, "start", 700),
    text(
      page.widthMm - m - 4,
      m + 5,
      `SHEET ${String(number).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      2.6,
      "end",
    ),
    line(m, m + 8, page.widthMm - m, m + 8),
    content,
  ];
  const area = draft.drawingBounds ?? bounds(draft.title, page);
  for (let col = 0; col < 6; col++)
    out.push(
      text(
        area.x + (area.w * (col + 0.5)) / 6,
        m + 12,
        String(col + 1),
        2.2,
        "middle",
      ),
    );
  for (let row = 0; row < 4; row++)
    out.push(
      text(m + 3, area.y + (area.h * (row + 0.5)) / 4, "ABCD"[row]!, 2.2),
    );
  for (const link of draft.links) {
    out.push(
      `<a href="#sheet-${link.to}" aria-label="Continue on sheet ${link.to}">`,
    );
    const label = `${link.id} / ${String(link.to).padStart(2, "0")}`;
    if (link.side === "left" || link.side === "right") {
      const sign = link.side === "left" ? -1 : 1;
      out.push(
        line(link.x, link.y, link.x + sign * 2, link.y),
        text(
          link.x + sign * 3,
          link.y + 0.8,
          label,
          2.2,
          sign < 0 ? "end" : "start",
        ),
      );
    } else {
      const sign = link.side === "top" ? -1 : 1;
      out.push(
        line(link.x, link.y, link.x, link.y + sign * 2),
        text(link.x, link.y + sign * 4, label, 2.2, "middle"),
      );
    }
    out.push("</a>");
  }
  out.push(
    line(m, titleTop, page.widthMm - m, titleTop),
    line(page.widthMm - m - 66, titleTop, page.widthMm - m - 66, bottom),
  );
  const max = Math.floor((w - 76) / 1.6);
  const circuit =
    draft.view.format === "documentation-view/0.1" &&
    ["circuit", "connector-assembly"].includes(draft.view.kind);
  let y = titleTop + 5;
  for (const row of circuit
    ? circuitTextLines(draft.title.projectName, w - 76, 3.2)
    : wrap(draft.title.projectName, max)) {
    out.push(text(m + 4, y, row, 3.2, "start", 700));
    y += 4;
  }
  for (const row of circuit
    ? circuitTextLines(label, w - 76, 2.7)
    : wrap(label, max)) {
    out.push(text(m + 4, y, row));
    y += 4;
  }
  for (const entry of draft.title.lines.filter(
    (entry) => entry.field === "title.authored-line",
  )) {
    for (const row of circuit
      ? circuitTextLines(entry.value, w - 76, 2.5)
      : wrap(entry.value, max)) {
      out.push(text(m + 4, y, row, 2.5));
      y += 4;
    }
  }
  out.push(text(m + 4, bottom - 3, draft.note, 2.2));
  const revisionRows = circuit
    ? circuitTextLines(`REV ${draft.title.revision}`, 58, 2.6)
    : wrap(`REV ${draft.title.revision}`, 34);
  if (revisionRows.length > 3)
    throw new Error(
      "Revision is too long for the sheet title block; use at most 96 characters.",
    );
  revisionRows.forEach((row, index) =>
    out.push(
      text(
        page.widthMm - m - 62,
        titleTop + 5 + index * 3,
        row,
        2.6,
        "start",
        700,
      ),
    ),
  );
  out.push(
    text(
      page.widthMm - m - 62,
      bottom - 10,
      `${page.size.toUpperCase()} / ${page.orientation.toUpperCase()}`,
      2.4,
    ),
    text(page.widthMm - m - 62, bottom - 6, "Thermite 0.3.0-alpha.2", 2.4),
    text(
      page.widthMm - m - 62,
      bottom - 2.5,
      `SHEET ${number} OF ${total}`,
      2.4,
    ),
    "</svg>",
  );
  return out.join("\n") + "\n";
}
interface Interval {
  start: number;
  end: number;
}
/** Cuts only in whitespace between indivisible devices, rails and labels. */
function cuts(
  length: number,
  capacity: number,
  protectedIntervals: Interval[],
): number[] | null {
  const result = [0];
  const intervals = protectedIntervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end)
      last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  while (length - result.at(-1)! > capacity + 0.001) {
    const start = result.at(-1)!;
    let cut = start + capacity;
    for (let i = merged.length - 1; i >= 0; i--) {
      const interval = merged[i]!;
      if (cut > interval.start && cut < interval.end) cut = interval.start;
    }
    if (cut - start < capacity * 0.2 || result.length >= 40) return null;
    result.push(cut);
  }
  result.push(length);
  return result;
}
async function drawingDraftsCandidate(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  spacingProfile?: "compact" | "dense",
): Promise<RenderOutcome<Draft[]>> {
  const prepared = await prepareSchematicDrawing(
    ir,
    request,
    presentation,
    spacingProfile ? { spacingProfile } : {},
  );
  if (!prepared.ok) return prepared;
  const { graph, layout, titleContext: title, view } = prepared.value;
  let b = bounds(title, page);
  // Separate the zone row, continued cabinet caption and top conductor links.
  b = { ...b, y: b.y + 4, h: b.h - 4 };
  const pad = OUTER_SVG_PADDING;
  // A proven single-sheet candidate needs no side gutters for continuation arrows.
  const fullWidth = page.widthMm - 2 * page.marginMm - 10;
  if (
    spacingProfile &&
    (layout.width + 2 * pad) * 0.25 <= fullWidth &&
    (layout.height + 2 * pad) * 0.25 <= b.h
  )
    b = { ...b, x: page.marginMm + 5, w: fullWidth };
  if (b.w < 60 || b.h < 50)
    return failure(
      "unprintable-layout",
      "Title information leaves insufficient drawing space. Shorten title lines or use a larger sheet.",
    );
  const fullW = layout.width + 2 * pad,
    fullH = layout.height + 2 * pad;
  const scale = Math.max(0.25, Math.min(0.32, b.w / fullW, b.h / fullH));
  const protectedX: Interval[] = [],
    protectedY: Interval[] = [];
  for (const item of [
    ...layout.nodes.filter((node) => node.kind !== "location"),
    ...layout.labels,
  ]) {
    protectedX.push({
      start: item.x + pad - 12,
      end: item.x + item.width + pad + 12,
    });
    protectedY.push({
      start: item.y + pad - 12,
      end: item.y + item.height + pad + 12,
    });
  }
  // Avoid routing bends and collinear cuts as well as symbols.
  for (const edge of layout.edges)
    for (const point of edge.points) {
      protectedX.push({ start: point.x + pad - 6, end: point.x + pad + 6 });
      protectedY.push({ start: point.y + pad - 6, end: point.y + pad + 6 });
    }
  const xs = cuts(fullW, b.w / scale, protectedX),
    ys = cuts(fullH, b.h / scale, protectedY);
  if (!xs || !ys || (xs.length - 1) * (ys.length - 1) > 80)
    return failure(
      "unprintable-layout",
      "This view cannot be split without cutting a device or label at readable print size. Use a larger page, change flow, or select a narrower view.",
    );
  const emitted = emitSchematicSvg(graph, layout, title, undefined, true);
  if (!emitted.ok) return emitted;
  const inner = emitted.value
    .replace(/^<\?xml[^>]*>\s*/, "")
    .replace(/^<svg[^>]*>\s*/, "")
    .replace(/<\/svg>\s*$/, "");
  const drafts: Draft[] = [];
  const nx = xs.length - 1,
    ny = ys.length - 1;
  for (let row = 0; row < ny; row++)
    for (let col = 0; col < nx; col++) {
      const width = (xs[col + 1]! - xs[col]!) * scale,
        height = (ys[row + 1]! - ys[row]!) * scale;
      const continued = graph.locationGroups
        .filter((group) => {
          const box = layout.nodes.find((node) => node.id === group.id)!;
          const label = layout.labels.find(
            (label) => label.id === group.label.id,
          )!;
          const intersects =
            box.x + pad < xs[col + 1]! &&
            box.x + box.width + pad > xs[col]! &&
            box.y + pad < ys[row + 1]! &&
            box.y + box.height + pad > ys[row]!;
          const labelVisible =
            label.x + pad >= xs[col]! &&
            label.x + label.width + pad <= xs[col + 1]! &&
            label.y + pad >= ys[row]! &&
            label.y + label.height + pad <= ys[row + 1]!;
          return intersects && !labelVisible;
        })
        .map((group) => group.label.text);
      const caption = continued.length
        ? `CONTINUED LOCATION: ${continued.join(" / ")}`
        : "";
      if ([...caption].length * 1.4 > b.w)
        return failure(
          "unprintable-layout",
          "Continued cabinet labels exceed this sheet's header width. Use shorter location names or a larger page.",
        );
      drafts.push({
        view,
        title,
        links: [],
        drawingBounds: b,
        references: graph.nodes.flatMap((node) => {
          if (!("deviceUid" in node)) return [];
          const box = layout.nodes.find((n) => n.id === node.id)!;
          const cx = box.x + box.width / 2 + pad,
            cy = box.y + box.height / 2 + pad;
          if (
            cx < xs[col]! ||
            cx >= xs[col + 1]! ||
            cy < ys[row]! ||
            cy >= ys[row + 1]!
          )
            return [];
          return [
            {
              deviceUid: node.deviceUid,
              designation: node.designation,
              functions: node.functionIds.map((f) => f.functionKey),
              xMm: b.x + (cx - xs[col]!) * scale,
              yMm: b.y + (cy - ys[row]!) * scale,
              zone: zone(
                b.x + (cx - xs[col]!) * scale,
                b.y + (cy - ys[row]!) * scale,
                b,
              ),
            },
          ];
        }),
        note: `Layout: ${spacingProfile ?? "standard"}. Drawing scale: ${n(scale)} mm/unit. Continuations: reference / destination sheet.`,
        content:
          `<svg data-layout-config-version="${LAYOUT_CONFIG_VERSION}" x="${n(b.x)}" y="${n(b.y)}" width="${n(width)}" height="${n(height)}" viewBox="${n(xs[col]!)} ${n(ys[row]!)} ${n(width / scale)} ${n(height / scale)}" overflow="hidden">${inner}</svg>` +
          (caption ? text(b.x, b.y - 9, caption, 2.5) : ""),
      });
    }
  let serial = 0;
  for (const edge of layout.edges) {
    const semantic = graph.edges.find(({ id }) => id === edge.id)!;
    const conductor =
      semantic.label?.text ?? semantic.netLabel?.text ?? edge.netId;
    for (let j = 1; j < edge.points.length; j++) {
      const p = edge.points[j - 1]!,
        q = edge.points[j]!;
      for (let col = 1; col < nx; col++) {
        const x = xs[col]! - pad;
        if (p.y !== q.y || x <= Math.min(p.x, q.x) || x >= Math.max(p.x, q.x))
          continue;
        const row = ys.findIndex(
          (start, index) =>
            index < ny && p.y + pad >= start && p.y + pad < ys[index + 1]!,
        );
        if (row < 0) continue;
        const left = row * nx + col - 1,
          right = left + 1,
          id = `C${String(++serial).padStart(3, "0")}`;
        const y = b.y + (p.y + pad - ys[row]!) * scale;
        drafts[left]!.links.push({
          id,
          conductor,
          netId: edge.netId,
          to: right + 1,
          x: b.x + (xs[col]! - xs[col - 1]!) * scale,
          y,
          side: "right",
        });
        drafts[right]!.links.push({
          id,
          conductor,
          netId: edge.netId,
          to: left + 1,
          x: b.x,
          y,
          side: "left",
        });
      }
      for (let row = 1; row < ny; row++) {
        const y = ys[row]! - pad;
        if (p.x !== q.x || y <= Math.min(p.y, q.y) || y >= Math.max(p.y, q.y))
          continue;
        const col = xs.findIndex(
          (start, index) =>
            index < nx && p.x + pad >= start && p.x + pad < xs[index + 1]!,
        );
        if (col < 0) continue;
        const top = (row - 1) * nx + col,
          bottom = top + nx,
          id = `C${String(++serial).padStart(3, "0")}`;
        const x = b.x + (p.x + pad - xs[col]!) * scale;
        drafts[top]!.links.push({
          id,
          conductor,
          netId: edge.netId,
          to: bottom + 1,
          x,
          y: b.y + (ys[row]! - ys[row - 1]!) * scale,
          side: "bottom",
        });
        drafts[bottom]!.links.push({
          id,
          conductor,
          netId: edge.netId,
          to: top + 1,
          x,
          y: b.y,
          side: "top",
        });
      }
    }
  }
  for (const draft of drafts)
    for (let i = 0; i < draft.links.length; i++)
      for (const other of draft.links.slice(i + 1)) {
        const link = draft.links[i]!;
        if (
          link.side === other.side &&
          (link.side === "left" || link.side === "right"
            ? Math.abs(link.y - other.y) < 3
            : Math.abs(link.x - other.x) < 18)
        )
          return failure(
            "unprintable-layout",
            "Continuation labels are too close to print clearly. Change flow, use a larger sheet, or narrow the view.",
          );
      }
  // Fold horizontal continuations into stacked sections when their actual visible
  // bounds fit on one sheet. ELK geometry and conductor endpoints stay untouched.
  if (spacingProfile && ny === 1 && nx > 1) {
    const untrimmed = structuredClone(drafts);
    const heights: number[] = [];
    for (let col = 0; col < nx; col++) {
      const x0 = xs[col]! - pad,
        x1 = xs[col + 1]! - pad;
      const spans: { y: number; h: number }[] = [];
      for (const box of [...layout.nodes, ...layout.labels]) {
        if (box.x < x1 && box.x + box.width > x0)
          spans.push({ y: box.y, h: box.height });
      }
      for (const edge of layout.edges)
        for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1]!,
            z = edge.points[i]!;
          if (Math.max(a.x, z.x) >= x0 && Math.min(a.x, z.x) <= x1)
            spans.push({ y: Math.min(a.y, z.y), h: Math.abs(a.y - z.y) });
        }
      const start = Math.max(0, Math.min(...spans.map((s) => s.y)) + pad - 12);
      const end = Math.min(
        fullH,
        Math.max(...spans.map((s) => s.y + s.h)) + pad + 12,
      );
      const h = (end - start) * scale,
        draft = drafts[col]!;
      heights.push(h);
      // Only the first viewport belongs to this section; text/metadata is unchanged.
      draft.content = draft.content.replace(/<svg\b[^>]*>/u, (tag) =>
        tag
          .replace(/\bheight="[^"]*"/u, `height="${n(h)}"`)
          .replace(
            /\bviewBox="[^"]*"/u,
            `viewBox="${n(xs[col]!)} ${n(start)} ${n(xs[col + 1]! - xs[col]!)} ${n(end - start)}"`,
          ),
      );
      draft.links = draft.links.map((link) => ({
        ...link,
        y: link.y - start * scale,
      }));
      if (draft.references)
        draft.references = draft.references.map((r) => ({
          ...r,
          ...(r.yMm === undefined ? {} : { yMm: r.yMm - start * scale }),
        }));
    }
    const groups: number[][] = [];
    let used = 0;
    heights.forEach((h, i) => {
      if (!groups.length || used + h + 14 > b.h) {
        groups.push([i]);
        used = h;
      } else {
        groups.at(-1)!.push(i);
        used += 14 + h;
      }
    });
    if (groups.length < drafts.length) {
      const destinations = new Map(
        groups.flatMap((group, index) =>
          group.map((i) => [i + 1, index + 1] as const),
        ),
      );
      const folded = groups.map((group) => {
        const draft: Draft = {
          ...drafts[group[0]!]!,
          content: "",
          links: [],
          references: [],
          note: "Folded circuit sections; follow paired conductor references.",
          drawingBounds: b,
        };
        let offset = 0;
        for (const i of group) {
          const source = drafts[i]!;
          const scoped = source.content.replace(/<[^>]+>/gu, (tag) =>
            tag
              .replace(
                /(?<=\s)id="([^"]+)"/gu,
                (_, id: string) => `id="section-${i}-${id}"`,
              )
              .replace(
                /(?<=\s)clip-path="url\(#([^)]+)\)"/gu,
                (_, id: string) => `clip-path="url(#section-${i}-${id})"`,
              ),
          );
          draft.content += `<g transform="translate(0 ${n(offset)})">${scoped}</g>`;
          draft.links.push(
            ...source.links.map((link) => ({
              ...link,
              to: destinations.get(link.to)!,
              y: link.y + offset,
            })),
          );
          draft.references!.push(
            ...(source.references ?? []).map((r) => ({
              ...r,
              ...(r.yMm === undefined ? {} : { yMm: r.yMm + offset }),
              zone:
                r.xMm === undefined || r.yMm === undefined
                  ? r.zone
                  : zone(r.xMm, r.yMm + offset, b),
            })),
          );
          offset += heights[i]! + 14;
        }
        return draft;
      });
      return { ok: true, value: folded };
    }
    // If packing is not possible, keep the untrimmed draft geometry/references.
    return { ok: true, value: untrimmed };
  }
  return { ok: true, value: drafts };
}

/** At most three validated ELK candidates; never shrink symbols or alter flow. */
async function drawingDrafts(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  mode: "standard" | "compact" = "standard",
): Promise<RenderOutcome<Draft[]>> {
  let best = await drawingDraftsCandidate(ir, request, presentation, page);
  if (mode === "standard" || (best.ok && best.value.length === 1)) return best;
  if (!best.ok && best.error.code !== "R006") return best;
  for (const profile of ["compact", "dense"] as const) {
    const candidate = await drawingDraftsCandidate(
      ir,
      request,
      presentation,
      page,
      profile,
    );
    if (
      candidate.ok &&
      (!best.ok ||
        candidate.value.length < best.value.length ||
        (candidate.value.length === best.value.length &&
          candidate.value.reduce((n, d) => n + d.links.length, 0) <
            best.value.reduce((n, d) => n + d.links.length, 0)))
    )
      best = candidate;
    if (best.ok && best.value.length === 1) break;
  }
  return best;
}

async function cableDrafts(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): Promise<RenderOutcome<Draft[]>> {
  const normalized = normalizeSchematicView(ir, request);
  if (!normalized.ok) return normalized;
  const view = normalized.value.view;
  if (view.format !== "schematic-view/0.2" || view.intent !== "conductors")
    throw new Error("Expected a cable view.");
  const queried = createQueryEngine(ir).cable(request.root);
  if (!queried.ok) return queried;
  const schedule = buildCableSchedule(ir, view.root.cableUid);
  const preparedTitle = prepareSchematicTitleContext(
    ir.project.name,
    view,
    presentation,
  );
  if (!preparedTitle.ok) return preparedTitle;
  const title = preparedTitle.value,
    b = bounds(title, page);
  const sources = schedule.cores
    .flatMap((core) => [
      core.id,
      core.color,
      core.size ?? "",
      ...core.endpoints.flatMap((end) =>
        end === null ? [] : [end.display, end.location ?? ""],
      ),
    ])
    .concat(
      schedule.fromLocation ?? "",
      schedule.toLocation ?? "",
      schedule.typeId,
    );
  const preflight = preflightTitleRenderText(
    view,
    sources.map((value) => ({
      ownerKind: "cable",
      ownerId: schedule.cableUid,
      field: "title.authored-line",
      value,
    })),
  );
  if (!preflight.ok) return preflight;
  const left = b.x,
    right = b.x + b.w,
    jacketL = left + b.w * 0.35,
    jacketR = right - b.w * 0.35;
  const maxEnd = Math.floor((jacketL - left - 8) / 1.55);
  if (maxEnd < 12 || sources.some((value) => [...value].length > 160))
    return failure(
      "unprintable-layout",
      "Cable labels exceed the supported print width. Shorten labels or use a larger page.",
    );
  const drafts: Draft[] = [];
  let content: string[] = [],
    refs: SheetReference[] = [],
    y = b.y,
    first = 0;
  function header() {
    refs = [];
    content = [
      text(left, b.y + 4, `CABLE ${schedule.designation}`, 4, "start", 700),
      text(left, b.y + 10, schedule.typeId, 2.6),
      text(
        left,
        b.y + 16,
        `${schedule.counts.total} cores / ${schedule.counts.spare} spare / ${schedule.counts.unassigned} unassigned`,
        2.6,
      ),
    ];
    const a = schedule.fromLocation ?? "END A",
      z = schedule.toLocation ?? "END B";
    if (
      a.length > maxEnd ||
      z.length > maxEnd ||
      schedule.typeId.length * 1.5 > b.w
    )
      return false;
    content.push(
      text(left, b.y + 25, a, 3, "start", 700),
      text(right, b.y + 25, z, 3, "end", 700),
    );
    y = b.y + 33;
    return true;
  }
  function finish(last: number) {
    const jacket = `<rect x="${n(jacketL)}" y="${n(b.y + 29)}" width="${n(jacketR - jacketL)}" height="${n(y - b.y - 24)}" rx="3" fill="none" stroke="#667085" stroke-width="0.45" stroke-dasharray="2 1"/>`;
    content.push(
      jacket,
      text(
        left,
        y + 13,
        "Solid: assigned   Dashed: spare   X: unterminated   ?: unassigned",
        2.5,
      ),
      text(
        left,
        y + 18,
        schedule.shield === true
          ? "Shielded construction; shield terminations are not specified by this view."
          : "Shield termination is not inferred from cable construction.",
        2.5,
      ),
    );
    drafts.push({
      view,
      title,
      content: content.join("\n"),
      links: [],
      references: refs,
      note: `Core inventory ${first + 1}-${last} of ${schedule.cores.length}. ${schedule.endOrder === "canonical" ? "Legacy endpoints shown in canonical order." : "End A/B follows authored endpoint order."}`,
    });
  }
  if (!header())
    return failure(
      "unprintable-layout",
      "Cable cabinet or type labels are too long for this page.",
    );
  for (let i = 0; i < schedule.cores.length; i++) {
    const core = schedule.cores[i]!;
    const leftEnd = core.endpoints[0],
      rightEnd = core.endpoints[1];
    const a =
      leftEnd === null
        ? [core.status === "unassigned" ? "? UNASSIGNED" : "X UNTERMINATED"]
        : wrap(leftEnd.display, maxEnd);
    const z =
      rightEnd === null
        ? [core.status === "unassigned" ? "? UNASSIGNED" : "X UNTERMINATED"]
        : wrap(rightEnd.display, maxEnd);
    const center = `${core.id} / ${core.color}${core.size ? ` / ${core.size}` : ""}`;
    const centerRows = wrap(center, Math.floor((jacketR - jacketL - 6) / 1.5));
    const height = Math.max(
      19,
      Math.max(a.length, z.length, centerRows.length) * 4 + 12,
    );
    if (y + height + 24 > b.y + b.h) {
      if (i === first)
        return failure(
          "unprintable-layout",
          "A cable core row cannot fit on this page. Shorten labels or use a larger page.",
        );
      finish(i);
      first = i;
      header();
    }
    const midY = y + Math.max(a.length, z.length, centerRows.length) * 4 + 1;
    const dashed = core.usage === "spare" || core.status === "unassigned";
    content.push(
      `<g data-cable-uid="${attr(schedule.cableUid)}" data-conductor-id="${attr(core.id)}" data-usage="${core.usage}" data-status="${core.status}">`,
      line(
        left + 1,
        midY,
        right - 1,
        midY,
        dashed ? 'stroke-dasharray="2 1"' : "",
      ),
    );
    a.forEach((row, index) =>
      content.push(text(left, y + index * 4 + 4, row, 2.7)),
    );
    z.forEach((row, index) =>
      content.push(text(right, y + index * 4 + 4, row, 2.7, "end")),
    );
    centerRows.forEach((row, index) =>
      content.push(
        text((left + right) / 2, y + index * 4 + 3, row, 2.6, "middle"),
      ),
    );
    content.push(
      text(
        (left + right) / 2,
        midY + 4,
        core.usage === "unspecified"
          ? "ASSIGNED / USAGE UNSPECIFIED"
          : core.usage.toUpperCase(),
        2.2,
        "middle",
      ),
    );
    for (const [end, x] of [
      [leftEnd, left + 1],
      [rightEnd, right - 1],
    ] as const) {
      if (end === null)
        content.push(
          line(x - 1, midY - 1, x + 1, midY + 1),
          line(x - 1, midY + 1, x + 1, midY - 1),
        );
      else {
        refs.push({
          deviceUid: end.terminal.deviceUid,
          designation: ir.devices.find((d) => d.uid === end.terminal.deviceUid)!
            .designation,
          functions: [],
          zone: zone(x, midY, b),
        });
        content.push(
          `<circle cx="${n(x)}" cy="${n(midY)}" r="0.8" fill="white" stroke="#344054" stroke-width="0.3"/>`,
        );
      }
    }
    content.push("</g>");
    y += height;
  }
  finish(schedule.cores.length);
  return { ok: true, value: drafts };
}
async function topologyDrafts(
  ir: Readonly<ElectricalIr>,
  request:
    | CommunicationViewRequest
    | ConnectorAssemblyViewRequest
    | SignalLoopViewRequest
    | WiringViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): Promise<RenderOutcome<Draft[]>> {
  try {
    const wiring = request.format === "wiring-view-request/0.1";
    const signalLoop = request.format === "signal-loop-view-request/0.1";
    const assembly = request.format === "connector-assembly-view-request/0.1";
    const drawing = wiring
      ? await prepareWiringDrawing(ir, request)
      : signalLoop
        ? await prepareSignalLoopDrawing(ir, request)
        : assembly
          ? await prepareConnectorAssemblyDrawing(ir, request)
          : await prepareCommunicationDrawing(ir, request);
    const title: SchematicTitleContext = {
      projectName: ir.project.name,
      revision: presentation?.revision ?? "UNSPECIFIED",
      backgroundColor: "#ffffff",
      toolVersion: "0.3.0-alpha.2",
      lines: [
        {
          ownerKind: "view",
          ownerId: wiring
            ? "wiring"
            : signalLoop
              ? "signal-loop"
              : assembly
                ? "connector-assembly"
                : "communication",
          field: "title.view-line",
          value: drawing.title,
        },
        ...(presentation?.titleBlockLines ?? []).map((value) => ({
          ownerKind: "presentation" as const,
          ownerId: "presentation",
          field: "title.authored-line" as const,
          value,
        })),
      ],
    };
    const b = bounds(title, page);
    const headingLines = assembly
      ? circuitTextLines(drawing.title, b.w, 4)
      : [drawing.title];
    const headingHeight = 9 + (headingLines.length - 1) * 4.8;
    const scale = Math.min(
      1,
      b.w / drawing.width,
      (b.h - headingHeight - 6) / drawing.height,
    );
    if (scale < 2.5 / 2.7 || !Number.isFinite(scale))
      return failure(
        "unprintable-layout",
        wiring
          ? "Wiring view cannot fit at readable text size. Select fewer conductors or larger paper."
          : signalLoop
            ? "Signal loop cannot fit at readable text size. Use larger paper or another flow."
            : assembly
              ? "Connector assembly view cannot fit at readable text size. Select fewer assemblies or larger paper; omitted ports remain identified."
              : "Communication view cannot fit at readable text size. Select fewer devices or larger paper; boundary links will remain visible.",
      );
    const x = b.x + (b.w - drawing.width * scale) / 2,
      y = b.y + headingHeight;
    const references = drawing.references.map((r) => ({
      deviceUid: r.deviceUid,
      designation: r.designation,
      functions: "functions" in r ? (r.functions as string[]) : [],
      zone: zone(x + r.x * scale, y + r.y * scale, b),
      xMm: x + r.x * scale,
      yMm: y + r.y * scale,
    }));
    const noteLines = drawing.note
      .split("\n")
      .flatMap((line) => wrapReport(line, Math.floor(b.w / 1.6)));
    const height =
      headingHeight + drawing.height * scale + 4 + noteLines.length * 3.5;
    if (height > b.h)
      return failure(
        "unprintable-layout",
        "Diagram notes exceed the sheet bounds.",
      );
    const note = noteLines
      .map((v, i) =>
        text(b.x, b.y + height - (noteLines.length - 1 - i) * 3.5, v, 2.5),
      )
      .join("\n");
    return {
      ok: true,
      value: [
        {
          view: {
            format: "documentation-view/0.1",
            kind: wiring
              ? "wiring"
              : signalLoop
                ? "signal-loop"
                : assembly
                  ? "connector-assembly"
                  : "communication",
            title: drawing.title,
          },
          title,
          drawingBounds: b,
          communicationHeight: height,
          references,
          links: [],
          note: wiring
            ? "Selected physical wiring - terminal details and other connections in schedules"
            : signalLoop
              ? "Field-device hookup - verify selected connector pinout before construction"
              : assembly
                ? "Connector assemblies only - unresolved pin mapping; no inferred electrical continuity"
                : "Port connections - see link schedule for protocol and status",
          content:
            headingLines
              .map((line, i) =>
                text(b.x, b.y + 3 + i * 4.8, line, 4, "start", 700),
              )
              .join("") +
            `<g transform="translate(${n(x)} ${n(y)}) scale(${n(scale)})">${drawing.content}</g>` +
            note,
        },
      ],
    };
  } catch (e) {
    return failure(
      "unprintable-layout",
      e instanceof Error ? e.message : "Topology view failed.",
    );
  }
}

async function circuitDrafts(
  ir: Readonly<ElectricalIr>,
  request: CircuitViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  appearances?: Map<string, string[]>,
): Promise<RenderOutcome<Draft[]>> {
  try {
    const prepared = await prepareCircuitView(ir, request, appearances);
    const title: SchematicTitleContext = {
      projectName: ir.project.name,
      revision: presentation?.revision ?? "UNSPECIFIED",
      backgroundColor: "#ffffff",
      toolVersion: "0.3.0-alpha.2",
      lines: [
        {
          ownerKind: "view",
          ownerId: "circuit",
          field: "title.view-line",
          value: prepared.title,
        },
        ...(presentation?.titleBlockLines ?? []).map((value) => ({
          ownerKind: "presentation" as const,
          ownerId: "presentation",
          field: "title.authored-line" as const,
          value,
        })),
      ],
    };
    const b = bounds(title, page);
    const notes = prepared.notes.flatMap((s) => circuitTextLines(s, b.w));
    const headingLines = circuitTextLines(prepared.title, b.w, 3.5),
      headerHeight = headingLines.length * 4.5 + 3;
    const available = b.h - headerHeight - 1;
    if (available < 35)
      return failure(
        "unprintable-layout",
        "Circuit notes leave insufficient readable drawing space.",
      );
    const gap = 8,
      columnWidth = (b.w - gap * (prepared.columns - 1)) / prepared.columns;
    const drafts: Draft[] = [];
    let column = 0,
      cursors = [0, 0];
    const newDraft = (): Draft => ({
      view: {
        format: "documentation-view/0.1",
        kind: "circuit",
        title: prepared.title,
      },
      title,
      drawingBounds: b,
      references: [],
      links: [],
      note: "Source-selected circuits · [+N]: connections outside group · device/function references in index",
      content: headingLines
        .map((s, i) => text(b.x, b.y + 3.5 + i * 4.5, s, 3.5, "start", 700))
        .join(""),
    });
    drafts.push(newDraft());
    for (const group of prepared.groups) {
      const spanning = group.width > columnWidth + 0.001;
      const width = spanning ? b.w : columnWidth;
      if (group.width > width + 0.001)
        return failure(
          "unprintable-layout",
          `Circuit ${group.id} needs ${n(group.width)} mm at readable size; select a narrower circuit group, another flow, or larger paper.`,
        );
      const heading = [
        group.lineReference ? `Ref. ${group.lineReference}` : undefined,
        group.label,
      ]
        .filter(Boolean)
        .join(" · ");
      const headings = circuitTextLines(heading, width, 2.7);
      const headHeight = headings.length * 3.5 + 1;
      const height = headHeight + group.height + 3;
      if (height > available)
        return failure(
          "unprintable-layout",
          `Circuit ${group.id} cannot fit as a complete group at readable size. Split its source selection into smaller circuit or channel groups.`,
        );
      let offset = spanning ? Math.max(...cursors) : cursors[column]!;
      if (offset + height > available) {
        if (
          !spanning &&
          column + 1 < prepared.columns &&
          cursors[column + 1]! + height <= available
        )
          column++;
        else {
          drafts.push(newDraft());
          column = 0;
          cursors = [0, 0];
        }
        offset = spanning ? Math.max(...cursors) : cursors[column]!;
      }
      const draft = drafts.at(-1)!;
      const x = b.x + (spanning ? 0 : column * (columnWidth + gap)),
        y = b.y + headerHeight + offset;
      draft.content +=
        headings
          .map((s, i) => text(x, y + 2.7 + i * 3.5, s, 2.7, "start", 700))
          .join("") +
        `<g transform="translate(${n(x)} ${n(y + headHeight)})">${group.content}</g>`;
      draft.references!.push(
        ...group.references.map((r) => ({
          deviceUid: r.deviceUid,
          designation: r.designation,
          functions: r.functions,
          xMm: x + r.x,
          yMm: y + headHeight + r.y,
          zone: zone(x + r.x, y + headHeight + r.y, b),
        })),
      );
      if (spanning) {
        cursors = [offset + height, offset + height];
        column = 0;
      } else cursors[column] = offset + height;
    }
    if (notes.length) {
      let printedNotes = notes,
        noteColumn = 0,
        noteOffset = Math.max(...cursors),
        noteHeight = 5 + notes.length * 3.5;
      if (noteOffset + noteHeight > available && prepared.columns === 2) {
        const narrow = prepared.notes.flatMap((s) =>
          circuitTextLines(s, columnWidth),
        );
        if (cursors[1]! + 5 + narrow.length * 3.5 <= available) {
          printedNotes = narrow;
          noteColumn = 1;
          noteOffset = cursors[1]!;
          noteHeight = 5 + narrow.length * 3.5;
        }
      }
      if (noteHeight > available)
        return failure(
          "unprintable-layout",
          "Circuit notes cannot fit at readable size; shorten the notes or use larger paper.",
        );
      if (noteOffset + noteHeight > available) {
        drafts.push(newDraft());
        noteColumn = 0;
        noteOffset = 0;
      }
      const x = b.x + noteColumn * (columnWidth + gap),
        y = b.y + headerHeight + noteOffset;
      drafts.at(-1)!.content +=
        text(x, y + 3, "View notes", 2.7, "start", 700) +
        printedNotes.map((s, i) => text(x, y + 7 + i * 3.5, s, 2.5)).join("");
    }
    return { ok: true, value: drafts };
  } catch (error) {
    return failure(
      "unprintable-layout",
      error instanceof Error ? error.message : "Circuit view failed.",
    );
  }
}

function documentationDrafts(
  ir: Readonly<ElectricalIr>,
  request: DocumentationRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): RenderOutcome<Draft[]> {
  try {
    return tableDrafts(ir, buildDocumentation(ir, request), presentation, page);
  } catch (e) {
    return failure(
      "invalid-packet",
      e instanceof Error ? e.message : "Invalid report.",
    );
  }
}
function tableDrafts(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): RenderOutcome<Draft[]> {
  const allText = [
    ir.project.name,
    presentation?.revision ?? "UNSPECIFIED",
    ...(presentation?.titleBlockLines ?? []),
    table.title,
    ...table.columns,
    ...table.notes,
    ...table.rows.flatMap((r) => r.cells),
  ];
  if (
    allText.some((t) =>
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(t),
    )
  )
    return failure(
      "unprintable-layout",
      "Report text contains characters that cannot be represented in XML.",
    );
  const view: NormalizedDocumentationView = {
    format: "documentation-view/0.1",
    kind: table.kind,
    title: table.title,
  };
  const title: SchematicTitleContext = {
    projectName: ir.project.name,
    revision: presentation?.revision ?? "UNSPECIFIED",
    backgroundColor: "#ffffff",
    toolVersion: "0.3.0-alpha.2",
    lines: [
      {
        ownerKind: "view",
        ownerId: "report",
        field: "title.view-line",
        value: table.title,
      },
      ...(presentation?.titleBlockLines ?? []).map((value) => ({
        ownerKind: "presentation" as const,
        ownerId: "presentation",
        field: "title.authored-line" as const,
        value,
      })),
    ],
  };
  const b = bounds(title, page),
    drafts: Draft[] = [];
  if (b.w < 60 || b.h < 50)
    return failure(
      "unprintable-layout",
      "Insufficient report area. Shorten title lines or select a larger sheet.",
    );
  const widthSum = table.widths.reduce((a, b) => a + b, 0),
    widths = table.widths.map((w) => (w / widthSum) * b.w);
  const limits = widths.map((w) => Math.max(1, Math.floor((w - 4) / 1.65)));
  const split = (cells: readonly string[]) =>
    cells.map((v, i) =>
      v.split(/\r?\n/u).flatMap((t) => wrapReport(t, limits[i]!)),
    );
  const header = split(table.columns),
    headerH = Math.max(...header.map((c) => c.length)) * 3.6 + 5;
  const notes = table.notes.flatMap((t) => wrap(t, Math.floor(b.w / 1.6)));
  const bottom = b.y + b.h - notes.length * 3.5 - 5;
  let content: string[] = [],
    refs: SheetReference[] = [],
    y = 0,
    first = 0;
  function row(cells: string[][], height: number, heading = false) {
    let x = b.x;
    cells.forEach((lines, i) => {
      content.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(widths[i]!)}" height="${n(height)}" fill="${heading ? "#e9eef4" : "white"}" stroke="#9ba6b4" stroke-width="0.2"/>`,
      );
      lines.forEach((v, j) =>
        content.push(
          text(x + 2, y + 4 + j * 3.6, v, 2.6, "start", heading ? 700 : 400),
        ),
      );
      x += widths[i]!;
    });
    y += height;
  }
  function start() {
    content = [text(b.x, b.y + 3, table.title, 4, "start", 700)];
    refs = [];
    y = b.y + 9;
    row(header, headerH, true);
  }
  function finish(end: number) {
    notes.forEach((v, i) =>
      content.push(text(b.x, b.y + b.h - (notes.length - 1 - i) * 3.5, v, 2.5)),
    );
    drafts.push({
      view,
      title,
      content: content.join("\n"),
      links: [],
      references: refs,
      note: table.rows.length
        ? `Rows ${first + 1}-${end} of ${table.rows.length}`
        : "No matching records",
    });
  }
  start();
  for (let i = 0; i < table.rows.length; i++) {
    const source = table.rows[i]!,
      cells = split(source.cells),
      height = Math.max(...cells.map((c) => c.length)) * 3.6 + 4;
    if (height + headerH + 9 > bottom - b.y)
      return failure(
        "unprintable-layout",
        `A ${table.kind} row cannot fit at readable size. Narrow the report or use larger paper.`,
      );
    if (y + height > bottom) {
      finish(i);
      first = i;
      start();
    }
    for (const uid of new Set(source.deviceUids)) {
      const d = ir.devices.find((d) => d.uid === uid);
      if (d)
        refs.push({
          deviceUid: uid,
          designation: d.designation,
          functions: [],
          zone: zone(b.x + b.w / 2, y + height / 2, b),
        });
    }
    content.push(`<g data-report-row="${attr(source.key)}">`);
    row(cells, height);
    content.push("</g>");
    if (drafts.length > 100)
      return failure(
        "unprintable-layout",
        "Report exceeds the 100-sheet limit.",
      );
  }
  if (!table.rows.length)
    content.push(text(b.x + 2, y + 7, "No matching records", 3));
  finish(table.rows.length);
  return { ok: true, value: drafts };
}

export function printPacketHtml(
  sheets: readonly RenderedSheet[],
  page: PaperPage,
  title: string,
): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${xml(title)}</title><style>
@page{size:${n(page.widthMm)}mm ${n(page.heightMm)}mm;margin:0}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;color:#18212b;font:14px system-ui,sans-serif}header{max-width:1100px;margin:auto;padding:24px 20px 8px}header h1{font-size:20px;margin:0 0 8px}header p{line-height:1.5;margin:0}main{display:flex;flex-direction:column;align-items:center;gap:24px;padding:20px}section{width:100%;max-width:${n(page.widthMm)}mm;background:white;box-shadow:0 2px 12px #0002;break-after:page}section:last-child{break-after:auto}section[hidden]{display:none}.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:14px 0}.toolbar input[type=search]{min-width:220px}.toolbar input,.toolbar select,.toolbar button{font:inherit;padding:8px;border:1px solid #aab2bd;border-radius:5px;background:white}main.actual-size{align-items:flex-start}main.actual-size section{width:${n(page.widthMm)}mm;max-width:none;flex-shrink:0}section{scroll-margin-top:12px}section:focus{outline:2px solid #2563eb}#packet-status{font-size:13px;color:#475569}section>svg{display:block;width:100%;height:auto}@media print{section[hidden]{display:block!important}section:focus{outline:none}body{background:white}header{display:none}main{display:block;padding:0}section{width:${n(page.widthMm)}mm;max-width:none;height:${n(page.heightMm)}mm;box-shadow:none;margin:0}section>svg{width:100%;height:100%}}</style></head><body><header><h1>${xml(title)}</h1><p>${sheets.length} sheets · ${page.size.toUpperCase()} ${page.orientation}. Print at 100% on matching paper; disable browser headers and footers. Each sheet is a vector SVG.</p><div class="toolbar"><label>Find device <input id="packet-search" type="search" placeholder="Designation, e.g. PLC1" autocomplete="off"></label><label>Go to <select id="packet-sheet">${sheets.map((s) => `<option value="sheet-${s.number}">${s.number} - ${xml(sheetLabel(s.view))}</option>`).join("")}</select></label><label><input id="packet-size" type="checkbox"> Actual size</label><button id="packet-print" type="button">Print packet</button></div><p id="packet-status" role="status" aria-live="polite"></p></header><main>${sheets.map((sheet) => `<section id="sheet-${sheet.number}" tabindex="-1" data-search="${attr(`${sheetLabel(sheet.view)} ${sheet.references.map((r) => r.designation).join(" ")}`)}" aria-label="Sheet ${sheet.number}">${sheet.svg.replace(/^<\?xml[^>]*>\s*/, "")}</section>`).join("\n")}</main><script>${PACKET_VIEWER_SCRIPT}</script></body></html>\n`;
}
export async function renderSchematicPacket(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation?: Readonly<CompiledProjectPresentation>,
): Promise<RenderOutcome<RenderedPacket>> {
  if (
    !record(request) ||
    request.format !== "schematic-packet-request/0.1" ||
    Object.keys(request).some(
      (key) => !["format", "page", "views", "layout", "index"].includes(key),
    ) ||
    (request.index !== undefined && typeof request.index !== "boolean") ||
    (request.layout !== undefined &&
      !["standard", "compact"].includes(request.layout)) ||
    !Array.isArray(request.views) ||
    request.views.length < 1 ||
    request.views.length > 40
  )
    return failure(
      "invalid-packet",
      "A packet requires format schematic-packet-request/0.1 and 1–40 views, with an optional shared page.",
    );
  const paper = normalizePaperPage(
    Object.hasOwn(request, "page")
      ? record(request.page)
        ? { ...presentation?.page, ...request.page }
        : request.page
      : (presentation?.page ?? {}),
  );
  if (!paper.ok) return paper;
  const drafts: Draft[] = [];
  let referenceNumber = 0;
  let circuitAppearances: Map<string, string[]>;
  try {
    circuitAppearances = circuitFunctionAppearances(
      ir,
      request.views.filter(
        (view) => record(view) && view.format === "circuit-view-request/0.1",
      ) as CircuitViewRequest[],
    );
  } catch (error) {
    return failure(
      "invalid-packet",
      error instanceof Error ? error.message : "Invalid circuit view.",
    );
  }
  for (const view of request.views) {
    if (record(view) && Object.hasOwn(view, "page"))
      return failure(
        "invalid-packet",
        "Individual views cannot override the packet's shared page settings.",
      );
    const result =
      record(view) && view.format === "circuit-view-request/0.1"
        ? await circuitDrafts(
            ir,
            view as unknown as CircuitViewRequest,
            presentation,
            paper.value,
            circuitAppearances,
          )
        : record(view) &&
            (view.format === "communication-view-request/0.1" ||
              view.format === "connector-assembly-view-request/0.1" ||
              view.format === "signal-loop-view-request/0.1" ||
              view.format === "wiring-view-request/0.1")
          ? await topologyDrafts(
              ir,
              view as unknown as
                | CommunicationViewRequest
                | ConnectorAssemblyViewRequest
                | SignalLoopViewRequest
                | WiringViewRequest,
              presentation,
              paper.value,
            )
          : record(view) && view.format === "documentation-view-request/0.1"
            ? documentationDrafts(
                ir,
                view as unknown as DocumentationRequest,
                presentation,
                paper.value,
              )
            : record(view) &&
                record(view.intent) &&
                view.intent.kind === "conductors"
              ? await cableDrafts(
                  ir,
                  view as unknown as SchematicViewRequest,
                  presentation,
                  paper.value,
                )
              : await drawingDrafts(
                  ir,
                  view as SchematicViewRequest,
                  presentation,
                  paper.value,
                  request.layout,
                );
    if (!result.ok) return result;
    const references = new Map<string, string>();
    for (const draft of result.value)
      for (const link of draft.links) {
        link.to += drafts.length;
        if (!references.has(link.id))
          references.set(
            link.id,
            `C${String(++referenceNumber).padStart(3, "0")}`,
          );
        link.id = references.get(link.id)!;
      }
    for (const draft of result.value) {
      const previous = drafts.at(-1);
      if (
        request.layout === "compact" &&
        previous?.communicationHeight !== undefined &&
        draft.communicationHeight !== undefined &&
        previous.title.lines[0]?.value === draft.title.lines[0]?.value &&
        previous.communicationHeight + 10 + draft.communicationHeight <=
          previous.drawingBounds!.h
      ) {
        const offset = previous.communicationHeight + 10;
        previous.content += `<g transform="translate(0 ${n(offset)})">${draft.content}</g>`;
        previous.references!.push(
          ...draft.references!.map((r) => ({
            ...r,
            yMm: r.yMm! + offset,
            zone: zone(r.xMm!, r.yMm! + offset, previous.drawingBounds!),
          })),
        );
        previous.communicationHeight += 10 + draft.communicationHeight;
      } else drafts.push(draft);
    }
    if (drafts.length > 100)
      return failure(
        "unprintable-layout",
        "Packet exceeds the 100-sheet alpha limit; split it into smaller packets.",
      );
  }
  if (request.index) {
    const indexTable: DocumentationTable = {
      kind: "index",
      title: "Drawing index",
      columns: ["Sheet", "View", "Devices"],
      widths: [0.08, 0.42, 0.5],
      notes: [
        "Index covers the generated content sheets. References point to this packet revision.",
      ],
      rows: drafts.map((d, i) => ({
        key: String(i + 1),
        cells: [
          String(i + 1),
          sheetLabel(d.view),
          [...new Set(d.references?.map((r) => r.designation) ?? [])].join(
            ", ",
          ),
        ],
        deviceUids: [...new Set(d.references?.map((r) => r.deviceUid) ?? [])],
      })),
    };
    const groups = new Map<
      string,
      {
        designation: string;
        functions: string;
        locations: string[];
        uid: string;
      }
    >();
    drafts.forEach((d, i) =>
      d.references?.forEach((r) => {
        const key = JSON.stringify([r.deviceUid, r.functions]);
        const g = groups.get(key) ?? {
          designation: r.designation,
          functions: r.functions.join(", ") || "Terminal / schedule",
          locations: [],
          uid: r.deviceUid,
        };
        g.locations.push(`${i + 1} / ${r.zone}`);
        groups.set(key, g);
      }),
    );
    const refTable: DocumentationTable = {
      kind: "references",
      title: "Device and function references",
      columns: ["Device", "Function / representation", "Sheet / zone"],
      widths: [0.2, 0.35, 0.45],
      notes: [
        "Repeated functions represent the same physical device. References include schedule appearances.",
      ],
      rows: [...groups]
        .sort(([, a], [, b]) =>
          a.designation < b.designation
            ? -1
            : a.designation > b.designation
              ? 1
              : 0,
        )
        .map(([key, g]) => ({
          key,
          cells: [
            g.designation,
            g.functions,
            [...new Set(g.locations)].join("; "),
          ],
          deviceUids: [g.uid],
        })),
    };
    for (const table of [indexTable, refTable]) {
      const extra = tableDrafts(ir, table, presentation, paper.value);
      if (!extra.ok) return extra;
      drafts.push(...extra.value);
    }
  }
  if (drafts.length > 100)
    return failure(
      "unprintable-layout",
      "Packet exceeds the 100-sheet limit including indexes.",
    );
  try {
    const sheets = drafts.map((draft, index) => ({
      number: index + 1,
      view: draft.view,
      references: draft.references ?? [],
      svg: frame(draft, paper.value, index + 1, drafts.length),
      continuations: draft.links.map((link) => ({
        id: link.id,
        toSheet: link.to,
        conductor: link.conductor,
        netId: link.netId,
      })),
    }));
    return {
      ok: true,
      value: {
        format: "schematic-packet/0.1",
        page: paper.value,
        sheets,
        html: printPacketHtml(sheets, paper.value, ir.project.name),
      },
    };
  } catch (error) {
    return failure(
      "unprintable-layout",
      error instanceof Error
        ? error.message
        : "Unable to produce the sheet title block.",
    );
  }
}
export function renderSchematicSheets(
  ir: Readonly<ElectricalIr>,
  view: SchematicViewRequest,
  presentation?: Readonly<CompiledProjectPresentation>,
  page?: PageSettings,
): Promise<RenderOutcome<RenderedPacket>> {
  return renderSchematicPacket(
    ir,
    {
      format: "schematic-packet-request/0.1",
      ...(page === undefined ? {} : { page }),
      views: [view],
    },
    presentation,
  );
}
