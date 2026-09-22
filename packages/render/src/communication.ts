import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import type { ElectricalIr } from "@thermite/compiler";
import { buildCommunicationInventory } from "@thermite/query";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "./svg/escape.js";

export interface CommunicationViewRequest {
  readonly format: "communication-view-request/0.1";
  readonly medium: "ethernet" | "nrg-bus";
  readonly devices?: readonly string[];
}
export interface CommunicationDrawing {
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
const Constructor = BundledElk as unknown as { new (): ELK };
const n = (v: number) => String(Number(v.toFixed(3)));
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
// Conservative advance bounds for Arial/Noto Sans at 2.7 mm, including wide text.
const textWidth = (s: string) =>
  [...s].reduce(
    (w, c) =>
      w +
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
  `<text x="${n(x)}" y="${n(y)}" font-family="Arial, Helvetica, sans-serif" font-size="2.7" font-weight="${bold ? 700 : 400}" fill="#18212b">${xml(s)}</text>`;
function wrap(s: string, limit = 35, width = Infinity): string[] {
  const words = s.split(/\s+/u),
    lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (
      line &&
      (line.length + word.length + 1 > limit ||
        textWidth(`${line} ${word}`) > width)
    ) {
      lines.push(line);
      line = "";
    }
    if (word.length > limit || textWidth(word) > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const character of word) {
        if (line.length >= limit || textWidth(line + character) > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}
/** ELK owns port placement and orthogonal paths. Geometry is generated from compiled links. */
export async function prepareCommunicationDrawing(
  ir: Readonly<ElectricalIr>,
  request: CommunicationViewRequest,
): Promise<CommunicationDrawing> {
  if (
    !request ||
    request.format !== "communication-view-request/0.1" ||
    !["ethernet", "nrg-bus"].includes(request.medium) ||
    Object.keys(request).some(
      (k) => !["format", "medium", "devices"].includes(k),
    ) ||
    (request.devices !== undefined &&
      (!Array.isArray(request.devices) ||
        !request.devices.length ||
        request.devices.length > 40 ||
        request.devices.some((d) => typeof d !== "string" || !d.trim()) ||
        new Set(request.devices).size !== request.devices.length))
  )
    throw new Error(
      "Invalid communication view. Use medium ethernet or nrg-bus and optional unique device selectors.",
    );
  const inventory = buildCommunicationInventory(ir);
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  const selected = new Set<string>();
  for (const name of request.devices ?? []) {
    const matches = ir.devices.filter(
      (d) => d.uid === name || d.designation === name,
    );
    if (matches.length !== 1)
      throw new Error(
        `Communication device ${JSON.stringify(name)} does not resolve uniquely.`,
      );
    if (
      !Object.values(types.get(matches[0]!.typeId)!.ports ?? {}).some(
        (p) => p.medium === request.medium,
      )
    )
      throw new Error(`${name} has no ${request.medium} ports.`);
    selected.add(matches[0]!.uid);
  }
  const links = inventory.links.filter(
    (r) =>
      r.connection.medium === request.medium &&
      (!selected.size ||
        selected.has(r.fromDeviceUid) ||
        selected.has(r.toDeviceUid)),
  );
  const included = new Set([
    ...selected,
    ...links.flatMap((l) => [l.fromDeviceUid, l.toDeviceUid]),
  ]);
  if (!selected.size)
    for (const p of inventory.ports.filter(
      (p) => p.definition.medium === request.medium,
    ))
      included.add(p.deviceUid);
  if (!included.size)
    throw new Error(`No ${request.medium} devices in this view.`);
  if (included.size > 80)
    throw new Error(
      "Communication view exceeds 80 devices; select a smaller view.",
    );
  const ordered = [...included].sort((a, b) =>
    compare(devices.get(a)!.designation, devices.get(b)!.designation),
  );
  const nodeIds = new Map(ordered.map((uid, i) => [uid, `d${i}`]));
  const portIds = new Map<string, string>();
  const rows = new Map<
    string,
    { key: string; side: "WEST" | "EAST"; y: number }[]
  >();
  const captions = new Map<string, string[]>();
  const nodeWidth = request.medium === "nrg-bus" ? 44 : 66;
  const children: ElkNode[] = ordered.map((uid) => {
    const device = devices.get(uid)!,
      type = types.get(device.typeId)!;
    const boundary = selected.size > 0 && !selected.has(uid);
    const caption = [
      device.designation,
      ...wrap(
        type.catalog?.orderNumber ?? type.description ?? type.id,
        request.medium === "nrg-bus" ? 24 : 35,
        nodeWidth - 6,
      ),
      ...wrap(
        device.location ?? "Location unspecified",
        request.medium === "nrg-bus" ? 24 : 35,
        nodeWidth - 6,
      ),
      ...(boundary ? ["Boundary (schedule)"] : []),
    ];
    if (caption.some((line) => textWidth(line) > nodeWidth - 6))
      throw new Error(
        `Communication caption for ${device.designation} is too wide; use a shorter label.`,
      );
    captions.set(uid, caption);
    const connected = links.flatMap<{ key: string; side: "WEST" | "EAST" }>(
      (l) =>
        l.fromDeviceUid === uid
          ? [{ key: l.connection.fromPort, side: "EAST" as const }]
          : l.toDeviceUid === uid
            ? [{ key: l.connection.toPort, side: "WEST" as const }]
            : [],
    );
    const west = connected.filter((p) => p.side === "WEST"),
      east = connected.filter((p) => p.side === "EAST");
    for (let i = 0; i < Math.max(west.length, east.length); i++)
      if (
        textWidth(west[i]?.key ?? "") + textWidth(east[i]?.key ?? "") >
        nodeWidth - 8
      )
        throw new Error(
          `Communication port labels on ${device.designation} cannot fit without overlap.`,
        );
    const labelBottom = 4 + caption.length * 3.7;
    const list = [
      ...west.map((p, i) => ({ ...p, y: labelBottom + 4 + i * 5 })),
      ...east.map((p, i) => ({ ...p, y: labelBottom + 4 + i * 5 })),
    ];
    rows.set(uid, list);
    return {
      id: nodeIds.get(uid)!,
      width: nodeWidth,
      height: labelBottom + 9 + Math.max(west.length, east.length, 1) * 5,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: list.map((p, i) => {
        const id = `${nodeIds.get(uid)}p${i}`;
        portIds.set(JSON.stringify([uid, p.key]), id);
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
  });
  const elk = new Constructor();
  const graph: ElkNode = await elk.layout({
    id: "communication",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "10",
      "elk.layered.spacing.nodeNodeBetweenLayers":
        request.medium === "nrg-bus" ? "6" : "32",
      "elk.layered.spacing.edgeNodeBetweenLayers": "4",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "4",
      "elk.spacing.edgeNode": "8",
      "elk.spacing.edgeEdge": "5",
      "elk.padding": "[top=5,left=5,bottom=5,right=5]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children,
    edges: links.map((l, i) => ({
      id: `e${i}`,
      sources: [
        portIds.get(JSON.stringify([l.fromDeviceUid, l.connection.fromPort]))!,
      ],
      targets: [
        portIds.get(JSON.stringify([l.toDeviceUid, l.connection.toPort]))!,
      ],
      labels: [
        {
          text: l.designation ?? `Link ${i + 1}`,
          width: textWidth(l.designation ?? `Link ${i + 1}`) + 2,
          height: 4,
        },
      ],
    })),
  });
  if (!Number.isFinite(graph.width) || !Number.isFinite(graph.height))
    throw new Error("Invalid communication layout bounds.");
  const out: string[] = [];
  const rectangles = graph.children ?? [];
  const inside = (x: number, y: number, node: ElkNode) =>
    x > node.x! + 0.01 &&
    x < node.x! + node.width! - 0.01 &&
    y > node.y! + 0.01 &&
    y < node.y! + node.height! - 0.01;
  for (const [i, edge] of (graph.edges ?? []).entries()) {
    if (!edge.sections?.length)
      throw new Error("Communication route is incomplete.");
    out.push(`<g data-communication-link="${attr(links[i]!.uid)}">`);
    for (const section of edge.sections) {
      const points = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ].map((p) => ({ x: Number(n(p.x)), y: Number(n(p.y)) }));
      for (let j = 1; j < points.length; j++) {
        const a = points[j - 1]!,
          b = points[j]!;
        if (
          ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
          (a.x !== b.x && a.y !== b.y)
        )
          throw new Error("Communication route is not finite and orthogonal.");
        for (const node of rectangles) {
          const midX = Math.max(
            node.x! + 0.02,
            Math.min((a.x + b.x) / 2, node.x! + node.width! - 0.02),
          );
          const midY = Math.max(
            node.y! + 0.02,
            Math.min((a.y + b.y) / 2, node.y! + node.height! - 0.02),
          );
          if (
            (a.x === b.x &&
              inside(a.x, midY, node) &&
              Math.max(a.y, b.y) > node.y! + 0.01 &&
              Math.min(a.y, b.y) < node.y! + node.height! - 0.01) ||
            (a.y === b.y &&
              inside(midX, a.y, node) &&
              Math.max(a.x, b.x) > node.x! + 0.01 &&
              Math.min(a.x, b.x) < node.x! + node.width! - 0.01)
          )
            throw new Error("Communication route crosses a device body.");
        }
      }
      out.push(
        `<path d="${points.map((p, j) => `${j ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="${request.medium === "ethernet" ? "#176785" : "#775721"}" stroke-width="0.45"/>`,
      );
    }
    for (const label of edge.labels ?? []) {
      if (label.x === undefined || label.y === undefined)
        throw new Error("Communication label is unplaced.");
      out.push(
        `<rect x="${n(label.x)}" y="${n(label.y)}" width="${n(label.width!)}" height="${n(label.height!)}" fill="white"/>`,
        text(label.x + 1, label.y + 3, label.text!),
      );
    }
    out.push("</g>");
  }
  const references: CommunicationDrawing["references"] = [];
  for (const node of rectangles) {
    const uid = ordered[Number(node.id.slice(1))]!,
      device = devices.get(uid)!;
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite))
      throw new Error("Invalid communication node.");
    out.push(
      `<g data-device-uid="${attr(uid)}" transform="translate(${n(node.x!)} ${n(node.y!)})">`,
      `<rect width="${n(node.width!)}" height="${n(node.height!)}" rx="1" fill="#f5f8fb" stroke="#344054" stroke-width="0.3"/>`,
    );
    captions
      .get(uid)!
      .forEach((s, j) => out.push(text(3, 5 + j * 3.7, s, j === 0)));
    for (const port of rows.get(uid)!) {
      const px = port.side === "WEST" ? 0 : node.width!;
      out.push(
        `<circle cx="${n(px)}" cy="${n(port.y)}" r="0.7" fill="white" stroke="#344054" stroke-width="0.3"/>`,
        text(
          port.side === "WEST" ? 2 : node.width! - 2 - textWidth(port.key),
          port.y + 1,
          port.key,
        ),
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
    title:
      request.medium === "ethernet"
        ? "Ethernet connections"
        : "NRG heater bus connections",
    content: out.join("\n"),
    width: graph.width!,
    height: graph.height!,
    references,
    note: `${links.length} authored links; ${selected.size ? "boundary devices included; " : ""}see communication schedule for status and unconnected ports.`,
  };
}
