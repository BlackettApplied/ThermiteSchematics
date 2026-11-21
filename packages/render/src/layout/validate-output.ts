import { validateContextInk } from "./context-reference-validation.js";
import { symbolRectangles } from "./symbol-rectangles.js";
import {
  validateLeafSize,
  validateReferenceInput,
  contextReferenceLayouts,
} from "./context-reference-layout.js";
import { validateCompoundRegions } from "./compound-regions.js";
import { contextJunctionInk } from "./context-reference-ink.js";
import "../terminal-context-reference.js";
import { presentationDeviceNames } from "./topology-conservation.js";
import { graphSemanticOrder } from "../semantic-order.js";
import { layoutLabelInk } from "./label-bounds.js";
import {
  netLabelOverlaps,
  segmentIntersectsInterior,
  type NetLabelOverlap,
  type Segment,
} from "./label-overlaps.js";
import type {
  ElkExtendedEdge,
  ElkLabel,
  ElkNode,
  ElkPoint,
  ElkPort,
} from "elkjs/lib/elk-api.js";

import type { InvalidLayoutError } from "../errors.js";
import { comparePresentationLabel, compareText } from "../ordering.js";
import {
  DEFAULT_SYMBOL_STROKE,
  OUTER_SVG_PADDING,
  orientSymbolDefinition,
} from "../symbols/catalog.js";
import type { SymbolDefinition, SymbolPrimitive } from "../symbols/types.js";
import type {
  LayoutCrossing,
  LayoutContextReference,
  LayoutEdge,
  LayoutEdgeSection,
  LayoutLabel,
  LayoutNode,
  LayoutNodeKind,
  LayoutPoint,
  LayoutPort,
  NormalizedSchematicLayout,
  PresentationEdge,
  PresentationGraph,
  PresentationLabel,
  PresentationNode,
  PresentationPort,
} from "../types.js";
import { MAX_SVG_MAGNITUDE } from "../svg/numbers.js";

export { MAX_SVG_MAGNITUDE } from "../svg/numbers.js";

class LayoutContractViolation extends Error {
  readonly netId: string | undefined;

  constructor(
    message: string,
    netId?: string,
    readonly failureKind: LayoutFailureKind = "contract-violation",
    readonly netLabelOverlaps?: readonly NetLabelOverlap[],
  ) {
    super(message);
    this.name = "LayoutContractViolation";
    this.netId = netId;
  }
}

interface RawNodeRecord {
  readonly node: ElkNode;
  readonly parentId: string;
}

interface RawPortRecord {
  readonly port: ElkPort;
  readonly nodeId: string;
}

interface RawLabelRecord {
  readonly label: ElkLabel;
  readonly ownerKind: "node" | "port" | "edge";
  readonly ownerId: string;
}

interface InputIndex {
  readonly nodes: ReadonlyMap<string, RawNodeRecord>;
  readonly ports: ReadonlyMap<string, RawPortRecord>;
  readonly labels: ReadonlyMap<string, RawLabelRecord>;
  readonly edges: ReadonlyMap<string, ElkExtendedEdge>;
  readonly edgeOrder: readonly string[];
}

interface PresentationIndex {
  readonly nodeKind: ReadonlyMap<string, LayoutNodeKind>;
  readonly nodes: ReadonlyMap<string, PresentationNode>;
  readonly labels: ReadonlyMap<string, PresentationLabel>;
  readonly ports: ReadonlyMap<string, PresentationPort>;
  readonly edges: ReadonlyMap<string, PresentationEdge>;
}

export interface GeometryIndex {
  readonly nodes: Map<string, LayoutNode>;
  readonly ports: Map<string, LayoutPort>;
  readonly labels: Map<string, LayoutLabel>;
  readonly edges: Map<string, LayoutEdge>;
}

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Padding {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Layout input invariant: ${message}`);
}

export type LayoutFailureKind =
  | "contract-violation"
  | "ambiguous-intersection"
  | "net-label-intersection"
  | "collinear-overlap"
  | "symbol-intersection";
export type LayoutValidationOutcome =
  | { readonly ok: true; readonly value: NormalizedSchematicLayout }
  | {
      readonly ok: false;
      readonly error: InvalidLayoutError;
      readonly failureKind: LayoutFailureKind;
      readonly netLabelOverlaps?: readonly NetLabelOverlap[];
    };

function reject(
  message: string,
  netId?: string,
  failureKind?: LayoutFailureKind,
  netLabelOverlaps?: readonly NetLabelOverlap[],
): never {
  throw new LayoutContractViolation(
    message,
    netId,
    failureKind,
    netLabelOverlaps,
  );
}

function invalidLayoutError(
  graph: Readonly<PresentationGraph>,
  violation: LayoutContractViolation,
): InvalidLayoutError {
  const names = presentationDeviceNames(graph);
  const terminal = (t: import("@thermite/compiler").TerminalId) => ({
    ...t,
    designation: names.get(t.deviceUid) ?? t.deviceUid,
    functionKeys: [
      ...new Set(
        graph.nodes.flatMap((node) =>
          "deviceUid" in node && node.deviceUid === t.deviceUid
            ? node.ports
                .filter((p) => p.terminal.terminalKey === t.terminalKey)
                .flatMap((p) =>
                  p.memberFunctionId
                    ? [p.memberFunctionId.functionKey]
                    : node.functionIds.map((f) => f.functionKey),
                )
            : [],
        ),
      ),
    ],
  });
  const edges = graph.edges
    .filter((e) => violation.message.includes(e.id))
    .map((e) => ({
      id: e.id,
      designation: e.conductor
        ? e.conductor.kind === "cable-conductor"
          ? `${e.conductor.cableDesignation}/${e.conductor.conductorId}`
          : e.conductor.designation
        : "boundary segment",
      // Diagnostic companions keep their historical structural terminal tuple.
      // This ordering never reaches the adapter or drawing.
      terminals: [...e.endpoints]
        .sort(
          (a, b) =>
            compareText(a.deviceUid, b.deviceUid) ||
            compareText(a.terminalKey, b.terminalKey),
        )
        .map(terminal),
    }));
  let message = violation.message;
  for (const edge of edges)
    message = message.replaceAll(
      edge.id,
      `${edge.designation} (${edge.terminals.map((t) => `${t.designation}.${t.terminalKey}${t.functionKeys.length ? ` / ${[...new Set(t.functionKeys)].join(", ")}` : ""}`).join(" → ")})`,
    );
  for (const [uid, name] of names) message = message.replaceAll(uid, name);
  return Object.freeze({
    code: "R004",
    message: `Invalid layout: ${message}.`,
    ...(message === violation.message
      ? {}
      : {
          details: {
            originalMessage: `Invalid layout: ${violation.message}.`,
            conductors: edges,
          },
        }),
    family: graph.view.family,
    ...(violation.netId === undefined ? {} : { netId: violation.netId }),
    root: graph.view.root.designation,
  });
}

export function quantizeLayoutNumber(value: unknown, context: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_SVG_MAGNITUDE
  ) {
    reject(`${context} is not a finite safe coordinate`);
  }
  const quantized = Number(value.toFixed(3));
  if (!Number.isFinite(quantized) || Math.abs(quantized) > MAX_SVG_MAGNITUDE) {
    reject(`${context} quantizes outside the safe coordinate range`);
  }
  return Object.is(quantized, -0) ? 0 : quantized;
}

function dimension(value: unknown, context: string): number {
  const normalized = quantizeLayoutNumber(value, context);
  if (normalized < 0) reject(`${context} is negative`);
  return normalized;
}

function rawCoordinate(value: unknown, context: string): number {
  quantizeLayoutNumber(value, context);
  return value as number;
}

function requiredId(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0)
    reject(`${context} has no stable ID`);
  return value;
}

function insertInput<Value>(
  map: Map<string, Value>,
  id: string,
  value: Value,
  context: string,
): void {
  invariant(!map.has(id), `duplicate ${context} ${id}`);
  map.set(id, value);
}

function inputIndex(root: Readonly<ElkNode>): InputIndex {
  invariant(root.id === "root", "adapter root ID must be root");
  const nodes = new Map<string, RawNodeRecord>();
  const ports = new Map<string, RawPortRecord>();
  const labels = new Map<string, RawLabelRecord>();
  const edges = new Map<string, ElkExtendedEdge>();
  const visit = (node: Readonly<ElkNode>, parentId: string): void => {
    if (node.id !== "root")
      insertInput(nodes, node.id, { node, parentId }, "node");
    for (const label of node.labels ?? []) {
      invariant(
        typeof label.id === "string",
        `node ${node.id} label has no ID`,
      );
      insertInput(
        labels,
        label.id,
        { label, ownerKind: "node", ownerId: node.id },
        "label",
      );
    }
    for (const port of node.ports ?? []) {
      insertInput(ports, port.id, { port, nodeId: node.id }, "port");
      for (const label of port.labels ?? []) {
        invariant(
          typeof label.id === "string",
          `port ${port.id} label has no ID`,
        );
        insertInput(
          labels,
          label.id,
          { label, ownerKind: "port", ownerId: port.id },
          "label",
        );
      }
    }
    for (const edge of node.edges ?? []) {
      invariant(
        node.id === "root",
        `semantic edge ${edge.id} is not root-owned`,
      );
      insertInput(edges, edge.id, edge, "edge");
      for (const label of edge.labels ?? []) {
        invariant(
          typeof label.id === "string",
          `edge ${edge.id} label has no ID`,
        );
        insertInput(
          labels,
          label.id,
          { label, ownerKind: "edge", ownerId: edge.id },
          "label",
        );
      }
    }
    for (const child of node.children ?? []) visit(child, node.id);
  };
  visit(root, "");
  return {
    nodes,
    ports,
    labels,
    edges,
    edgeOrder: (root.edges ?? []).map(({ id }) => id),
  };
}

function presentationIndex(
  graph: Readonly<PresentationGraph>,
): PresentationIndex {
  const nodeKind = new Map<string, LayoutNodeKind>();
  const nodes = new Map<string, PresentationNode>();
  const labels = new Map<string, PresentationLabel>();
  const ports = new Map<string, PresentationPort>();
  const edges = new Map<string, PresentationEdge>();
  const addLabel = (label: PresentationLabel): void => {
    invariant(
      !labels.has(label.id),
      `duplicate presentation label ${label.id}`,
    );
    labels.set(label.id, label);
  };
  for (const group of graph.locationGroups) {
    invariant(
      !nodeKind.has(group.id),
      `duplicate presentation node ${group.id}`,
    );
    nodeKind.set(group.id, "location");
    addLabel(group.label);
  }
  for (const group of graph.deviceGroups) {
    invariant(
      !nodeKind.has(group.id),
      `duplicate presentation node ${group.id}`,
    );
    nodeKind.set(group.id, "device");
    addLabel(group.label);
  }
  for (const node of graph.nodes) {
    invariant(!nodeKind.has(node.id), `duplicate presentation node ${node.id}`);
    nodeKind.set(
      node.id,
      node.kind === "symbol"
        ? "symbol"
        : node.kind === "rail"
          ? "rail"
          : "junction",
    );
    nodes.set(node.id, node);
    for (const port of node.ports) {
      invariant(!ports.has(port.id), `duplicate presentation port ${port.id}`);
      ports.set(port.id, port);
    }
    if (node.kind !== "junction")
      for (const label of node.labels) addLabel(label);
  }
  for (const edge of graph.edges) {
    invariant(!edges.has(edge.id), `duplicate presentation edge ${edge.id}`);
    edges.set(edge.id, edge);
    if (edge.label !== undefined) addLabel(edge.label);
    if (edge.netLabel !== undefined) addLabel(edge.netLabel);
  }
  return { nodeKind, nodes, labels, ports, edges };
}

function sameIds(
  expected: ReadonlyMap<string, unknown>,
  actual: ReadonlyMap<string, unknown>,
  context: string,
): void {
  if (expected.size !== actual.size) reject(`${context} ID count changed`);
  for (const id of expected.keys())
    if (!actual.has(id)) reject(`${context} ${id} is missing`);
  for (const id of actual.keys())
    if (!expected.has(id)) reject(`unexpected ${context} ${id}`);
}

function samePoint(left: LayoutPoint, right: LayoutPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function point(raw: Readonly<ElkPoint>, context: string): LayoutPoint {
  if (raw === null || typeof raw !== "object") reject(`${context} is missing`);
  return {
    x: quantizeLayoutNumber(raw.x, `${context}.x`),
    y: quantizeLayoutNumber(raw.y, `${context}.y`),
  };
}

function normalizedLabel(
  raw: Readonly<ElkLabel>,
  expected: Readonly<PresentationLabel>,
  rawX: number,
  rawY: number,
): LayoutLabel {
  const x = quantizeLayoutNumber(rawX, `label ${expected.id}.x`);
  const y = quantizeLayoutNumber(rawY, `label ${expected.id}.y`);
  const width = dimension(raw.width, `label ${expected.id}.width`);
  const height = dimension(raw.height, `label ${expected.id}.height`);
  if (width !== expected.width || height !== expected.height)
    reject(`label ${expected.id} dimensions changed`);
  quantizeLayoutNumber(
    rawX + (raw.width as number),
    `label ${expected.id}.right`,
  );
  quantizeLayoutNumber(
    rawY + (raw.height as number),
    `label ${expected.id}.bottom`,
  );
  return {
    id: expected.id,
    ownerKind: expected.ownerKind,
    ownerId: expected.ownerId,
    role: expected.role,
    text: expected.text,
    x,
    y,
    width,
    height,
  };
}

function normalizeNodes(
  output: Readonly<ElkNode>,
  input: Readonly<InputIndex>,
  presentation: Readonly<PresentationIndex>,
  geometry: GeometryIndex,
  graphForReferences: Readonly<PresentationGraph>,
): void {
  if (output.id !== "root") reject("returned root ID changed");
  const rootWidth = dimension(output.width, "root.width");
  const rootHeight = dimension(output.height, "root.height");
  if (output.x !== undefined && quantizeLayoutNumber(output.x, "root.x") !== 0)
    reject("root.x is not zero");
  if (output.y !== undefined && quantizeLayoutNumber(output.y, "root.y") !== 0)
    reject("root.y is not zero");
  quantizeLayoutNumber(rootWidth, "root.right");
  quantizeLayoutNumber(rootHeight, "root.bottom");

  const rawNodes = new Map<string, RawNodeRecord>();
  const rawPorts = new Map<string, RawPortRecord>();
  const rawLabels = new Map<string, RawLabelRecord>();
  const visit = (
    node: Readonly<ElkNode>,
    parentId: string,
    parentRawX: number,
    parentRawY: number,
  ): void => {
    for (const child of node.children ?? []) {
      const id = requiredId(child.id, "returned node");
      if (rawNodes.has(id)) reject(`duplicate returned node ${id}`);
      const expected = input.nodes.get(id);
      if (expected === undefined) reject(`unexpected node ${id}`);
      if (expected.parentId !== parentId)
        reject(`node ${id} returned under the wrong parent`);
      const localX = rawCoordinate(child.x, `node ${id}.x`);
      const localY = rawCoordinate(child.y, `node ${id}.y`);
      const rawX = parentRawX + localX;
      const rawY = parentRawY + localY;
      const x = quantizeLayoutNumber(rawX, `node ${id} absolute x`);
      const y = quantizeLayoutNumber(rawY, `node ${id} absolute y`);
      const width = dimension(child.width, `node ${id}.width`);
      const height = dimension(child.height, `node ${id}.height`);
      quantizeLayoutNumber(rawX + (child.width as number), `node ${id}.right`);
      quantizeLayoutNumber(
        rawY + (child.height as number),
        `node ${id}.bottom`,
      );
      const kind = presentation.nodeKind.get(id);
      if (kind === undefined) reject(`node ${id} has no presentation owner`);
      const semanticNode = presentation.nodes.get(id);
      validateLeafSize(graphForReferences, semanticNode, width, height, reject);
      const primitiveOrigin =
        semanticNode === undefined || semanticNode.kind === "junction"
          ? undefined
          : {
              x: quantizeLayoutNumber(
                rawX + semanticNode.primitiveOrigin.x,
                `node ${id} primitive origin x`,
              ),
              y: quantizeLayoutNumber(
                rawY + semanticNode.primitiveOrigin.y,
                `node ${id} primitive origin y`,
              ),
            };
      geometry.nodes.set(id, {
        id,
        parentId,
        kind,
        x,
        y,
        width,
        height,
        ...(primitiveOrigin === undefined ? {} : { primitiveOrigin }),
      });
      rawNodes.set(id, { node: child, parentId });

      for (const rawLabel of child.labels ?? []) {
        const labelId = requiredId(rawLabel.id, `node ${id} label`);
        if (rawLabels.has(labelId))
          reject(`duplicate returned label ${labelId}`);
        const expectedLabel = presentation.labels.get(labelId);
        const inputLabel = input.labels.get(labelId);
        if (
          expectedLabel === undefined ||
          inputLabel === undefined ||
          inputLabel.ownerKind !== "node" ||
          inputLabel.ownerId !== id
        ) {
          reject(`unexpected label ${labelId}`);
        }
        const labelX = rawCoordinate(rawLabel.x, `label ${labelId}.x`);
        const labelY = rawCoordinate(rawLabel.y, `label ${labelId}.y`);
        if (
          inputLabel.label.x !== undefined ||
          inputLabel.label.y !== undefined
        ) {
          const inputLabelX = rawCoordinate(
            inputLabel.label.x,
            `input label ${labelId}.x`,
          );
          const inputLabelY = rawCoordinate(
            inputLabel.label.y,
            `input label ${labelId}.y`,
          );
          if (
            quantizeLayoutNumber(labelX, `label ${labelId} returned x`) !==
              quantizeLayoutNumber(inputLabelX, `label ${labelId} input x`) ||
            quantizeLayoutNumber(labelY, `label ${labelId} returned y`) !==
              quantizeLayoutNumber(inputLabelY, `label ${labelId} input y`)
          ) {
            reject(`label ${labelId} coordinates changed`);
          }
        }
        geometry.labels.set(
          labelId,
          normalizedLabel(
            rawLabel,
            expectedLabel,
            rawX + labelX,
            rawY + labelY,
          ),
        );
        rawLabels.set(labelId, {
          label: rawLabel,
          ownerKind: "node",
          ownerId: id,
        });
      }

      for (const rawPort of child.ports ?? []) {
        const portId = requiredId(rawPort.id, `node ${id} port`);
        if (rawPorts.has(portId)) reject(`duplicate returned port ${portId}`);
        const expectedPortRecord = input.ports.get(portId);
        const semanticPort = presentation.ports.get(portId);
        if (expectedPortRecord === undefined || semanticPort === undefined)
          reject(`unexpected port ${portId}`);
        if (expectedPortRecord.nodeId !== id)
          reject(`port ${portId} returned on the wrong node`);
        const portLocalX = rawCoordinate(rawPort.x, `port ${portId}.x`);
        const portLocalY = rawCoordinate(rawPort.y, `port ${portId}.y`);
        const portX = quantizeLayoutNumber(
          rawX + portLocalX,
          `port ${portId} absolute x`,
        );
        const portY = quantizeLayoutNumber(
          rawY + portLocalY,
          `port ${portId} absolute y`,
        );
        const portWidth = dimension(rawPort.width, `port ${portId}.width`);
        const portHeight = dimension(rawPort.height, `port ${portId}.height`);
        const expectedLocalX = quantizeLayoutNumber(
          expectedPortRecord.port.x,
          `input port ${portId}.x`,
        );
        const expectedLocalY = quantizeLayoutNumber(
          expectedPortRecord.port.y,
          `input port ${portId}.y`,
        );
        if (
          quantizeLayoutNumber(portLocalX, `port ${portId} local x`) !==
            expectedLocalX ||
          quantizeLayoutNumber(portLocalY, `port ${portId} local y`) !==
            expectedLocalY ||
          portWidth !==
            dimension(
              expectedPortRecord.port.width,
              `input port ${portId}.width`,
            ) ||
          portHeight !==
            dimension(
              expectedPortRecord.port.height,
              `input port ${portId}.height`,
            )
        ) {
          reject(`fixed port ${portId} moved`);
        }
        geometry.ports.set(portId, {
          id: portId,
          nodeId: id,
          side: semanticPort.side,
          x: portX,
          y: portY,
          width: portWidth,
          height: portHeight,
        });
        rawPorts.set(portId, { port: rawPort, nodeId: id });
        for (const rawLabel of rawPort.labels ?? []) {
          const labelId = requiredId(rawLabel.id, `port ${portId} label`);
          if (rawLabels.has(labelId))
            reject(`duplicate returned label ${labelId}`);
          const expectedLabel = presentation.labels.get(labelId);
          if (expectedLabel === undefined)
            reject(`unexpected label ${labelId}`);
          const labelX = rawCoordinate(rawLabel.x, `label ${labelId}.x`);
          const labelY = rawCoordinate(rawLabel.y, `label ${labelId}.y`);
          geometry.labels.set(
            labelId,
            normalizedLabel(
              rawLabel,
              expectedLabel,
              rawX + portLocalX + labelX,
              rawY + portLocalY + labelY,
            ),
          );
          rawLabels.set(labelId, {
            label: rawLabel,
            ownerKind: "port",
            ownerId: portId,
          });
        }
      }
      if ((child.edges?.length ?? 0) > 0)
        reject(`node ${id} contains a non-root edge`);
      visit(child, id, rawX, rawY);
    }
  };
  if ((output.labels?.length ?? 0) > 0 || (output.ports?.length ?? 0) > 0)
    reject("root contains an unexpected label or port");
  visit(output, "root", 0, 0);
  sameIds(input.nodes, rawNodes, "node");
  sameIds(input.ports, rawPorts, "port");
  for (const [id, expected] of input.labels) {
    if (expected.ownerKind !== "edge" && !rawLabels.has(id))
      reject(`label ${id} is missing`);
  }
  for (const [id, actual] of rawLabels) {
    const expected = input.labels.get(id);
    if (
      expected === undefined ||
      expected.ownerKind !== actual.ownerKind ||
      expected.ownerId !== actual.ownerId
    ) {
      reject(`label ${id} returned on the wrong owner`);
    }
  }
}

function normalizedSection(
  raw: Readonly<NonNullable<ElkExtendedEdge["sections"]>[number]>,
  edge: Readonly<PresentationEdge>,
): LayoutEdgeSection {
  const id = requiredId(raw.id, `edge ${edge.id} section`);
  const points = [
    point(raw.startPoint, `section ${id}.startPoint`),
    ...(raw.bendPoints ?? []).map((bend, index) =>
      point(bend, `section ${id}.bendPoints[${index}]`),
    ),
    point(raw.endPoint, `section ${id}.endPoint`),
  ];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (samePoint(previous, current))
      reject(`section ${id} contains a collapsed segment`, edge.netId);
    if (previous.x !== current.x && previous.y !== current.y)
      reject(`section ${id} contains a diagonal segment`, edge.netId);
  }
  return { id, points };
}

function reverseSection(section: LayoutEdgeSection): LayoutEdgeSection {
  return { id: section.id, points: [...section.points].reverse() };
}

function simplifyPoints(
  points: readonly LayoutPoint[],
): readonly LayoutPoint[] {
  const result: LayoutPoint[] = [];
  for (const current of points) {
    const prior = result[result.length - 1];
    if (prior !== undefined && samePoint(prior, current)) continue;
    result.push(current);
    while (result.length >= 3) {
      const first = result[result.length - 3]!;
      const middle = result[result.length - 2]!;
      const last = result[result.length - 1]!;
      if (
        (first.x === middle.x && middle.x === last.x) ||
        (first.y === middle.y && middle.y === last.y)
      ) {
        result.splice(result.length - 2, 1);
      } else {
        break;
      }
    }
  }
  return result;
}

function chainSections(
  sections: readonly LayoutEdgeSection[],
  source: LayoutPoint,
  target: LayoutPoint,
  edge: Readonly<PresentationEdge>,
): Readonly<{
  sections: readonly LayoutEdgeSection[];
  points: readonly LayoutPoint[];
}> {
  const unused = new Map(sections.map((section) => [section.id, section]));
  if (unused.size !== sections.length)
    reject(`edge ${edge.id} has duplicate section IDs`, edge.netId);
  const ordered: LayoutEdgeSection[] = [];
  const points: LayoutPoint[] = [source];
  let current = source;
  while (unused.size > 0) {
    const candidates: LayoutEdgeSection[] = [];
    for (const section of unused.values()) {
      const first = section.points[0]!;
      const last = section.points[section.points.length - 1]!;
      if (samePoint(first, current)) candidates.push(section);
      else if (samePoint(last, current))
        candidates.push(reverseSection(section));
    }
    if (candidates.length !== 1)
      reject(
        `edge ${edge.id} sections are disconnected or branched`,
        edge.netId,
      );
    const next = candidates[0]!;
    ordered.push(next);
    unused.delete(next.id);
    points.push(...next.points.slice(1));
    current = next.points[next.points.length - 1]!;
    if (samePoint(current, target) && unused.size > 0)
      reject(`edge ${edge.id} has sections beyond its target`, edge.netId);
  }
  if (!samePoint(current, target))
    reject(`edge ${edge.id} does not end at its target port`, edge.netId);
  return { sections: ordered, points: simplifyPoints(points) };
}

function normalizeEdges(
  output: Readonly<ElkNode>,
  input: Readonly<InputIndex>,
  presentation: Readonly<PresentationIndex>,
  geometry: GeometryIndex,
): void {
  const rawEdges = new Map<string, ElkExtendedEdge>();
  const rawEdgeLabels = new Map<string, RawLabelRecord>();
  for (const rawEdge of output.edges ?? []) {
    const id = requiredId(rawEdge.id, "returned edge");
    if (rawEdges.has(id)) reject(`duplicate returned edge ${id}`);
    const expectedInput = input.edges.get(id);
    const expected = presentation.edges.get(id);
    if (expectedInput === undefined || expected === undefined)
      reject(`unexpected edge ${id}`);
    if (
      !Array.isArray(rawEdge.sources) ||
      !Array.isArray(rawEdge.targets) ||
      rawEdge.sources.length !== 1 ||
      rawEdge.targets.length !== 1 ||
      rawEdge.sources[0] !== expected.sourcePortId ||
      rawEdge.targets[0] !== expected.targetPortId
    ) {
      reject(`edge ${id} attachment changed`, expected.netId);
    }
    if ((rawEdge.junctionPoints?.length ?? 0) > 0)
      reject(`edge ${id} implies an ELK junction`, expected.netId);
    const source = geometry.ports.get(expected.sourcePortId);
    const target = geometry.ports.get(expected.targetPortId);
    if (source === undefined || target === undefined)
      reject(`edge ${id} references a missing port`, expected.netId);
    if (rawEdge.sections === undefined || rawEdge.sections.length === 0)
      reject(`edge ${id} has no sections`, expected.netId);
    const sections = rawEdge.sections.map((section) =>
      normalizedSection(section, expected),
    );
    const chained = chainSections(
      sections,
      { x: source.x, y: source.y },
      { x: target.x, y: target.y },
      expected,
    );
    geometry.edges.set(id, {
      id,
      kind: expected.kind,
      netId: expected.netId,
      sourcePortId: expected.sourcePortId,
      targetPortId: expected.targetPortId,
      sectionIds: chained.sections.map(({ id: sectionId }) => sectionId),
      sections: chained.sections,
      points: chained.points,
    });
    rawEdges.set(id, rawEdge);
    for (const rawLabel of rawEdge.labels ?? []) {
      const labelId = requiredId(rawLabel.id, `edge ${id} label`);
      if (rawEdgeLabels.has(labelId))
        reject(`duplicate returned edge label ${labelId}`, expected.netId);
      const expectedLabel = presentation.labels.get(labelId);
      const inputLabel = input.labels.get(labelId);
      if (
        expectedLabel === undefined ||
        inputLabel === undefined ||
        inputLabel.ownerKind !== "edge" ||
        inputLabel.ownerId !== id
      ) {
        reject(`unexpected edge label ${labelId}`, expected.netId);
      }
      const labelX = rawCoordinate(rawLabel.x, `label ${labelId}.x`);
      const labelY = rawCoordinate(rawLabel.y, `label ${labelId}.y`);
      geometry.labels.set(
        labelId,
        normalizedLabel(rawLabel, expectedLabel, labelX, labelY),
      );
      rawEdgeLabels.set(labelId, {
        label: rawLabel,
        ownerKind: "edge",
        ownerId: id,
      });
    }
  }
  sameIds(input.edges, rawEdges, "edge");
  for (const [id, expected] of input.labels) {
    if (expected.ownerKind === "edge" && !rawEdgeLabels.has(id))
      reject(`edge label ${id} is missing`);
  }
}

function boundsOf(
  rect: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>,
): Bounds {
  return {
    left: rect.x,
    top: rect.y,
    right: quantizeLayoutNumber(rect.x + rect.width, "rectangle right"),
    bottom: quantizeLayoutNumber(rect.y + rect.height, "rectangle bottom"),
  };
}

function inside(inner: Bounds, outer: Bounds): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom
  );
}

function positiveAreaIntersection(left: Bounds, right: Bounds): boolean {
  return (
    Math.min(left.right, right.right) > Math.max(left.left, right.left) &&
    Math.min(left.bottom, right.bottom) > Math.max(left.top, right.top)
  );
}

function normalizedAngle(value: number): number {
  const fullTurn = 2 * Math.PI;
  const normalized = value % fullTurn;
  return normalized < 0 ? normalized + fullTurn : normalized;
}

function angleOnSweep(angle: number, start: number, delta: number): boolean {
  const epsilon = 1e-12;
  return delta >= 0
    ? normalizedAngle(angle - start) <= delta + epsilon
    : normalizedAngle(start - angle) <= -delta + epsilon;
}

function arcBounds(
  primitive: Extract<SymbolPrimitive, { readonly kind: "arc" }>,
): Bounds {
  let radiusX = Math.abs(primitive.radiusX);
  let radiusY = Math.abs(primitive.radiusY);
  const deltaX = (primitive.from.x - primitive.to.x) / 2;
  const deltaY = (primitive.from.y - primitive.to.y) / 2;
  const scale =
    (deltaX * deltaX) / (radiusX * radiusX) +
    (deltaY * deltaY) / (radiusY * radiusY);
  if (scale > 1) {
    const factor = Math.sqrt(scale);
    radiusX *= factor;
    radiusY *= factor;
  }
  const radiusXSquared = radiusX * radiusX;
  const radiusYSquared = radiusY * radiusY;
  const denominator =
    radiusXSquared * deltaY * deltaY + radiusYSquared * deltaX * deltaX;
  const numerator = Math.max(0, radiusXSquared * radiusYSquared - denominator);
  const sign = primitive.clockwise ? 1 : -1;
  const coefficient =
    denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const centerPrimeX = (coefficient * radiusX * deltaY) / radiusY;
  const centerPrimeY = (-coefficient * radiusY * deltaX) / radiusX;
  const centerX = centerPrimeX + (primitive.from.x + primitive.to.x) / 2;
  const centerY = centerPrimeY + (primitive.from.y + primitive.to.y) / 2;
  const startVector = {
    x: (deltaX - centerPrimeX) / radiusX,
    y: (deltaY - centerPrimeY) / radiusY,
  };
  const endVector = {
    x: (-deltaX - centerPrimeX) / radiusX,
    y: (-deltaY - centerPrimeY) / radiusY,
  };
  const startAngle = Math.atan2(startVector.y, startVector.x);
  let deltaAngle = Math.atan2(
    startVector.x * endVector.y - startVector.y * endVector.x,
    startVector.x * endVector.x + startVector.y * endVector.y,
  );
  if (primitive.clockwise && deltaAngle < 0) deltaAngle += 2 * Math.PI;
  if (!primitive.clockwise && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  const points: LayoutPoint[] = [primitive.from, primitive.to];
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    if (!angleOnSweep(angle, startAngle, deltaAngle)) continue;
    points.push({
      x: centerX + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle),
    });
  }
  return {
    left: Math.min(...points.map(({ x }) => x)),
    top: Math.min(...points.map(({ y }) => y)),
    right: Math.max(...points.map(({ x }) => x)),
    bottom: Math.max(...points.map(({ y }) => y)),
  };
}

function primitiveLocalBounds(primitive: Readonly<SymbolPrimitive>): Bounds {
  let points: readonly LayoutPoint[];
  switch (primitive.kind) {
    case "line":
      points = [primitive.from, primitive.to];
      break;
    case "polyline":
      points = primitive.points;
      break;
    case "rect":
      points = [
        { x: primitive.x, y: primitive.y },
        {
          x: primitive.x + primitive.width,
          y: primitive.y + primitive.height,
        },
      ];
      break;
    case "circle":
      points = [
        {
          x: primitive.center.x - primitive.radius,
          y: primitive.center.y - primitive.radius,
        },
        {
          x: primitive.center.x + primitive.radius,
          y: primitive.center.y + primitive.radius,
        },
      ];
      break;
    case "arc":
      return arcBounds(primitive);
  }
  return {
    left: Math.min(...points.map(({ x }) => x)),
    top: Math.min(...points.map(({ y }) => y)),
    right: Math.max(...points.map(({ x }) => x)),
    bottom: Math.max(...points.map(({ y }) => y)),
  };
}

function translatedPrimitiveBounds(
  graph: Readonly<PresentationGraph>,
  geometry: Readonly<GeometryIndex>,
  catalog: readonly SymbolDefinition[],
): ReadonlyMap<string, readonly Bounds[]> {
  const symbols = new Map(catalog.map((symbol) => [symbol.id, symbol]));
  const result = new Map<string, readonly Bounds[]>();
  for (const node of graph.nodes) {
    if (node.kind === "junction") continue;
    const symbol = symbols.get(node.symbolId);
    invariant(symbol !== undefined, `symbol ${node.symbolId} is missing`);
    const oriented = orientSymbolDefinition(symbol, node.orientation);
    const layout = geometry.nodes.get(node.id);
    if (layout?.primitiveOrigin === undefined)
      reject(`node ${node.id} has no primitive origin`);
    result.set(
      node.id,
      oriented.primitives.map((primitive) => {
        const local = primitiveLocalBounds(primitive);
        const inflation = DEFAULT_SYMBOL_STROKE / 2;
        return {
          left: quantizeLayoutNumber(
            layout.primitiveOrigin!.x + local.left - inflation,
            `node ${node.id} primitive left`,
          ),
          top: quantizeLayoutNumber(
            layout.primitiveOrigin!.y + local.top - inflation,
            `node ${node.id} primitive top`,
          ),
          right: quantizeLayoutNumber(
            layout.primitiveOrigin!.x + local.right + inflation,
            `node ${node.id} primitive right`,
          ),
          bottom: quantizeLayoutNumber(
            layout.primitiveOrigin!.y + local.bottom + inflation,
            `node ${node.id} primitive bottom`,
          ),
        };
      }),
    );
  }
  return result;
}

function edgeSegments(edge: LayoutEdge): readonly Segment[] {
  const result: Segment[] = [];
  for (let index = 1; index < edge.points.length; index++) {
    const start = edge.points[index - 1]!;
    const end = edge.points[index]!;
    if (samePoint(start, end)) reject(`edge ${edge.id} collapsed`, edge.netId);
    if (start.x !== end.x && start.y !== end.y)
      reject(`edge ${edge.id} is diagonal`, edge.netId);
    result.push({ edge, start, end, horizontal: start.y === end.y });
  }
  return result;
}

function validateNodeAndLabelCollisions(
  graph: Readonly<PresentationGraph>,
  geometry: Readonly<GeometryIndex>,
  catalog: readonly SymbolDefinition[],
  segments: readonly Segment[],
  references: readonly LayoutContextReference[],
  captions: ReadonlyMap<string, PresentationLabel>,
): void {
  const primitiveBounds = translatedPrimitiveBounds(graph, geometry, catalog);
  const rectangles = symbolRectangles(graph, geometry, reject);
  for (const segment of segments) {
    for (const [nodeId, bounds] of rectangles) {
      if (segmentIntersectsInterior(segment, bounds))
        reject(
          `edge ${segment.edge.id} crosses symbol ${nodeId}`,
          segment.edge.netId,
          "symbol-intersection",
        );
    }
  }
  const labels = [...geometry.labels.values()];
  const inkBounds = (label: LayoutLabel) =>
    layoutLabelInk(label, captions, geometry.edges, reject);
  for (const label of labels) {
    const labelBounds = inkBounds(label);
    for (const [nodeId, boundsList] of primitiveBounds) {
      if (
        boundsList.some((bounds) =>
          positiveAreaIntersection(labelBounds, bounds),
        )
      ) {
        reject(`label ${label.id} overlaps symbol ${nodeId}`);
      }
    }
    for (const segment of segments) {
      if (!segmentIntersectsInterior(segment, labelBounds)) continue;
      reject(
        `label ${label.id} overlaps edge ${segment.edge.id}`,
        segment.edge.netId,
        label.role === "net" ? "net-label-intersection" : undefined,
        netLabelOverlaps(graph.view, label, labels, segments, inkBounds),
      );
    }
  }
  if (references.length)
    validateContextInk(
      graph,
      geometry,
      references,
      primitiveBounds,
      segments,
      inkBounds,
      reject,
    );
  for (let leftIndex = 0; leftIndex < labels.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < labels.length;
      rightIndex++
    ) {
      const left = labels[leftIndex]!;
      const right = labels[rightIndex]!;
      if (positiveAreaIntersection(inkBounds(left), inkBounds(right)))
        reject(`labels ${left.id} and ${right.id} overlap`);
    }
  }
}

function between(value: number, first: number, second: number): boolean {
  return value >= Math.min(first, second) && value <= Math.max(first, second);
}

function segmentIntersection(
  left: Segment,
  right: Segment,
):
  | { readonly kind: "none" }
  | { readonly kind: "point"; readonly point: LayoutPoint }
  | { readonly kind: "overlap" } {
  if (left.horizontal === right.horizontal) {
    const sameAxis = left.horizontal
      ? left.start.y === right.start.y
      : left.start.x === right.start.x;
    if (!sameAxis) return { kind: "none" };
    const leftStart = left.horizontal ? left.start.x : left.start.y;
    const leftEnd = left.horizontal ? left.end.x : left.end.y;
    const rightStart = right.horizontal ? right.start.x : right.start.y;
    const rightEnd = right.horizontal ? right.end.x : right.end.y;
    const start = Math.max(
      Math.min(leftStart, leftEnd),
      Math.min(rightStart, rightEnd),
    );
    const end = Math.min(
      Math.max(leftStart, leftEnd),
      Math.max(rightStart, rightEnd),
    );
    if (end < start) return { kind: "none" };
    if (end > start) return { kind: "overlap" };
    return {
      kind: "point",
      point: left.horizontal
        ? { x: start, y: left.start.y }
        : { x: left.start.x, y: start },
    };
  }
  const horizontal = left.horizontal ? left : right;
  const vertical = left.horizontal ? right : left;
  const candidate = { x: vertical.start.x, y: horizontal.start.y };
  return between(candidate.x, horizontal.start.x, horizontal.end.x) &&
    between(candidate.y, vertical.start.y, vertical.end.y)
    ? { kind: "point", point: candidate }
    : { kind: "none" };
}

function edgeEndpoint(edge: LayoutEdge, pointValue: LayoutPoint): boolean {
  return (
    samePoint(edge.points[0]!, pointValue) ||
    samePoint(edge.points[edge.points.length - 1]!, pointValue)
  );
}

function segmentEndpoint(segment: Segment, pointValue: LayoutPoint): boolean {
  return (
    samePoint(segment.start, pointValue) || samePoint(segment.end, pointValue)
  );
}

function allowedConnectionPoints(
  graph: Readonly<PresentationGraph>,
  geometry: Readonly<GeometryIndex>,
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== "junction" && node.classification !== "terminal")
      continue;
    for (const port of node.ports) {
      const layout = geometry.ports.get(port.id);
      if (layout !== undefined) result.add(`${layout.x},${layout.y}`);
    }
  }
  return result;
}

function validateJunctions(
  graph: Readonly<PresentationGraph>,
  geometry: Readonly<GeometryIndex>,
  references: readonly LayoutContextReference[],
): void {
  for (const node of graph.nodes) {
    if (node.kind !== "junction") continue;
    const layout = geometry.nodes.get(node.id);
    if (layout === undefined)
      reject(`junction ${node.id} is missing`, node.netId);
    const ink = contextJunctionInk(graph, node);
    const center = {
      x: quantizeLayoutNumber(
        layout.x + ink.anchor.x,
        `junction ${node.id} center x`,
      ),
      y: quantizeLayoutNumber(
        layout.y + ink.anchor.y,
        `junction ${node.id} center y`,
      ),
    };
    for (const port of node.ports) {
      const portLayout = geometry.ports.get(port.id);
      if (
        portLayout === undefined ||
        portLayout.x !== center.x ||
        portLayout.y !== center.y
      ) {
        reject(`junction ${node.id} port is off-center`, node.netId);
      }
      const incident = [...geometry.edges.values()].filter(
        (edge) =>
          edge.sourcePortId === port.id || edge.targetPortId === port.id,
      );
      const reference = references.filter(
        (r) => r.sourcePortId === port.id || r.targetPortId === port.id,
      );
      if (incident.length + reference.length !== 1)
        reject(`junction ${node.id} port incidence changed`, node.netId);
      const r = reference[0];
      if (r) {
        const origin = r.leaders[r.sourcePortId === port.id ? 0 : 1][0];
        if (!origin || !samePoint(origin, center))
          reject(`junction ${node.id} reference is off-center`, node.netId);
        continue;
      }
      const edge = incident[0]!;
      const endpoint =
        edge.sourcePortId === port.id
          ? edge.points[0]!
          : edge.points[edge.points.length - 1]!;
      if (!samePoint(endpoint, center))
        reject(`junction ${node.id} edge is off-center`, node.netId);
    }
  }
}

function validateRouteInteractions(
  graph: Readonly<PresentationGraph>,
  geometry: Readonly<GeometryIndex>,
  segments: readonly Segment[],
): readonly LayoutCrossing[] {
  const allowed = allowedConnectionPoints(graph, geometry);
  const crossings = new Map<string, LayoutCrossing>();
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segments.length;
      rightIndex++
    ) {
      const left = segments[leftIndex]!;
      const right = segments[rightIndex]!;
      if (left.edge.id === right.edge.id) continue;
      const intersection = segmentIntersection(left, right);
      if (intersection.kind === "none") continue;
      if (intersection.kind === "overlap")
        reject(
          `edges ${left.edge.id} and ${right.edge.id} overlap collinearly`,
          left.edge.netId,
          "collinear-overlap",
        );
      const pointValue = intersection.point;
      const leftEdgeEndpoint = edgeEndpoint(left.edge, pointValue);
      const rightEdgeEndpoint = edgeEndpoint(right.edge, pointValue);
      const sameNet = left.edge.netId === right.edge.netId;
      if (
        sameNet &&
        leftEdgeEndpoint &&
        rightEdgeEndpoint &&
        allowed.has(`${pointValue.x},${pointValue.y}`)
      ) {
        continue;
      }
      if (
        !sameNet &&
        !segmentEndpoint(left, pointValue) &&
        !segmentEndpoint(right, pointValue) &&
        left.horizontal !== right.horizontal
      ) {
        const edgeIds = [left.edge.id, right.edge.id].sort(compareText) as [
          string,
          string,
        ];
        const first = geometry.edges.get(edgeIds[0])!;
        const second = geometry.edges.get(edgeIds[1])!;
        const key = `${edgeIds[0]}\u0000${edgeIds[1]}\u0000${pointValue.x},${pointValue.y}`;
        crossings.set(key, {
          edgeIds,
          netIds: [first.netId, second.netId],
          point: pointValue,
        });
        continue;
      }
      reject(
        `edges ${left.edge.id} and ${right.edge.id} form an ambiguous intersection`,
        left.edge.netId,
        "ambiguous-intersection",
      );
    }
  }
  return [...crossings.values()].sort(
    (left, right) =>
      compareText(left.edgeIds[0], right.edgeIds[0]) ||
      compareText(left.edgeIds[1], right.edgeIds[1]) ||
      left.point.x - right.point.x ||
      left.point.y - right.point.y,
  );
}

function validateFinalBounds(
  graph: Readonly<PresentationGraph>,
  geometry: Readonly<GeometryIndex>,
  rootWidth: number,
  rootHeight: number,
  catalog: readonly SymbolDefinition[],
): void {
  const xValues: number[] = [0, rootWidth];
  const yValues: number[] = [0, rootHeight];
  const addBox = (
    box: Readonly<{ x: number; y: number; width: number; height: number }>,
  ): void => {
    xValues.push(box.x, box.x + box.width);
    yValues.push(box.y, box.y + box.height);
  };
  for (const node of geometry.nodes.values()) addBox(node);
  for (const port of geometry.ports.values()) addBox(port);
  for (const label of geometry.labels.values()) addBox(label);
  for (const edge of geometry.edges.values()) {
    for (const pointValue of edge.points) {
      xValues.push(pointValue.x);
      yValues.push(pointValue.y);
    }
  }
  for (const boundsList of translatedPrimitiveBounds(
    graph,
    geometry,
    catalog,
  ).values()) {
    for (const bounds of boundsList) {
      xValues.push(bounds.left, bounds.right);
      yValues.push(bounds.top, bounds.bottom);
    }
  }
  for (const [index, value] of xValues.entries()) {
    quantizeLayoutNumber(value, `final x bound ${index}`);
    quantizeLayoutNumber(
      value + OUTER_SVG_PADDING,
      `translated x bound ${index}`,
    );
  }
  for (const [index, value] of yValues.entries()) {
    quantizeLayoutNumber(value, `final y bound ${index}`);
    quantizeLayoutNumber(
      value + OUTER_SVG_PADDING,
      `translated y bound ${index}`,
    );
  }
  quantizeLayoutNumber(
    Math.max(...xValues) - Math.min(...xValues),
    "final x extent",
  );
  quantizeLayoutNumber(
    Math.max(...yValues) - Math.min(...yValues),
    "final y extent",
  );
  const paddedWidth = quantizeLayoutNumber(
    rootWidth + OUTER_SVG_PADDING * 2,
    "padded viewBox width",
  );
  const paddedHeight = quantizeLayoutNumber(
    rootHeight + OUTER_SVG_PADDING * 2,
    "padded viewBox height",
  );
  const translatedLeft = quantizeLayoutNumber(
    Math.min(...xValues) + OUTER_SVG_PADDING,
    "translated geometry left",
  );
  const translatedTop = quantizeLayoutNumber(
    Math.min(...yValues) + OUTER_SVG_PADDING,
    "translated geometry top",
  );
  const translatedRight = quantizeLayoutNumber(
    Math.max(...xValues) + OUTER_SVG_PADDING,
    "translated geometry right",
  );
  const translatedBottom = quantizeLayoutNumber(
    Math.max(...yValues) + OUTER_SVG_PADDING,
    "translated geometry bottom",
  );
  if (
    translatedLeft < 0 ||
    translatedTop < 0 ||
    translatedRight > paddedWidth ||
    translatedBottom > paddedHeight
  ) {
    reject("translated geometry escapes the padded viewBox");
  }
  for (const port of geometry.ports.values()) {
    const owner = geometry.nodes.get(port.nodeId);
    if (owner?.primitiveOrigin === undefined) continue;
    quantizeLayoutNumber(
      port.x + port.width / 2 - owner.primitiveOrigin.x,
      `translated port ${port.id} x`,
    );
    quantizeLayoutNumber(
      port.y + port.height / 2 - owner.primitiveOrigin.y,
      `translated port ${port.id} y`,
    );
  }
}

function freezeLayout(
  layout: NormalizedSchematicLayout,
): NormalizedSchematicLayout {
  for (const edge of layout.edges) {
    for (const section of edge.sections) Object.freeze(section.points);
    Object.freeze(edge.sections);
    Object.freeze(edge.sectionIds);
    Object.freeze(edge.points);
    Object.freeze(edge);
  }
  for (const crossing of layout.crossings) {
    Object.freeze(crossing.edgeIds);
    Object.freeze(crossing.netIds);
    Object.freeze(crossing.point);
    Object.freeze(crossing);
  }
  for (const collection of [layout.nodes, layout.ports, layout.labels]) {
    for (const value of collection) Object.freeze(value);
    Object.freeze(collection);
  }
  Object.freeze(layout.edges);
  Object.freeze(layout.crossings);
  if (layout.contextReferences) {
    for (const reference of layout.contextReferences) {
      for (const leader of reference.leaders) Object.freeze(leader);
      Object.freeze(reference.leaders);
      Object.freeze(reference);
    }
    Object.freeze(layout.contextReferences);
  }
  return Object.freeze(layout);
}

function validateLayoutRegions(
  graph: PresentationGraph,
  geometry: GeometryIndex,
  width: number,
  height: number,
) {
  validateCompoundRegions(graph, geometry, width, height, {
    boundsOf,
    inside,
    quantizeLayoutNumber,
    reject,
  });
}

function validateInputCounts(
  input: InputIndex,
  presentation: PresentationIndex,
) {
  invariant(
    input.nodes.size === presentation.nodeKind.size,
    "adapter nodes do not match presentation nodes",
  );
  invariant(
    input.ports.size === presentation.ports.size,
    "adapter ports do not match presentation ports",
  );
  invariant(
    input.labels.size === presentation.labels.size,
    "adapter labels do not match presentation labels",
  );
}

export function normalizeAndValidateLayout(
  graph: Readonly<PresentationGraph>,
  adapterInput: Readonly<ElkNode>,
  elkOutput: Readonly<ElkNode>,
  catalog: readonly SymbolDefinition[],
): LayoutValidationOutcome {
  const input = inputIndex(adapterInput);
  const presentation = presentationIndex(graph);
  validateInputCounts(input, presentation);
  validateReferenceInput(graph, input.edges, input.labels, invariant);
  try {
    const geometry: GeometryIndex = {
      nodes: new Map(),
      ports: new Map(),
      labels: new Map(),
      edges: new Map(),
    };
    normalizeNodes(elkOutput, input, presentation, geometry, graph);
    normalizeEdges(elkOutput, input, presentation, geometry);
    sameIds(input.labels, geometry.labels, "label");
    const rootWidth = dimension(elkOutput.width, "root.width");
    const rootHeight = dimension(elkOutput.height, "root.height");
    validateLayoutRegions(graph, geometry, rootWidth, rootHeight);
    const edges = input.edgeOrder.map((id) => {
      const edge = geometry.edges.get(id);
      if (edge === undefined) reject(`edge ${id} is missing`);
      return edge;
    });
    const segments = edges.flatMap(edgeSegments);
    const references = contextReferenceLayouts(graph, geometry.ports, reject);
    validateJunctions(graph, geometry, references);
    validateNodeAndLabelCollisions(
      graph,
      geometry,
      catalog,
      segments,
      references,
      presentation.labels,
    );
    const crossings = validateRouteInteractions(graph, geometry, segments);
    validateFinalBounds(graph, geometry, rootWidth, rootHeight, catalog);
    const order = graphSemanticOrder(graph);
    const labels = [...presentation.labels.values()]
      .sort((a, b) => comparePresentationLabel(a, b, order.key))
      .map((label) => geometry.labels.get(label.id)!);
    return {
      ok: true,
      value: freezeLayout({
        format: "schematic-layout/0.1",
        view: structuredClone(graph.view),
        width: rootWidth,
        height: rootHeight,
        nodes: [...geometry.nodes.values()].sort((left, right) =>
          compareText(left.id, right.id),
        ),
        ports: [...geometry.ports.values()].sort((left, right) =>
          compareText(left.id, right.id),
        ),
        labels,
        edges,
        crossings,
        ...(references.length ? { contextReferences: references } : {}),
      }),
    };
  } catch (error) {
    if (error instanceof LayoutContractViolation)
      return layoutFailure(error, invalidLayoutError(graph, error));
    throw error;
  }
}

function layoutFailure(
  violation: LayoutContractViolation,
  error: InvalidLayoutError,
): LayoutValidationOutcome {
  return {
    ok: false,
    error,
    failureKind: violation.failureKind,
    ...(violation.netLabelOverlaps
      ? { netLabelOverlaps: violation.netLabelOverlaps }
      : {}),
  };
}
