import { contactCaptionRegion } from "../presentation/contact-caption.js";
import type { LayoutLabel, PresentationGraph } from "../types.js";
import type { Bounds, Padding, GeometryIndex } from "./validate-output.js";
import {
  DEVICE_PADDING,
  LOCATION_PADDING,
  ROOT_PADDING,
  LABEL_PORT_HORIZONTAL_SPACING as H,
  LABEL_PORT_VERTICAL_SPACING as V,
} from "./options.js";

interface Checks {
  boundsOf(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Bounds;
  inside(inner: Bounds, outer: Bounds): boolean;
  quantizeLayoutNumber(value: unknown, context: string): number;
  reject(message: string): never;
}

function parentContracts(
  graph: PresentationGraph,
  geometry: Readonly<GeometryIndex>,
  width: number,
  height: number,
  checks: Checks,
) {
  const parents = new Map<string, { bounds: Bounds; padding: Padding }>();
  parents.set("root", {
    bounds: { left: 0, top: 0, right: width, bottom: height },
    padding: ROOT_PADDING,
  });
  for (const group of graph.locationGroups) {
    const layout = geometry.nodes.get(group.id);
    if (!layout) checks.reject(`location ${group.id} is missing`);
    if (
      layout.width < Math.max(32, group.label.width + 16) ||
      layout.height < 54
    )
      checks.reject(`location ${group.id} violates its minimum size`);
    parents.set(group.id, {
      bounds: checks.boundsOf(layout),
      padding: LOCATION_PADDING,
    });
  }
  for (const group of graph.deviceGroups) {
    const layout = geometry.nodes.get(group.id);
    if (!layout) checks.reject(`device ${group.id} is missing`);
    if (
      layout.width < Math.max(16, group.label.width + 16) ||
      layout.height < 38
    )
      checks.reject(`device ${group.id} violates its minimum size`);
    parents.set(group.id, {
      bounds: checks.boundsOf(layout),
      padding: DEVICE_PADDING,
    });
  }
  return parents;
}

function validateLeafHeader(
  graph: PresentationGraph,
  geometry: Readonly<GeometryIndex>,
  label: LayoutLabel,
  checks: Checks,
) {
  const owner = geometry.nodes.get(label.ownerId);
  if (!owner) checks.reject(`label ${label.id} has no leaf owner`);
  const source = graph.nodes.find((n) => n.id === owner.id);
  const box =
    source && source.kind !== "junction" ? source.contentBox : undefined;
  const x = owner.x + (box?.x ?? 0),
    y = owner.y + (box?.y ?? 0);
  const semantic =
    source?.kind === "symbol"
      ? source.labels.find((l) => l.id === label.id)
      : undefined;
  const caption =
    source?.kind === "symbol" && semantic
      ? contactCaptionRegion(source, semantic)
      : undefined;
  if (caption) {
    if (
      Math.abs(label.x - x - caption.x) > 0.002 ||
      Math.abs(label.y - y - caption.y) > 0.002 ||
      caption.x < 0 ||
      caption.y < 0 ||
      caption.x + caption.width > (box?.width ?? owner.width) ||
      caption.y + caption.height > (box?.height ?? owner.height)
    )
      checks.reject(
        `label ${label.id} escapes its owner-nearest contact region`,
      );
    return;
  }
  if (
    label.x < x ||
    label.x + label.width > x + (box?.width ?? owner.width) ||
    label.y < y ||
    label.y + label.height > y + 22
  )
    checks.reject(`label ${label.id} escapes its leaf header`);
}

function validateTerminalLabel(
  geometry: Readonly<GeometryIndex>,
  label: LayoutLabel,
  checks: Checks,
) {
  const port = geometry.ports.get(label.ownerId);
  if (!port) checks.reject(`label ${label.id} has no port owner`);
  const expected =
    port.side === "west"
      ? { x: port.x - label.width - H, y: port.y + V }
      : port.side === "east"
        ? { x: port.x + H, y: port.y + V }
        : port.side === "north"
          ? { x: port.x + V, y: port.y - label.height - H }
          : { x: port.x + V, y: port.y + H };
  if (
    label.x !==
      checks.quantizeLayoutNumber(expected.x, `label ${label.id} expected x`) ||
    label.y !==
      checks.quantizeLayoutNumber(expected.y, `label ${label.id} expected y`)
  )
    checks.reject(
      `terminal label ${label.id} is outside its ELK port placement`,
    );
}

function validateRegionLabel(
  graph: PresentationGraph,
  geometry: Readonly<GeometryIndex>,
  label: LayoutLabel,
  checks: Checks,
) {
  const box = checks.boundsOf(label);
  if (label.role === "location" || label.role === "device") {
    const owner = geometry.nodes.get(label.ownerId);
    if (!owner) checks.reject(`label ${label.id} has no compound owner`);
    if (
      !checks.inside(box, checks.boundsOf(owner)) ||
      label.y < owner.y ||
      label.y + label.height > owner.y + (label.role === "location" ? 38 : 30)
    )
      checks.reject(`label ${label.id} escapes its compound header`);
  } else if (["function", "aggregate", "rail"].includes(label.role))
    validateLeafHeader(graph, geometry, label, checks);
  else if (label.role === "terminal")
    validateTerminalLabel(geometry, label, checks);
  else if (label.role === "off-view") {
    const port = geometry.ports.get(label.ownerId);
    const owner = port && geometry.nodes.get(port.nodeId);
    if (!owner || !checks.inside(box, checks.boundsOf(owner)))
      checks.reject(`off-view label ${label.id} escapes its reserved owner`);
  }
}

export function validateCompoundRegions(
  graph: PresentationGraph,
  geometry: Readonly<GeometryIndex>,
  width: number,
  height: number,
  checks: Checks,
): void {
  const parents = parentContracts(graph, geometry, width, height, checks);
  for (const node of geometry.nodes.values()) {
    const parent = parents.get(node.parentId);
    if (!parent) checks.reject(`node ${node.id} has no layout parent`);
    const content = {
      left: checks.quantizeLayoutNumber(
        parent.bounds.left + parent.padding.left,
        `parent ${node.parentId} content left`,
      ),
      top: checks.quantizeLayoutNumber(
        parent.bounds.top + parent.padding.top,
        `parent ${node.parentId} content top`,
      ),
      right: checks.quantizeLayoutNumber(
        parent.bounds.right - parent.padding.right,
        `parent ${node.parentId} content right`,
      ),
      bottom: checks.quantizeLayoutNumber(
        parent.bounds.bottom - parent.padding.bottom,
        `parent ${node.parentId} content bottom`,
      ),
    };
    if (!checks.inside(checks.boundsOf(node), content))
      checks.reject(`node ${node.id} escapes its parent padding`);
  }
  for (const label of geometry.labels.values())
    validateRegionLabel(graph, geometry, label, checks);
}
