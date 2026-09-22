import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "./svg/escape.js";
import type { CommunicationDrawing } from "./communication.js";

/** A deliberate subset of physical wiring, never an inferred circuit or net short. */
export interface WiringViewRequest {
  readonly format: "wiring-view-request/0.1";
  readonly title: string;
  readonly conductors: readonly string[];
  readonly notes?: readonly string[];
  readonly deviceOrder?: readonly string[];
}
const Constructor = BundledElk as unknown as { new (): ELK };
const key = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);
const n = (v: number) => String(Number(v.toFixed(3)));
const width = (s: string) =>
  [...s].reduce(
    (w, c) =>
      w +
      (/[ilI1 .,:;'|!]/u.test(c)
        ? 0.4
        : /[MW@%]/u.test(c)
          ? 1
          : c.codePointAt(0)! > 127
            ? 1.2
            : 0.75) *
        2.7,
    0,
  );
const text = (x: number, y: number, s: string, bold = false) =>
  `<text x="${n(x)}" y="${n(y)}" font-family="Arial, Helvetica, sans-serif" font-size="2.7" font-weight="${bold ? 700 : 400}" fill="#18212b">${xml(s)}</text>`;
function wrap(s: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/u)) {
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
export async function prepareWiringDrawing(
  ir: Readonly<ElectricalIr>,
  request: WiringViewRequest,
): Promise<CommunicationDrawing> {
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
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  const all = [
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
      name: w.designation ?? w.uid,
      ends: w.endpoints.map((e) => e.terminal),
      detail: "Jumper",
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
  // Endpoint order has no electrical meaning. Orient layout only, without mutating IR.
  for (const conductor of selected)
    if (
      ordered.indexOf(conductor.ends[0]!.deviceUid) >
      ordered.indexOf(conductor.ends[1]!.deviceUid)
    )
      conductor.ends.reverse();
  if (ordered.length > 30)
    throw new Error("Wiring view exceeds 30 devices; select a smaller view.");
  const boundary = new Map(
    [...terminalIds].map(([k]) => [
      k,
      all.filter((w) => !chosen.has(w.id) && w.ends.some((t) => key(t) === k))
        .length,
    ]),
  );
  const ids = new Map(ordered.map((uid, i) => [uid, `d${i}`]));
  const ports = new Map<string, string>();
  const labels = new Map<string, string[]>();
  const rows = new Map<
    string,
    { key: string; label: string; side: "WEST" | "EAST"; y: number }[]
  >();
  const children: ElkNode[] = ordered.map((uid) => {
    const d = devices.get(uid)!,
      type = types.get(d.typeId)!;
    const nodeWidth = 48;
    if (width(d.designation) > nodeWidth - 6)
      throw new Error("Wiring device designation is too wide.");
    const caption = [
      d.designation,
      ...wrap(type.description ?? type.id, nodeWidth - 6),
      ...wrap(d.location ?? "Location unspecified", nodeWidth - 6),
    ];
    const pins = [...terminalIds.values()]
      .filter((t) => t.deviceUid === uid)
      .sort(
        (a, b) =>
          (type.terminalOrder?.indexOf(a.terminalKey) ?? -1) -
            (type.terminalOrder?.indexOf(b.terminalKey) ?? -1) ||
          (a.terminalKey < b.terminalKey ? -1 : 1),
      );
    const omitted = Object.keys(type.terminals).length - pins.length;
    if (omitted) caption.push(`${omitted} other terminals: schedule`);
    labels.set(uid, caption);
    let y = 6 + caption.length * 3.7;
    const list = pins.map((t) => {
      const side = selected.some((w) => key(w.ends[1]!) === key(t))
        ? ("WEST" as const)
        : ("EAST" as const);
      const label = `${t.terminalKey}${boundary.get(key(t)) ? ` [ +${boundary.get(key(t))} ]` : ""}`;
      if (width(label) > nodeWidth - 6)
        throw new Error("Wiring terminal label is too wide.");
      const row = { key: t.terminalKey, label, side, y };
      y += 6;
      return row;
    });
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
  });
  const graph: ElkNode = await new Constructor().layout({
    id: "wiring",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "10",
      "elk.layered.spacing.nodeNodeBetweenLayers": "14",
      "elk.spacing.edgeNode": "5",
      "elk.spacing.edgeEdge": "5",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "5",
      "elk.padding": "[top=5,left=5,bottom=5,right=5]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children,
    edges: selected.map((w, i) => ({
      id: `e${i}`,
      sources: [ports.get(key(w.ends[0]!))!],
      targets: [ports.get(key(w.ends[1]!))!],
      labels: [
        {
          text: w.name,
          width: Math.max(width(w.name), width(w.detail)) + 2,
          height: w.detail ? 8 : 4,
        },
      ],
    })),
  });
  if (![graph.width, graph.height].every(Number.isFinite))
    throw new Error("Invalid wiring layout bounds.");
  const out: string[] = [];
  const nodes = graph.children ?? [];
  const routes: { index: number; points: { x: number; y: number }[] }[] = [];
  for (const [i, edge] of (graph.edges ?? []).entries()) {
    if (!edge.sections?.length) throw new Error("Incomplete wiring route.");
    out.push(
      `<g data-wiring-conductor="${attr(selected[i]!.id)}"><title>${xml(selected[i]!.name + (selected[i]!.detail ? " / " + selected[i]!.detail : ""))}</title>`,
    );
    for (const section of edge.sections) {
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
        `<path d="${points.map((p, j) => `${j ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="#344054" stroke-width="${selected[i]!.jumper ? 0.7 : 0.35}"/>`,
      );
    }
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
    out.push("</g>");
  }
  type Point = { x: number; y: number };
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
  const edgeLabels = (graph.edges ?? []).flatMap((e, index) =>
    (e.labels ?? []).map((l) => ({
      index,
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
  const references: CommunicationDrawing["references"] = [];
  for (const node of nodes) {
    const uid = ordered[Number(node.id.slice(1))]!,
      d = devices.get(uid)!;
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite))
      throw new Error("Invalid wiring node.");
    out.push(
      `<g data-device-uid="${attr(uid)}" transform="translate(${n(node.x!)} ${n(node.y!)})"><rect width="${n(node.width!)}" height="${n(node.height!)}" rx="1" fill="#f5f8fb" stroke="#344054" stroke-width=".3"/>`,
    );
    labels
      .get(uid)!
      .forEach((s, i) => out.push(text(3, 5 + i * 3.7, s, i === 0)));
    for (const p of rows.get(uid)!)
      out.push(
        `<circle data-terminal-key="${attr(p.key)}" cx="${p.side === "WEST" ? 0 : node.width}" cy="${n(p.y)}" r=".7" fill="white" stroke="#344054" stroke-width=".3"/>`,
        text(
          p.side === "WEST" ? 2 : node.width! - 2 - width(p.label),
          p.y + 1,
          p.label,
        ),
      );
    out.push("</g>");
    references.push({
      deviceUid: uid,
      designation: d.designation,
      x: node.x! + node.width! / 2,
      y: node.y! + node.height! / 2,
    });
  }
  return {
    title: request.title,
    content: out.join("\n"),
    width: graph.width!,
    height: graph.height!,
    references,
    note: [
      "Terminal wiring: device internals are not shown. [ +N ] = other physical connections at that terminal; see wire schedule.",
      ...(request.notes ?? []),
    ].join("\n"),
  };
}
