import { withRenderCache } from "./packet/render-cache.js";
import { finalizeTitleData } from "./internal/title-data/finalize.js";
import {
  packetFrameMetadata,
  authoredTitlePresentation,
} from "./internal/title-data/frame-context.js";
import { withFontMetricCache } from "./symbols/font-metric-cache.js";
import {
  fitLegendDrafts,
  type LegendViewDrafts,
} from "./packet/device-legend.js";
import { circuitPreviewSheets as legendSheets } from "./layout/circuit-preview-cache.js";
import { rootedPageCostFailure } from "./packet/rooted-bound.js";
import { renderErrorContext } from "./render-error-context.js";
import { finalReferenceDrafts } from "./packet/references-final.js";
import { viewDrafts } from "./packet/dispatch.js";
import { circuitSelectionContext } from "./packet/circuit.js";
import { appendViewDrafts } from "./packet/assembly.js";
import { navigationViewKey } from "./packet/navigation-identity.js";
import { centroidReferences } from "./packet/navigation-occurrences.js";
import { seedCircuitNavigation } from "./packet/navigation-circuit.js";
import { appendDocumentCompanions } from "./packet/document-companions.js";
import { appendTerminalStrips } from "./packet/terminal-strip.js";
import { required } from "./presentation/util.js";

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

import type { RenderFailure, RenderOutcome } from "./types.js";

import type {
  SchematicPacketRequest,
  RenderedPacket,
  ReferenceSelection,
  Draft,
  PageSettings,
} from "./packet/types.js";
export type {
  PageSettings,
  PacketRenderOptions,
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
  type PacketViewContext,
  withPacketViews,
  PacketDraftError,
  composedPacketFailure,
} from "./packet/errors.js";
import { sheetLabel } from "./packet/page.js";
export { normalizePaperPage, sheetLabel } from "./packet/page.js";
import { printPacketHtml } from "./packet/html.js";
export { printPacketHtml } from "./packet/html.js";

import { hasCompactFrame } from "./packet/frame-profile.js";
import { controlPrint } from "./packet/rooted-control-print.js";
import {
  packetPaperPage,
  parsePacketFields,
  parsePacketReferences,
  readPacketPage,
} from "./packet/validate-request.js";
import { contextualRenderOutcome } from "./render-diagnostic-context.js";

function packetDiagnostics(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: RenderedPacket["sheets"],
  explicitPacket: boolean,
  reflowedViews: Iterable<PacketViewContext>,
) {
  const diagnostics = explicitPacket
    ? packetDeviceCoverageDiagnostics(
        ir,
        sheets.map((sheet, i) => ({
          number: sheet.number,
          schematic: !required(drafts[i], "Missing rendered sheet draft")
            .documentationTable,
          references: drafts[i]?.terminalStrip ? [] : sheet.references,
        })),
      )
    : [];
  diagnostics.push(...drafts.flatMap((draft) => draft.diagnostics ?? []));
  for (const view of reflowedViews)
    diagnostics.push({
      code: "I906",
      severity: "info",
      ...ir.project.source,
      message: `View ${view.viewIndex + 1} ${JSON.stringify(view.title)}: A tighter top-to-bottom placement was used during pagination.`,
    });
  return diagnostics;
}

async function renderPacketPreservingRetry(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  explicitPacket: boolean,
  configurePage?: (page: import("./packet/types.js").PaperPage) => void,
  requestFormat?: unknown,
): Promise<RenderOutcome<RenderedPacket>> {
  const paginationFailures = new Map<PacketViewContext, RenderFailure>();
  const result = await renderPacket(
    ir,
    request,
    presentation,
    explicitPacket,
    paginationFailures,
    configurePage,
    requestFormat,
  );
  const original = paginationFailures.values().next().value;
  return result.ok || !original ? result : { ok: false, error: original };
}

async function renderPacket(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  explicitPacket: boolean,
  paginationFailures: Map<PacketViewContext, RenderFailure>,
  configurePage?: (page: import("./packet/types.js").PaperPage) => void,
  requestFormat?: unknown,
): Promise<RenderOutcome<RenderedPacket>> {
  const contextError: typeof withPacketViews = (error, views) =>
    explicitPacket ? withPacketViews(error, views) : error;
  const parsed = parsePacketFields(request, requestFormat);
  if (!parsed.ok)
    return failure(
      "invalid-packet",
      "A packet requires format schematic-packet-request/0.1 and 1–40 views, with an optional shared page.",
    );
  const { index, layout, views, rawReferences } = parsed.value;
  const parsedReferences = parsePacketReferences(rawReferences, index);
  if (!parsedReferences.ok)
    return failure(
      "invalid-packet",
      "Reference options require index: true and either false or filter/appearances settings.",
    );
  const references = parsedReferences.value;
  let referenceDevices: ReturnType<typeof resolveDeviceFilter> | undefined;
  try {
    if (references && references.filter !== undefined)
      referenceDevices = resolveDeviceFilter(ir, references.filter);
  } catch (e) {
    return failure(
      "invalid-packet",
      e instanceof Error ? e.message : "Invalid reference filter.",
    );
  }
  const { hasPage, pageCopy } = readPacketPage(request);
  const paperResult = packetPaperPage(
    hasPage,
    pageCopy,
    presentation,
    configurePage,
  );
  if (!paperResult.ok) return paperResult;
  const paper = paperResult.value;
  const refRequest: Pick<SchematicPacketRequest, "references" | "page"> = {
    ...(hasPage && pageCopy !== undefined ? { page: pageCopy } : {}),
    ...(references !== undefined ? { references } : {}),
  };
  let drafts: Draft[] = [];
  const legendViews: LegendViewDrafts[] = [];
  const composedFailure = (message: string) =>
    composedPacketFailure(message, drafts, contextError);
  const documentationSelections: (DocumentationSelection & { view: number })[] =
    [];
  let referenceNumber = 0;
  const appearances = collectCircuitAppearances(ir, views, contextError);
  if (!appearances.ok) return appearances;
  const navigationDuplicates = new Map<string, number>();
  for (const [viewIndex, view] of views.entries()) {
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
      authoredTitlePresentation(
        presentation,
        paper,
        viewIndex,
        drafts.length + 1,
      ),
      paper,
      layout,
      appearances.value,
      referenceNumber,
    );
    if (!result.ok || result.value[0]?.rootedPaginationFailure) {
      const refusal = result.ok
        ? result.value[0]?.rootedPaginationFailure
        : result.error;
      if (!refusal) throw Error("Missing original pagination refusal");
      const error = contextError(renderErrorContext(ir, refusal), [context]);
      if (!result.ok) return { ok: false, error };
      paginationFailures.set(context, error);
    }
    const first = result.value[0];
    if (first?.rootedPaginationFailure) delete first.rootedPaginationFailure;
    const reportSelection = first?.documentationSelection;
    if (record(view) && view.format === "circuit-view-request/0.1")
      seedCircuitNavigation(ir, result.value);
    const selection = first?.view.format.startsWith("schematic-view/")
      ? first.view
      : view;
    const navigationView = packetNavigationView(
      ir,
      selection,
      viewIndex,
      navigationDuplicates,
    );
    if (reportSelection)
      documentationSelections.push({ ...reportSelection, view: viewIndex + 1 });
    legendViews.push({
      drafts: structuredClone(result.value),
      viewIndex,
      context,
      navigationView,
    });
    referenceNumber = appendViewDrafts(
      drafts,
      result.value,
      viewIndex,
      layout,
      referenceNumber,
      context,
      navigationView,
    );
    if (drafts.length > 100)
      return composedFailure(
        "Packet exceeds the 100-sheet alpha limit; split it into smaller packets.",
      );
  }
  const legendFit = fitPacketLegends(
    ir,
    drafts,
    legendViews,
    paper,
    layout,
    contextError,
  );
  if (!legendFit.ok)
    return {
      ok: false,
      error: contextError(
        legendFit.error,
        drafts.flatMap((d) => d.views ?? []),
      ),
    };
  const finish = (fittedDrafts: Draft[]) =>
    finishPacket(
      ir,
      fittedDrafts,
      paper,
      index,
      refRequest,
      referenceDevices,
      presentation,
      explicitPacket,
      documentationSelections,
      paginationFailures,
      contextError,
    );
  attachControlAssembly(
    ir,
    legendFit.value,
    views.length === 1 ? legendViews[0] : undefined,
    paper,
    layout,
    contextError,
    finish,
  );
  return finish(legendFit.value);
}

function finishPacket(
  ir: Readonly<ElectricalIr>,
  fittedDrafts: Draft[],
  paper: import("./packet/types.js").PaperPage,
  index: boolean | undefined,
  refRequest: Pick<SchematicPacketRequest, "references" | "page">,
  referenceDevices: ReturnType<typeof resolveDeviceFilter> | undefined,
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  explicitPacket: boolean,
  documentationSelections: readonly (DocumentationSelection & {
    view: number;
  })[],
  paginationFailures: ReadonlyMap<PacketViewContext, RenderFailure>,
  contextError: typeof withPacketViews,
): RenderOutcome<RenderedPacket> {
  const pageCost = checkedPageCost(fittedDrafts, contextError);
  if (!pageCost.ok) return pageCost;
  const companions = packetCompanions(
    ir,
    fittedDrafts,
    paper,
    presentation,
    explicitPacket,
    contextError,
  );
  if (!companions.ok) return companions;
  let finalDrafts = companions.value;
  let referenceSelection: ReferenceSelection | undefined;
  if (index) {
    const indexes = packetReferences(
      ir,
      finalDrafts,
      refRequest,
      referenceDevices,
      presentation,
      paper,
      contextError,
    );
    if (!indexes.ok) return indexes;
    referenceSelection = indexes.value.referenceSelection;
    finalDrafts = indexes.value.drafts;
  }
  if (finalDrafts.length > 100 /* Backstop after composition. */)
    return composedPacketFailure(
      "Packet exceeds the 100-sheet limit including indexes.",
      finalDrafts,
      contextError,
    );
  return assemblePacket(
    ir,
    finalDrafts,
    paper,
    explicitPacket,
    documentationSelections,
    referenceSelection,
    presentation,
    paginationFailures.keys(),
  );
}

function attachControlAssembly(
  ir: Readonly<ElectricalIr>,
  originalFitted: readonly Draft[],
  singleView: LegendViewDrafts | undefined,
  paper: import("./packet/types.js").PaperPage,
  layout: "standard" | "compact" | undefined,
  contextError: typeof withPacketViews,
  finish: (fittedDrafts: Draft[]) => RenderOutcome<RenderedPacket>,
) {
  const control = controlPrint.getStore();
  if (!control?.propose || !singleView || hasCompactFrame(paper)) return;
  const originalDrafts = structuredClone(originalFitted);
  control.assemble = {
    originalDrafts,
    fit(replacement) {
      const candidateDrafts: Draft[] = [];
      const candidateLegendViews: LegendViewDrafts[] = [
        {
          drafts: structuredClone(replacement),
          viewIndex: singleView.viewIndex,
          context: singleView.context,
          ...(singleView.navigationView
            ? { navigationView: singleView.navigationView }
            : {}),
        },
      ];
      appendViewDrafts(
        candidateDrafts,
        structuredClone(replacement),
        singleView.viewIndex,
        layout,
        0,
        singleView.context,
        singleView.navigationView,
      );
      if (candidateDrafts.length > 100) return undefined;
      const fitted = fitPacketLegends(
        ir,
        candidateDrafts,
        candidateLegendViews,
        paper,
        layout,
        contextError,
      );
      if (!fitted.ok) return undefined;
      return {
        drafts: fitted.value,
        finish: () => finish(fitted.value),
      };
    },
  };
}

function collectCircuitAppearances(
  ir: Readonly<ElectricalIr>,
  views: SchematicPacketRequest["views"],
  contextError: typeof withPacketViews,
): RenderOutcome<Map<string, string[]>> {
  const circuitAppearances = new Map<string, string[]>();
  for (const [viewIndex, view] of views.entries()) {
    if (!record(view) || view.format !== "circuit-view-request/0.1") continue;
    try {
      for (const [key, labels] of circuitFunctionAppearances(ir, [
        view as unknown as CircuitViewRequest,
      ]))
        circuitAppearances.set(key, [
          ...new Set([...(circuitAppearances.get(key) ?? []), ...labels]),
        ]);
    } catch (error) {
      const failed = invalidCircuitFailure(ir, view, error);
      if (!failed.ok)
        return {
          ok: false,
          error: contextError(failed.error, [
            packetViewContext(view, viewIndex, ir),
          ]),
        };
    }
  }
  return { ok: true, value: circuitAppearances };
}

function packetNavigationView(
  ir: Readonly<ElectricalIr>,
  selection: unknown,
  viewIndex: number,
  duplicates: Map<string, number>,
) {
  const identityKey = navigationViewKey(ir, selection, 0);
  const ordinal = duplicates.get(identityKey) ?? 0;
  duplicates.set(identityKey, ordinal + 1);
  return {
    key: navigationViewKey(ir, selection, ordinal),
    authoredOrder: viewIndex,
  };
}

function packetReferences(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  request: Pick<SchematicPacketRequest, "references" | "page">,
  referenceDevices: ReturnType<typeof resolveDeviceFilter> | undefined,
  presentation: CompiledProjectPresentation | undefined,
  page: import("./packet/types.js").PaperPage,
  contextError: typeof withPacketViews,
): RenderOutcome<{
  drafts: Draft[];
  referenceSelection: ReferenceSelection | undefined;
}> {
  const located = legendSheets(ir, drafts, page);
  if (!located.ok) return located;
  centroidReferences(drafts, located.navigation?.occurrences ?? []);
  for (const [index, draft] of drafts.entries())
    if (draft.terminalStrip)
      draft.references = required(
        located.value[index],
        "Missing located strip sheet",
      ).references.slice();
  const indexes = finalReferenceDrafts(
    ir,
    drafts,
    request,
    referenceDevices,
    presentation,
    page,
  );
  return indexes.ok
    ? indexes
    : {
        ok: false,
        error: contextError(
          indexes.error,
          drafts.flatMap((d) => d.views ?? []),
        ),
      };
}

function checkedPageCost(
  drafts: Draft[],
  contextError: typeof withPacketViews,
): RenderOutcome<Draft[]> {
  const error = rootedPageCostFailure(drafts);
  return error
    ? {
        ok: false,
        error: contextError(
          error,
          drafts.flatMap((d) => d.views ?? []),
        ),
      }
    : { ok: true, value: drafts };
}
function packetCompanions(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  page: import("./packet/types.js").PaperPage,
  presentation: CompiledProjectPresentation | undefined,
  explicit: boolean,
  contextError: typeof withPacketViews,
): RenderOutcome<Draft[]> {
  const result = explicit
    ? appendDocumentCompanions(ir, drafts, page, presentation)
    : { ok: true as const, value: appendTerminalStrips(drafts) };
  return result.ok
    ? result
    : {
        ok: false,
        error: contextError(
          result.error,
          drafts.flatMap((d) => d.views ?? []),
        ),
      };
}
function fitPacketLegends(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  views: readonly LegendViewDrafts[],
  page: import("./packet/types.js").PaperPage,
  layout: "standard" | "compact" | undefined,
  contextError: typeof withPacketViews,
): RenderOutcome<Draft[]> {
  try {
    return fitLegendDrafts(ir, drafts, views, page, layout, legendSheets);
  } catch (error) {
    return assemblyError(error, drafts, contextError);
  }
}
function assemblePacket(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  page: import("./packet/types.js").PaperPage,
  explicitPacket: boolean,
  documentationSelections: readonly (DocumentationSelection & {
    view: number;
  })[],
  referenceSelection: ReferenceSelection | undefined,
  presentation: CompiledProjectPresentation | undefined,
  reflowedViews: Iterable<PacketViewContext>,
): RenderOutcome<RenderedPacket> {
  const contextError: typeof withPacketViews = (error, views) =>
    explicitPacket ? withPacketViews(error, views) : error;
  try {
    const titles = finalizeTitleData(ir, drafts, page, presentation);
    if (!titles.ok) return titles;
    const rendered = legendSheets(ir, drafts, page, true, {
      presentation,
      standalone: !explicitPacket,
    });
    if (!rendered.ok)
      return {
        ok: false,
        error: contextError(
          rendered.error,
          drafts.flatMap((d) => d.views ?? []),
        ),
      };
    const sheets = rendered.value;
    const diagnostics = packetDiagnostics(
      ir,
      drafts,
      sheets,
      explicitPacket,
      reflowedViews,
    );
    let html: string | undefined;
    return {
      ok: true,
      value: {
        format: "schematic-packet/0.1",
        ...packetFrameMetadata(page),
        page,
        sheets,
        // PDF and SVG consumers do not need an HTML font subset.
        get html() {
          return (html ??= printPacketHtml(sheets, page, ir.project.name));
        },
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
        ...(rendered.navigation ? { navigation: rendered.navigation } : {}),
        ...(referenceSelection ? { referenceSelection } : {}),
      },
    };
  } catch (error) {
    return assemblyError(error, drafts, contextError);
  }
}
function assemblyError(
  error: unknown,
  drafts: readonly Draft[],
  contextError: typeof withPacketViews,
): RenderOutcome<never> {
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

function invalidCircuitFailure(
  ir: Readonly<ElectricalIr>,
  view: unknown,
  error: unknown,
) {
  return failure(
    "invalid-packet",
    error instanceof Error ? error.message : "Invalid circuit view.",
    circuitSelectionContext(ir, view as CircuitViewRequest),
  );
}

function compactAdviceView(
  request: SchematicPacketRequest,
  details: Readonly<Record<string, unknown>> | undefined,
) {
  const index =
    typeof details?.viewIndex === "number"
      ? details.viewIndex
      : request.views.length === 1
        ? 0
        : undefined;
  const view = index === undefined ? undefined : request.views[index];
  return (
    record(view) &&
    (view.format === "schematic-view-request/0.1" ||
      view.format === "schematic-view-request/0.2") &&
    view.flow === "top-to-bottom"
  );
}

export async function renderPacketWithAdvice(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  explicitPacket: boolean,
  configurePage?: (page: import("./packet/types.js").PaperPage) => void,
  options?: import("./packet/types.js").PacketRenderOptions,
): Promise<RenderOutcome<RenderedPacket>> {
  const format = request?.format;
  if (
    presentation?.format === "project-presentation/0.3" ||
    format === "schematic-packet-request/0.2"
  ) {
    const { renderTitlePacket } =
      await import("./internal/title-data/entry.js");
    return renderTitlePacket(
      ir,
      request,
      presentation,
      explicitPacket,
      configurePage,
      options,
    );
  }
  const result = await renderPacketPreservingRetry(
    ir,
    request,
    presentation,
    explicitPacket,
    configurePage,
    format,
  );
  if (
    result.ok ||
    result.error.code !== "R006" ||
    result.error.reason !== "unprintable-layout" ||
    result.error.details?.navigationInvariant ||
    request.layout === "compact" ||
    !compactAdviceView(request, result.error.details)
  )
    return result;
  // Advice is evidence about the complete export, including assembly and the
  // packet page-cost bound. It never substitutes a different drawing.
  try {
    const compact = await renderPacketPreservingRetry(
      ir,
      { ...request, layout: "compact" },
      presentation,
      explicitPacket,
      configurePage,
    );
    return compact.ok
      ? {
          ok: false,
          error: {
            ...result.error,
            message: `${result.error.message} Try --layout compact; it produces a printable version of this packet on this page.`,
            details: { ...result.error.details, compactLayoutAvailable: true },
          },
        }
      : result;
  } catch {
    return result;
  }
}

export function renderSchematicPacket(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation?: Readonly<CompiledProjectPresentation>,
  options?: import("./packet/types.js").PacketRenderOptions,
): Promise<RenderOutcome<RenderedPacket>> {
  return withRenderCache(() =>
    withFontMetricCache(async () =>
      contextualRenderOutcome(
        ir,
        request,
        await renderPacketWithAdvice(
          ir,
          request,
          presentation,
          true,
          undefined,
          options,
        ),
      ),
    ),
  );
}
export function renderSchematicSheets(
  ir: Readonly<ElectricalIr>,
  view: SchematicPacketRequest["views"][number],
  presentation?: Readonly<CompiledProjectPresentation>,
  page?: PageSettings,
  options: Pick<SchematicPacketRequest, "layout" | "index"> = {},
): Promise<RenderOutcome<RenderedPacket>> {
  return withRenderCache(() =>
    withFontMetricCache(async () =>
      contextualRenderOutcome(
        ir,
        view,
        await renderPacketWithAdvice(
          ir,
          {
            ...options,
            format: "schematic-packet-request/0.1",
            ...(page === undefined ? {} : { page }),
            views: [view],
          },
          presentation,
          false,
        ),
      ),
    ),
  );
}
