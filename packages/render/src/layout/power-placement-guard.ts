import type { ElkNode, ElkEdgeSection } from "elkjs/lib/elk-api.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { RootedCandidate } from "../packet/rooted-build.js";
import { conductorKey, required } from "../presentation/util.js";
import { routeFragments } from "../packet/route-fragments.js";
import { circuitConductorGuard } from "./circuit-route-quality.js";
import {
  circuitNativeGuard,
  circuitCrossingGuard,
} from "./circuit-native-guard.js";
import {
  circuitPortGroups,
  circuitPortOrderGuard,
} from "./circuit-port-order.js";

/** Project native normalized routes into the existing route-quality machinery.
 * Sections stay separate; every cable UID/core has its own physical key. */
export function powerRouteGraph(
  candidate: RootedCandidate,
  clipped = true,
): ElkNode {
  const sections = new Map<string, ElkEdgeSection[]>();
  for (const edge of candidate.prepared.graph.edges.filter(
    (e) => e.kind === "conductor",
  )) {
    const route = required(
      candidate.prepared.layout.edges.find((e) => e.id === edge.id),
      "Missing power route",
    );
    const paths = clipped
      ? candidate.drafts.flatMap((d) =>
          (d.rootedSections ?? []).flatMap((s) =>
            routeFragments(route.points, s.viewport),
          ),
        )
      : [route.points];
    for (const key of new Set(edge.elementIds.map(conductorKey))) {
      const population = sections.get(key) ?? [];
      for (const path of paths) {
        const points = path.map((p) => ({
          x: p.x * candidate.scale,
          y: p.y * candidate.scale,
        }));
        population.push({
          id: String(population.length),
          startPoint: required(points[0], "Missing power route start"),
          endPoint: required(points.at(-1), "Missing power route end"),
          bendPoints: points.slice(1, -1),
        });
      }
      sections.set(key, population);
    }
  }
  return {
    id: "power-routes",
    edges: [...sections].map(([id, sections]) => ({
      id,
      sources: [],
      targets: [],
      sections,
    })),
  };
}

function nativeGraph(p: PreparedSchematicDrawing): ElkNode {
  return {
    id: "power",
    children: p.graph.nodes.map((node) => {
      const box = required(
        p.layout.nodes.find((n) => n.id === node.id),
        "Missing power node",
      );
      return {
        id: node.id,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        ports: p.layout.ports
          .filter((port) => port.nodeId === node.id)
          .map((port) => ({
            id: port.id,
            x: port.x - box.x,
            y: port.y - box.y,
          })),
      };
    }),
    edges: p.layout.edges.map((e) => ({
      id: e.id,
      sources: [e.sourcePortId],
      targets: [e.targetPortId],
      sections: [
        {
          id: e.id,
          startPoint: required(e.points[0], "Missing power route start"),
          endPoint: required(e.points.at(-1), "Missing power route end"),
          bendPoints: e.points.slice(1, -1),
        },
      ],
    })),
  };
}

export function powerNativeGuard(
  candidate: PreparedSchematicDrawing,
  original: PreparedSchematicDrawing,
) {
  const a = nativeGraph(candidate),
    b = nativeGraph(original);
  const groups = circuitPortGroups(
    original.graph.nodes
      .filter((n) => "deviceUid" in n)
      .map((n) => ({ device: { uid: n.deviceUid }, pins: n.ports })),
  );
  return (
    JSON.stringify(candidate.graph) === JSON.stringify(original.graph) &&
    circuitNativeGuard(a, b) &&
    circuitPortOrderGuard(a, b, groups) &&
    circuitCrossingGuard(a, b)
  );
}

/** A repair in the targeted phase never buys a defect, bend or excessive length
 * on any other phase, in either continuous or finally clipped routes. */
export function powerConductorGuard(
  candidate: RootedCandidate,
  original: RootedCandidate,
) {
  return [false, true].every((clipped) =>
    circuitConductorGuard(
      powerRouteGraph(candidate, clipped),
      powerRouteGraph(original, clipped),
    ),
  );
}
