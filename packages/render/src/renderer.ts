import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import type { ELK as ElkApi } from "elkjs/lib/elk-api.js";
import type { QueryEngine } from "@thermite/query";

import { layoutPresentationGraph } from "./layout/elk-adapter.js";
import { buildPresentationGraph } from "./presentation.js";
import {
  selectCableConductorSubgraph,
  selectLoadsSubgraph,
  selectSemanticSubgraph,
  selectTraceSubgraph,
} from "./selection.js";
import { SYMBOL_CATALOG } from "./symbols/catalog.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  projectDeviceTypeSymbolMappings,
  type DeviceTypeSymbolMapping,
} from "./symbols/mappings.js";
import type { SymbolDefinition } from "./symbols/types.js";
import { emitSchematicSvg } from "./svg/emitter.js";
import { preflightRenderText } from "./svg/escape.js";
import { prepareSchematicTitleContext } from "./title-block.js";
import type {
  RenderFailure,
  RenderOutcome,
  RenderedSchematic,
  SchematicRenderer,
  SchematicViewRequest,
} from "./types.js";
import { normalizeSchematicView } from "./view-spec.js";

export interface SchematicRendererDependencies {
  readonly mappings?: readonly DeviceTypeSymbolMapping[];
  readonly catalog?: readonly SymbolDefinition[];
  readonly queryEngineFactory?: (ir: Readonly<ElectricalIr>) => QueryEngine;
  readonly layoutEngine?: ElkApi;
  readonly spacingProfile?: "compact" | "dense";
}

function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const member of Object.values(value)) deepFreeze(member, seen);
  return Object.freeze(value);
}

function detachedFrozen<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function failed(error: RenderFailure): RenderOutcome<never> {
  return detachedFrozen({ ok: false as const, error });
}

function succeeded(value: RenderedSchematic): RenderOutcome<RenderedSchematic> {
  return detachedFrozen({ ok: true as const, value });
}

export interface PreparedSchematicDrawing {
  readonly graph: import("./types.js").PresentationGraph;
  readonly layout: import("./types.js").NormalizedSchematicLayout;
  readonly titleContext: import("./title-block.js").SchematicTitleContext;
  readonly summary: import("./types.js").RenderSummary;
  readonly view: import("./types.js").NormalizedSchematicView;
}

export async function prepareSchematicDrawing(
  ir: Readonly<ElectricalIr>,
  request: Readonly<SchematicViewRequest>,
  presentation?: Readonly<CompiledProjectPresentation>,
  dependencies: Readonly<SchematicRendererDependencies> = {},
  preNormalized?: ReturnType<typeof normalizeSchematicView>,
): Promise<RenderOutcome<PreparedSchematicDrawing>> {
  const mappings = dependencies.mappings ?? projectDeviceTypeSymbolMappings(ir);
  const catalog = dependencies.catalog ?? SYMBOL_CATALOG;
  const normalized =
    preNormalized ??
    normalizeSchematicView(ir, request, {
      mappings,
      ...(dependencies.queryEngineFactory === undefined
        ? {}
        : { queryEngineFactory: dependencies.queryEngineFactory }),
    });
  if (!normalized.ok) return failed(normalized.error);

  const titleContext = prepareSchematicTitleContext(
    ir.project.name,
    normalized.value.view,
    presentation,
  );
  if (!titleContext.ok) return failed(titleContext.error);

  const selected =
    normalized.value.view.format === "schematic-view/0.1"
      ? selectSemanticSubgraph({
          ir,
          view: normalized.value.view,
          engine: normalized.value.engine,
          mappings,
        })
      : normalized.value.view.intent === "trace"
        ? selectTraceSubgraph({
            ir,
            view: normalized.value.view,
            engine: normalized.value.engine,
            mappings,
            target: normalized.value.view.target,
            includePower: normalized.value.view.includePower,
          })
        : normalized.value.view.intent === "loads"
          ? selectLoadsSubgraph({
              ir,
              view: normalized.value.view,
              engine: normalized.value.engine,
              mappings,
              catalog,
            })
          : selectCableConductorSubgraph({
              ir,
              view: normalized.value.view,
              engine: normalized.value.engine,
              mappings,
              root:
                "rootSelector" in normalized.value
                  ? normalized.value.rootSelector
                  : (() => {
                      throw new Error(
                        "Prepared cable view omitted its root selector.",
                      );
                    })(),
            });
  if (!selected.ok) return failed(selected.error);

  const presented = buildPresentationGraph({
    ir,
    selected: selected.value,
    mappings,
    catalog,
  });
  if (!presented.ok) return failed(presented.error);

  const preflight = preflightRenderText(presented.value.graph);
  if (!preflight.ok) return failed(preflight.error);

  const laidOut = await layoutPresentationGraph(presented.value.graph, {
    catalog,
    selected: selected.value,
    ...(dependencies.spacingProfile
      ? { spacingProfile: dependencies.spacingProfile }
      : {}),
    ...(dependencies.layoutEngine === undefined
      ? {}
      : { engine: dependencies.layoutEngine }),
  });
  if (!laidOut.ok) return failed(laidOut.error);

  return {
    ok: true,
    value: {
      graph: presented.value.graph,
      layout: laidOut.value,
      titleContext: titleContext.value,
      summary: presented.value.summary,
      view: normalized.value.view,
    },
  };
}

export function createSchematicRendererWithDependencies(
  dependencies: Readonly<SchematicRendererDependencies> = {},
): SchematicRenderer {
  return Object.freeze({
    async render(
      ir: Readonly<ElectricalIr>,
      request: Readonly<SchematicViewRequest>,
      presentation?: Readonly<CompiledProjectPresentation>,
    ): Promise<RenderOutcome<RenderedSchematic>> {
      const normalized = normalizeSchematicView(ir, request, {
        mappings: dependencies.mappings ?? projectDeviceTypeSymbolMappings(ir),
        ...(dependencies.queryEngineFactory === undefined
          ? {}
          : { queryEngineFactory: dependencies.queryEngineFactory }),
      });
      if (!normalized.ok) return failed(normalized.error);
      const view = normalized.value.view;
      if (
        view.format === "schematic-view/0.2" &&
        view.intent === "conductors"
      ) {
        const cable = ir.cables.find(
          (entry) => entry.uid === view.root.cableUid,
        )!;
        if (cable.assignments !== undefined) {
          const { renderSchematicSheets } = await import("./sheets.js");
          const packet = await renderSchematicSheets(ir, request, presentation);
          if (!packet.ok) return failed(packet.error);
          if (packet.value.sheets.length !== 1)
            return failed({
              code: "R006",
              root: cable.designation,
              reason: "unprintable-layout",
              message:
                "This cable inventory needs multiple sheets. Use thermite view --conductors with HTML or JSON output to retain every core.",
            });
          const terminals = new Map(
            cable.assignments.flatMap((core) =>
              core.endpoints.flatMap((end) =>
                end === null
                  ? []
                  : [[JSON.stringify(end.terminal), end.terminal] as const],
              ),
            ),
          );
          const terminalIds = [...terminals.values()].sort((a, b) =>
            a.deviceUid < b.deviceUid
              ? -1
              : a.deviceUid > b.deviceUid
                ? 1
                : a.terminalKey < b.terminalKey
                  ? -1
                  : a.terminalKey > b.terminalKey
                    ? 1
                    : 0,
          );
          return succeeded({
            view,
            svg: packet.value.sheets[0]!.svg,
            summary: {
              deviceUids: [
                ...new Set(terminalIds.map((id) => id.deviceUid)),
              ].sort(),
              terminalIds,
              functionIds: [],
              presentationNodeIds: [],
              conductiveElementIds: ir.cableConductors
                .filter((core) => core.cableUid === cable.uid)
                .map((core) => ({ kind: "cable_conductor", ...core.id })),
              netIds: [
                ...new Set(
                  ir.indexes.netIdByTerminal
                    .filter(({ key }) =>
                      terminalIds.some(
                        (id) =>
                          id.deviceUid === key.deviceUid &&
                          id.terminalKey === key.terminalKey,
                      ),
                    )
                    .map(({ value }) => value),
                ),
              ].sort(),
            },
          });
        }
      }
      const prepared = await prepareSchematicDrawing(
        ir,
        request,
        presentation,
        dependencies,
        normalized,
      );
      if (!prepared.ok) return failed(prepared.error);
      const { graph, layout, titleContext, summary } = prepared.value;
      const emitted = emitSchematicSvg(
        graph,
        layout,
        titleContext,
        dependencies.catalog ?? SYMBOL_CATALOG,
      );
      if (!emitted.ok) return failed(emitted.error);
      return succeeded({ view, summary, svg: emitted.value });
    },
  });
}

export function createSchematicRenderer(): SchematicRenderer {
  return createSchematicRendererWithDependencies();
}

export function renderSchematic(
  ir: Readonly<ElectricalIr>,
  request: Readonly<SchematicViewRequest>,
  presentation?: Readonly<CompiledProjectPresentation>,
): Promise<RenderOutcome<RenderedSchematic>> {
  return createSchematicRenderer().render(ir, request, presentation);
}
