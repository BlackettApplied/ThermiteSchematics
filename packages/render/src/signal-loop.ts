import "./signal-loop/pin-rows.js";
import { directLoopDocumentNeeds } from "./packet/document-producers.js";
import "./layout/port-attributes.js";
import "./device-tag-svg.js";
import type { DeviceTagPlan } from "./device-tags.js";
import "./symbols/printable-policy.js";
import { measureText, wrapText } from "./text-metrics.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import { escapeXmlText as xml } from "./svg/escape.js";
import { layoutDirectLoop } from "./layout/direct-loop-layout.js";
import {
  InlineLabelFitError,
  isInlineLabelFailure,
  InlineLabelCollisionError as Collision,
} from "./layout/inline-label-error.js";
import "./symbols/field-device.js";
import {
  validateSignalLoopRequest,
  selectSeriesLoop,
} from "./signal-loop/series-selection.js";
import { prepareSeriesLoopDrawing } from "./signal-loop/series-layout.js";
import "./signal-loop/route-geometry.js";
import "./signal-loop/pin-map.js";
import {
  directLoopPolarity,
  finishDirectLoopDrawing,
} from "./signal-loop/direct-polarity.js";
import { drawEnclosures } from "./signal-loop-enclosures.js";
import type { DrawingEdge } from "./signal-loop/direct-types.js";
import { directLoopAssemblies } from "./signal-loop/direct-assemblies.js";
import { directLoopNode } from "./signal-loop/direct-nodes.js";
import { emitDirectLoopRoutes } from "./signal-loop/direct-routes.js";
import { emitDirectLoopNodes } from "./signal-loop/direct-node-emission.js";

export interface SignalLoopViewRequest {
  readonly format: "signal-loop-view-request/0.1";
  readonly from: { readonly device: string; readonly function: string };
  readonly to: { readonly device: string; readonly function: string };
  readonly loopPower?: { readonly device: string; readonly function: string };
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
export interface Conductor {
  id: string;
  ends: readonly [TerminalId, TerminalId];
  label: string[];
  net: string;
  cable?: string;
  spare: boolean;
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
  `<text x="${n(x)}" y="${n(y)}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="${size}" text-anchor="${anchor}" font-weight="${bold ? 700 : 400}" fill="#18212b">${xml(value.normalize("NFC"))}</text>`;
const width = (value: string) => measureText(value, 2.7).width;
const wrap = (value: string, max: number) => wrapText(value, max, 2.7);
function checkLabelGeometry(
  box: { x: number; y: number; width: number; height: number },
  graph: ElkNode,
) {
  if (
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0
  )
    throw new Error("Signal loop contains invalid content geometry.");
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > graph.width! + 0.01 ||
    box.y + box.height > graph.height! + 0.01
  )
    throw new InlineLabelFitError(
      "Signal loop contains unplaced or out-of-bounds content.",
    );
}

// Check ELK's placed labels as well as its routes: a white label background
// must never erase another conductor or a device body.
export function checkLabels(graph: ElkNode) {
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
  for (const box of [...boxes, ...labels]) checkLabelGeometry(box, graph);
  for (const [index, label] of labels.entries()) {
    if (
      boxes.some((box) => overlap(label, box)) ||
      labels.slice(index + 1).some((other) => overlap(label, other))
    )
      throw new Collision("Signal loop labels overlap other drawing content.");
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
            throw new Collision(
              "A signal loop label conceals another conductor.",
            );
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
  validateSignalLoopRequest(request);

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
  if (!input && !output && !request.loopPower)
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
  if (request.loopPower) {
    const series = selectSeriesLoop(ir, request, from, to, conductors);
    return {
      from,
      to,
      output: false,
      auxiliary: [],
      stages: series.stages,
      devices,
      types,
      conductors: series.conductors,
      series,
    };
  }
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
    unverifiedEndpoints: input ? directLoopPolarity(ir, from, to, paths) : [],
  };
}

export function signalLoopTitle(
  selected: ReturnType<typeof selectSignalLoop>,
): string {
  return selected.output
    ? `${selected.to.device.designation} - analog output`
    : `${selected.from.device.designation} - signal loop`;
}

export async function prepareSignalLoopDrawing(
  ir: Readonly<ElectricalIr>,
  request: SignalLoopViewRequest,
  acceptCandidate?: (
    candidate: ReturnType<typeof directLoopDrawing>,
    fallback: ReturnType<typeof directLoopDrawing> | undefined,
  ) => boolean,
) {
  const selected = selectSignalLoop(ir, request);
  if (selected.series) return prepareSeriesLoopDrawing(ir, request, selected);
  const { stages, devices, types } = selected;
  const vertical = request.flow === "top-to-bottom";
  const physicalEdges = selected.conductors.map((c) =>
    stages.indexOf(c.ends[0].deviceUid) < stages.indexOf(c.ends[1].deviceUid)
      ? c
      : { ...c, ends: [c.ends[1], c.ends[0]] as const },
  );
  const { assemblies, assembledCables } = directLoopAssemblies(
    ir,
    request,
    physicalEdges,
    { key, compare, n, text, width, wrap },
  );
  const edges: DrawingEdge[] = [
    ...physicalEdges.filter((e) => !e.cable || !assembledCables.has(e.cable)),
    ...assemblies,
  ];
  const tags = new Map<string, DeviceTagPlan>();
  const pinRows = new Map<string, ReadonlyMap<number, string>>();
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
  const context = {
    selected,
    stages,
    devices,
    types,
    vertical,
    physicalEdges,
    assemblies,
    tags,
    pinRows,
    captions,
    ports,
    key,
    compare,
    n,
    text,
    width,
    wrap,
  };
  const children: ElkNode[] = stages.map((uid, index) =>
    directLoopNode(uid, index, context),
  );
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
  const documentNeeds = directLoopDocumentNeeds(ir, assembledCables, stages);
  const draw = (graph: ElkNode) =>
    directLoopDrawing(graph, selected, request, edges, context, documentNeeds);
  const fallback = directLoopFallback(draw);
  let accepted:
    { graph: ElkNode; drawing: ReturnType<typeof draw> } | undefined;
  const graph = await layoutDirectLoop(
    children,
    edges.map((e, i) => ({
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
    vertical,
    vertical && selected.output
      ? edges.flatMap((e, i) => (e.cable || e.assembly ? [] : [`e${i}`]))
      : [],
    checkLabels,
    acceptCandidate
      ? (candidate, native) => {
          const drawing = draw(candidate);
          if (!acceptCandidate(drawing, fallback.project(native))) return false;
          accepted = { graph: candidate, drawing };
          return true;
        }
      : undefined,
  );
  if (accepted?.graph === graph) return accepted.drawing;
  return fallback.selected(graph) ?? draw(graph);
}

function directLoopDrawing(
  graph: ElkNode,
  selected: Exclude<ReturnType<typeof selectSignalLoop>, { series: unknown }>,
  request: SignalLoopViewRequest,
  edges: DrawingEdge[],
  context: Parameters<typeof emitDirectLoopNodes>[3],
  documentNeeds: ReturnType<typeof directLoopDocumentNeeds>,
) {
  const { vertical, assemblies, tags } = context;
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
  emitDirectLoopRoutes(graph, edges, out, {
    key,
    compare,
    n,
    text,
    width,
    wrap,
  });
  const references = emitDirectLoopNodes(graph, enclosure, out, context);
  return finishDirectLoopDrawing(
    {
      title: signalLoopTitle(selected),
      content: `<g transform="translate(${n(-enclosure.minX)} ${n(-enclosure.minY)})">${out.join("\n")}</g>`,
      width: enclosure.width,
      height: enclosure.height,
      references,
      deviceTags: [...tags.values()],
      documentNeeds,
    },
    selected,
    request,
    assemblies.length > 0,
  );
}

/** The fixed native fallback is projected at most once, including failures. */
function directLoopFallback(
  draw: (graph: ElkNode) => ReturnType<typeof directLoopDrawing>,
) {
  let fallback:
    | { graph: ElkNode; drawing: ReturnType<typeof draw> }
    | { graph: ElkNode; error: unknown }
    | undefined;
  return {
    project(graph: ElkNode) {
      if (!fallback) {
        try {
          fallback = { graph, drawing: draw(graph) };
        } catch (error) {
          if (!isInlineLabelFailure(error)) throw error;
          fallback = { graph, error };
        }
      }
      return "drawing" in fallback ? fallback.drawing : undefined;
    },
    selected(graph: ElkNode) {
      if (fallback?.graph !== graph) return undefined;
      if ("error" in fallback) throw fallback.error;
      return fallback.drawing;
    },
  };
}
