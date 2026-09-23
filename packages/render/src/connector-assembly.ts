import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { ElectricalIr } from "@thermite/compiler";
import { buildConnectorAssemblyInventory } from "@thermite/query";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "./svg/escape.js";
import { createElkEngine } from "./layout/elk-runtime.js";

export interface ConnectorAssemblyViewRequest {
  readonly format: "connector-assembly-view-request/0.1";
  readonly title?: string;
  readonly devices?: readonly string[];
  readonly assemblies?: readonly string[];
  readonly notes?: readonly string[];
}
export interface ConnectorAssemblyDrawing {
  title: string;
  content: string;
  width: number;
  height: number;
  references: {
    deviceUid: string;
    designation: string;
    x: number;
    y: number;
  }[];
  note: string;
}
const n = (x: number) => String(Number(x.toFixed(3)));
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const width = (s: string) =>
  [...s].reduce(
    (v, c) =>
      v +
      (/[MW@%]/u.test(c)
        ? 1
        : /[ilI1 .,:;'|!]/u.test(c)
          ? 0.4
          : c.codePointAt(0)! > 127
            ? 1.2
            : 0.75) *
        2.7,
    0,
  );
const text = (x: number, y: number, s: string, bold = false) =>
  `<text x="${n(x)}" y="${n(y)}" font-family="Arial, Helvetica, sans-serif" font-size="2.7" font-weight="${bold ? 700 : 400}" fill="#17212b">${xml(s)}</text>`;
function wrap(value: string, max = 48): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u)) {
    if (line && width(line + " " + word) > max) {
      lines.push(line);
      line = "";
    }
    if (width(word) > max) {
      for (const c of word) {
        if (width(line + c) > max) {
          lines.push(line);
          line = "";
        }
        line += c;
      }
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}
const strings = (v: unknown, maxCount: number, maxLength: number) =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= maxCount &&
  v.every(
    (s) =>
      typeof s === "string" &&
      s.trim() &&
      s.length <= maxLength &&
      !/[\u0000-\u001f]/u.test(s),
  ) &&
  new Set(v).size === v.length;

/** Assembly paths are authored port reservations, never wires or inferred pin joins. */
export async function prepareConnectorAssemblyDrawing(
  ir: Readonly<ElectricalIr>,
  request: ConnectorAssemblyViewRequest,
): Promise<ConnectorAssemblyDrawing> {
  if (
    !request ||
    request.format !== "connector-assembly-view-request/0.1" ||
    Object.keys(request).some(
      (k) => !["format", "title", "devices", "assemblies", "notes"].includes(k),
    ) ||
    (request.title !== undefined && !strings([request.title], 1, 120)) ||
    (request.devices !== undefined && !strings(request.devices, 40, 200)) ||
    (request.assemblies !== undefined &&
      !strings(request.assemblies, 80, 200)) ||
    (request.notes !== undefined && !strings(request.notes, 12, 400))
  )
    throw new Error("Invalid connector assembly view request.");
  const inventory = buildConnectorAssemblyInventory(ir),
    devices = new Map(ir.devices.map((d) => [d.uid, d])),
    types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  const selected = new Set<string>();
  for (const value of request.devices ?? []) {
    const found = ir.devices.filter(
      (d) => d.uid === value || d.designation === value,
    );
    if (found.length !== 1)
      throw new Error(`Assembly device ${value} does not resolve uniquely.`);
    if (!Object.keys(types.get(found[0]!.typeId)!.connectorPorts ?? {}).length)
      throw new Error(`${value} has no connector ports.`);
    if (selected.has(found[0]!.uid))
      throw new Error("Assembly device selectors repeat a source identity.");
    selected.add(found[0]!.uid);
  }
  const exact = new Set<string>();
  for (const value of request.assemblies ?? []) {
    const found = inventory.assemblies.filter(
      (a) => a.uid === value || a.designation === value,
    );
    if (found.length !== 1)
      throw new Error(`Assembly ${value} does not resolve uniquely.`);
    if (exact.has(found[0]!.uid))
      throw new Error("Assembly selectors repeat a source identity.");
    exact.add(found[0]!.uid);
  }
  const links = inventory.assemblies.filter((a) =>
    exact.size
      ? exact.has(a.uid)
      : !selected.size ||
        selected.has(a.fromDeviceUid) ||
        selected.has(a.toDeviceUid),
  );
  const included = new Set([
    ...selected,
    ...links.flatMap((a) => [a.fromDeviceUid, a.toDeviceUid]),
  ]);
  if (!selected.size && !exact.size)
    for (const p of inventory.ports) included.add(p.deviceUid);
  if (!included.size || included.size > 80)
    throw new Error(
      "Connector assembly view requires 1–80 devices; select a smaller assembly subset.",
    );
  const ordered = [...included].sort((a, b) =>
    compare(devices.get(a)!.designation, devices.get(b)!.designation),
  );
  const ids = new Map(ordered.map((uid, i) => [uid, `d${i}`]));
  const portIds = new Map<string, string>(),
    captions = new Map<string, string[]>(),
    rows = new Map<
      string,
      {
        key: string;
        connector: string;
        side: "WEST" | "EAST";
        y: number;
        status: string;
        lines: string[];
      }[]
    >();
  const nodeWidth = 58;
  const edgeCaptions = links.map((r) => [
    r.designation ?? r.uid,
    ...wrap(
      r.assembly.cable?.specification ??
        (r.assembly.kind === "cap" ? "Protective cap" : "Direct mating"),
    ),
    ...wrap(
      [r.assembly.cable?.manufacturer, r.assembly.cable?.orderNumber]
        .filter(Boolean)
        .join(" / "),
    ),
    ...(r.assembly.cable?.lengthM === undefined
      ? []
      : [`Length: ${r.assembly.cable.lengthM} m`]),
    ...(r.assembly.cable?.route
      ? wrap(`Route: ${r.assembly.cable.route}`)
      : []),
    ...(r.description ? wrap(r.description) : []),
    ...(r.assembly.status ? [`Status: ${r.assembly.status}`] : []),
    `Pin mapping: ${r.assembly.pinMapping.status}`,
  ]);
  const children: ElkNode[] = ordered.map((uid) => {
    const device = devices.get(uid)!,
      type = types.get(device.typeId)!;
    const caption = [
      device.designation,
      ...wrap(device.description ?? type.description ?? type.id, nodeWidth - 6),
      ...wrap(type.catalog?.orderNumber ?? "", nodeWidth - 6),
      ...wrap(device.location ?? "Location unspecified", nodeWidth - 6),
    ];
    if (caption.some((s) => width(s) > nodeWidth - 6))
      throw new Error(
        `Assembly device designation ${device.designation} is too wide.`,
      );
    captions.set(uid, caption);
    const available = inventory.ports.filter((p) => p.deviceUid === uid);
    const ports = available.filter(
      (p) =>
        !exact.size ||
        selected.has(uid) ||
        links.some(
          (a) =>
            (a.fromDeviceUid === uid && a.assembly.fromPort === p.key) ||
            (a.toDeviceUid === uid && a.assembly.toPort === p.key),
        ),
    );
    if (ports.length < available.length)
      caption.push(
        ...wrap(
          `${available.length - ports.length} other ports: schedule`,
          nodeWidth - 6,
        ),
      );
    let y = 5 + caption.length * 3.6;
    const list = ports.map((p, i) => {
      const incoming = links.some(
        (a) => a.toDeviceUid === uid && a.assembly.toPort === p.key,
      );
      const selectedLink = links.find(
        (a) =>
          (a.fromDeviceUid === uid && a.assembly.fromPort === p.key) ||
          (a.toDeviceUid === uid && a.assembly.toPort === p.key),
      );
      const status = selectedLink
        ? selectedLink.assembly.kind
        : p.assemblyUid
          ? "outside view"
          : "unoccupied";
      const lines = [
        ...wrap(p.key, nodeWidth - 6),
        ...wrap(p.definition.connector, nodeWidth - 6),
        ...(p.definition.description
          ? wrap(p.definition.description, nodeWidth - 6)
          : []),
        ...(!selectedLink ? [status] : []),
      ];
      const row = {
        key: p.key,
        connector: p.definition.connector,
        side: incoming ? ("WEST" as const) : ("EAST" as const),
        y: y + 3,
        status,
        lines,
      };
      y += Math.max(10, lines.length * 3.6 + 4);
      portIds.set(JSON.stringify([uid, p.key]), `${ids.get(uid)}p${i}`);
      return row;
    });
    rows.set(uid, list);
    return {
      id: ids.get(uid)!,
      width: nodeWidth,
      height: y + 2,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: list.map((p) => ({
        id: portIds.get(JSON.stringify([uid, p.key]))!,
        width: 0,
        height: 0,
        x: p.side === "WEST" ? 0 : nodeWidth,
        y: p.y,
        layoutOptions: { "elk.port.side": p.side },
      })),
    };
  });
  const graph: ElkNode = await createElkEngine().layout({
    id: "connector-assembly",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "7",
      "elk.layered.spacing.nodeNodeBetweenLayers": "8",
      "elk.spacing.edgeNode": "4",
      "elk.spacing.edgeEdge": "4",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "4",
      "elk.layered.spacing.edgeNodeBetweenLayers": "4",
      "elk.padding": "[top=4,left=4,bottom=4,right=4]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children,
    edges: links.map((r, i) => ({
      id: `e${i}`,
      sources: [
        portIds.get(JSON.stringify([r.fromDeviceUid, r.assembly.fromPort]))!,
      ],
      targets: [
        portIds.get(JSON.stringify([r.toDeviceUid, r.assembly.toPort]))!,
      ],
      labels: [
        {
          text: edgeCaptions[i]!.join("\n"),
          width: Math.max(...edgeCaptions[i]!.map(width)) + 2,
          height: edgeCaptions[i]!.length * 3.6 + 1,
        },
      ],
    })),
  });
  if (![graph.width, graph.height].every(Number.isFinite))
    throw new Error("Invalid assembly layout bounds.");
  const nodes = graph.children ?? [],
    out: string[] = [],
    labelBoxes: {
      x: number;
      y: number;
      width: number;
      height: number;
      edge: number;
    }[] = [],
    segments: {
      a: { x: number; y: number };
      b: { x: number; y: number };
      edge: number;
    }[] = [];
  const overlap = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width - 0.01 &&
    a.x + a.width > b.x + 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    a.y + a.height > b.y + 0.01;
  if (graph.edges?.length !== links.length)
    throw new Error("Incomplete assembly coverage.");
  for (const edge of graph.edges ?? []) {
    const index = Number(edge.id.slice(1)),
      r = links[index]!;
    if (edge.sections?.length !== 1)
      throw new Error("Incomplete assembly route.");
    const section = edge.sections[0]!,
      points = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ].map((p) => ({ x: Number(n(p.x)), y: Number(n(p.y)) }));
    const endpoints = [
      { deviceUid: r.fromDeviceUid, portKey: r.assembly.fromPort },
      { deviceUid: r.toDeviceUid, portKey: r.assembly.toPort },
    ];
    const actual = endpoints.map((e) => {
      const node = nodes.find((n) => n.id === ids.get(e.deviceUid))!,
        port = node.ports!.find(
          (p) => p.id === portIds.get(JSON.stringify([e.deviceUid, e.portKey])),
        )!;
      return { x: node.x! + port.x!, y: node.y! + port.y! };
    });
    if (
      Math.hypot(points[0]!.x - actual[0]!.x, points[0]!.y - actual[0]!.y) >
        0.01 ||
      Math.hypot(
        points.at(-1)!.x - actual[1]!.x,
        points.at(-1)!.y - actual[1]!.y,
      ) > 0.01
    )
      throw new Error("Assembly route moved away from its source ports.");
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      if (
        ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
        (a.x !== b.x && a.y !== b.y)
      )
        throw new Error("Invalid assembly route.");
      const rect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
      };
      if (
        nodes.some((n) =>
          overlap(rect, {
            x: n.x!,
            y: n.y!,
            width: n.width!,
            height: n.height!,
          }),
        )
      )
        throw new Error("Assembly route crosses a device body.");
      segments.push({ a, b, edge: index });
    }
    out.push(
      `<g data-connector-assembly="${attr(r.uid)}" data-assembly-designation="${attr(r.designation ?? r.uid)}" data-assembly-endpoints="${attr(JSON.stringify(endpoints))}" data-pin-mapping="${r.assembly.pinMapping.status}"><title>${xml(r.assembly.pinMapping.reason)}</title><path d="${points.map((p, i) => `${i ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="white" stroke-width="1.8"/><path d="${points.map((p, i) => `${i ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="#4f5964" stroke-width="0.65"${r.assembly.kind === "cap" ? ' stroke-dasharray="1.5 1"' : ""}/></g>`,
    );
    for (const label of edge.labels ?? []) {
      if (![label.x, label.y, label.width, label.height].every(Number.isFinite))
        throw new Error("Unplaced assembly label.");
      labelBoxes.push({
        x: label.x!,
        y: label.y!,
        width: label.width!,
        height: label.height!,
        edge: index,
      });
      out.push(
        `<g data-assembly-label="${attr(r.uid)}"><rect x="${n(label.x!)}" y="${n(label.y!)}" width="${n(label.width!)}" height="${n(label.height!)}" fill="white"/>${edgeCaptions[index]!.map((s, j) => text(label.x! + 1, label.y! + 3 + j * 3.6, s, j === 0)).join("")}</g>`,
      );
    }
  }
  for (let i = 0; i < labelBoxes.length; i++) {
    const label = labelBoxes[i]!;
    if (
      nodes.some((n) =>
        overlap(label, {
          x: n.x!,
          y: n.y!,
          width: n.width!,
          height: n.height!,
        }),
      ) ||
      labelBoxes.slice(i + 1).some((b) => overlap(label, b)) ||
      segments.some(
        (s) =>
          s.edge !== label.edge &&
          overlap(label, {
            x: Math.min(s.a.x, s.b.x),
            y: Math.min(s.a.y, s.b.y),
            width: Math.abs(s.a.x - s.b.x),
            height: Math.abs(s.a.y - s.b.y),
          }),
      )
    )
      throw new Error(
        "Assembly label overlaps drawing content; select a smaller assembly subset.",
      );
  }
  assertAssemblyRouteSeparation(segments);
  const references: ConnectorAssemblyDrawing["references"] = [];
  for (const node of nodes) {
    const uid = ordered[Number(node.id.slice(1))]!,
      device = devices.get(uid)!;
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite))
      throw new Error("Invalid assembly node bounds.");
    out.push(
      `<g data-device-uid="${attr(uid)}" transform="translate(${n(node.x!)} ${n(node.y!)})"><rect width="${n(node.width!)}" height="${n(node.height!)}" rx="1" fill="#fafafa" stroke="#344054" stroke-width=".35"/>${captions
        .get(uid)!
        .map((s, i) => text(3, 5 + i * 3.6, s, i === 0))
        .join("")}`,
    );
    for (const p of rows.get(uid)!) {
      const x = p.side === "WEST" ? 0 : node.width!;
      out.push(
        `<g data-connector-port="${attr(p.key)}" data-connector-definition="${attr(p.connector)}" data-port-occupancy="${p.status}"><circle cx="${n(x)}" cy="${n(p.y)}" r="1.1" fill="white" stroke="#344054" stroke-width=".4"/>${p.lines.map((s, i) => text(3, p.y + 1 + i * 3.6, s, i === 0)).join("")}</g>`,
      );
    }
    out.push("</g>");
    references.push({
      deviceUid: uid,
      designation: device.designation,
      x: node.x! + node.width! / 2,
      y: node.y! + node.height! / 2,
    });
  }
  return {
    title: request.title ?? "Connector and cable assemblies",
    content: out.join("\n"),
    width: graph.width!,
    height: graph.height!,
    references,
    note: [
      `${links.length} authored assemblies. Lines connect named connectors, not electrical pins; cable pin mapping is unresolved. See assembly schedule for specifications and mapping reasons.`,
      ...(request.notes ?? []),
    ].join("\n"),
  };
}

/** Separate point-to-point assemblies may cross, but may not share a drawn segment. */
export function assertAssemblyRouteSeparation(
  segments: readonly {
    a: { x: number; y: number };
    b: { x: number; y: number };
    edge: number;
  }[],
): void {
  for (let i = 0; i < segments.length; i++)
    for (const other of segments.slice(i + 1)) {
      const current = segments[i]!;
      if (current.edge === other.edge) continue;
      const vertical =
        current.a.x === current.b.x &&
        other.a.x === other.b.x &&
        current.a.x === other.a.x;
      const horizontal =
        current.a.y === current.b.y &&
        other.a.y === other.b.y &&
        current.a.y === other.a.y;
      const axis = vertical ? "y" : "x";
      if (
        (vertical || horizontal) &&
        Math.min(
          Math.max(current.a[axis], current.b[axis]),
          Math.max(other.a[axis], other.b[axis]),
        ) -
          Math.max(
            Math.min(current.a[axis], current.b[axis]),
            Math.min(other.a[axis], other.b[axis]),
          ) >
          0.000001
      )
        throw new Error(
          "Distinct connector assemblies share a drawn segment; select a smaller assembly subset.",
        );
    }
}
