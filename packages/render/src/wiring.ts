import { circuitTextLines } from "./symbols/circuit-text.js";
import { printableTextWidth } from "./text-metrics.js";
import { wiringStrokeMm } from "./layout/wiring-landing-ink.js";
import { labelLeaderArrow } from "./layout/wire-label-support.js";
import {
  ownedWiringLabels,
  wiringLabelLeaders,
} from "./layout/wiring-label-support.js";
import {
  drawingDeviceTag,
  deviceHeaderSvg,
  deviceHeaderHeight,
} from "./device-tag-svg.js";
import type { DeviceTagPlan } from "./device-tags.js";
import { drawingDeviceReference } from "./device-tag-ownership.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "./svg/escape.js";
import type { CommunicationDrawing } from "./communication.js";
import {
  routePortAttributes,
  terminalPortAttribute,
} from "./layout/port-attributes.js";
import { layoutWiring } from "./layout/wiring-layout.js";
import { required } from "./presentation/util.js";
import {
  WIRING_LANDING_SUFFIX,
  WIRING_TERMINAL_RADIUS_SVG,
} from "./layout/wiring-landings.js";
import {
  wiringHiddenIncidences,
  omittedTerminalNeed,
} from "./packet/document-producers.js";

/** A deliberate subset of physical wiring, never an inferred circuit or net short. */
export interface WiringViewRequest {
  readonly format: "wiring-view-request/0.1";
  readonly title: string;
  readonly conductors: readonly string[];
  readonly notes?: readonly string[];
  readonly deviceOrder?: readonly string[];
}
const key = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);
const n = (v: number) => String(Number(v.toFixed(3)));
const text = (x: number, y: number, s: string, bold = false) =>
  `<text x="${n(x)}" y="${n(y)}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="2.7" font-weight="${bold ? 700 : 400}" fill="#18212b">${xml(s)}</text>`;
const wrap = (value: string, max: number) => circuitTextLines(value, max, 2.7);
type Point = { x: number; y: number };
type WiringRoute = { index: number; points: Point[] };
type WiringSegment = { index: number; a: Point; b: Point };
type WiringEdge = NonNullable<ElkNode["edges"]>[number];
type WiringSection = NonNullable<WiringEdge["sections"]>[number];
type WiringConductor = ReturnType<typeof wiringConductors>[number];
type WiringState = ReturnType<typeof wiringGraphState>;

export async function prepareWiringDrawing(
  ir: Readonly<ElectricalIr>,
  request: WiringViewRequest,
  admit?: (
    candidate: CommunicationDrawing,
    original: CommunicationDrawing,
  ) => boolean,
): Promise<CommunicationDrawing> {
  validateWiringRequest(request);
  const state = wiringGraphState(selectWiringDrawing(ir, request));
  const children = state.ordered.map((uid) => wiringNode(uid, state));
  const edges = wiringEdges(state);
  const graph = await layoutWiring(
    children,
    edges,
    admit
      ? (candidate, baseline) => {
          const original = wiringDrawing(baseline, state, request);
          let proposed: CommunicationDrawing;
          try {
            proposed = wiringDrawing(candidate, state, request);
          } catch {
            return false;
          }
          return admit(proposed, original);
        }
      : undefined,
    new Map(state.selected.map((c, i) => [`e${i}`, wiringStrokeMm(c.jumper)])),
  );
  return wiringDrawing(graph, state, request);
}

function wiringDrawing(
  graph: ElkNode,
  state: WiringState,
  request: WiringViewRequest,
): CommunicationDrawing {
  if (![graph.width, graph.height].every(Number.isFinite))
    throw new Error("Invalid wiring layout bounds.");
  graph = ownedWiringLabels(graph);
  const out: string[] = [];
  const nodes = graph.children ?? [];
  const routes = appendWiringRoutes(graph, state.selected, nodes, out);
  appendWiringLabelLeaders(graph, state.selected, out);
  const segments = appendWiringJunctions(routes, state.selected, out);
  assertWiringLabels(graph, nodes, segments);
  const references = appendWiringDevices(nodes, state, out);
  const { documentNeeds, selected, tags } = state;
  return {
    documentNeeds,
    title: request.title,
    content: out.join("\n"),
    width: graph.width!,
    height: graph.height!,
    references,
    deviceTags: [...tags.values()],
    coverage: {
      kind: "wiring",
      conductorIds: selected.map((c) => c.id),
      functionIds: [],
    },
    note: [
      "Terminal wiring: device internals are not shown. [ +N ] = other physical connections at that terminal; see wire schedule.",
      ...(request.notes ?? []),
    ].join("\n"),
  };
}

function validateWiringRequest(request: WiringViewRequest) {
  if (
    !request ||
    request.format !== "wiring-view-request/0.1" ||
    typeof request.title !== "string" ||
    !request.title.trim() ||
    request.title.length > 120 ||
    Object.keys(request).some(
      (k) =>
        !["format", "title", "conductors", "notes", "deviceOrder"].includes(k),
    ) ||
    !Array.isArray(request.conductors) ||
    !request.conductors.length ||
    request.conductors.length > 60 ||
    request.conductors.some((c) => typeof c !== "string" || !c.trim()) ||
    new Set(request.conductors).size !== request.conductors.length ||
    (request.notes !== undefined &&
      (!Array.isArray(request.notes) ||
        request.notes.length > 10 ||
        request.notes.some(
          (s) => typeof s !== "string" || !s.trim() || s.length > 400,
        )))
  )
    throw new Error(
      "Invalid wiring view. Select 1-60 unique conductor designations or UIDs, a title and optional notes.",
    );
}

function wiringConductors(ir: Readonly<ElectricalIr>) {
  return [
    ...ir.wires.map((w) => ({
      id: w.uid,
      name: w.designation,
      ends: w.endpoints.map((e) => e.terminal),
      detail: [w.properties?.size, w.properties?.color]
        .filter(Boolean)
        .join(" / "),
      jumper: false,
    })),
    ...ir.jumpers.map((w) => ({
      id: w.uid,
      name: w.designation,
      ends: w.endpoints.map((e) => e.terminal),
      detail: w.designation ? "Jumper" : "",
      jumper: true,
    })),
    ...ir.cableConductors.map((w) => ({
      id: JSON.stringify(w.id),
      name: `${ir.cables.find((c) => c.uid === w.cableUid)!.designation}/${w.id.conductorId}`,
      ends: w.endpoints.map((e) => e.terminal),
      detail: [w.typeConductor?.size, w.typeConductor?.color]
        .filter(Boolean)
        .join(" / "),
      jumper: false,
    })),
  ];
}

function wiringDeviceOrder(
  ordered: string[],
  request: WiringViewRequest,
  devices: Map<string, ElectricalIr["devices"][number]>,
) {
  if (request.deviceOrder !== undefined) {
    if (
      !Array.isArray(request.deviceOrder) ||
      request.deviceOrder.length !== ordered.length
    )
      throw new Error(
        "deviceOrder must list each included device exactly once.",
      );
    const resolved = request.deviceOrder.map((name) =>
      ordered.filter(
        (uid) => uid === name || devices.get(uid)!.designation === name,
      ),
    );
    if (
      resolved.some((matches) => matches.length !== 1) ||
      new Set(resolved.map((matches) => matches[0])).size !== ordered.length
    )
      throw new Error(
        "deviceOrder must list each included device exactly once.",
      );
    ordered = resolved.map((matches) => matches[0]!);
  }
  return ordered;
}

function selectWiringDrawing(
  ir: Readonly<ElectricalIr>,
  request: WiringViewRequest,
) {
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  const all = wiringConductors(ir);
  const selected = request.conductors
    .map((s) => {
      const found = all.filter((w) => w.id === s || w.name === s);
      if (found.length !== 1)
        throw new Error(
          `Conductor ${JSON.stringify(s)} does not resolve uniquely to fully terminated physical wiring.`,
        );
      return found[0]!;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(selected.map((w) => w.id)).size !== selected.length)
    throw new Error("Duplicate conductor identity in wiring view.");
  const chosen = new Set(selected.map((w) => w.id));
  const terminalIds = new Map(
    selected.flatMap((w) => w.ends.map((t) => [key(t), t] as const)),
  );
  let ordered = [
    ...new Set([...terminalIds.values()].map((t) => t.deviceUid)),
  ].sort((a, b) =>
    devices.get(a)!.designation < devices.get(b)!.designation ? -1 : 1,
  );
  ordered = wiringDeviceOrder(ordered, request, devices);
  // Endpoint order has no electrical meaning. Orient layout only, without mutating IR.
  for (const conductor of selected)
    if (
      ordered.indexOf(conductor.ends[0]!.deviceUid) >
      ordered.indexOf(conductor.ends[1]!.deviceUid)
    )
      conductor.ends.reverse();
  if (ordered.length > 30)
    throw new Error("Wiring view exceeds 30 devices; select a smaller view.");
  const { needs: documentNeeds, boundary } = wiringHiddenIncidences(
    ir,
    chosen,
    terminalIds,
  );
  return {
    ir,
    devices,
    types,
    selected,
    terminalIds,
    ordered,
    documentNeeds,
    boundary,
  };
}

function wiringGraphState(selection: ReturnType<typeof selectWiringDrawing>) {
  const { ordered } = selection;
  const ids = new Map(ordered.map((uid, i) => [uid, `d${i}`]));
  const ports = new Map<string, string>();
  const labels = new Map<string, string[]>();
  const tags = new Map<string, DeviceTagPlan>();
  const rows = new Map<
    string,
    { key: string; label: string; side: "WEST" | "EAST"; y: number }[]
  >();
  return { ...selection, ids, ports, labels, tags, rows };
}

function wiringNode(uid: string, state: WiringState): ElkNode {
  const {
    ir,
    devices,
    types,
    tags,
    terminalIds,
    documentNeeds,
    labels,
    rows,
    ids,
    ports,
  } = state;
  const d = devices.get(uid)!,
    type = types.get(d.typeId)!;
  // Retain validation of authored type text even when an instance overrides it.
  xml(type.description ?? "");
  const tag = drawingDeviceTag(d, type, 48);
  tags.set(uid, tag);
  const nodeWidth = tag.widthMm;
  const caption = d.location?.trim() ? wrap(d.location, nodeWidth - 6) : [];
  const pins = [...terminalIds.values()]
    .filter((t) => t.deviceUid === uid)
    .sort(
      (a, b) =>
        (type.terminalOrder?.indexOf(a.terminalKey) ?? -1) -
          (type.terminalOrder?.indexOf(b.terminalKey) ?? -1) ||
        (a.terminalKey < b.terminalKey ? -1 : 1),
    );
  const omitted = omittedTerminalNeed(
    ir,
    uid,
    pins.map((p) => p.terminalKey),
  );
  if (omitted) {
    caption.push(`${omitted.count} other terminals`);
    documentNeeds.push(omitted);
  }
  labels.set(uid, caption);
  const { list, y } = wiringRows(
    pins,
    state,
    d,
    nodeWidth,
    deviceHeaderHeight(tag, caption) + 6,
  );
  rows.set(uid, list);
  return {
    id: ids.get(uid)!,
    width: nodeWidth,
    height: y + 2,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports: list.map((p, i) => {
      const id = `${ids.get(uid)}p${i}`;
      ports.set(key({ deviceUid: uid, terminalKey: p.key }), id);
      return {
        id,
        width: 0,
        height: 0,
        x: p.side === "WEST" ? 0 : nodeWidth,
        y: p.y,
        layoutOptions: { "elk.port.side": p.side },
      };
    }),
  };
}

function wiringRows(
  pins: TerminalId[],
  state: WiringState,
  d: ElectricalIr["devices"][number],
  nodeWidth: number,
  y: number,
) {
  const { selected, boundary } = state;
  const list = pins.map((t) => {
    const side = selected.some((w) => key(w.ends[1]!) === key(t))
      ? ("WEST" as const)
      : ("EAST" as const);
    const label = `${t.terminalKey}${boundary.get(key(t)) ? ` [ +${boundary.get(key(t))} ]` : ""}`;
    if (printableTextWidth(label, 2.7) > nodeWidth - 6)
      throw wiringWidthError(d.designation, t.terminalKey);
    const row = { key: t.terminalKey, label, side, y };
    row.y = Math.round(y);
    y += 6;
    return row;
  });
  return { list, y };
}

function wiringEdges(state: WiringState) {
  const { selected, ports } = state;
  return selected.map((w, i) => ({
    id: `e${i}`,
    sources: [ports.get(key(w.ends[0]!))!],
    targets: [ports.get(key(w.ends[1]!))!],
    labels: [
      {
        text: w.name ?? "Jumper",
        width:
          Math.max(
            printableTextWidth(w.name ?? "Jumper", 2.7),
            printableTextWidth(w.detail, 2.7),
          ) + 2,
        height: w.detail ? 8 : 4,
      },
    ],
  }));
}

function appendWiringRoutes(
  graph: ElkNode,
  selected: WiringConductor[],
  nodes: ElkNode[],
  out: string[],
) {
  const routes: WiringRoute[] = [];
  for (const edge of graph.edges ?? []) {
    const i = Number(edge.id.slice(1));
    const conductor = required(selected[i], "Missing native wiring identity");
    if (!edge.sections?.length) throw new Error("Incomplete wiring route.");
    out.push(
      `<g ${routePortAttributes(edge)} data-wiring-conductor="${attr(conductor.id)}" data-endpoints="${attr(JSON.stringify(conductor.ends))}"><title>${xml((conductor.name ?? "Jumper") + (conductor.detail ? " / " + conductor.detail : ""))}</title>`,
    );
    for (const section of edge.sections)
      appendWiringSection(section, i, selected, nodes, routes, out);
    appendWiringLabels(edge, i, selected, out);
    out.push("</g>");
  }
  return routes;
}

function appendWiringSection(
  section: WiringSection,
  i: number,
  selected: WiringConductor[],
  nodes: ElkNode[],
  routes: WiringRoute[],
  out: string[],
) {
  const points = [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ];
  routes.push({ index: i, points });
  for (let j = 1; j < points.length; j++) {
    const a = points[j - 1]!,
      b = points[j]!;
    if (
      ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
      (Math.abs(a.x - b.x) > 1e-7 && Math.abs(a.y - b.y) > 1e-7)
    )
      throw new Error("Invalid orthogonal wiring route.");
    for (const d of nodes) {
      const left = d.x! + 0.01,
        right = d.x! + d.width! - 0.01,
        top = d.y! + 0.01,
        bottom = d.y! + d.height! - 0.01;
      if (
        (Math.abs(a.x - b.x) < 1e-7 &&
          a.x > left &&
          a.x < right &&
          Math.max(a.y, b.y) > top &&
          Math.min(a.y, b.y) < bottom) ||
        (Math.abs(a.y - b.y) < 1e-7 &&
          a.y > top &&
          a.y < bottom &&
          Math.max(a.x, b.x) > left &&
          Math.min(a.x, b.x) < right)
      )
        throw new Error("Wiring route crosses a device body.");
    }
  }
  out.push(
    `<path d="${points.map((p, j) => `${j ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="#344054" stroke-width="${wiringStrokeMm(selected[i]!.jumper)}"/>`,
  );
}

function appendWiringLabels(
  edge: WiringEdge,
  i: number,
  selected: WiringConductor[],
  out: string[],
) {
  for (const l of edge.labels ?? []) {
    if (![l.x, l.y, l.width, l.height].every(Number.isFinite))
      throw new Error("Unplaced wiring label.");
    out.push(
      `<rect x="${n(l.x!)}" y="${n(l.y!)}" width="${n(l.width!)}" height="${n(l.height!)}" fill="white"/>`,
      text(l.x! + 1, l.y! + 3, l.text!),
      selected[i]!.detail
        ? text(l.x! + 1, l.y! + 6.5, selected[i]!.detail)
        : "",
    );
  }
}

function appendWiringLabelLeaders(
  graph: ElkNode,
  selected: WiringConductor[],
  out: string[],
) {
  const path = (points: readonly Point[]) =>
    points.map((p, i) => `${i ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ");
  for (const leader of wiringLabelLeaders(graph)) {
    const conductor = required(
      selected[Number(leader.edgeId.slice(1))],
      "Missing wiring label owner",
    );
    out.push(
      `<path class="wire-label-leader" data-label-leader-owner="${attr(conductor.id)}" d="${path(leader.points)}" fill="none" stroke="#475467" stroke-width=".15" stroke-dasharray=".5 .375"/>`,
      `<path class="wire-label-leader-arrow" d="${path(labelLeaderArrow(leader.points, 0.75))}" fill="none" stroke="#475467" stroke-width=".15"/>`,
    );
  }
}

function appendWiringJunctions(
  routes: WiringRoute[],
  selected: WiringConductor[],
  out: string[],
) {
  const on = (p: Point, a: Point, b: Point) =>
    p.x >= Math.min(a.x, b.x) - 1e-7 &&
    p.x <= Math.max(a.x, b.x) + 1e-7 &&
    p.y >= Math.min(a.y, b.y) - 1e-7 &&
    p.y <= Math.max(a.y, b.y) + 1e-7 &&
    (Math.abs(a.x - b.x) < 1e-7
      ? Math.abs(p.x - a.x) < 1e-7
      : Math.abs(p.y - a.y) < 1e-7);
  const commonTerminal = (a: number, b: number) =>
    selected[a]!.ends.some((t) =>
      selected[b]!.ends.some((u) => key(t) === key(u)),
    );
  const segments = routes.flatMap((r) =>
    r.points.slice(1).map((b, i) => ({ index: r.index, a: r.points[i]!, b })),
  );
  assertWiringRouteOverlaps(segments, commonTerminal);
  const dots = wiringJunctionDots(routes, segments, commonTerminal, on);
  appendWiringJunctionSvg(dots, segments, commonTerminal, on, out);
  return segments;
}

function assertWiringRouteOverlaps(
  segments: WiringSegment[],
  commonTerminal: (a: number, b: number) => boolean,
) {
  // Coincident paths must represent a shared physical terminal, not an invented join.
  for (let i = 0; i < segments.length; i++)
    for (const other of segments.slice(i + 1)) {
      const segment = segments[i]!;
      if (
        segment.index === other.index ||
        commonTerminal(segment.index, other.index)
      )
        continue;
      const vertical =
        Math.abs(segment.a.x - segment.b.x) < 1e-7 &&
        Math.abs(other.a.x - other.b.x) < 1e-7 &&
        Math.abs(segment.a.x - other.a.x) < 1e-7;
      const horizontal =
        Math.abs(segment.a.y - segment.b.y) < 1e-7 &&
        Math.abs(other.a.y - other.b.y) < 1e-7 &&
        Math.abs(segment.a.y - other.a.y) < 1e-7;
      const overlap = (axis: "x" | "y") =>
        Math.min(
          Math.max(segment.a[axis], segment.b[axis]),
          Math.max(other.a[axis], other.b[axis]),
        ) -
          Math.max(
            Math.min(segment.a[axis], segment.b[axis]),
            Math.min(other.a[axis], other.b[axis]),
          ) >
        1e-7;
      if ((vertical && overlap("y")) || (horizontal && overlap("x")))
        throw new Error("Unrelated wiring routes overlap.");
    }
}

function wiringJunctionDots(
  routes: WiringRoute[],
  segments: WiringSegment[],
  commonTerminal: (a: number, b: number) => boolean,
  on: (p: Point, a: Point, b: Point) => boolean,
) {
  const dots = new Map<string, { point: Point; index: number }>();
  for (const route of routes)
    for (const other of routes) {
      if (
        route.index === other.index ||
        !commonTerminal(route.index, other.index)
      )
        continue;
      for (const p of route.points.slice(1, -1)) {
        const touching = segments.filter(
          (s) =>
            (s.index === route.index || s.index === other.index) &&
            on(p, s.a, s.b),
        );
        const directions = new Set(
          touching.flatMap((s) =>
            [s.a, s.b].flatMap((q) => [
              ...(q.x > p.x + 1e-7 ? ["E"] : []),
              ...(q.x < p.x - 1e-7 ? ["W"] : []),
              ...(q.y > p.y + 1e-7 ? ["S"] : []),
              ...(q.y < p.y - 1e-7 ? ["N"] : []),
            ]),
          ),
        );
        if (directions.size >= 3)
          dots.set(`${n(p.x)},${n(p.y)}`, { point: p, index: route.index });
      }
    }
  return dots;
}

function appendWiringJunctionSvg(
  dots: Map<string, { point: Point; index: number }>,
  segments: WiringSegment[],
  commonTerminal: (a: number, b: number) => boolean,
  on: (p: Point, a: Point, b: Point) => boolean,
  out: string[],
) {
  for (const { point: p, index } of dots.values()) {
    if (
      segments.some(
        (s) =>
          s.index !== index &&
          !commonTerminal(index, s.index) &&
          on(p, s.a, s.b),
      )
    )
      throw new Error("Unrelated wire crosses a terminal junction.");
    out.push(
      `<circle data-wiring-junction="true" cx="${n(p.x)}" cy="${n(p.y)}" r=".65" fill="#344054"/>`,
    );
  }
}

function assertWiringLabels(
  graph: ElkNode,
  nodes: ElkNode[],
  segments: WiringSegment[],
) {
  const edgeLabels = (graph.edges ?? []).flatMap((e) =>
    (e.labels ?? []).map((l) => ({
      index: Number(e.id.slice(1)),
      x: l.x!,
      y: l.y!,
      width: l.width!,
      height: l.height!,
    })),
  );
  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width - 0.01 &&
    a.x + a.width > b.x + 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    a.y + a.height > b.y + 0.01;
  for (let i = 0; i < edgeLabels.length; i++) {
    const label = edgeLabels[i]!;
    if (
      nodes.some((d) =>
        overlaps(label, {
          x: d.x!,
          y: d.y!,
          width: d.width!,
          height: d.height!,
        }),
      ) ||
      edgeLabels.slice(i + 1).some((other) => overlaps(label, other))
    )
      throw new Error("Wiring labels overlap a device or another label.");
    if (
      segments.some(
        (s) =>
          s.index !== label.index &&
          overlaps(label, {
            x: Math.min(s.a.x, s.b.x),
            y: Math.min(s.a.y, s.b.y),
            width: Math.abs(s.a.x - s.b.x),
            height: Math.abs(s.a.y - s.b.y),
          }),
      )
    )
      throw new Error("A wiring label obscures another conductor.");
  }
}

function appendWiringDevices(
  nodes: ElkNode[],
  state: WiringState,
  out: string[],
) {
  const { ordered, devices, tags, labels, rows, ports } = state;
  const references: CommunicationDrawing["references"] = [];
  for (const node of nodes) {
    const uid = ordered[Number(node.id.slice(1))]!,
      d = devices.get(uid)!;
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite))
      throw new Error("Invalid wiring node.");
    out.push(
      `<g data-device-uid="${attr(uid)}" transform="translate(${n(node.x!)} ${n(node.y!)})"><rect width="${n(node.width!)}" height="${n(node.height!)}" rx="1" fill="#f5f8fb" stroke="#344054" stroke-width=".3"/>`,
    );
    out.push(deviceHeaderSvg(tags.get(uid), labels.get(uid)!));
    out.push(...wiringPortSvg(node, rows.get(uid)!, ports, uid));
    out.push("</g>");
    references.push(drawingDeviceReference(node, d));
  }
  return references;
}

function wiringWidthError(designation: string, terminalKey?: string) {
  return new Error(
    terminalKey === undefined
      ? `Wiring device ${JSON.stringify(designation)} designation is too wide.`
      : `Wiring terminal ${JSON.stringify(`${designation}.${terminalKey}`)} label is too wide.`,
  );
}

function wiringPortSvg(
  node: ElkNode,
  ports: readonly {
    key: string;
    label: string;
    side: "WEST" | "EAST";
    y: number;
  }[],
  portIds: ReadonlyMap<string, string>,
  deviceUid: string,
) {
  const result: string[] = [];
  for (const p of ports) {
    const id = portIds.get(key({ deviceUid, terminalKey: p.key }));
    if (!id) throw new Error("Missing declared wiring terminal.");
    result.push(
      `<circle ${terminalPortAttribute(id)} data-terminal-key="${attr(p.key)}" cx="${p.side === "WEST" ? 0 : n(node.width!)}" cy="${n(p.y)}" r="${WIRING_TERMINAL_RADIUS_SVG}" fill="white" stroke="#344054" stroke-width=".3"/>`,
      ...wiringLandingAnchors(node, id, p.key),
      text(
        p.side === "WEST"
          ? 2
          : node.width! - 2 - printableTextWidth(p.label, 2.7),
        p.y + 1,
        p.label,
      ),
    );
  }
  return result;
}

function wiringLandingAnchors(
  node: ElkNode,
  physical: string,
  terminalKey: string,
) {
  // Nonpainting attachment locators inside the one physical terminal mark.
  // A nonempty native geometry supports SVG path sampling; explicit no-fill and
  // no-stroke ensure these locators never add terminal symbols or hardware.
  return (node.ports ?? [])
    .filter((p) => p.id.startsWith(physical + WIRING_LANDING_SUFFIX))
    .map(
      (p) =>
        `<circle ${terminalPortAttribute(p.id)} data-wiring-landing-for="${attr(physical)}" data-terminal-key="${attr(terminalKey)}" cx="${n(required(p.x, "Unplaced wiring landing"))}" cy="${n(required(p.y, "Unplaced wiring landing"))}" r=".001" fill="none" stroke="none"/>`,
    );
}
