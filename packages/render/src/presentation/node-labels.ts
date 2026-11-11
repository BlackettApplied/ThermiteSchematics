import type { IrPotential, IrDeviceType } from "@thermite/compiler";
import type { IrFunction, TerminalId, FunctionId } from "@thermite/compiler";
import type { PresentationContext, SymbolRepresentation } from "./model.js";
import {
  required,
  orientedSymbolSize,
  sameTerminal,
  presentationLabel,
  textSource,
  cloneFunction,
} from "./util.js";
import { terminalIdKey, functionIdKey } from "../ordering.js";
import type { SymbolDefinition } from "../symbols/types.js";
import type {
  PresentationLabel,
  BoundaryConstraint,
  SemanticAttachmentKind,
  SelectedBoundary,
  RenderTextSource,
} from "../types.js";
import { representationBindings } from "./context.js";
import { compareCompleteFunction } from "./util.js";
import type { AggregateSymbolRule } from "../symbols/mappings.js";
import { printableCaption } from "../symbols/printable-policy.js";
import { contactCaptionRegion } from "./contact-caption.js";

function functionLabelText(
  materialized: IrFunction,
  type: IrDeviceType,
): string {
  if (materialized.kind === "contact") {
    return `${materialized.id.functionKey} ${materialized.normal_state === "open" ? "NO" : "NC"}`;
  }
  if (materialized.kind === "channel") {
    return `${materialized.id.functionKey} ${printableCaption({ kind: "channel", fn: materialized, type, spare: false })}`;
  }
  if (
    materialized.kind === "coil" &&
    !materialized.id.functionKey.toLowerCase().includes("coil")
  ) {
    return `${materialized.id.functionKey} coil`;
  }
  return materialized.id.functionKey;
}

export function netForTerminal(
  context: PresentationContext,
  terminal: TerminalId,
): string {
  const netId = required(
    context.netIdByTerminal.get(terminalIdKey(terminal)),
    `Presentation terminal ${terminalIdKey(terminal)} has no compiler net.`,
  );
  if (!context.selectedNetIds.has(netId)) {
    throw new Error(
      `Presentation terminal ${terminalIdKey(terminal)} is outside the selected query nets.`,
    );
  }
  return netId;
}

export function leafGeometry(
  symbol: SymbolDefinition,
  orientation: "left-to-right" | "top-to-bottom",
  label: PresentationLabel,
  caption = label,
): Readonly<{
  symbolSize: Readonly<{ width: number; height: number }>;
  width: number;
  height: number;
  primitiveOrigin: Readonly<{ x: number; y: number }>;
}> {
  const symbolSize = orientedSymbolSize(symbol, orientation);
  const vertical = orientation === "top-to-bottom";
  const width = vertical
    ? label.width + symbolSize.width + 24
    : Math.max(symbolSize.width + 16, label.width + 16);
  const height = 22 + symbolSize.height + 8;
  const geometry = {
    symbolSize,
    width,
    height,
    primitiveOrigin: {
      x: vertical
        ? label.width + 16
        : Number(((width - symbolSize.width) / 2).toFixed(3)),
      y: 22,
    },
  };
  // Retain the leaf lane and port anchors. The measured caption slot must fit
  // beside its own primitive before ELK sees the node or routes conductors.
  const region = contactCaptionRegion(
    { ...geometry, symbolId: symbol.id, orientation },
    caption,
  );
  if (
    region &&
    (region.x < 0 ||
      region.y < 0 ||
      region.x + region.width > width ||
      region.y + region.height > height)
  )
    throw Error(
      `Contact caption ${caption.text} exceeds its reserved leaf region.`,
    );
  return geometry;
}

export function representationBoundaryConstraint(
  representation: SymbolRepresentation,
  constraints: ReadonlyMap<string, BoundaryConstraint>,
): BoundaryConstraint | undefined {
  const bindingKeys = representationBindings(representation).map(
    ({ terminalKey }) =>
      terminalIdKey({
        deviceUid: representation.device.uid,
        terminalKey,
      }),
  );
  const active = bindingKeys
    .map((key) => constraints.get(key))
    .filter((value): value is BoundaryConstraint => value !== undefined);
  if (active.length > 0) {
    if (active.some((constraint) => constraint !== active[0])) {
      throw new Error(
        `Presentation symbol ${representation.id} has conflicting boundary constraints.`,
      );
    }
    return active[0];
  }
  return undefined;
}

export function semanticAttachmentKind(
  context: PresentationContext,
  representation: SymbolRepresentation,
): SemanticAttachmentKind {
  if (representation.kind === "terminal") return "terminal";
  if (representation.kind === "aggregate") return "aggregate";
  const materialized = required(
    context.functionByKey.get(
      functionIdKey(representation.functionIds[0] as FunctionId),
    ),
    `Presentation function ${representation.id} is missing.`,
  );
  return materialized.kind === "channel" ? "channel" : "function";
}

export function connectedTerminalPortHasLabel(
  context: PresentationContext,
  symbol: SymbolDefinition,
  terminal: TerminalId,
  symbolPortId: string,
): boolean {
  if (symbol.id !== "ais:terminal") return true;
  return context.selected.paths.some((path) =>
    path.steps.some(
      (step) =>
        step.kind === "conductor" &&
        ((sameTerminal(step.from, terminal) && symbolPortId === "out") ||
          (sameTerminal(step.to, terminal) && symbolPortId === "in")),
    ),
  );
}

function representationLabel(
  context: PresentationContext,
  representation: SymbolRepresentation,
) {
  return representation.kind === "terminal"
    ? presentationLabel(
        "symbol",
        representation.id,
        "function",
        "coil outside view",
        [],
      )
    : representation.kind === "aggregate"
      ? presentationLabel(
          "symbol",
          representation.id,
          "aggregate",
          (representation.rule as AggregateSymbolRule).key,
          [
            textSource(
              "aggregate",
              [
                representation.device.uid,
                (representation.rule as AggregateSymbolRule).key,
              ],
              "aggregate.key",
              (representation.rule as AggregateSymbolRule).key,
            ),
          ],
        )
      : (() => {
          const materialized = required(
            context.functionByKey.get(
              functionIdKey(representation.functionIds[0] as FunctionId),
            ),
            `Presentation function ${representation.id} is missing.`,
          );
          return presentationLabel(
            "symbol",
            representation.id,
            "function",
            functionLabelText(
              materialized,
              required(
                context.ir.deviceTypes.find(
                  (t) => t.id === representation.device.typeId,
                ),
                "Missing channel label type",
              ),
            ),
            [
              textSource(
                "function",
                [
                  representation.device.uid,
                  (representation.functionIds[0] as FunctionId).functionKey,
                ],
                "function.key",
                (representation.functionIds[0] as FunctionId).functionKey,
              ),
            ],
          );
        })();
}

export function symbolCaption(
  context: PresentationContext,
  representation: SymbolRepresentation,
  symbol: SymbolDefinition,
) {
  const nodeLabel = representationLabel(context, representation);
  const printableText =
    representation.kind === "terminal"
      ? "coil outside view"
      : representation.kind === "aggregate"
        ? printableCaption({
            kind: "aggregate",
            mark: symbol.id,
            type: required(
              context.ir.deviceTypes.find(
                (t) => t.id === representation.device.typeId,
              ),
              "Missing aggregate caption type",
            ),
          })
        : printableCaption({
            kind: "function",
            fn: required(
              context.functionByKey.get(
                functionIdKey(representation.functionIds[0] as FunctionId),
              ),
              "Missing caption function",
            ),
            type: required(
              context.ir.deviceTypes.find(
                (t) => t.id === representation.device.typeId,
              ),
              "Missing caption type",
            ),
            mark: symbol.id,
          });
  return { nodeLabel, printableText };
}

export function boundaryTextSources(
  context: PresentationContext,
  boundary: SelectedBoundary,
): readonly RenderTextSource[] {
  const anchored =
    boundary.potentialUid === undefined
      ? undefined
      : context.ir.potentials.find(({ uid }) => uid === boundary.potentialUid);
  if (anchored !== undefined) {
    return [
      textSource("potential", [anchored.uid], "potential.name", anchored.name),
    ];
  }
  const netPotentials = context.ir.potentials.filter(
    ({ netId }) => netId === boundary.netId,
  );
  if (
    netPotentials.length === 1 &&
    (netPotentials[0] as IrPotential).name === boundary.label
  ) {
    return [
      textSource(
        "potential",
        [(netPotentials[0] as IrPotential).uid],
        "potential.name",
        (netPotentials[0] as IrPotential).name,
      ),
    ];
  }
  return [
    textSource(
      "boundary",
      [
        boundary.terminal.deviceUid,
        boundary.terminal.terminalKey,
        boundary.kind,
      ],
      "boundary.label",
      boundary.label,
    ),
  ];
}

export function collapsedFunctionIds(
  context: PresentationContext,
  terminal: TerminalId,
  representations: readonly SymbolRepresentation[],
): readonly FunctionId[] {
  const ids = new Map<string, FunctionId>();
  for (const representation of representations) {
    if (representation.device.uid !== terminal.deviceUid) continue;
    if (
      !representationBindings(representation).some(
        ({ terminalKey }) => terminalKey === terminal.terminalKey,
      )
    ) {
      continue;
    }
    for (const functionId of representation.functionIds) {
      ids.set(functionIdKey(functionId), cloneFunction(functionId));
    }
  }
  return [...ids.values()].sort((left, right) =>
    compareCompleteFunction(context, left, right),
  );
}
