import type { ElkNode, ElkPoint, ElkShape } from "elkjs/lib/elk-api.js";

// Native NETWORK_SIMPLEX quantizes fixed port coordinates. Two solver units per
// millimetre retain half-millimetre attachments without changing physical scale.
export const WIRING_UNITS_PER_MM = 2;

function unitsShape(shape: ElkShape, factor: number) {
  for (const key of ["x", "y", "width", "height"] as const) {
    const value = shape[key];
    if (value !== undefined) shape[key] = value * factor;
  }
  for (const label of shape.labels ?? []) unitsShape(label, factor);
}
function unitsPoint(point: ElkPoint, factor: number) {
  point.x *= factor;
  point.y *= factor;
}
function unitsNode(node: ElkNode, factor: number) {
  unitsShape(node, factor);
  for (const port of node.ports ?? []) {
    unitsShape(port, factor);
    const offset = port.layoutOptions?.["elk.port.borderOffset"];
    if (offset !== undefined)
      port.layoutOptions = {
        ...port.layoutOptions,
        "elk.port.borderOffset": String(Number(offset) * factor),
      };
  }
  for (const edge of node.edges ?? []) {
    for (const label of edge.labels ?? []) unitsShape(label, factor);
    for (const point of edge.junctionPoints ?? []) unitsPoint(point, factor);
    for (const section of edge.sections ?? []) {
      unitsPoint(section.startPoint, factor);
      unitsPoint(section.endPoint, factor);
      for (const point of section.bendPoints ?? []) unitsPoint(point, factor);
    }
  }
  for (const child of node.children ?? []) unitsNode(child, factor);
}

/** Uniform coordinate conversion of the entire graph, never endpoint snapping.
 * Clone first: native cache entries and the authored fixed-port model stay intact. */
export function wiringGeometryInUnits(graph: ElkNode, factor: number): ElkNode {
  const copy = structuredClone(graph);
  unitsNode(copy, factor);
  return copy;
}

export function wiringSolverInput(input: ElkNode) {
  const factor = WIRING_UNITS_PER_MM;
  const copy = wiringGeometryInUnits(input, factor);
  const options = { ...copy.layoutOptions };
  for (const [key, value] of Object.entries(options))
    if (key.includes(".spacing.") && Number.isFinite(Number(value)))
      options[key] = String(Number(value) * factor);
  if (options["elk.padding"])
    options["elk.padding"] = options["elk.padding"].replace(
      /-?\d+(?:\.\d+)?/gu,
      (value) => String(Number(value) * factor),
    );
  // Preserve upstream elkjs 0.12 defaults as well as the explicit wiring gaps.
  // eclipse.dev/elk/reference/options/org-eclipse-elk-spacing-edgeLabel.html
  // .../org-eclipse-elk-layered-spacing-edgeNodeBetweenLayers.html
  options["elk.spacing.edgeLabel"] ??= String(2 * factor);
  options["elk.layered.spacing.edgeNodeBetweenLayers"] ??= String(10 * factor);
  copy.layoutOptions = options;
  for (const edge of copy.edges ?? [])
    edge.layoutOptions = {
      ...edge.layoutOptions,
      // ELK's default edge thickness hint is 1 solver unit, not the SVG stroke.
      "elk.edge.thickness": String(
        Number(edge.layoutOptions?.["elk.edge.thickness"] ?? 1) * factor,
      ),
    };
  return copy;
}
