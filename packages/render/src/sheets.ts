import { referenceTables } from "./packet/references.js";
import { viewDrafts } from "./packet/dispatch.js";
import { appendViewDrafts, assembleSheets } from "./packet/assembly.js";

import {
  circuitFunctionAppearances,
  type CircuitViewRequest,
} from "./circuit.js";

import {
  buildPacketCoverage,
  packetDeviceCoverageDiagnostics,
} from "./coverage.js";

import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import {
  type DocumentationSelection,
  resolveDeviceFilter,
} from "@thermite/query";

import type { RenderOutcome, SchematicViewRequest } from "./types.js";

import type {
  SchematicPacketRequest,
  RenderedPacket,
  ReferenceSelection,
  Draft,
  PageSettings,
} from "./packet/types.js";
export type {
  PageSettings,
  PaperPage,
  SchematicPacketRequest,
  SheetReference,
  NormalizedDocumentationView,
  RenderedSheet,
  CommunicationContinuation,
  CircuitContinuation,
  RenderedPacket,
  ReferenceSelection,
} from "./packet/types.js";
import {
  failure,
  record,
  packetViewContext,
  withPacketViews,
  PacketDraftError,
} from "./packet/errors.js";
import { normalizePaperPage, sheetLabel } from "./packet/page.js";
export { normalizePaperPage, sheetLabel } from "./packet/page.js";
import { printPacketHtml } from "./packet/html.js";
export { printPacketHtml } from "./packet/html.js";

import { tableDrafts } from "./packet/reports.js";

async function renderPacket(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  explicitPacket: boolean,
): Promise<RenderOutcome<RenderedPacket>> {
  const contextError: typeof withPacketViews = (error, views) =>
    explicitPacket ? withPacketViews(error, views) : error;
  if (
    !record(request) ||
    request.format !== "schematic-packet-request/0.1" ||
    Object.keys(request).some(
      (key) =>
        !["format", "page", "views", "layout", "index", "references"].includes(
          key,
        ),
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
  if (
    request.references !== undefined &&
    (request.index !== true ||
      (request.references !== false &&
        (!record(request.references) ||
          !Object.keys(request.references).length ||
          Object.keys(request.references).some(
            (k) => !["filter", "appearances"].includes(k),
          ) ||
          (Object.hasOwn(request.references, "appearances") &&
            !["all", "drawings"].includes(request.references.appearances!)) ||
          (Object.hasOwn(request.references, "filter") &&
            request.references.filter === undefined))))
  )
    return failure(
      "invalid-packet",
      "Reference options require index: true and either false or filter/appearances settings.",
    );
  let referenceDevices: ReturnType<typeof resolveDeviceFilter> | undefined;
  try {
    if (request.references && request.references.filter !== undefined)
      referenceDevices = resolveDeviceFilter(ir, request.references.filter);
  } catch (e) {
    return failure(
      "invalid-packet",
      e instanceof Error ? e.message : "Invalid reference filter.",
    );
  }
  const paper = normalizePaperPage(
    Object.hasOwn(request, "page")
      ? record(request.page)
        ? { ...presentation?.page, ...request.page }
        : request.page
      : (presentation?.page ?? {}),
  );
  if (!paper.ok) return paper;
  const drafts: Draft[] = [];
  const composedFailure = (message: string) => {
    const result = failure("unprintable-layout", message);
    return !result.ok
      ? {
          ok: false as const,
          error: contextError(
            result.error,
            drafts.flatMap((d) => d.views ?? []),
          ),
        }
      : result;
  };
  const documentationSelections: (DocumentationSelection & { view: number })[] =
    [];
  let referenceSelection: ReferenceSelection | undefined;
  let referenceNumber = 0;
  const circuitAppearances = new Map<string, string[]>();
  for (const [viewIndex, view] of request.views.entries()) {
    if (!record(view) || view.format !== "circuit-view-request/0.1") continue;
    try {
      for (const [key, labels] of circuitFunctionAppearances(ir, [
        view as unknown as CircuitViewRequest,
      ]))
        circuitAppearances.set(key, [
          ...new Set([...(circuitAppearances.get(key) ?? []), ...labels]),
        ]);
    } catch (error) {
      const failed = failure(
        "invalid-packet",
        error instanceof Error ? error.message : "Invalid circuit view.",
      );
      if (!failed.ok)
        return {
          ok: false,
          error: contextError(failed.error, [
            packetViewContext(view, viewIndex, ir),
          ]),
        };
    }
  }
  for (const [viewIndex, view] of request.views.entries()) {
    const context = packetViewContext(view, viewIndex, ir);
    if (record(view) && Object.hasOwn(view, "page")) {
      const failed = failure(
        "invalid-packet",
        "Individual views cannot override the packet's shared page settings.",
      );
      if (!failed.ok)
        return { ok: false, error: contextError(failed.error, [context]) };
    }
    const result = await viewDrafts(
      ir,
      view,
      presentation,
      paper.value,
      request.layout,
      circuitAppearances,
    );
    if (!result.ok)
      return { ok: false, error: contextError(result.error, [context]) };
    const reportSelection = result.value[0]?.documentationSelection;
    if (reportSelection)
      documentationSelections.push({ ...reportSelection, view: viewIndex + 1 });
    referenceNumber = appendViewDrafts(
      drafts,
      result.value,
      viewIndex,
      request.layout,
      referenceNumber,
      context,
    );
    if (drafts.length > 100)
      return composedFailure(
        "Packet exceeds the 100-sheet alpha limit; split it into smaller packets.",
      );
  }
  if (request.index) {
    const indexes = referenceTables(ir, drafts, request, referenceDevices);
    referenceSelection = indexes.referenceSelection;
    for (const table of indexes.tables) {
      const extra = tableDrafts(ir, table, presentation, paper.value);
      if (!extra.ok)
        return {
          ok: false,
          error: contextError(
            extra.error,
            drafts.flatMap((d) => d.views ?? []),
          ),
        };
      drafts.push(...extra.value);
    }
  }
  if (drafts.length > 100)
    return composedFailure(
      "Packet exceeds the 100-sheet limit including indexes.",
    );
  try {
    const sheets = assembleSheets(ir, drafts, paper.value);
    const diagnostics = explicitPacket
      ? packetDeviceCoverageDiagnostics(
          ir,
          sheets.map((sheet, i) => ({
            number: sheet.number,
            schematic: !drafts[i]!.documentationTable,
            references: sheet.references,
          })),
        )
      : [];
    diagnostics.push(...drafts.flatMap((d) => d.diagnostics ?? []));
    return {
      ok: true,
      value: {
        format: "schematic-packet/0.1",
        page: paper.value,
        sheets,
        html: printPacketHtml(sheets, paper.value, ir.project.name),
        coverage: {
          ...buildPacketCoverage(
            ir,
            drafts.map((draft, i) => ({
              sheet: i + 1,
              view: sheetLabel(draft.view),
              drawings: draft.coverage ?? [],
              topologyDrawings: draft.topologyCoverage ?? [],
            })),
          ),
          ...(diagnostics.length ? { diagnostics } : {}),
        },
        ...(documentationSelections.length ? { documentationSelections } : {}),
        ...(referenceSelection ? { referenceSelection } : {}),
      },
    };
  } catch (error) {
    const failed = failure(
      "unprintable-layout",
      error instanceof Error
        ? error.message
        : "Unable to produce the sheet title block.",
    );
    return !failed.ok
      ? {
          ok: false,
          error: contextError(
            failed.error,
            error instanceof PacketDraftError
              ? error.views
              : drafts.flatMap((d) => d.views ?? []),
          ),
        }
      : failed;
  }
}
export function renderSchematicPacket(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation?: Readonly<CompiledProjectPresentation>,
): Promise<RenderOutcome<RenderedPacket>> {
  return renderPacket(ir, request, presentation, true);
}
export function renderSchematicSheets(
  ir: Readonly<ElectricalIr>,
  view: SchematicViewRequest | import("@thermite/query").DocumentationRequest,
  presentation?: Readonly<CompiledProjectPresentation>,
  page?: PageSettings,
  options: Pick<SchematicPacketRequest, "layout" | "index"> = {},
): Promise<RenderOutcome<RenderedPacket>> {
  return renderPacket(
    ir,
    {
      ...options,
      format: "schematic-packet-request/0.1",
      ...(page === undefined ? {} : { page }),
      views: [view],
    },
    presentation,
    false,
  );
}
