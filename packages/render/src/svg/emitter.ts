import type { ConductiveElementId, TerminalId } from "@thermite/compiler";

import { comparePresentationLabel, compareText } from "../ordering.js";
import {
  DEFAULT_SYMBOL_STROKE,
  OUTER_SVG_PADDING,
  SYMBOL_CATALOG,
  orientSymbolDefinition,
} from "../symbols/catalog.js";
import type {
  SymbolDefinition,
  SymbolPrimitive,
  SymbolStyle,
} from "../symbols/types.js";
import type { SchematicTitleContext } from "../title-block.js";
import type {
  LayoutEdge,
  LayoutLabel,
  LayoutNode,
  LayoutPoint,
  NormalizedSchematicLayout,
  PresentationEdge,
  PresentationGraph,
  PresentationLabel,
  PresentationPort,
  RailPresentationNode,
  RenderOutcome,
  SymbolPresentationNode,
} from "../types.js";
import {
  LAYOUT_CONFIG_VERSION,
  RENDERER_VERSION,
  SYMBOL_CATALOG_VERSION,
} from "../types.js";
import {
  decodeSvgSemanticId,
  escapeXmlAttribute,
  escapeXmlText,
  preflightRenderText,
  preflightTitleRenderText,
  svgSemanticId,
} from "./escape.js";
import { formatSvgNumber } from "./numbers.js";
import {
  buildRenderSourceRegistry,
  type RenderSourceRegistry,
} from "./source-registry.js";

type SvgElementName =
  | "circle"
  | "clipPath"
  | "defs"
  | "desc"
  | "g"
  | "line"
  | "path"
  | "polyline"
  | "rect"
  | "style"
  | "svg"
  | "text"
  | "title";

type SvgAttributeName =
  | "aria-label"
  | "class"
  | "clip-path"
  | "clipPathUnits"
  | "cx"
  | "cy"
  | "d"
  | `data-${string}`
  | "dominant-baseline"
  | "fill"
  | "font-family"
  | "font-size"
  | "height"
  | "id"
  | "lengthAdjust"
  | "points"
  | "r"
  | "role"
  | "rx"
  | "ry"
  | "stroke"
  | "stroke-linecap"
  | "stroke-linejoin"
  | "stroke-width"
  | "text-anchor"
  | "textLength"
  | "transform"
  | "version"
  | "viewBox"
  | "width"
  | "x"
  | "x1"
  | "x2"
  | "xmlns"
  | "y"
  | "y1"
  | "y2";

type SvgAttributeValue = string | number | undefined;
type SvgAttributes = Readonly<
  Partial<Record<SvgAttributeName, SvgAttributeValue>>
>;

const FIXED_ATTRIBUTE_ORDER = Object.freeze([
  "xmlns",
  "version",
  "viewBox",
  "width",
  "height",
  "id",
  "class",
  "clipPathUnits",
  "clip-path",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "font-family",
  "font-size",
  "text-anchor",
  "dominant-baseline",
  "textLength",
  "lengthAdjust",
  "role",
  "aria-label",
] as const satisfies readonly Exclude<SvgAttributeName, `data-${string}`>[]);

const FIXED_DATA_ATTRIBUTE_ORDER = Object.freeze([
  "data-location",
  "data-virtual-location",
  "data-boundary-kind",
  "data-device-uid",
  "data-designation",
  "data-type-id",
  "data-function-key",
  "data-aggregate-key",
  "data-terminal-key",
  "data-member-function-key",
  "data-net-id",
  "data-potential-uid",
  "data-potential-name",
  "data-wire-uid",
  "data-jumper-uid",
  "data-cable-uid",
  "data-conductor-id",
  "data-presentation-only",
] as const);

const PREFIXED_DATA_ATTRIBUTE_ORDER = Object.freeze([
  "data-project-name",
  "data-project-revision",
  "data-tool-version",
  "data-view-format",
  "data-view-family",
  "data-view-intent",
  "data-view-flow",
  "data-renderer-version",
  "data-symbol-catalog-version",
] as const);

const BUILT_IN_STYLE =
  ".location-frame{fill:#f7f8fa;stroke:#667085;stroke-width:1.5}.device-frame{fill:#fff;stroke:#98a2b3;stroke-width:1.5}.net-path{fill:none;stroke:#101828;stroke-width:1.5;stroke-linecap:square;stroke-linejoin:miter}.boundary-path{fill:none;stroke:#475467;stroke-width:1.5;stroke-linecap:square;stroke-linejoin:miter}.symbol-body,.symbol-operator,.symbol-actuator,.symbol-annotation{fill:none;stroke:#101828;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.symbol-terminal{fill:#fff;stroke:#101828;stroke-width:1.5}.terminal-marker{fill:#fff;stroke:#101828;stroke-width:1.5}.junction-dot{fill:#101828;stroke:none}.label-background{fill:#fff;stroke:none}.label-text{fill:#101828;stroke:none}";

function dataAttributeRank(name: string): number {
  if (name.startsWith("data-view-")) return 0;
  if (name.startsWith("data-renderer-")) return 1;
  if (name.startsWith("data-symbol-")) return 2;
  const fixed = FIXED_DATA_ATTRIBUTE_ORDER.indexOf(
    name as (typeof FIXED_DATA_ATTRIBUTE_ORDER)[number],
  );
  return fixed < 0 ? 100 : fixed + 3;
}

function compareAttributeNames(left: string, right: string): number {
  const leftFixed = FIXED_ATTRIBUTE_ORDER.indexOf(
    left as (typeof FIXED_ATTRIBUTE_ORDER)[number],
  );
  const rightFixed = FIXED_ATTRIBUTE_ORDER.indexOf(
    right as (typeof FIXED_ATTRIBUTE_ORDER)[number],
  );
  if (leftFixed >= 0 || rightFixed >= 0) {
    return (
      (leftFixed < 0 ? 1_000 : leftFixed) -
      (rightFixed < 0 ? 1_000 : rightFixed)
    );
  }
  const leftPrefixed = PREFIXED_DATA_ATTRIBUTE_ORDER.indexOf(left as never);
  const rightPrefixed = PREFIXED_DATA_ATTRIBUTE_ORDER.indexOf(right as never);
  if (leftPrefixed >= 0 && rightPrefixed >= 0)
    return leftPrefixed - rightPrefixed;
  const rank = dataAttributeRank(left) - dataAttributeRank(right);
  return rank || compareText(left, right);
}

function serializedAttributes(attributes: SvgAttributes): string {
  return Object.entries(attributes)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    )
    .sort(([left], [right]) => compareAttributeNames(left, right))
    .map(([name, raw]) => {
      if (
        !name.startsWith("data-") &&
        !FIXED_ATTRIBUTE_ORDER.includes(name as never)
      ) {
        throw new Error(`SVG emitter rejected attribute ${name}.`);
      }
      const value = typeof raw === "number" ? formatSvgNumber(raw) : raw;
      return ` ${name}="${escapeXmlAttribute(value)}"`;
    })
    .join("");
}

class SvgWriter {
  readonly lines: string[] = [];

  element(
    indent: number,
    name: SvgElementName,
    attributes: SvgAttributes = {},
    text?: string,
  ): void {
    const prefix = "  ".repeat(indent);
    const attrs = serializedAttributes(attributes);
    this.lines.push(
      text === undefined
        ? `${prefix}<${name}${attrs}/>`
        : `${prefix}<${name}${attrs}>${escapeXmlText(text)}</${name}>`,
    );
  }

  open(
    indent: number,
    name: SvgElementName,
    attributes: SvgAttributes = {},
  ): void {
    this.lines.push(
      `${"  ".repeat(indent)}<${name}${serializedAttributes(attributes)}>`,
    );
  }

  close(indent: number, name: SvgElementName): void {
    this.lines.push(`${"  ".repeat(indent)}</${name}>`);
  }

  finish(): string {
    return `${this.lines.join("\n")}\n`;
  }
}

function indexById<Value extends { readonly id: string }>(
  values: readonly Value[],
  kind: string,
): ReadonlyMap<string, Value> {
  const result = new Map<string, Value>();
  for (const value of values) {
    if (result.has(value.id))
      throw new Error(`Duplicate ${kind} ID ${value.id}.`);
    result.set(value.id, value);
  }
  return result;
}

function required<Value>(value: Value | undefined, message: string): Value {
  if (value === undefined) throw new Error(message);
  return value;
}

function sourceValue(
  registry: RenderSourceRegistry,
  field: Parameters<RenderSourceRegistry["valueFor"]>[0],
  value: string,
  context: string,
): string {
  return registry.valueFor(field, value, context);
}

function global(value: number): number {
  return value + OUTER_SVG_PADDING;
}

function samePoint(left: LayoutPoint, right: LayoutPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function simplifiedPoints(
  points: readonly LayoutPoint[],
): readonly LayoutPoint[] {
  const unique: LayoutPoint[] = [];
  for (const point of points) {
    if (unique.length === 0 || !samePoint(unique[unique.length - 1]!, point)) {
      unique.push(point);
    }
  }
  const simplified: LayoutPoint[] = [];
  for (const point of unique) {
    while (simplified.length >= 2) {
      const first = simplified[simplified.length - 2]!;
      const second = simplified[simplified.length - 1]!;
      if (!(
        (first.x === second.x && second.x === point.x) ||
        (first.y === second.y && second.y === point.y)
      ))
        break;
      simplified.pop();
    }
    simplified.push(point);
  }
  return simplified;
}

export function orthogonalPathData(points: readonly LayoutPoint[]): string {
  const values = simplifiedPoints(points);
  if (values.length < 2)
    throw new Error("An SVG edge path requires two points.");
  const first = values[0]!;
  const commands = [
    `M ${formatSvgNumber(global(first.x))} ${formatSvgNumber(global(first.y))}`,
  ];
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1]!;
    const point = values[index]!;
    if (point.y === previous.y)
      commands.push(`H ${formatSvgNumber(global(point.x))}`);
    else if (point.x === previous.x)
      commands.push(`V ${formatSvgNumber(global(point.y))}`);
    else throw new Error("SVG emitter received a diagonal edge segment.");
  }
  return commands.join(" ");
}

function primitiveClass(style: SymbolStyle): string {
  return `symbol-${style}`;
}

function primitivePath(
  primitive: Extract<SymbolPrimitive, { kind: "arc" }>,
): string {
  return [
    "M",
    formatSvgNumber(primitive.from.x),
    formatSvgNumber(primitive.from.y),
    "A",
    formatSvgNumber(primitive.radiusX),
    formatSvgNumber(primitive.radiusY),
    "0",
    "0",
    primitive.clockwise ? "1" : "0",
    formatSvgNumber(primitive.to.x),
    formatSvgNumber(primitive.to.y),
  ].join(" ");
}

function emitPrimitive(
  writer: SvgWriter,
  primitive: SymbolPrimitive,
  indent: number,
): void {
  const className = primitiveClass(primitive.style);
  switch (primitive.kind) {
    case "line":
      writer.element(indent, "line", {
        class: className,
        x1: primitive.from.x,
        y1: primitive.from.y,
        x2: primitive.to.x,
        y2: primitive.to.y,
      });
      return;
    case "polyline":
      writer.element(indent, "polyline", {
        class: className,
        points: primitive.points
          .map(({ x, y }) => `${formatSvgNumber(x)},${formatSvgNumber(y)}`)
          .join(" "),
      });
      return;
    case "rect":
      writer.element(indent, "rect", {
        class: className,
        x: primitive.x,
        y: primitive.y,
        width: primitive.width,
        height: primitive.height,
        rx: primitive.radius,
        ry: primitive.radius,
      });
      return;
    case "circle":
      writer.element(indent, "circle", {
        class: className,
        cx: primitive.center.x,
        cy: primitive.center.y,
        r: primitive.radius,
      });
      return;
    case "arc":
      writer.element(indent, "path", {
        class: className,
        d: primitivePath(primitive),
      });
  }
}

function structuralIdParts(id: string, expectedTag: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(id);
  } catch {
    throw new Error(`Presentation ID ${id} is not a structural tuple.`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed[0] !== expectedTag ||
    !parsed.every((part) => typeof part === "string")
  ) {
    throw new Error(`Presentation ID ${id} is not a ${expectedTag} tuple.`);
  }
  return parsed.slice(1) as string[];
}

function aggregateKey(node: Readonly<SymbolPresentationNode>): string {
  const source = node.labels
    .flatMap(({ textSources }) => textSources)
    .find(({ field }) => field === "aggregate.key");
  return (
    source?.value ??
    required(
      structuralIdParts(node.id, "aggregate")[1],
      `Aggregate ${node.id} has no structural key.`,
    )
  );
}

function potentialMetadata(
  edges: readonly PresentationEdge[],
): Readonly<{ uid: string; name: string }> | undefined {
  for (const edge of edges) {
    const source = edge.netLabel?.textSources.find(
      ({ ownerKind, field }) =>
        ownerKind === "potential" && field === "potential.name",
    );
    if (source === undefined) continue;
    const uid = decodeSvgSemanticId("potential", source.ownerId)[0];
    if (uid === undefined) throw new Error("Potential metadata has no UID.");
    return { uid, name: source.value };
  }
  return undefined;
}

function endpointAttributes(
  endpoints: readonly [TerminalId, TerminalId],
  registry: RenderSourceRegistry,
): SvgAttributes {
  return {
    "data-source-device-uid": endpoints[0].deviceUid,
    "data-source-terminal-key": sourceValue(
      registry,
      "terminal.key",
      endpoints[0].terminalKey,
      "conductor source terminal",
    ),
    "data-target-device-uid": endpoints[1].deviceUid,
    "data-target-terminal-key": sourceValue(
      registry,
      "terminal.key",
      endpoints[1].terminalKey,
      "conductor target terminal",
    ),
  };
}

function conductorAttributes(
  edge: Readonly<PresentationEdge>,
  registry: RenderSourceRegistry,
): SvgAttributes {
  const fallback = edge.elementIds[0];
  const designation =
    edge.conductor?.kind === "cable-conductor"
      ? edge.conductor.cableDesignation
      : (edge.conductor?.designation ?? edge.label?.text ?? "");
  const wireUid =
    edge.conductor?.kind === "wire"
      ? edge.conductor.uid
      : fallback?.kind === "wire"
        ? fallback.uid
        : undefined;
  if (wireUid !== undefined) {
    return {
      id: svgSemanticId("wire", [wireUid]),
      class: "net-path wire-path",
      "data-designation": sourceValue(
        registry,
        "wire.designation",
        designation,
        `wire ${wireUid} designation`,
      ),
      "data-net-id": edge.netId,
      "data-wire-uid": wireUid,
      ...endpointAttributes(edge.endpoints, registry),
    };
  }
  const jumperUid =
    edge.conductor?.kind === "jumper"
      ? edge.conductor.uid
      : fallback?.kind === "jumper"
        ? fallback.uid
        : undefined;
  if (jumperUid !== undefined) {
    return {
      id: svgSemanticId("jumper", [jumperUid]),
      class: "net-path jumper-path",
      "data-designation":
        edge.label?.textSources.some(
          ({ field }) => field === "jumper.designation",
        ) === true
          ? sourceValue(
              registry,
              "jumper.designation",
              designation,
              `jumper ${jumperUid} designation`,
            )
          : designation,
      "data-net-id": edge.netId,
      "data-jumper-uid": jumperUid,
      ...endpointAttributes(edge.endpoints, registry),
    };
  }
  const cable =
    edge.conductor?.kind === "cable-conductor"
      ? edge.conductor
      : fallback?.kind === "cable_conductor"
        ? {
            cableUid: fallback.cableUid,
            conductorId: fallback.conductorId,
            cableDesignation: designation,
          }
        : undefined;
  if (cable === undefined) {
    throw new Error(`Conductor edge ${edge.id} has no physical provenance.`);
  }
  return {
    id: svgSemanticId("cable-conductor", [cable.cableUid, cable.conductorId]),
    class: "net-path cable-conductor-path",
    "data-designation": sourceValue(
      registry,
      "cable.designation",
      cable.cableDesignation,
      `cable ${cable.cableUid} designation`,
    ),
    "data-net-id": edge.netId,
    "data-cable-uid": cable.cableUid,
    "data-conductor-id": sourceValue(
      registry,
      "cable.conductor.id",
      cable.conductorId,
      `cable ${cable.cableUid} conductor ID`,
    ),
    ...endpointAttributes(edge.endpoints, registry),
  };
}

function edgeAttributes(
  edge: Readonly<PresentationEdge>,
  registry: RenderSourceRegistry,
): SvgAttributes {
  return edge.kind === "boundary-segment"
    ? {
        id: svgSemanticId("boundary", [edge.id]),
        class: "boundary-path",
        "data-net-id": edge.netId,
        "data-presentation-only": "true",
        ...endpointAttributes(edge.endpoints, registry),
      }
    : conductorAttributes(edge, registry);
}

function canonicalLabels(
  graph: Readonly<PresentationGraph>,
  layout: Readonly<NormalizedSchematicLayout>,
): readonly LayoutLabel[] {
  const semantic = indexById(
    [
      ...graph.locationGroups.map(({ label }) => label),
      ...graph.deviceGroups.map(({ label }) => label),
      ...graph.nodes.flatMap((node) =>
        node.kind === "junction" ? [] : node.labels,
      ),
      ...graph.edges.flatMap((edge) => [
        ...(edge.label === undefined ? [] : [edge.label]),
        ...(edge.netLabel === undefined ? [] : [edge.netLabel]),
      ]),
    ],
    "presentation label",
  );
  return [...layout.labels].sort((left, right) =>
    comparePresentationLabel(
      required(
        semantic.get(left.id),
        `Layout label ${left.id} has no presentation label.`,
      ),
      required(
        semantic.get(right.id),
        `Layout label ${right.id} has no presentation label.`,
      ),
    ),
  );
}

function emitDefinitions(
  writer: SvgWriter,
  labels: readonly LayoutLabel[],
): void {
  writer.open(1, "defs");
  for (const label of labels) {
    writer.open(2, "clipPath", {
      id: svgSemanticId("clip", [label.id]),
      clipPathUnits: "userSpaceOnUse",
    });
    writer.element(3, "rect", {
      x: global(label.x),
      y: global(label.y),
      width: label.width,
      height: label.height,
    });
    writer.close(2, "clipPath");
  }
  writer.close(1, "defs");
}

function emitFrames(
  writer: SvgWriter,
  graph: Readonly<PresentationGraph>,
  nodeLayouts: ReadonlyMap<string, LayoutNode>,
  registry: RenderSourceRegistry,
): void {
  const locations = new Map(
    graph.locationGroups.map((group) => [group.id, group]),
  );
  for (const group of graph.locationGroups) {
    const layout = required(
      nodeLayouts.get(group.id),
      `Location ${group.id} has no layout.`,
    );
    const attributes: SvgAttributes =
      group.identity[0] === "authored"
        ? {
            "data-location": sourceValue(
              registry,
              "device.location",
              group.identity[1],
              `location ${group.id}`,
            ),
          }
        : { "data-virtual-location": "UNSPECIFIED" };
    writer.open(1, "g", {
      id: svgSemanticId("location", [group.identity[0], group.identity[1]]),
      class: "location-group",
      ...attributes,
    });
    writer.element(2, "rect", {
      class: "location-frame",
      x: global(layout.x),
      y: global(layout.y),
      width: layout.width,
      height: layout.height,
      rx: 4,
      ry: 4,
    });
    writer.close(1, "g");
  }
  for (const group of graph.deviceGroups) {
    const layout = required(
      nodeLayouts.get(group.id),
      `Device ${group.id} has no layout.`,
    );
    const location = required(
      locations.get(group.parentId),
      `Device ${group.id} has no location.`,
    );
    writer.open(1, "g", {
      id: svgSemanticId("device", [group.deviceUid]),
      class: "device-group",
      "data-location":
        location.identity[0] === "authored"
          ? sourceValue(
              registry,
              "device.location",
              location.identity[1],
              `device ${group.deviceUid} location`,
            )
          : undefined,
      "data-device-uid": group.deviceUid,
      "data-designation": sourceValue(
        registry,
        "device.designation",
        group.designation,
        `device ${group.deviceUid} designation`,
      ),
      "data-type-id": sourceValue(
        registry,
        "device.type",
        group.typeId,
        `device ${group.deviceUid} type`,
      ),
    });
    writer.element(2, "rect", {
      class: "device-frame",
      x: global(layout.x),
      y: global(layout.y),
      width: layout.width,
      height: layout.height,
      rx: 3,
      ry: 3,
    });
    writer.close(1, "g");
  }
}

function emitEdges(
  writer: SvgWriter,
  graph: Readonly<PresentationGraph>,
  edgeLayouts: ReadonlyMap<string, LayoutEdge>,
  registry: RenderSourceRegistry,
): void {
  const grouped = new Map<string, PresentationEdge[]>();
  for (const edge of graph.edges) {
    grouped.set(edge.netId, [...(grouped.get(edge.netId) ?? []), edge]);
  }
  for (const [netId, edges] of grouped) {
    const potential = potentialMetadata(edges);
    writer.open(1, "g", {
      id: svgSemanticId("net", [netId]),
      class: "net-group",
      "data-net-id": netId,
      "data-potential-uid": potential?.uid,
      "data-potential-name":
        potential === undefined
          ? undefined
          : sourceValue(
              registry,
              "potential.name",
              potential.name,
              `net ${netId} potential name`,
            ),
    });
    for (const edge of edges) {
      const layout = required(
        edgeLayouts.get(edge.id),
        `Edge ${edge.id} has no layout.`,
      );
      writer.element(2, "path", {
        ...edgeAttributes(edge, registry),
        d: orthogonalPathData(layout.points),
      });
    }
    writer.close(1, "g");
  }
}

function emitJunctions(
  writer: SvgWriter,
  graph: Readonly<PresentationGraph>,
  nodeLayouts: ReadonlyMap<string, LayoutNode>,
  registry: RenderSourceRegistry,
): void {
  for (const node of graph.nodes) {
    if (node.kind !== "junction") continue;
    const layout = required(
      nodeLayouts.get(node.id),
      `Junction ${node.id} has no layout.`,
    );
    writer.element(1, "circle", {
      id: svgSemanticId("junction", [node.id]),
      class: "junction-dot",
      cx: global(layout.x + layout.width / 2),
      cy: global(layout.y + layout.height / 2),
      r: 3,
      "data-device-uid": node.terminal.deviceUid,
      "data-terminal-key": sourceValue(
        registry,
        "terminal.key",
        node.terminal.terminalKey,
        `junction ${node.id} terminal`,
      ),
      "data-net-id": node.netId,
    });
  }
}

function symbolGroupAttributes(
  node: Readonly<SymbolPresentationNode | RailPresentationNode>,
  origin: LayoutPoint,
  registry: RenderSourceRegistry,
): SvgAttributes {
  if (node.kind === "rail") {
    return {
      id: svgSemanticId("rail", [
        node.deviceUid,
        node.boundary.terminal.terminalKey,
        node.boundary.kind,
      ]),
      class: "symbol rail-symbol",
      transform: `translate(${formatSvgNumber(global(origin.x))} ${formatSvgNumber(global(origin.y))})`,
      "data-symbol-id": node.symbolId,
      "data-boundary-kind": node.boundary.kind,
      "data-device-uid": node.deviceUid,
      "data-designation": sourceValue(
        registry,
        "device.designation",
        node.designation,
        `rail ${node.id} designation`,
      ),
      "data-type-id": sourceValue(
        registry,
        "device.type",
        node.typeId,
        `rail ${node.id} type`,
      ),
      "data-terminal-key": sourceValue(
        registry,
        "terminal.key",
        node.boundary.terminal.terminalKey,
        `rail ${node.id} terminal`,
      ),
      "data-net-id": node.boundary.netId,
      "data-potential-uid": node.boundary.potentialUid,
      "data-potential-name":
        node.boundary.potentialUid === undefined
          ? undefined
          : sourceValue(
              registry,
              "potential.name",
              node.boundary.label,
              `rail ${node.id} potential name`,
            ),
    };
  }
  if (node.representation === "function") {
    const key = required(
      node.functionIds[0],
      `Function ${node.id} has no function ID.`,
    ).functionKey;
    return {
      id: svgSemanticId("function", [node.deviceUid, key]),
      class: `symbol function-symbol ${node.classification}`,
      transform: `translate(${formatSvgNumber(global(origin.x))} ${formatSvgNumber(global(origin.y))})`,
      "data-symbol-id": node.symbolId,
      "data-device-uid": node.deviceUid,
      "data-function-key": sourceValue(
        registry,
        "function.key",
        key,
        `function ${node.id} key`,
      ),
    };
  }
  const key = aggregateKey(node);
  return {
    id: svgSemanticId("aggregate", [node.deviceUid, key]),
    class: `symbol aggregate-symbol ${node.classification}`,
    transform: `translate(${formatSvgNumber(global(origin.x))} ${formatSvgNumber(global(origin.y))})`,
    "data-symbol-id": node.symbolId,
    "data-device-uid": node.deviceUid,
    "data-aggregate-key": sourceValue(
      registry,
      "aggregate.key",
      key,
      `aggregate ${node.id} key`,
    ),
  };
}

function terminalMarkerAttributes(
  node: Readonly<SymbolPresentationNode | RailPresentationNode>,
  port: Readonly<PresentationPort>,
  registry: RenderSourceRegistry,
): SvgAttributes {
  return {
    id: svgSemanticId("terminal", [
      port.terminal.deviceUid,
      port.terminal.terminalKey,
      port.symbolPortId,
    ]),
    class: "terminal-marker",
    "data-device-uid": port.terminal.deviceUid,
    "data-designation": sourceValue(
      registry,
      "device.designation",
      node.designation,
      `terminal marker ${port.id} designation`,
    ),
    "data-terminal-key": sourceValue(
      registry,
      "terminal.key",
      port.terminal.terminalKey,
      `terminal marker ${port.id} key`,
    ),
    "data-member-function-key":
      port.memberFunctionId === undefined
        ? undefined
        : sourceValue(
            registry,
            "function.key",
            port.memberFunctionId.functionKey,
            `terminal marker ${port.id} member function`,
          ),
    "data-net-id": port.netId,
  };
}

function emitSymbols(
  writer: SvgWriter,
  graph: Readonly<PresentationGraph>,
  nodeLayouts: ReadonlyMap<string, LayoutNode>,
  portLayouts: ReadonlyMap<
    string,
    {
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  >,
  catalog: readonly SymbolDefinition[],
  registry: RenderSourceRegistry,
): void {
  const symbols = new Map(
    catalog.map((definition) => [definition.id, definition]),
  );
  for (const node of graph.nodes) {
    if (node.kind === "junction") continue;
    const layout = required(
      nodeLayouts.get(node.id),
      `Symbol ${node.id} has no layout.`,
    );
    const origin = required(
      layout.primitiveOrigin,
      `Symbol ${node.id} has no primitive origin.`,
    );
    const definition = orientSymbolDefinition(
      required(
        symbols.get(node.symbolId),
        `Symbol definition ${node.symbolId} is missing.`,
      ),
      node.orientation,
    );
    writer.open(1, "g", symbolGroupAttributes(node, origin, registry));
    for (const primitive of definition.primitives)
      emitPrimitive(writer, primitive, 2);
    for (const port of node.ports) {
      const portLayout = required(
        portLayouts.get(port.id),
        `Port ${port.id} has no layout.`,
      );
      writer.element(2, "circle", {
        ...terminalMarkerAttributes(node, port, registry),
        cx: portLayout.x + portLayout.width / 2 - origin.x,
        cy: portLayout.y + portLayout.height / 2 - origin.y,
        r: 2,
      });
    }
    writer.close(1, "g");
  }
}

function presentationLabelIndex(
  graph: Readonly<PresentationGraph>,
): ReadonlyMap<string, PresentationLabel> {
  return indexById(
    [
      ...graph.locationGroups.map(({ label }) => label),
      ...graph.deviceGroups.map(({ label }) => label),
      ...graph.nodes.flatMap((node) =>
        node.kind === "junction" ? [] : node.labels,
      ),
      ...graph.edges.flatMap((edge) => [
        ...(edge.label === undefined ? [] : [edge.label]),
        ...(edge.netLabel === undefined ? [] : [edge.netLabel]),
      ]),
    ],
    "presentation label",
  );
}

function emitLabels(
  writer: SvgWriter,
  graph: Readonly<PresentationGraph>,
  labels: readonly LayoutLabel[],
  registry: RenderSourceRegistry,
): void {
  const semantic = presentationLabelIndex(graph);
  for (const label of labels) {
    const presentation = required(
      semantic.get(label.id),
      `Layout label ${label.id} has no presentation label.`,
    );
    if (
      presentation.text !== label.text ||
      presentation.width !== label.width ||
      presentation.height !== label.height
    ) {
      throw new Error(
        `Layout label ${label.id} disagrees with presentation text geometry.`,
      );
    }
    for (const source of presentation.textSources) {
      sourceValue(
        registry,
        source.field,
        source.value,
        `label ${presentation.id} source`,
      );
    }
    writer.element(1, "rect", {
      class: `label-background label-${label.role}`,
      x: global(label.x),
      y: global(label.y),
      width: label.width,
      height: label.height,
    });
    writer.element(
      1,
      "text",
      {
        class: `label-text label-${label.role}`,
        "clip-path": `url(#${svgSemanticId("clip", [label.id])})`,
        x: global(label.x + 3),
        y: global(label.y + label.height / 2),
        "font-family": "monospace",
        "font-size": 10,
        "text-anchor": "start",
        "dominant-baseline": "middle",
        textLength: presentation.textLength,
        lengthAdjust: "spacingAndGlyphs",
      },
      label.text,
    );
  }
}

function assertMatchingInputs(
  graph: Readonly<PresentationGraph>,
  layout: Readonly<NormalizedSchematicLayout>,
): void {
  if (
    graph.format !== "schematic-presentation/0.1" ||
    layout.format !== "schematic-layout/0.1" ||
    JSON.stringify(graph.view) !== JSON.stringify(layout.view)
  ) {
    throw new Error(
      "SVG emitter received mismatched presentation and layout DTOs.",
    );
  }
}

function titleTextLength(value: string): number {
  return Number((6.2 * [...value].length).toFixed(3));
}

function emitTitleBlock(
  writer: SvgWriter,
  context: Readonly<SchematicTitleContext>,
  blockX: number,
  blockY: number,
  blockWidth: number,
  blockHeight: number,
): void {
  writer.open(1, "g", { class: "title-block" });
  writer.element(2, "rect", {
    class: "title-block-panel",
    x: blockX,
    y: blockY,
    width: blockWidth,
    height: blockHeight,
    fill: "#ffffff",
    stroke: "#344054",
  });
  for (const [index, line] of context.lines.entries()) {
    writer.element(
      2,
      "text",
      {
        class: "title-block-text",
        x: blockX + 8,
        y: blockY + 8 + 14 * index,
        fill: "#101828",
        "font-family": "monospace",
        "font-size": 10,
        "text-anchor": "start",
        "dominant-baseline": "hanging",
        textLength: titleTextLength(line.value),
        lengthAdjust: "spacingAndGlyphs",
      },
      line.value,
    );
  }
  writer.close(1, "g");
}

export function emitSchematicSvg(
  graph: Readonly<PresentationGraph>,
  layout: Readonly<NormalizedSchematicLayout>,
  titleContext: Readonly<SchematicTitleContext>,
  catalog: readonly SymbolDefinition[] = SYMBOL_CATALOG,
  diagramOnly = false,
): RenderOutcome<string> {
  const titlePreflight = preflightTitleRenderText(
    graph.view,
    titleContext.lines,
  );
  if (!titlePreflight.ok) return titlePreflight;
  const preflight = preflightRenderText(graph);
  if (!preflight.ok) return preflight;
  const registry = buildRenderSourceRegistry(graph);
  assertMatchingInputs(graph, layout);

  const nodeLayouts = indexById(layout.nodes, "layout node");
  const portLayouts = indexById(layout.ports, "layout port");
  const edgeLayouts = indexById(layout.edges, "layout edge");
  const labels = canonicalLabels(graph, layout);
  const diagramWidth = layout.width + OUTER_SVG_PADDING * 2;
  const diagramHeight = layout.height + OUTER_SVG_PADDING * 2;
  const longestTextLength = Math.max(
    ...titleContext.lines.map((line) => titleTextLength(line.value)),
  );
  const blockWidth = Math.max(240, longestTextLength + 16);
  const blockHeight = 16 + 14 * titleContext.lines.length;
  const width = diagramOnly
    ? diagramWidth
    : Math.max(diagramWidth, blockWidth + 32);
  const height = diagramOnly
    ? diagramHeight
    : diagramHeight + 16 + blockHeight + 16;
  const blockX = width - blockWidth - 16;
  const blockY = diagramHeight + 16;
  const rootDesignation = sourceValue(
    registry,
    graph.view.format === "schematic-view/0.2" &&
      graph.view.intent === "conductors"
      ? "cable.designation"
      : "device.designation",
    graph.view.root.designation,
    "root designation",
  );
  const title = `${graph.view.format === "schematic-view/0.2" ? graph.view.intent : graph.view.family} schematic: ${rootDesignation}`;

  const writer = new SvgWriter();
  writer.lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  writer.open(0, "svg", {
    xmlns: "http://www.w3.org/2000/svg",
    version: "1.1",
    viewBox: `0 0 ${formatSvgNumber(width)} ${formatSvgNumber(height)}`,
    width,
    height,
    role: "img",
    "aria-label": title,
    "data-project-name": titleContext.projectName,
    "data-project-revision": titleContext.revision,
    "data-tool-version": titleContext.toolVersion,
    "data-view-format": graph.view.format,
    "data-view-family": graph.view.family,
    "data-view-intent":
      graph.view.format === "schematic-view/0.2"
        ? graph.view.intent
        : undefined,
    "data-view-flow": graph.view.flow,
    "data-renderer-version": RENDERER_VERSION,
    "data-symbol-catalog-version": SYMBOL_CATALOG_VERSION,
    "data-layout-config-version": LAYOUT_CONFIG_VERSION,
    "data-root-device-uid":
      graph.view.format === "schematic-view/0.1" ||
      graph.view.intent !== "conductors"
        ? graph.view.root.deviceUid
        : undefined,
    "data-root-cable-uid":
      graph.view.format === "schematic-view/0.2" &&
      graph.view.intent === "conductors"
        ? graph.view.root.cableUid
        : undefined,
    "data-target-device-uid":
      graph.view.format === "schematic-view/0.2" &&
      graph.view.intent === "trace"
        ? graph.view.target.deviceUid
        : undefined,
  });
  writer.element(1, "title", {}, title);
  writer.element(
    1,
    "desc",
    {},
    `Deterministic ${graph.view.flow} ${graph.view.family} electrical schematic.`,
  );
  writer.element(1, "style", {}, BUILT_IN_STYLE);
  emitDefinitions(writer, labels);
  writer.element(1, "rect", {
    class: "canvas-background",
    x: 0,
    y: 0,
    width,
    height,
    fill: titleContext.backgroundColor,
  });
  emitFrames(writer, graph, nodeLayouts, registry);
  emitEdges(writer, graph, edgeLayouts, registry);
  emitJunctions(writer, graph, nodeLayouts, registry);
  emitSymbols(writer, graph, nodeLayouts, portLayouts, catalog, registry);
  emitLabels(writer, graph, labels, registry);
  if (!diagramOnly)
    emitTitleBlock(
      writer,
      titleContext,
      blockX,
      blockY,
      blockWidth,
      blockHeight,
    );
  writer.close(0, "svg");
  return { ok: true, value: writer.finish() };
}
