import { assembleSheets } from "./assembly.js";
import { drawingContinuations } from "./continuations.js";
import { foldDrawingDrafts } from "./folding.js";

import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";

import { prepareSchematicDrawing } from "../renderer.js";
import { OUTER_SVG_PADDING } from "../symbols/catalog.js";
import { emitSchematicSvg } from "../svg/emitter.js";

import {
  LAYOUT_CONFIG_VERSION,
  type RenderOutcome,
  type SchematicViewRequest,
} from "../types.js";

import type { Draft, PaperPage } from "./types.js";
import { failure } from "./errors.js";
import { bounds, zone } from "./page.js";
import { n, text } from "./svg.js";

interface Interval {
  start: number;
  end: number;
}
/** Cuts only in whitespace between indivisible devices, rails and labels. */
export function cuts(
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
  const emitted = emitSchematicSvg(
    graph,
    layout,
    title,
    undefined,
    true,
    scale,
    ir,
  );
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
  const linked = drawingContinuations(drafts, graph, layout, xs, ys, b, scale);
  if (!linked.ok) return linked;
  // Fold horizontal continuations into stacked sections when their actual visible
  // bounds fit on one sheet. ELK geometry and conductor endpoints stay untouched.
  if (spacingProfile && ny === 1 && nx > 1) {
    return {
      ok: true,
      value: foldDrawingDrafts(drafts, layout, xs, b, scale, fullH),
    };
  }
  return { ok: true, value: drafts };
}

/** At most three validated ELK candidates; never shrink symbols or alter flow. */
export async function drawingDrafts(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  mode: "standard" | "compact" = "standard",
): Promise<RenderOutcome<Draft[]>> {
  let best = await drawingDraftsCandidate(ir, request, presentation, page);
  if (mode === "standard") {
    if (
      !best.ok &&
      best.error.code === "R006" &&
      request.flow === "top-to-bottom"
    ) {
      const compact = await drawingDrafts(
        ir,
        request,
        presentation,
        page,
        "compact",
      );
      let printable = compact.ok;
      if (compact.ok)
        try {
          assembleSheets(ir, compact.value, page);
        } catch {
          printable = false;
        }
      if (printable)
        return {
          ok: false,
          error: {
            ...best.error,
            message: `${best.error.message} Try --layout compact; it produces a printable version of this view on this page.`,
            details: { ...best.error.details, compactLayoutAvailable: true },
          },
        };
    }
    return best;
  }
  if (best.ok && best.value.length === 1) return best;
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
