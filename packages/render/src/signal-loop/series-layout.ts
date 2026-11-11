import { selectedChannelCaption } from "../symbols/printable-policy.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import type {
  Conductor,
  SignalLoopViewRequest,
  selectSignalLoop,
} from "../signal-loop.js";
import { createElkEngine } from "../layout/elk-runtime.js";
import {
  assertTopologyIdentities,
  assertTopologyRouteEndpoints,
} from "../layout/topology-conservation.js";
import { fieldDeviceBody } from "../symbols/field-device.js";
import { circuitBlock, emitCircuitMark } from "../symbols/circuit.js";
import { drawEnclosures } from "../signal-loop-enclosures.js";
import { measureText, wrapText } from "../text-metrics.js";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "../svg/escape.js";
import { n, text } from "../packet/svg.js";
import { terminalKey as key } from "./polarity.js";
import { pinMapPair } from "./pin-map.js";
import {
  assertOrthogonalSegment,
  routeTolerance,
  snappedPath,
} from "./route-geometry.js";

type Selection = ReturnType<typeof selectSignalLoop>;
type Box = { x: number; y: number; width: number; height: number };
type Port = {
  id: string;
  conductor: string;
  terminal: TerminalId;
  x: number;
  y: number;
  side: "WEST" | "EAST" | "NORTH" | "SOUTH";
};
function need<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("Incomplete series loop drawing data.");
  return value;
}
const loopFunctions = (selected: Selection) => [
  selected.from,
  selected.to,
  need(selected.series).power,
];
const wrap = (s: string, w: number) => wrapText(s, w, 2.7);
const width = (s: string) => measureText(s, 2.7).width;
const landingKey = (id: string, t: TerminalId) => JSON.stringify([id, key(t)]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Captions preserve identifiers: whitespace first, retained hyphens only if needed. */
function wrapCaption(value: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const token of value.normalize("NFC").match(/\S+/gu) ?? []) {
    if (width(token) > maxWidth) {
      if (line) lines.push(line);
      line = "";
      for (const part of token.match(/[^-]*-|[^-]+$/gu) ?? []) {
        if (width(part) > maxWidth)
          throw new Error(
            "Series loop caption token cannot fit without splitting an identifier; use a circuit view.",
          );
        if (width(line + part) > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += part;
      }
    } else {
      const next = line ? `${line} ${token}` : token;
      if (width(next) > maxWidth) {
        lines.push(line);
        line = token;
      } else line = next;
    }
  }
  return [...lines, line];
}

function engineNotes(selected: Selection) {
  const series = need(selected.series);
  const base = `Three separate loop nets; loop power from ${series.power.device.designation}.${series.power.function.id.functionKey} as wired. Not assessed: input mode (passive/active), isolation, loop voltage budget`;
  const unknown = series.polarity.unverifiedEndpoints;
  const notes = [
    base +
      (unknown.length
        ? `; polarity not verified: ${unknown.join(", ")}.`
        : "."),
  ];
  for (const terminal of series.power.function.terminals) {
    const branches = series.supplyBranches.filter(
      (b) => key(b.terminal) === key(terminal),
    );
    if (!branches.length) continue;
    const entries = branches.map(
      (b) =>
        `${b.conductor.label[0]} to ${need(selected.devices.get(b.destination.deviceUid)).designation}.${b.destination.terminalKey}`,
    );
    notes.push(
      `Outside selected loop at ${series.power.device.designation}.${terminal.terminalKey}: ${branches.length} authored connections: ${entries.join("; ")}.`,
    );
  }
  return notes;
}

function drawingEdges(selected: Selection) {
  const order = selected.stages,
    directed = new Map<string, Conductor>();
  for (const leg of need(selected.series).legs) {
    const reverse =
      order.indexOf(need(leg.terminals[0]).deviceUid) >
      order.indexOf(need(leg.terminals.at(-1)).deviceUid);
    const terminals = reverse ? [...leg.terminals].reverse() : leg.terminals,
      edges = reverse ? [...leg.edges].reverse() : leg.edges;
    edges.forEach((edge, i) =>
      directed.set(edge.id, {
        ...edge,
        ends: [need(terminals[i]), need(terminals[i + 1])],
      }),
    );
  }
  return selected.conductors.map(
    (c) =>
      directed.get(c.id) ??
      (order.indexOf(c.ends[0].deviceUid) < order.indexOf(c.ends[1].deviceUid)
        ? c
        : { ...c, ends: [c.ends[1], c.ends[0]] as const }),
  );
}

function assemblyMembers(edges: Conductor[], cable: string) {
  const members = edges
    .filter((e) => e.cable === cable)
    .sort((a, b) => compare(a.id, b.id));
  const first = members[0];
  return members.map((c) =>
    !first || c.ends[0].deviceUid === first.ends[0].deviceUid
      ? c
      : { ...c, ends: [c.ends[1], c.ends[0]] as const },
  );
}

function assemblyLabels(
  ir: Readonly<ElectricalIr>,
  request: SignalLoopViewRequest,
  edges: Conductor[],
) {
  const labels = new Map<string, string[]>(),
    cables = new Map<string, string>();
  for (const spec of request.cableAssemblies ?? []) {
    const matches = ir.cables.filter(
      (c) => c.uid === spec.cable || c.designation === spec.cable,
    );
    if (matches.length !== 1)
      throw new Error(
        `Cable ${JSON.stringify(spec.cable)} does not resolve uniquely.`,
      );
    const cable = need(matches[0]),
      members = assemblyMembers(edges, cable.uid);
    if (!members.length || cables.has(cable.uid))
      throw new Error(
        "Cable assembly must identify a unique cable in the selected loop.",
      );
    if (
      members.some((m) =>
        m.ends.some(
          (t, i) => t.deviceUid !== need(need(members[0]).ends[i]).deviceUid,
        ),
      )
    )
      throw new Error(
        "A cable assembly must terminate on the same pair of devices for every core.",
      );
    if (width(spec.connector) > 15)
      throw new Error("Connector label is too wide.");
    const mapping = members.map((m) => pinMapPair(m)).join(", ");
    labels.set(need(members[0]).id, [
      spec.connector,
      ...wrap(spec.description, 55),
      ...wrap(`Pin map: ${mapping}`, 55),
    ]);
    cables.set(cable.uid, spec.connector);
  }
  return { labels, cables };
}

function nodePorts(
  terms: TerminalId[],
  index: number,
  edges: Conductor[],
  vertical: boolean,
  w: number,
  h: number,
  header: number,
): Port[] {
  return terms.flatMap((terminal, i) => {
    const landed = edges.filter((e) =>
      e.ends.some((t) => key(t) === key(terminal)),
    );
    if (landed.length > 2)
      throw new Error(
        "Series loop needs separate visible conductor landings at each feed-through; use a circuit view.",
      );
    return landed.map((edge, j) => {
      let incoming = key(edge.ends[1]) === key(terminal);
      if (
        j === 1 &&
        incoming === (key(need(landed[0]).ends[1]) === key(terminal))
      )
        incoming = !incoming;
      return {
        id: `p${index}_${i}_${incoming ? "in" : "out"}`,
        conductor: edge.id,
        terminal,
        side: vertical
          ? incoming
            ? "NORTH"
            : "SOUTH"
          : incoming
            ? "WEST"
            : "EAST",
        x: vertical ? 56 + i * 12 : incoming ? 0 : w,
        y: vertical ? (incoming ? 0 : h) : header + 5 + i * 10,
      };
    });
  });
}

function nodeCaption(
  selected: Selection,
  uid: string,
  vertical: boolean,
  source: boolean,
) {
  const device = need(selected.devices.get(uid)),
    type = need(selected.types.get(device.typeId));
  const values = [
    type.catalog?.orderNumber ?? type.description ?? type.id,
    device.location ?? "Location unspecified",
  ];
  if (source) values.push(`Loop power: ${device.designation}`);
  if (uid === selected.to.device.uid)
    values.push(selectedChannelCaption(selected.to));
  if (width(device.designation) > 44)
    throw new Error("Device designation is too wide for a signal loop view.");
  const captionWidth = vertical
    ? 50
    : Math.max(
        36,
        Math.min(
          50,
          Math.max(
            width(device.designation),
            ...values.flatMap((s) => (s.match(/\S+/gu) ?? []).map(width)),
          ) + 6,
        ),
      );
  return {
    captionWidth,
    caption: [
      device.designation,
      ...values.flatMap((s) => wrapCaption(s, captionWidth - 6)),
    ],
  };
}

function deviceNode(
  selected: Selection,
  uid: string,
  index: number,
  edges: Conductor[],
  vertical: boolean,
) {
  const device = need(selected.devices.get(uid)),
    type = need(selected.types.get(device.typeId));
  const source = uid === need(selected.series).power.device.uid;
  const pressure = type.symbol === "thermite:pressure-transmitter";
  const { captionWidth, caption } = nodeCaption(
    selected,
    uid,
    vertical,
    source,
  );
  const terms = [
    ...new Map(
      edges.flatMap((e) =>
        e.ends
          .filter((t) => t.deviceUid === uid)
          .map((t) => [key(t), t] as const),
      ),
    ).values(),
  ];
  const order = type.terminalOrder ?? type.terminals.map((t) => t.key);
  terms.sort(
    (a, b) =>
      order.indexOf(a.terminalKey) - order.indexOf(b.terminalKey) ||
      compare(a.terminalKey, b.terminalKey),
  );
  const header = (pressure ? 26 : source ? 20 : 5) + caption.length * 3.7;
  const w = vertical ? 50 + Math.max(30, terms.length * 12 + 8) : captionWidth;
  const h = vertical
    ? Math.max(header + 5, 26)
    : header + terms.length * 10 + 4;
  const ports = nodePorts(terms, index, edges, vertical, w, h, header);
  if (
    ports.some(
      (p) => width(p.terminal.terminalKey) > (vertical ? 10 : w / 2 - 5),
    )
  )
    throw new Error(
      "Terminal identifier is too wide for the signal loop symbol.",
    );
  const node: ElkNode = {
    id: `n${index}`,
    width: w,
    height: h,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports: ports.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": p.side },
    })),
  };
  return {
    uid,
    node,
    ports,
    caption,
    source,
    pressure,
    feedThrough: !loopFunctions(selected).some((f) => f.device.uid === uid),
  };
}

function overlaps(a: Box, b: Box) {
  return (
    a.x < b.x + b.width - 0.01 &&
    a.x + a.width > b.x + 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    a.y + a.height > b.y + 0.01
  );
}
function points(edge: ElkExtendedEdge) {
  return (edge.sections ?? []).map((s) => [
    s.startPoint,
    ...(s.bendPoints ?? []),
    s.endPoint,
  ]);
}
function checkLayout(graph: ElkNode) {
  if (!Number.isFinite(graph.width) || !Number.isFinite(graph.height))
    throw new Error("Invalid signal loop layout.");
  const nodes = graph.children ?? [],
    labels = (graph.edges ?? []).flatMap((e) =>
      (e.labels ?? []).map((l) => ({ ...l, edge: e.id })),
    );
  for (const box of [...nodes, ...labels]) {
    if (
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      need(box.x) < 0 ||
      need(box.y) < 0 ||
      need(box.width) <= 0 ||
      need(box.height) <= 0 ||
      need(box.x) + need(box.width) > need(graph.width) + 0.01 ||
      need(box.y) + need(box.height) > need(graph.height) + 0.01
    )
      throw new Error(
        "Signal loop contains unplaced or out-of-bounds content.",
      );
  }
  for (const [i, label] of labels.entries())
    if (
      [...nodes, ...labels.slice(i + 1)].some((b) =>
        overlaps(label as Box, b as Box),
      )
    )
      throw new Error("Signal loop labels overlap other drawing content.");
  for (const edge of graph.edges ?? [])
    for (const path of points(edge))
      for (let i = 1; i < path.length; i++) {
        const a = need(path[i - 1]),
          b = need(path[i]);
        assertOrthogonalSegment(a, b);
        const segment = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y),
        };
        if (nodes.some((node) => overlaps(segment, node as Box)))
          throw new Error("Signal loop route crosses a device body.");
        if (
          labels.some((l) => l.edge !== edge.id && overlaps(segment, l as Box))
        )
          throw new Error("A signal loop label conceals another conductor.");
      }
}

function checkSharedRuns(graph: ElkNode) {
  const segments = (graph.edges ?? []).flatMap((e) =>
    points(e).flatMap((ps) =>
      ps.slice(1).map((b, i) => ({ id: e.id, a: need(ps[i]), b })),
    ),
  );
  for (const [i, a] of segments.entries())
    for (const b of segments.slice(i + 1)) {
      if (a.id === b.id) continue;
      const horizontal =
        Math.abs(a.a.y - a.b.y) <= routeTolerance &&
        Math.abs(b.a.y - b.b.y) <= routeTolerance &&
        Math.abs(a.a.y - b.a.y) <= routeTolerance;
      const vertical =
        Math.abs(a.a.x - a.b.x) <= routeTolerance &&
        Math.abs(b.a.x - b.b.x) <= routeTolerance &&
        Math.abs(a.a.x - b.a.x) <= routeTolerance;
      if (!horizontal && !vertical) continue;
      const axis = horizontal ? "x" : "y";
      if (
        Math.min(
          Math.max(a.a[axis], a.b[axis]),
          Math.max(b.a[axis], b.b[axis]),
        ) -
          Math.max(
            Math.min(a.a[axis], a.b[axis]),
            Math.min(b.a[axis], b.b[axis]),
          ) >
        routeTolerance
      )
        throw new Error(
          "Series loop routes share a conductor run; use another orientation or flow, or a circuit view.",
        );
    }
}

function emitEdge(edge: ElkExtendedEdge, source: Conductor, label: string[]) {
  const paths = points(edge)
    .map(snappedPath)
    .map(
      (ps) =>
        `<path d="${ps.map((p, i) => `${i ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="${source.spare ? "#697586" : "#23566d"}" stroke-width="0.4" stroke-linecap="round"${source.spare ? ' stroke-dasharray="2 1"' : ""}/>`,
    )
    .join("");
  const labels = (edge.labels ?? [])
    .map(
      (l) =>
        `<rect x="${n(need(l.x))}" y="${n(need(l.y))}" width="${n(need(l.width))}" height="${n(need(l.height))}" fill="white"/>` +
        label
          .map((s, i) => text(need(l.x) + 1, need(l.y) + 3 + i * 3.8, s, 2.7))
          .join(""),
    )
    .join("");
  return `<g data-loop-conductor="${attr(source.id)}" data-net-id="${attr(source.net)}" data-terminal-ends="${attr(JSON.stringify(source.ends))}">${paths}${labels}</g>`;
}

function feedThroughLinks(info: ReturnType<typeof deviceNode>) {
  const groups = new Map<string, Port[]>();
  for (const port of info.ports) {
    const k = key(port.terminal);
    groups.set(k, [...(groups.get(k) ?? []), port]);
  }
  return [...groups]
    .flatMap(([id, ps]) => {
      if (ps.length !== 2) return [];
      if (!info.feedThrough)
        throw new Error(
          "Series loop needs separate visible feed-through landings; use a circuit view.",
        );
      const a = need(ps[0]),
        b = need(ps[1]);
      return [
        `<g data-terminal-feed-through="${attr(id)}"><path d="M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)}" stroke="#344054" stroke-width="0.3" fill="none"/></g>`,
      ];
    })
    .join("");
}

function emitNode(
  info: ReturnType<typeof deviceNode>,
  placed: ElkNode,
  vertical: boolean,
) {
  const w = need(placed.width),
    h = need(placed.height);
  const body = info.source
    ? circuitBlock(w, h, info.ports)
    : fieldDeviceBody(
        info.pressure ? "thermite:pressure-transmitter" : "",
        w,
        h,
        vertical ? 25 : w / 2,
      );
  const mark = info.source
    ? `<g transform="translate(${n(vertical ? 19 : w / 2 - 6)} 3)">${emitCircuitMark("dc-output", false, 1)}</g>`
    : "";
  const caption = info.caption
    .map((s, i) =>
      text(
        3,
        (info.pressure ? 26 : info.source ? 20 : 5) + i * 3.7,
        s,
        2.7,
        "start",
        i === 0 ? 700 : 400,
      ),
    )
    .join("");
  const ports = info.ports
    .map(
      (p) =>
        `<g data-loop-terminal="${attr(key(p.terminal))}"><circle cx="${n(p.x)}" cy="${n(p.y)}" r="0.8" fill="white" stroke="#344054" stroke-width="0.3"/>${vertical ? text(p.x + 1.5, p.y === 0 ? 4 : h - 2, p.terminal.terminalKey, 2.7) : text(p.x === 0 ? 2 : w - 2, p.y - 1.5, p.terminal.terminalKey, 2.7, p.x === 0 ? "start" : "end")}</g>`,
    )
    .join("");
  return `<g data-device-uid="${attr(info.uid)}" data-body-width="${n(w)}" data-body-height="${n(h)}" transform="translate(${n(need(placed.x))} ${n(need(placed.y))})">${body}${mark}${caption}${feedThroughLinks(info)}${ports}</g>`;
}

function seriesGraph(
  infos: ReturnType<typeof deviceNode>[],
  edges: Conductor[],
  labels: string[][],
  vertical: boolean,
): ElkNode {
  const ports = new Map(
    infos.flatMap((info) =>
      info.ports.map(
        (p) => [landingKey(p.conductor, p.terminal), p.id] as const,
      ),
    ),
  );
  return {
    id: "series-loop",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": vertical ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "8",
      "elk.layered.spacing.edgeNodeBetweenLayers": "3",
      "elk.spacing.edgeEdge": "6",
      "elk.spacing.edgeNode": "6",
      "elk.padding": "[top=6,left=6,bottom=6,right=6]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: infos.map((i) => i.node),
    edges: edges.map((e, i) => ({
      id: `e${i}`,
      sources: [need(ports.get(landingKey(e.id, e.ends[0])))],
      targets: [need(ports.get(landingKey(e.id, e.ends[1])))],
      labels: [
        {
          text: need(labels[i]).join("\n"),
          width: Math.max(...need(labels[i]).map(width)) + 2,
          height: need(labels[i]).length * 3.8 + 1,
        },
      ],
    })),
  };
}

function emitRoutes(
  graph: ElkNode,
  edges: Conductor[],
  labels: string[][],
  cables: Map<string, string>,
) {
  const content: string[] = [];
  for (const edge of graph.edges ?? []) {
    const i = Number(edge.id.slice(1)),
      source = need(edges[i]);
    const part = emitEdge(edge, source, need(labels[i]));
    content.push(
      source.cable && cables.has(source.cable)
        ? `<g data-cable-assembly="${attr(source.cable)}">${part}</g>`
        : part,
    );
  }
  return content;
}

/** Series-only layout. Conductive relations come exclusively from selection. */
export async function prepareSeriesLoopDrawing(
  ir: Readonly<ElectricalIr>,
  request: SignalLoopViewRequest,
  selected: Selection,
) {
  const vertical = request.flow === "top-to-bottom",
    edges = drawingEdges(selected),
    assembly = assemblyLabels(ir, request, edges);
  const infos = selected.stages.map((uid, i) =>
    deviceNode(selected, uid, i, edges, vertical),
  );
  const labels = edges.map((e) => [
    ...(assembly.labels.get(e.id) ?? []),
    ...e.label,
  ]);
  const expected = seriesGraph(infos, edges, labels, vertical);
  const graph = await createElkEngine().layout(structuredClone(expected));
  assertTopologyIdentities(graph, expected);
  assertTopologyRouteEndpoints(graph);
  checkLayout(graph);
  checkSharedRuns(graph);
  const enclosure = drawEnclosures(
    graph,
    selected,
    request.enclosures ?? [],
    vertical,
  );
  const content = [enclosure.content];
  content.push(...emitRoutes(graph, edges, labels, assembly.cables));
  const references = (graph.children ?? []).map((node) => {
    const info = need(infos[Number(node.id.slice(1))]);
    content.push(emitNode(info, node, vertical));
    return {
      deviceUid: info.uid,
      designation: need(selected.devices.get(info.uid)).designation,
      functions: loopFunctions(selected)
        .filter((f) => f.device.uid === info.uid)
        .map((f) => f.function.id.functionKey),
      x: need(node.x) + need(node.width) / 2 - enclosure.minX,
      y: need(node.y) + need(node.height) / 2 - enclosure.minY,
    };
  });
  const notes = engineNotes(selected);
  return {
    title: `${selected.from.device.designation} - signal loop`,
    content:
      `<desc>${xml(notes.join("\n"))}</desc>` +
      `<g transform="translate(${n(-enclosure.minX)} ${n(-enclosure.minY)})">${content.join("\n")}</g>`,
    width: enclosure.width,
    height: enclosure.height,
    references,
    engineNotes: notes,
    note: [
      ...notes,
      "Dashed cores are explicitly spare; connector contact numbers are not a mating-face view.",
      ...(assembly.cables.size
        ? [
            "Assembly pin maps identify separate core routes; no shared electrical net is implied.",
          ]
        : []),
      ...(request.notes ?? []),
    ].join("\n"),
  };
}
