import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { PresentationGraph } from "../types.js";
import {
  verticalPowerLanes,
  VERTICAL_POWER_EDGE_NODE_SPACING,
} from "./adapter-ordering.js";
import { ELK_OPTIONS } from "./options.js";

export interface PaginationSpacing {
  readonly parentId?: string;
  readonly axes: readonly ("height" | "width")[];
  readonly layerSpacing?: number;
}

/** Spacing alternatives leave all fixed ports, ordering and route checks intact. */
export function applyLayoutSpacing(
  input: ElkNode,
  graph: PresentationGraph,
  options: {
    spacingProfile?: "compact" | "dense";
    powerTurnSpacing?: number;
    paginationSpacing?: PaginationSpacing;
  },
) {
  const vertical = verticalPowerLanes(graph);
  const visit = (node: ElkNode): void => {
    if (!node.children?.length) return;
    if (options.spacingProfile) {
      const dense = options.spacingProfile === "dense";
      node.layoutOptions = {
        ...node.layoutOptions,
        [ELK_OPTIONS.nodeNodeSpacing]: dense ? "12" : "18",
        [ELK_OPTIONS.nodeNodeBetweenLayersSpacing]: dense ? "20" : "40",
        [ELK_OPTIONS.edgeNodeSpacing]: vertical
          ? VERTICAL_POWER_EDGE_NODE_SPACING
          : dense
            ? "10"
            : "12",
        [ELK_OPTIONS.componentComponentSpacing]: dense ? "16" : "24",
      };
    }
    if (vertical && options.powerTurnSpacing) {
      node.layoutOptions = {
        ...node.layoutOptions,
        [ELK_OPTIONS.edgeNodeSpacing]: String(
          Math.max(
            Number(node.layoutOptions?.[ELK_OPTIONS.edgeNodeSpacing] ?? 0),
            options.powerTurnSpacing,
          ),
        ),
      };
    }
    const pagination = options.paginationSpacing;
    if (
      pagination &&
      (!pagination.parentId || pagination.parentId === node.id)
    ) {
      const layoutOptions = (node.layoutOptions ??= {});
      for (const axis of pagination.axes) {
        const alongFlow =
          axis === (graph.view.flow === "left-to-right" ? "width" : "height");
        const [key, dense] = alongFlow
          ? [ELK_OPTIONS.nodeNodeBetweenLayersSpacing, 20]
          : [ELK_OPTIONS.nodeNodeSpacing, 12];
        if (alongFlow && pagination.layerSpacing !== undefined)
          layoutOptions[key] = String(pagination.layerSpacing);
        else if (Number(layoutOptions[key]) > dense)
          layoutOptions[key] = String(dense);
      }
    }
    node.children.forEach(visit);
  };
  visit(input);
}
