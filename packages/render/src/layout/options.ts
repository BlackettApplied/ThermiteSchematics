import type {
  ElkLayoutOptionDescription,
  LayoutOptions,
} from "elkjs/lib/elk-api.js";

import { compareText } from "../ordering.js";
import type { SchematicFlow } from "../types.js";

export type ElkOptionTargetKind =
  "parent" | "node" | "port" | "node-label" | "edge" | "edge-label";

export interface ElkOptionAssignment {
  readonly targetKind: ElkOptionTargetKind;
  readonly targetId: string;
  readonly option: string;
  readonly value: string;
}

export interface ElkOptionMetadataSnapshot {
  readonly id: string;
  readonly type: string;
  readonly targets: readonly string[];
}

export const ELK_OPTIONS = Object.freeze({
  algorithm: "org.eclipse.elk.algorithm",
  direction: "org.eclipse.elk.direction",
  edgeRouting: "org.eclipse.elk.edgeRouting",
  hierarchyHandling: "org.eclipse.elk.hierarchyHandling",
  edgeCoords: "org.eclipse.elk.json.edgeCoords",
  randomSeed: "org.eclipse.elk.randomSeed",
  separateConnectedComponents: "org.eclipse.elk.separateConnectedComponents",
  considerModelOrderStrategy:
    "org.eclipse.elk.layered.considerModelOrder.strategy",
  considerModelOrderComponents:
    "org.eclipse.elk.layered.considerModelOrder.components",
  considerPortModelOrder:
    "org.eclipse.elk.layered.considerModelOrder.portModelOrder",
  cycleBreakingStrategy: "org.eclipse.elk.layered.cycleBreaking.strategy",
  crossingMinimizationStrategy:
    "org.eclipse.elk.layered.crossingMinimization.strategy",
  nodePlacementStrategy: "org.eclipse.elk.layered.nodePlacement.strategy",
  portSortingStrategy: "org.eclipse.elk.layered.portSortingStrategy",
  mergeEdges: "org.eclipse.elk.layered.mergeEdges",
  mergeHierarchyEdges: "org.eclipse.elk.layered.mergeHierarchyEdges",
  favorStraightEdges:
    "org.eclipse.elk.layered.nodePlacement.favorStraightEdges",
  priorityDirection: "org.eclipse.elk.layered.priority.direction",
  nodeNodeSpacing: "org.eclipse.elk.spacing.nodeNode",
  nodeNodeBetweenLayersSpacing:
    "org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers",
  edgeEdgeSpacing: "org.eclipse.elk.spacing.edgeEdge",
  edgeNodeSpacing: "org.eclipse.elk.spacing.edgeNode",
  componentComponentSpacing: "org.eclipse.elk.spacing.componentComponent",
  labelNodeSpacing: "org.eclipse.elk.spacing.labelNode",
  labelLabelSpacing: "org.eclipse.elk.spacing.labelLabel",
  edgeLabelSpacing: "org.eclipse.elk.spacing.edgeLabel",
  labelPortHorizontalSpacing: "org.eclipse.elk.spacing.labelPortHorizontal",
  labelPortVerticalSpacing: "org.eclipse.elk.spacing.labelPortVertical",
  edgeLabelSideSelection: "org.eclipse.elk.layered.edgeLabels.sideSelection",
  padding: "org.eclipse.elk.padding",
  portLabelsPlacement: "org.eclipse.elk.portLabels.placement",
  edgeLabelsPlacement: "org.eclipse.elk.edgeLabels.placement",
  edgeLabelsInline: "org.eclipse.elk.edgeLabels.inline",
  nodeLabelsPlacement: "org.eclipse.elk.nodeLabels.placement",
  nodeLabelsPadding: "org.eclipse.elk.nodeLabels.padding",
  nodeSizeConstraints: "org.eclipse.elk.nodeSize.constraints",
  nodeSizeMinimum: "org.eclipse.elk.nodeSize.minimum",
  portConstraints: "org.eclipse.elk.portConstraints",
  portSide: "org.eclipse.elk.port.side",
  portIndex: "org.eclipse.elk.port.index",
  portBorderOffset: "org.eclipse.elk.port.borderOffset",
  layerConstraint: "org.eclipse.elk.layered.layering.layerConstraint",
} as const);

export const ROOT_PADDING = Object.freeze({
  top: 16,
  left: 16,
  bottom: 16,
  right: 16,
});

export const LOCATION_PADDING = Object.freeze({
  top: 38,
  left: 16,
  bottom: 16,
  right: 16,
});

export const DEVICE_PADDING = Object.freeze({
  top: 30,
  left: 8,
  bottom: 8,
  right: 8,
});

export const LOCATION_LABEL_PADDING = Object.freeze({
  top: 8,
  left: 8,
  bottom: 8,
  right: 8,
});

export const DEVICE_LABEL_PADDING = Object.freeze({
  top: 4,
  left: 8,
  bottom: 4,
  right: 8,
});

export const LABEL_PORT_HORIZONTAL_SPACING = 4;
export const LABEL_PORT_VERTICAL_SPACING = 4;

export const PARENT_SPACING_OPTIONS: Readonly<LayoutOptions> = Object.freeze({
  [ELK_OPTIONS.nodeNodeSpacing]: "24",
  [ELK_OPTIONS.nodeNodeBetweenLayersSpacing]: "56",
  [ELK_OPTIONS.edgeEdgeSpacing]: "12",
  [ELK_OPTIONS.edgeNodeSpacing]: "16",
  [ELK_OPTIONS.labelNodeSpacing]: "8",
  [ELK_OPTIONS.labelLabelSpacing]: "4",
});

export function paddingValue(
  padding: Readonly<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  }>,
): string {
  return `[top=${padding.top},left=${padding.left},bottom=${padding.bottom},right=${padding.right}]`;
}

export function minimumSizeValue(width: number, height: number): string {
  return `(${width},${height})`;
}

export function rootLayoutOptions(flow: SchematicFlow): LayoutOptions {
  return {
    [ELK_OPTIONS.algorithm]: "layered",
    [ELK_OPTIONS.direction]: flow === "left-to-right" ? "RIGHT" : "DOWN",
    [ELK_OPTIONS.edgeRouting]: "ORTHOGONAL",
    [ELK_OPTIONS.hierarchyHandling]: "INCLUDE_CHILDREN",
    [ELK_OPTIONS.edgeCoords]: "ROOT",
    [ELK_OPTIONS.randomSeed]: "1",
    [ELK_OPTIONS.separateConnectedComponents]: "true",
    [ELK_OPTIONS.considerModelOrderStrategy]: "NODES_AND_EDGES",
    [ELK_OPTIONS.considerModelOrderComponents]: "MODEL_ORDER",
    [ELK_OPTIONS.considerPortModelOrder]: "true",
    [ELK_OPTIONS.cycleBreakingStrategy]: "GREEDY_MODEL_ORDER",
    [ELK_OPTIONS.crossingMinimizationStrategy]: "LAYER_SWEEP",
    [ELK_OPTIONS.nodePlacementStrategy]: "BRANDES_KOEPF",
    [ELK_OPTIONS.portSortingStrategy]: "INPUT_ORDER",
    [ELK_OPTIONS.mergeEdges]: "false",
    [ELK_OPTIONS.mergeHierarchyEdges]: "false",
    [ELK_OPTIONS.favorStraightEdges]: "true",
    ...PARENT_SPACING_OPTIONS,
    [ELK_OPTIONS.componentComponentSpacing]: "32",
    [ELK_OPTIONS.edgeLabelSpacing]: "4",
    [ELK_OPTIONS.edgeLabelSideSelection]: "DIRECTION_UP",
    [ELK_OPTIONS.padding]: paddingValue(ROOT_PADDING),
  };
}

const TARGET_METADATA: Readonly<Record<ElkOptionTargetKind, string>> =
  Object.freeze({
    parent: "PARENTS",
    node: "NODES",
    port: "PORTS",
    "node-label": "LABELS",
    edge: "EDGES",
    "edge-label": "LABELS",
  });

const OPTION_TYPES: Readonly<Record<string, string>> = Object.freeze({
  [ELK_OPTIONS.algorithm]: "STRING",
  [ELK_OPTIONS.direction]: "ENUM",
  [ELK_OPTIONS.edgeRouting]: "ENUM",
  [ELK_OPTIONS.hierarchyHandling]: "ENUM",
  [ELK_OPTIONS.edgeCoords]: "ENUM",
  [ELK_OPTIONS.randomSeed]: "INT",
  [ELK_OPTIONS.separateConnectedComponents]: "BOOLEAN",
  [ELK_OPTIONS.considerModelOrderStrategy]: "ENUM",
  [ELK_OPTIONS.considerModelOrderComponents]: "ENUM",
  [ELK_OPTIONS.considerPortModelOrder]: "BOOLEAN",
  [ELK_OPTIONS.cycleBreakingStrategy]: "ENUM",
  [ELK_OPTIONS.crossingMinimizationStrategy]: "ENUM",
  [ELK_OPTIONS.nodePlacementStrategy]: "ENUM",
  [ELK_OPTIONS.portSortingStrategy]: "ENUM",
  [ELK_OPTIONS.mergeEdges]: "BOOLEAN",
  [ELK_OPTIONS.mergeHierarchyEdges]: "BOOLEAN",
  [ELK_OPTIONS.favorStraightEdges]: "BOOLEAN",
  [ELK_OPTIONS.priorityDirection]: "INT",
  [ELK_OPTIONS.nodeNodeSpacing]: "DOUBLE",
  [ELK_OPTIONS.nodeNodeBetweenLayersSpacing]: "DOUBLE",
  [ELK_OPTIONS.edgeEdgeSpacing]: "DOUBLE",
  [ELK_OPTIONS.edgeNodeSpacing]: "DOUBLE",
  [ELK_OPTIONS.componentComponentSpacing]: "DOUBLE",
  [ELK_OPTIONS.labelNodeSpacing]: "DOUBLE",
  [ELK_OPTIONS.labelLabelSpacing]: "DOUBLE",
  [ELK_OPTIONS.edgeLabelSpacing]: "DOUBLE",
  [ELK_OPTIONS.labelPortHorizontalSpacing]: "DOUBLE",
  [ELK_OPTIONS.labelPortVerticalSpacing]: "DOUBLE",
  [ELK_OPTIONS.edgeLabelSideSelection]: "ENUM",
  [ELK_OPTIONS.padding]: "OBJECT",
  [ELK_OPTIONS.portLabelsPlacement]: "ENUMSET",
  [ELK_OPTIONS.edgeLabelsPlacement]: "ENUM",
  [ELK_OPTIONS.edgeLabelsInline]: "BOOLEAN",
  [ELK_OPTIONS.nodeLabelsPlacement]: "ENUMSET",
  [ELK_OPTIONS.nodeLabelsPadding]: "OBJECT",
  [ELK_OPTIONS.nodeSizeConstraints]: "ENUMSET",
  [ELK_OPTIONS.nodeSizeMinimum]: "OBJECT",
  [ELK_OPTIONS.portConstraints]: "ENUM",
  [ELK_OPTIONS.portSide]: "ENUM",
  [ELK_OPTIONS.portIndex]: "INT",
  [ELK_OPTIONS.portBorderOffset]: "DOUBLE",
  [ELK_OPTIONS.layerConstraint]: "ENUM",
});

export function validateOptionAssignmentsAgainstMetadata(
  descriptions: readonly ElkLayoutOptionDescription[],
  assignments: readonly ElkOptionAssignment[],
): readonly ElkOptionMetadataSnapshot[] {
  const byId = new Map(
    descriptions.map((description) => [description.id, description]),
  );
  const usedIds = [...new Set(assignments.map(({ option }) => option))].sort(
    compareText,
  );
  return usedIds.map((id) => {
    const description = byId.get(id);
    if (description === undefined) {
      throw new Error(`ELK option metadata is missing ${id}.`);
    }
    const expectedType = OPTION_TYPES[id];
    if (expectedType === undefined || description.type !== expectedType) {
      throw new Error(
        `ELK option ${id} has type ${String(description.type)}; expected ${String(expectedType)}.`,
      );
    }
    const targets = [...(description.targets ?? [])].sort(compareText);
    for (const assignment of assignments.filter(
      ({ option }) => option === id,
    )) {
      const target = TARGET_METADATA[assignment.targetKind];
      if (!targets.includes(target)) {
        throw new Error(
          `ELK option ${id} cannot target ${assignment.targetKind} ${assignment.targetId}.`,
        );
      }
    }
    return Object.freeze({ id, type: expectedType, targets });
  });
}

export function sortOptionAssignments(
  assignments: readonly ElkOptionAssignment[],
): readonly ElkOptionAssignment[] {
  return [...assignments].sort(
    (left, right) =>
      compareText(left.targetKind, right.targetKind) ||
      compareText(left.targetId, right.targetId) ||
      compareText(left.option, right.option) ||
      compareText(left.value, right.value),
  );
}
