import type { CompiledProjectPresentation } from "@thermite/compiler";
import { record } from "./errors.js";
import { normalizePaperPage } from "./page.js";
import type {
  PageSettings,
  PaperPage,
  SchematicPacketRequest,
} from "./types.js";

export interface ParsedPacketFields {
  readonly index: boolean | undefined;
  readonly layout: "standard" | "compact" | undefined;
  readonly views: readonly SchematicPacketRequest["views"][number][];
  readonly rawReferences: SchematicPacketRequest["references"];
}

export function parsePacketFields(
  request: SchematicPacketRequest,
  requestFormat?: unknown,
): { ok: true; value: ParsedPacketFields } | { ok: false } {
  const format =
    requestFormat !== undefined
      ? requestFormat
      : record(request)
        ? request.format
        : undefined;
  if (
    !record(request) ||
    format !== "schematic-packet-request/0.1" ||
    Object.keys(request).some(
      (key) =>
        !["format", "page", "views", "layout", "index", "references"].includes(
          key,
        ),
    )
  )
    return { ok: false };
  const index = request.index;
  const layout = request.layout;
  if (
    (index !== undefined && typeof index !== "boolean") ||
    (layout !== undefined && !["standard", "compact"].includes(layout)) ||
    !Array.isArray(request.views) ||
    request.views.length < 1 ||
    request.views.length > 40
  )
    return { ok: false };
  const views = [...request.views];
  const rawReferences = request.references;
  return {
    ok: true,
    value: { index, layout, views, rawReferences },
  };
}

export function readPacketPage(request: SchematicPacketRequest) {
  const hasPage = Object.hasOwn(request, "page");
  const rawPage = hasPage ? request.page : undefined;
  const pageCopy: PageSettings | undefined =
    hasPage && record(rawPage) ? { ...rawPage } : rawPage;
  return { hasPage, pageCopy };
}

export function parsePacketReferences(
  rawReferences: SchematicPacketRequest["references"],
  index: boolean | undefined,
): { ok: true; value: SchematicPacketRequest["references"] } | { ok: false } {
  if (rawReferences === undefined) return { ok: true, value: undefined };
  if (index !== true) return { ok: false };
  if (rawReferences === false) return { ok: true, value: false };
  if (
    !record(rawReferences) ||
    !Object.keys(rawReferences).length ||
    Object.keys(rawReferences).some(
      (k) => !["filter", "appearances"].includes(k),
    )
  )
    return { ok: false };
  const hasAppearances = Object.hasOwn(rawReferences, "appearances");
  const rawAppearances = hasAppearances ? rawReferences.appearances : undefined;
  const appearances =
    rawAppearances === "all" || rawAppearances === "drawings"
      ? rawAppearances
      : undefined;
  if (hasAppearances && !appearances) return { ok: false };
  const hasFilter = Object.hasOwn(rawReferences, "filter");
  const filter = hasFilter ? rawReferences.filter : undefined;
  if (hasFilter && filter === undefined) return { ok: false };
  return {
    ok: true,
    value: {
      ...(appearances !== undefined ? { appearances } : {}),
      ...(filter !== undefined ? { filter } : {}),
    },
  };
}

export function packetPaperPage(
  hasPage: boolean,
  pageInput: unknown,
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  configurePage: ((page: PaperPage) => void) | undefined,
) {
  const paper = normalizePaperPage(
    hasPage
      ? record(pageInput)
        ? { ...presentation?.page, ...pageInput }
        : pageInput
      : (presentation?.page ?? {}),
  );
  if (paper.ok) configurePage?.(paper.value);
  return paper;
}
