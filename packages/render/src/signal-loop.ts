import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "./svg/escape.js";
import { createElkEngine } from "./layout/elk-runtime.js";
import { fieldDeviceBody, connectorPort } from "./symbols/field-device.js";
import { drawEnclosures } from "./signal-loop-enclosures.js";

export interface SignalLoopViewRequest {
  readonly format: "signal-loop-view-request/0.1";
  readonly from: { readonly device: string; readonly function: string };
  readonly to: { readonly device: string; readonly function: string };
  readonly flow?: "left-to-right" | "top-to-bottom";
  readonly notes?: readonly string[];
  /** Explicit extra pairs (for example actuator power) within the same chain. */
  readonly auxiliary?: readonly {
    readonly from: { readonly device: string; readonly function: string };
    readonly to: { readonly device: string; readonly function: string };
  }[];
  readonly cableAssemblies?: readonly {
    readonly cable: string;
    readonly connector: string;
    readonly description: string;
  }[];
  readonly enclosures?: readonly {
    readonly label: string;
    readonly devices: readonly string[];
    readonly wallDevice?: string;
  }[];
}
interface Conductor {
  id: string;
  ends: readonly [TerminalId, TerminalId];
  label: string[];
  net: string;
  cable?: string;
  spare: boolean;
}
interface DrawingEdge extends Omit<Conductor, "net"> {
  net?: string;
  assembly?: { connector: string; members: readonly Conductor[] };
}
const key = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const n = (v: number) => String(Number(v.toFixed(3)));
const text = (
  x: number,
  y: number,
  value: string,
  size = 2.7,
  anchor = "start",
  bold = false,
) =>
  `<text x="${n(x)}" y="${n(y)}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" text-anchor="${anchor}" font-weight="${bold ? 700 : 400}" fill="#18212b">${xml(value)}</text>`;
const width = (s: string) =>
  [...s].reduce(
    (sum, c) =>
      sum +
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
function wrap(value: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u)) {
    if (line && width(`${line} ${word}`) > max) {
      lines.push(line);
      line = "";
    }
    for (const char of (line ? " " : "") + word) {
      if (width(line + char) > max) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const selector = (v: unknown) =>
  record(v) &&
  Object.keys(v).length === 2 &&
  ["device", "function"].every(
    (k) => typeof v[k] === "string" && (v[k] as string).trim(),
  );
const shortString = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const assembliesValid = (v: unknown) =>
  v === undefined ||
  (Array.isArray(v) &&
    v.length <= 7 &&
    v.every(
      (a) =>
        record(a) &&
        Object.keys(a).length === 3 &&
        shortString(a.cable, 100) &&
        shortString(a.connector, 8) &&
        shortString(a.description, 120),
    ));
const enclosuresValid = (v: unknown) =>
  v === undefined ||
  (Array.isArray(v) &&
    v.length <= 4 &&
    v.every(
      (e) =>
        record(e) &&
        Object.keys(e).every((k) =>
          ["label", "devices", "wallDevice"].includes(k),
        ) &&
        shortString(e.label, 80) &&
        Array.isArray(e.devices) &&
        e.devices.length > 0 &&
        e.devices.length <= 8 &&
        e.devices.every((d) => shortString(d, 100)) &&
        (e.wallDevice === undefined || shortString(e.wallDevice, 100)),
    ));

// Check ELK's placed labels as well as its routes: a white label background
// must never erase another conductor or a device body.
function checkLabels(graph: ElkNode) {
  type Box = { x: number; y: number; width: number; height: number };
  const boxes = (graph.children ?? []).map((node) => ({
    x: node.x!,
    y: node.y!,
    width: node.width!,
    height: node.height!,
  }));
  const labels = (graph.edges ?? []).flatMap((edge) =>
    (edge.labels ?? []).map((label) => ({
      edge: edge.id,
      x: label.x!,
      y: label.y!,
      width: label.width!,
      height: label.height!,
    })),
  );
  const overlap = (a: Box, b: Box) =>
    a.x < b.x + b.width - 0.01 &&
    b.x < a.x + a.width - 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    b.y < a.y + a.height - 0.01;
  for (const box of [...boxes, ...labels]) {
    if (
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.x < 0 ||
      box.y < 0 ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.x + box.width > graph.width! + 0.01 ||
      box.y + box.height > graph.height! + 0.01
    )
      throw new Error(
        "Signal loop contains unplaced or out-of-bounds content.",
      );
  }
  for (const [index, label] of labels.entries()) {
    if (
      boxes.some((box) => overlap(label, box)) ||
      labels.slice(index + 1).some((other) => overlap(label, other))
    )
      throw new Error("Signal loop labels overlap other drawing content.");
    for (const edge of graph.edges ?? []) {
      if (edge.id === label.edge) continue;
      for (const section of edge.sections ?? []) {
        const points = [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ];
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]!,
            b = points[i]!;
          if (
            overlap(label, {
              x: Math.min(a.x, b.x),
              y: Math.min(a.y, b.y),
              width: Math.abs(a.x - b.x),
              height: Math.abs(a.y - b.y),
            })
          )
            throw new Error("A signal loop label conceals another conductor.");
        }
      }
    }
  }
}

/** Select complete, unbranched conductive paths and every core of their cables.
 * Functions identify endpoints but never provide an implicit conductive step. */
export function selectSignalLoop(
  ir: Readonly<ElectricalIr>,
  request: SignalLoopViewRequest,
) {
  if (
    !record(request) ||
    request.format !== "signal-loop-view-request/0.1" ||
    Object.keys(request).some(
      (k) =>
        ![
          "format",
          "from",
          "to",
          "flow",
          "notes",
          "auxiliary",
          "cableAssemblies",
          "enclosures",
        ].includes(k),
    ) ||
    !selector(request.from) ||
    !selector(request.to) ||
    (request.auxiliary !== undefined &&
      (!Array.isArray(request.auxiliary) ||
        request.auxiliary.length > 2 ||
        request.auxiliary.some(
          (a) =>
            !record(a) ||
            Object.keys(a).length !== 2 ||
            !selector(a.from) ||
            !selector(a.to),
        ))) ||
    !assembliesValid(request.cableAssemblies) ||
    !enclosuresValid(request.enclosures) ||
    (request.flow !== undefined &&
      !["left-to-right", "top-to-bottom"].includes(request.flow)) ||
    (request.notes !== undefined &&
      (!Array.isArray(request.notes) ||
        request.notes.length > 6 ||
        request.notes.some(
          (s) => typeof s !== "string" || !s.trim() || s.length > 240,
        )))
  )
    throw new Error(
      "Invalid signal loop request; check selectors, flow, notes, cable assemblies and enclosures.",
    );

  // Validate the public IR contract before following physical connectivity.
  createQueryEngine(ir);
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  const resolve = (s: SignalLoopViewRequest["from"]) => {
    const found = ir.devices.filter(
      (d) => d.uid === s.device || d.designation === s.device,
    );
    if (found.length !== 1)
      throw new Error(
        `Device ${JSON.stringify(s.device)} does not resolve uniquely.`,
      );
    const device = found[0]!,
      functions = ir.functions.filter(
        (f) => f.id.deviceUid === device.uid && f.id.functionKey === s.function,
      );
    if (functions.length !== 1 || functions[0]!.terminals.length !== 2)
      throw new Error(
        `${s.device}.${s.function} must identify a two-terminal function.`,
      );
    return { device, function: functions[0]!, type: types.get(device.typeId)! };
  };
  const from = resolve(request.from),
    to = resolve(request.to);
  const output =
    from.function.kind === "channel" &&
    from.function.direction === "output" &&
    to.type.symbol === "thermite:analog-actuator";
  const input =
    ["thermite:pressure-transmitter", "thermite:two-wire-transmitter"].includes(
      from.type.symbol ?? "",
    ) &&
    to.function.kind === "channel" &&
    to.function.direction === "input";
  if (!input && !output)
    throw new Error(
      "Signal loop views require a two-wire transmitter to an input channel, or an output channel to an analog-actuator profile.",
    );
  const nets = new Map(
    ir.nets.flatMap((net) =>
      net.terminalIds.map((t) => [key(t), net.id] as const),
    ),
  );
  const conductors: Conductor[] = [];
  for (const wire of [...ir.wires, ...ir.jumpers])
    conductors.push({
      id: wire.uid,
      ends: wire.endpoints.map((e) => e.terminal) as [TerminalId, TerminalId],
      label: [wire.designation ?? "Jumper"],
      net: nets.get(key(wire.endpoints[0].terminal))!,
      spare: false,
    });
  const cables = new Map(ir.cables.map((c) => [c.uid, c]));
  for (const core of ir.cableConductors) {
    const cable = cables.get(core.cableUid)!,
      assignment = cable.assignments?.find((a) => a.id === core.id.conductorId);
    conductors.push({
      id: JSON.stringify(core.id),
      ends: core.endpoints.map((e) => e.terminal) as [TerminalId, TerminalId],
      label: [
        `${cable.designation}/${core.id.conductorId}`,
        `${core.typeConductor?.color || "Color unspecified"}${assignment?.usage === "spare" ? " / spare" : ""}`,
      ],
      net: nets.get(key(core.endpoints[0].terminal))!,
      cable: cable.uid,
      spare: assignment?.usage === "spare",
    });
  }
  conductors.sort((a, b) => compare(a.id, b.id));
  const adjacent = new Map<string, Conductor[]>();
  for (const c of conductors)
    for (const t of c.ends) {
      const list = adjacent.get(key(t)) ?? [];
      list.push(c);
      adjacent.set(key(t), list);
    }
  const tracePair = (startFunction: typeof from, endFunction: typeof to) => {
    const targetNets = endFunction.function.terminals.map((t) =>
      nets.get(key(t)),
    );
    if (
      new Set(targetNets).size !== 2 ||
      new Set(startFunction.function.terminals.map((t) => nets.get(key(t))))
        .size !== 2
    )
      throw new Error(
        "The two signal conductors must remain on separate electrical nets.",
      );
    return startFunction.function.terminals.map((start) => {
      const targets = endFunction.function.terminals.filter(
        (t) => nets.get(key(t)) === nets.get(key(start)),
      );
      if (targets.length !== 1)
        throw new Error(
          `No complete conductive path from ${startFunction.device.designation}.${start.terminalKey} to the selected destination function.`,
        );
      const target = targets[0]!,
        terminals = [start],
        edges: Conductor[] = [],
        visited = new Set<string>();
      let current = start;
      while (true) {
        const k = key(current);
        if (visited.has(k))
          throw new Error("Signal loop contains a conductive cycle.");
        visited.add(k);
        const incidence = adjacent.get(k) ?? [];
        if (
          incidence.length !== (k === key(start) || k === key(target) ? 1 : 2)
        )
          throw new Error(
            "Signal loop is branched or incomplete; no branch may be hidden in a loop view.",
          );
        if (k === key(target)) break;
        const next = incidence.find((c) => c !== edges.at(-1))!;
        if (next.spare)
          throw new Error(
            "An active signal path uses a core explicitly marked spare.",
          );
        edges.push(next);
        current = next.ends.find((t) => key(t) !== k)!;
        terminals.push(current);
        if (terminals.length > 8)
          throw new Error("Signal loop exceeds eight device stages.");
      }
      return { terminals, edges };
    });
  };
  const paths = tracePair(from, to);
  const stages = paths[0]!.terminals.map((t) => t.deviceUid);
  if (
    new Set(stages).size !== stages.length ||
    paths.some(
      (p) =>
        p.terminals.length !== stages.length ||
        p.terminals.some((t, i) => t.deviceUid !== stages[i]),
    )
  )
    throw new Error(
      "Both loop conductors must follow the same ordered device stages.",
    );
  for (const uid of stages.slice(1, -1))
    if (
      !["thermite:bulkhead-connector", "thermite:terminal-strip"].includes(
        types.get(devices.get(uid)!.typeId)!.symbol ?? "",
      )
    )
      throw new Error(
        "An intermediate device needs an explicit bulkhead-connector or terminal-strip profile.",
      );
  const auxiliary = (request.auxiliary ?? []).map((a) => ({
    from: resolve(a.from),
    to: resolve(a.to),
  }));
  const occupiedNets = new Set(
    paths.map((p) => nets.get(key(p.terminals[0]!))),
  );
  for (const pair of auxiliary) {
    const extra = tracePair(pair.from, pair.to);
    const first = stages.indexOf(pair.from.device.uid),
      last = stages.indexOf(pair.to.device.uid);
    if (
      first < 0 ||
      last <= first ||
      extra.some(
        (p) =>
          p.terminals.length !== last - first + 1 ||
          p.terminals.some((t, i) => t.deviceUid !== stages[first + i]),
      )
    )
      throw new Error(
        "Auxiliary pairs must follow a contiguous section of the selected device chain.",
      );
    for (const path of extra) {
      const net = nets.get(key(path.terminals[0]!));
      if (occupiedNets.has(net))
        throw new Error(
          "Auxiliary pairs must use distinct nets, separate from the command pair.",
        );
      occupiedNets.add(net);
    }
    paths.push(...extra);
  }
  const selected = new Map(
    paths.flatMap((p) => p.edges.map((e) => [e.id, e] as const)),
  );
  const selectedCables = new Set(
    [...selected.values()].flatMap((c) => (c.cable ? [c.cable] : [])),
  );
  for (const uid of selectedCables) {
    const cable = cables.get(uid)!,
      definition = ir.cableTypes.find((t) => t.id === cable.typeId)!;
    if (
      definition.conductors.some(
        (core) =>
          !cable.assignments?.some(
            (a) => a.id === core.id && a.endpoints.every(Boolean),
          ),
      )
    )
      throw new Error(
        `Cable ${cable.designation} has unassigned or loose cores; use its conductor view to resolve them before generating this loop view.`,
      );
    for (const c of conductors.filter((c) => c.cable === uid)) {
      if (
        c.ends.some((t) => !stages.includes(t.deviceUid)) ||
        Math.abs(
          stages.indexOf(c.ends[0].deviceUid) -
            stages.indexOf(c.ends[1].deviceUid),
        ) !== 1
      )
        throw new Error(
          "A cable leaves the selected device chain; select a view that includes its complete endpoints.",
        );
      if (!selected.has(c.id) && !c.spare)
        throw new Error(
          "A cable has an additional active core outside this two-wire loop; use a complete conductor view.",
        );
      selected.set(c.id, c);
    }
  }
  const shown = [...selected.values()];
  // Even an unused core cannot conceal an onward branch at either contact.
  for (const c of shown)
    for (const terminal of c.ends)
      if ((adjacent.get(key(terminal)) ?? []).some((e) => !selected.has(e.id)))
        throw new Error(
          "A shown terminal has an additional connection outside the selected loop.",
        );
  return {
    from,
    to,
    output,
    auxiliary,
    stages,
    devices,
    types,
    conductors: shown,
  };
}

export async function prepareSignalLoopDrawing(
  ir: Readonly<ElectricalIr>,
  request: SignalLoopViewRequest,
) {
  const selected = selectSignalLoop(ir, request),
    { stages, devices, types } = selected;
  const vertical = request.flow === "top-to-bottom";
  const physicalEdges = selected.conductors.map((c) =>
    stages.indexOf(c.ends[0].deviceUid) < stages.indexOf(c.ends[1].deviceUid)
      ? c
      : { ...c, ends: [c.ends[1], c.ends[0]] as const },
  );
  const assemblies: DrawingEdge[] = [];
  const assembledCables = new Set<string>();
  for (const spec of request.cableAssemblies ?? []) {
    const matching = ir.cables.filter(
      (c) => c.uid === spec.cable || c.designation === spec.cable,
    );
    if (matching.length !== 1)
      throw new Error(
        `Cable ${JSON.stringify(spec.cable)} does not resolve uniquely.`,
      );
    const cable = matching[0]!,
      members = physicalEdges
        .filter((e) => e.cable === cable.uid)
        .sort((a, b) => compare(a.id, b.id));
    if (!members.length || assembledCables.has(cable.uid))
      throw new Error(
        "Cable assembly must identify a unique cable in the selected loop.",
      );
    if (
      members.some((m) =>
        m.ends.some((t, i) => t.deviceUid !== members[0]!.ends[i]!.deviceUid),
      )
    )
      throw new Error(
        "A cable assembly must terminate on the same pair of devices for every core.",
      );
    if (width(spec.connector) > 15)
      throw new Error("Connector label is too wide.");
    const mapping = members.map(
      (m) =>
        `${m.ends[0].terminalKey}-${m.ends[1].terminalKey}${m.spare ? " spare" : ""}`,
    );
    assemblies.push({
      id: `assembly:${cable.uid}`,
      cable: cable.uid,
      ends: members[0]!.ends,
      spare: false,
      assembly: { connector: spec.connector, members },
      label: [
        cable.designation,
        ...wrap(spec.description, 55),
        `${members.length} cores / pin map:`,
        ...wrap(mapping.join(", "), 55),
      ],
    });
    assembledCables.add(cable.uid);
  }
  const edges: DrawingEdge[] = [
    ...physicalEdges.filter((e) => !e.cable || !assembledCables.has(e.cable)),
    ...assemblies,
  ];
  const captions = new Map<string, string[]>(),
    ports = new Map<
      string,
      {
        id: string;
        terminal: string;
        side: "in" | "out";
        x: number;
        y: number;
        suppressed?: boolean;
        assembly?: DrawingEdge;
        unused?: boolean;
      }[]
    >();
  const children: ElkNode[] = stages.map((uid, index) => {
    const device = devices.get(uid)!,
      type = types.get(device.typeId)!;
    const channel =
      uid === selected.from.device.uid
        ? selected.from
        : uid === selected.to.device.uid
          ? selected.to
          : undefined;
    const isChannel = channel?.function.kind === "channel";
    const captionWidth = selected.output
      ? index === 0 || index === stages.length - 1
        ? 50
        : 44
      : isChannel
        ? 66
        : 50;
    let w = captionWidth;
    const caption = [
      device.designation,
      ...wrap(
        isChannel
          ? (type.catalog?.orderNumber ?? type.description ?? type.id)
          : (type.description ?? type.id),
        captionWidth - 6,
      ),
      ...wrap(device.location ?? "Location unspecified", captionWidth - 6),
      ...(isChannel
        ? [`${channel!.function.id.functionKey} / selected channel`]
        : []),
    ];
    if (width(device.designation) > captionWidth - 6)
      throw new Error("Device designation is too wide for a signal loop view.");
    captions.set(uid, caption);
    const terms = new Set(
      physicalEdges.flatMap((e) =>
        e.ends.filter((t) => t.deviceUid === uid).map((t) => t.terminalKey),
      ),
    );
    // Match intermediate schematic contact order to the actuator connector.
    // Contact numbers still come from source; this is not a mechanical strip
    // or connector-face drawing. ELK continues to own placement and routing.
    const destinationOrder = (terminal: string): number => {
      let current: TerminalId = { deviceUid: uid, terminalKey: terminal };
      while (current.deviceUid !== stages.at(-1)) {
        const next = physicalEdges.filter(
          (e) => key(e.ends[0]) === key(current),
        );
        if (next.length !== 1) return Number.MAX_SAFE_INTEGER;
        current = next[0]!.ends[1];
      }
      const endType = selected.to.type;
      return (
        endType.terminalOrder ?? endType.terminals.map((t) => t.key)
      ).indexOf(current.terminalKey);
    };
    const ordered = [...terms].sort((a, b) => {
      if (selected.output) {
        const difference = destinationOrder(a) - destinationOrder(b);
        if (difference) return difference;
      }
      const order = type.terminalOrder ?? type.terminals.map((t) => t.key);
      return order.indexOf(a) - order.indexOf(b) || compare(a, b);
    });
    if (vertical) w += Math.max(66, ordered.length * 14 + 10);
    if (vertical && (index === 0 || index === stages.length - 1))
      for (const terminal of ordered) {
        const role = type.terminals.find(
          (t) => t.key === terminal,
        )?.description;
        if (role)
          caption.push(...wrap(`${terminal}: ${role}`, captionWidth - 6));
      }
    const header =
      (index === 0 && type.symbol === "thermite:pressure-transmitter"
        ? 26
        : 5) +
      caption.length * 3.7;
    const h = vertical
      ? Math.max(header + 5, 35)
      : header + ordered.length * 10 + 5;
    const list: NonNullable<ReturnType<typeof ports.get>> = ordered.flatMap(
      (terminal, i) =>
        (["in", "out"] as const).flatMap((side) => {
          const has = physicalEdges.some(
            (e) =>
              key(e.ends[side === "out" ? 0 : 1]) ===
              key({ deviceUid: uid, terminalKey: terminal }),
          );
          if (!has) return [];
          const suppressed = assemblies.some((a) =>
            a.assembly!.members.some(
              (m) =>
                key(m.ends[side === "out" ? 0 : 1]) ===
                key({ deviceUid: uid, terminalKey: terminal }),
            ),
          );
          const id = `n${index}_${side}_${i}`;
          return [
            {
              id,
              terminal,
              side,
              suppressed,
              x: vertical ? captionWidth + 9 + i * 14 : side === "in" ? 0 : w,
              y: vertical ? (side === "in" ? 0 : h) : header + 5 + i * 10,
            },
          ];
        }),
    );
    for (const assembly of assemblies)
      for (const side of ["in", "out"] as const) {
        if (assembly.ends[side === "out" ? 0 : 1].deviceUid !== uid) continue;
        if (list.some((p) => p.assembly && p.side === side))
          throw new Error(
            "Only one cable assembly per device face is supported in a loop view.",
          );
        const memberPorts = list.filter(
          (p) =>
            p.side === side &&
            assembly.assembly!.members.some(
              (m) => m.ends[side === "out" ? 0 : 1].terminalKey === p.terminal,
            ),
        );
        if (index !== 0 && index !== stages.length - 1)
          for (const p of memberPorts) {
            if (
              !list.some((q) => q.terminal === p.terminal && q.side !== p.side)
            )
              list.push({
                ...p,
                id: `${p.id}_unused`,
                side: side === "in" ? "out" : "in",
                x: vertical ? p.x : side === "in" ? w : 0,
                y: vertical ? (side === "in" ? h : 0) : p.y,
                suppressed: false,
                unused: true,
              });
          }
        list.push({
          id: `n${index}_${side}_${assembly.id}`,
          terminal: "",
          side,
          assembly,
          x: vertical
            ? memberPorts.reduce((s, p) => s + p.x, 0) / memberPorts.length
            : side === "in"
              ? 0
              : w,
          y: vertical
            ? side === "in"
              ? 0
              : h
            : memberPorts.reduce((s, p) => s + p.y, 0) / memberPorts.length,
        });
      }
    if (list.some((p) => width(p.terminal) > (vertical ? 11 : w / 2 - 5)))
      throw new Error(
        "Terminal identifier is too wide for the signal loop symbol.",
      );
    ports.set(uid, list);
    return {
      id: `n${index}`,
      width: w,
      height: h,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: list
        .filter((p) => !p.suppressed && !p.unused)
        .map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          width: 0,
          height: 0,
          layoutOptions: {
            "elk.port.side": vertical
              ? p.side === "in"
                ? "NORTH"
                : "SOUTH"
              : p.side === "in"
                ? "WEST"
                : "EAST",
          },
        })),
    };
  });
  const portId = (e: DrawingEdge, side: "in" | "out") =>
    ports
      .get(e.ends[side === "out" ? 0 : 1].deviceUid)!
      .find(
        (p) =>
          p.side === side &&
          (e.assembly
            ? p.assembly === e
            : !p.assembly &&
              p.terminal === e.ends[side === "out" ? 0 : 1].terminalKey),
      )!.id;
  const graph: ElkNode = await createElkEngine().layout({
    id: "loop",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": vertical ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "8",
      "elk.spacing.edgeEdge": "6",
      "elk.spacing.edgeNode": "5",
      "elk.padding": "[top=6,left=6,bottom=6,right=6]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children,
    edges: edges.map((e, i) => ({
      id: `e${i}`,
      sources: [portId(e, "out")],
      targets: [portId(e, "in")],
      labels: [
        {
          text: e.label.join("\n"),
          width: Math.max(...e.label.map(width)) + 2,
          height: e.label.length * 3.8 + 1,
        },
      ],
    })),
  });
  if (!Number.isFinite(graph.width) || !Number.isFinite(graph.height))
    throw new Error("Invalid signal loop layout.");
  checkLabels(graph);
  const enclosure = drawEnclosures(
    graph,
    selected,
    request.enclosures ?? [],
    vertical,
  );
  const out: string[] = [enclosure.content];
  for (const edge of graph.edges ?? []) {
    const source = edges[Number(edge.id.slice(1))]!;
    if (!edge.sections?.length)
      throw new Error("Incomplete signal loop route.");
    if (source.assembly)
      out.push(
        `<g data-cable-assembly="${attr(source.cable!)}"><desc>${xml(JSON.stringify(source.assembly.members))}</desc>`,
      );
    else
      out.push(
        `<g data-net-id="${attr(source.net!)}" data-loop-conductor="${attr(source.id)}">`,
      );
    for (const section of edge.sections) {
      const points = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ].map((p) => ({ x: Number(n(p.x)), y: Number(n(p.y)) }));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!;
        if (
          ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
          (a.x !== b.x && a.y !== b.y)
        )
          throw new Error("Non-orthogonal signal loop route.");
        for (const node of graph.children ?? []) {
          if (
            a.x === b.x
              ? a.x > node.x! + 0.01 &&
                a.x < node.x! + node.width! - 0.01 &&
                Math.max(a.y, b.y) > node.y! + 0.01 &&
                Math.min(a.y, b.y) < node.y! + node.height! - 0.01
              : a.y > node.y! + 0.01 &&
                a.y < node.y! + node.height! - 0.01 &&
                Math.max(a.x, b.x) > node.x! + 0.01 &&
                Math.min(a.x, b.x) < node.x! + node.width! - 0.01
          )
            throw new Error("Signal loop route crosses a device body.");
        }
      }
      out.push(
        `<path d="${points.map((p, i) => `${i ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="${source.spare ? "#697586" : "#23566d"}" stroke-width="${source.assembly ? 1.25 : 0.4}" stroke-linecap="round"${source.spare ? ' stroke-dasharray="2 1"' : ""}/>`,
      );
    }
    for (const label of edge.labels ?? []) {
      if (![label.x, label.y, label.width, label.height].every(Number.isFinite))
        throw new Error("Unplaced signal loop label.");
      out.push(
        `<rect x="${n(label.x!)}" y="${n(label.y!)}" width="${n(label.width!)}" height="${n(label.height!)}" fill="white"/>`,
      );
      source.label.forEach((s, i) =>
        out.push(text(label.x! + 1, label.y! + 3 + i * 3.8, s)),
      );
    }
    out.push("</g>");
  }
  const references = [];
  for (const node of graph.children ?? []) {
    const index = Number(node.id.slice(1)),
      uid = stages[index]!,
      device = devices.get(uid)!,
      type = types.get(device.typeId)!;
    out.push(
      `<g data-device-uid="${attr(uid)}" transform="translate(${n(node.x!)} ${n(node.y!)})">`,
      fieldDeviceBody(
        type.symbol ?? "",
        node.width!,
        node.height!,
        vertical ? 25 : node.width! / 2,
      ),
    );
    captions
      .get(uid)!
      .forEach((s, i) =>
        out.push(
          text(
            3,
            (index === 0 && type.symbol === "thermite:pressure-transmitter"
              ? 26
              : 5) +
              i * 3.7,
            s,
            2.7,
            "start",
            i === 0,
          ),
        ),
      );
    const list = ports.get(uid)!;
    for (const p of list) {
      if (p.assembly) {
        out.push(
          connectorPort(
            p.x,
            p.y,
            vertical,
            p.side,
            p.assembly.assembly!.connector,
          ),
        );
        continue;
      }
      if (p.suppressed) {
        if (!vertical && (index === 0 || index === stages.length - 1)) {
          const role =
            type.terminals.find((t) => t.key === p.terminal)?.description ?? "";
          const connector = list.find((q) => q.assembly && q.side === p.side)!
            .assembly!.assembly!.connector;
          const clearance = 7 + width(connector);
          const legendX = p.side === "in" ? clearance : 3;
          const lines = wrap(
            `${p.terminal}  ${role}`,
            Math.min(node.width! - 18, node.width! - clearance - 3),
          );
          if (lines.length > 2)
            throw new Error("Pin legend is too long for the assembly symbol.");
          lines.forEach((line, i) =>
            out.push(text(legendX, p.y + 1 + i * 3.3, line)),
          );
        }
        continue;
      }
      out.push(
        `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="0.8" fill="white" stroke="#344054" stroke-width="0.3"/>`,
      );
      out.push(
        vertical
          ? text(p.x + 1.5, p.side === "in" ? 4 : node.height! - 2, p.terminal)
          : text(
              p.side === "in" ? 2 : node.width! - 2,
              p.y - 1.5,
              p.terminal,
              2.7,
              p.side === "in" ? "start" : "end",
            ),
      );
      if (!vertical && (index === 0 || index === stages.length - 1)) {
        const role = type.terminals.find(
          (t) => t.key === p.terminal,
        )?.description;
        if (role) {
          const lines = wrap(role, node.width! - 12);
          if (lines.length > 2)
            throw new Error(
              "Terminal description is too long for a signal loop view.",
            );
          lines.forEach((line, i) =>
            out.push(
              text(p.side === "in" ? 9 : 3, p.y + 1 + i * 3.3, line, 2.7),
            ),
          );
        }
      }
      const twin = list.find(
        (q) =>
          !q.suppressed &&
          !q.assembly &&
          q.terminal === p.terminal &&
          q.side !== p.side,
      );
      if (twin && p.side === "in")
        out.push(
          `<path d="M ${n(p.x)} ${n(p.y)} L ${n(twin.x)} ${n(twin.y)}" stroke="#344054" stroke-width="0.3" fill="none"/>`,
        );
      if (
        ((!twin &&
          !list.some((q) => q.suppressed && q.terminal === p.terminal)) ||
          p.unused) &&
        index !== 0 &&
        index !== stages.length - 1
      ) {
        const auxiliaryEnd = selected.auxiliary.some((a) =>
          [a.from, a.to].some((e) =>
            e.function.terminals.some(
              (t) => t.deviceUid === uid && t.terminalKey === p.terminal,
            ),
          ),
        );
        const label = auxiliaryEnd
          ? (type.terminals.find((t) => t.key === p.terminal)?.description ??
            "Auxiliary feed")
          : "unused";
        const lines = wrap(label, vertical ? 12 : node.width! - 12);
        if (lines.length > (vertical ? 6 : 2))
          throw new Error("Auxiliary feed legend is too long.");
        lines.forEach((line, i) =>
          out.push(
            text(
              vertical ? p.x : node.width! / 2,
              (vertical
                ? p.side === "in"
                  ? 11
                  : node.height! - (auxiliaryEnd ? 23 : 9)
                : p.y + 1) +
                i * 3.3,
              line,
              2.7,
              "middle",
            ),
          ),
        );
      }
    }
    out.push("</g>");
    references.push({
      deviceUid: uid,
      designation: device.designation,
      functions: [
        ...new Set(
          [
            selected.from,
            selected.to,
            ...selected.auxiliary.flatMap((a) => [a.from, a.to]),
          ]
            .filter((e) => e.device.uid === uid)
            .map((e) => e.function.id.functionKey),
        ),
      ],
      x: node.x! + node.width! / 2 - enclosure.minX,
      y: node.y! + node.height! / 2 - enclosure.minY,
    });
  }
  return {
    title: selected.output
      ? `${selected.to.device.designation} - analog output`
      : `${selected.from.device.designation} - signal loop`,
    content: `<g transform="translate(${n(-enclosure.minX)} ${n(-enclosure.minY)})">${out.join("\n")}</g>`,
    width: enclosure.width,
    height: enclosure.height,
    references,
    note: [
      assemblies.length
        ? `Heavy line = cable assembly, not a shared electrical net. Pin maps run ${selected.output ? "from output toward actuator" : "from transmitter toward input"}; core details remain in the conductor view.`
        : `${selected.auxiliary.length ? "Separate command and auxiliary nets." : "Two separate signal nets."} Dashed cores are explicitly spare; connector contact numbers are not a mating-face view.`,
      ...(request.notes ?? []),
    ].join("\n"),
  };
}
