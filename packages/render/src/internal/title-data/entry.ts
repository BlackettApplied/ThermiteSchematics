import { failure, record } from "../../packet/errors.js";
import { deepFreeze } from "../../internal.js";
import type { JsonValue } from "@thermite/schema";
import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import type { SchematicPacketRequest } from "../../packet/types.js";
import type { PacketRequest, Presentation, TitleSources } from "./model.js";
import {
  validatePacketMetadata,
  validateInternalPresentation,
} from "./parse.js";
import {
  configureTitleFrame,
  registerTitlePresentation,
} from "./frame-context.js";
import { renderPacketWithAdvice } from "../../sheets.js";
import { selectCircuitPacket } from "../../layout/circuit-packet-selection.js";
import { withFontMetricCache } from "../../symbols/font-metric-cache.js";
import { titleFailure } from "./errors.js";

function snapshotTitleInputs(
  presentation: Presentation,
  metadata: PacketRequest,
) {
  // Only the authored-view cardinality is needed by the resolver. Real view
  // objects remain untouched in the request sent to the existing dispatcher.
  return deepFreeze({
    presentation: structuredClone(presentation),
    request: {
      format: "schematic-packet-request/0.2" as const,
      views: structuredClone(metadata.views),
      ...(metadata.titleData
        ? { titleData: structuredClone(metadata.titleData) }
        : {}),
    },
  });
}

/** Metadata parsing is deliberately blind to view contents. The unmodified
 * authored views go through the same strict dispatcher and source selection as
 * request/0.1, including page overrides and family-specific rejection order. */
export function prepareTitlePacket(
  request: PacketRequest | SchematicPacketRequest,
  presentation: Presentation,
  sources?: TitleSources,
  authoredPresentation?: Readonly<CompiledProjectPresentation>,
) {
  if (
    !record(request) ||
    !["schematic-packet-request/0.1", "schematic-packet-request/0.2"].includes(
      request.format,
    )
  )
    return failure(
      "invalid-packet",
      "Use schematic-packet-request/0.1 or schematic-packet-request/0.2.",
    );
  const parsed = validateInternalPresentation(
    presentation as unknown as JsonValue,
    sources?.presentation?.file,
    sources?.presentation?.nodes,
  );
  if (!parsed.value) return titleFailure(parsed.diagnostics);
  const metadata = validatePacketMetadata(
    {
      ...request,
      format: "schematic-packet-request/0.2",
      views: Array.isArray(request.views)
        ? request.views.map(() => ({}))
        : request.views,
    } as unknown as JsonValue,
    sources?.packet?.file,
    sources?.packet?.nodes,
  );
  if (!metadata.value) return titleFailure(metadata.diagnostics);
  const legacy = {
    ...request,
    format: "schematic-packet-request/0.1" as const,
  };
  if (request.format === "schematic-packet-request/0.2")
    delete (legacy as { titleData?: unknown }).titleData;
  const context = {
    ...snapshotTitleInputs(parsed.value, metadata.value),
    ...(sources ? { sources } : {}),
  };
  const source = context.presentation;
  const compiled: CompiledProjectPresentation = {
    format: "project-presentation/0.2",
    revision: source.revision ?? "UNSPECIFIED",
    backgroundColor: source.backgroundColor ?? "#ffffff",
    titleBlockLines: source.titleBlock?.lines ?? [],
    ...(source.page ? { page: source.page } : {}),
  };
  registerTitlePresentation(compiled, context, authoredPresentation ?? source);
  return { ok: true as const, value: { request: legacy, compiled, context } };
}
/** Benchmark entry for the public packet pipeline; absent from root exports. */
export function renderTitleFrameBenchmark(
  ir: Readonly<ElectricalIr>,
  request: PacketRequest | SchematicPacketRequest,
  presentation: Presentation,
) {
  return withFontMetricCache(async () => {
    const prepared = prepareTitlePacket(request, presentation);
    if (!prepared.ok) return prepared;
    const value = prepared.value;
    return selectCircuitPacket(value.request, () =>
      renderPacketWithAdvice(ir, value.request, value.compiled, true, (page) =>
        configureTitleFrame(page, value.context),
      ),
    );
  });
}

/** Normalize only packet metadata/version, then re-enter the original pipeline.
 * Circuit selection remains owned by the outer public entry. */
export async function renderTitlePacket(
  ir: Readonly<ElectricalIr>,
  request: SchematicPacketRequest,
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  explicit: boolean,
  configurePage?: (page: import("../../packet/types.js").PaperPage) => void,
  options?: import("../../packet/types.js").PacketRenderOptions,
) {
  const compact = presentation?.format === "project-presentation/0.3";
  if (
    !compact &&
    request.format === "schematic-packet-request/0.2" &&
    request.titleData !== undefined
  )
    return failure(
      "invalid-packet",
      "Packet titleData requires project-presentation/0.3.",
    );
  const raw: Presentation = compact
    ? ((presentation.compactFrame as unknown as Presentation | undefined) ?? {
        format: "project-presentation/0.3",
        revision: presentation.revision,
        backgroundColor: presentation.backgroundColor,
        ...(presentation.page ? { page: presentation.page } : {}),
        titleBlock: { lines: presentation.titleBlockLines },
      })
    : { format: "project-presentation/0.3" };
  const prepared = prepareTitlePacket(
    request,
    raw,
    {
      ...(options?.source ? { packet: options.source } : {}),
      ...(presentation?.compactFrameSource
        ? { presentation: presentation.compactFrameSource }
        : {}),
    },
    presentation,
  );
  if (!prepared.ok) return prepared;
  const value = prepared.value;
  return renderPacketWithAdvice(
    ir,
    value.request,
    compact ? value.compiled : presentation,
    explicit,
    (page) => {
      configurePage?.(page);
      if (compact) configureTitleFrame(page, value.context);
    },
  );
}
