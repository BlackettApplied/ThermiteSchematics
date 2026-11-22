import "./symbols/circuit-attachments.js";
import "./layout/port-attributes.js";
import "./symbols/circuit-route-pitch.js";
import { circuitConductorFunctions } from "./symbols/circuit-pagination-functions.js";
import {
  deviceTagFitDetails,
  type RelatedCaptionFit,
} from "./packet/device-tag-fit.js";
import "./device-tag-svg.js";
import type { DeviceTagPlan } from "./device-tags.js";
import "./device-tag-ownership.js";
import {
  circuitTextLines,
  measure,
  TERMINAL_TEXT_SIZE,
} from "./symbols/circuit-text.js";
export { circuitTextLines } from "./symbols/circuit-text.js";
import "./symbols/circuit-node-ink.js";
import "./symbols/circuit-caption-reservation.js";
import "./symbols/circuit-caption.js";
import "./text-metrics.js";
import "./symbols/caption-ink.js";
import "./symbols/printable-label.js";
import { unsupportedProfileError } from "./preflight.js";
import { CircuitRenderError } from "./render-error-context.js";
import type { Diagnostic } from "@thermite/schema";
import { resolveSensorSupply } from "@thermite/schema";
import { symbolProfile } from "./symbols/profiles.js";

import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrFunction,
  TerminalId,
} from "@thermite/compiler";
import type { ObjectSelector } from "@thermite/query";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "./svg/escape.js";
import { printableCaption } from "./symbols/printable-policy.js";
import { circuitPortGroups } from "./layout/circuit-port-order.js";
import { circuitInlineContext } from "./layout/circuit-inline-context.js";
import { rememberCircuitDrawing } from "./layout/circuit-printed-layouts.js";
import {
  layoutCircuitGroup,
  type CircuitLayoutRun,
} from "./layout/circuit-inline.js";
import { circuitMark, type CircuitMark } from "./symbols/circuit.js";
import { emitCircuitNode } from "./circuit/node-emission.js";
import { verticalLaneX } from "./circuit/nodes.js";
import {
  circuitGraphPins,
  circuitGraphChildren,
  circuitGraphEdge,
  circuitGraphInput,
} from "./circuit/layout-input.js";
import { circuitRouteState } from "./circuit/layout-routes.js";
import { renderCircuitLayout } from "./circuit/layout-drawing.js";
import { makeCircuitNodes } from "./circuit/make-nodes.js";
import {
  circuitGroupPrintReference,
  circuitPartReferences,
} from "./circuit/part-references.js";
import type { PhysicalConductor, Pin, DeviceNode } from "./circuit/types.js";

export interface CircuitFunctionSelector {
  readonly device: ObjectSelector;
  readonly key: string;
}
export interface CircuitGroupRequest {
  readonly id: string;
  readonly label?: string;
  readonly lineReference?: string;
  readonly conductors: readonly string[];
  readonly functions: readonly CircuitFunctionSelector[];
}
export interface CircuitViewRequest {
  readonly format: "circuit-view-request/0.1";
  readonly title: string;
  readonly groups: readonly CircuitGroupRequest[];
  readonly flow?: "left-to-right" | "top-to-bottom";
  readonly columns?: 1 | 2;
  readonly terminalLayout?: "grouped" | "distributed";
  readonly notes?: readonly string[];
}
export interface CircuitReference {
  deviceUid: string;
  designation: string;
  functions: string[];
  x: number;
  y: number;
}
export interface CircuitDrawing {
  diagnostics?: Diagnostic[];
  deviceTags?: readonly DeviceTagPlan[];
  relatedCaption?: RelatedCaptionFit;
  id: string;
  label: string;
  lineReference?: string;
  content: string;
  width: number;
  height: number;
  references: CircuitReference[];
  coverage: {
    conductorIds: string[];
    functionIds: string[];
    terminalIds: string[];
    boundaryTerminalIds: string[];
  };
  pagination?: {
    part: number;
    total: number;
    terminals: { id: string; label: string; parts: number[] }[];
  };
}
export interface PreparedCircuitView {
  title: string;
  columns: 1 | 2;
  notes: readonly string[];
  groups: CircuitDrawing[];
}

const n = (v: number) => String(Number(v.toFixed(3)));
const key = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);
const fkey = (f: IrFunction) =>
  JSON.stringify([f.id.deviceUid, f.id.functionKey]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const text = (
  x: number,
  y: number,
  s: string,
  size = 2.5,
  anchor = "start",
  bold = false,
) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-family="Thermite Sans, Thermite Math, sans-serif" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="#17212b">${xml(s)}</text>`;
const record = (x: unknown): x is Record<string, unknown> =>
  !!x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const shortText = (x: unknown, max = 120): x is string =>
  typeof x === "string" &&
  !!x.trim() &&
  x.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(x);
const keysOnly = (x: Record<string, unknown>, keys: string[]) =>
  Object.keys(x).every((k) => keys.includes(k));
const oneSidedFunction = (f: IrFunction, mark: CircuitMark) =>
  f.terminals.length !== 2 ||
  (["source", "load", "channel", "other"].includes(f.kind) &&
    !["lamp", "heater", "thermocouple", "fuse"].includes(mark));
const channelAssignment = (d: IrDevice, functionKey: string) =>
  d.io && Object.hasOwn(d.io.channels, functionKey)
    ? d.io.channels[functionKey]
    : undefined;
// Reserve the larger of legacy identity space and the actual printable caption.
const channelLabelLines = (
  d: IrDevice,
  f: IrFunction,
  type: IrDeviceType,
  printable = false,
): string[] => {
  const channel = channelAssignment(d, f.id.functionKey);
  const caption = printableCaption({
    kind: "channel",
    fn: f,
    type,
    ...(channel?.address === undefined ? {} : { address: channel.address }),
    spare: channel?.usage === "spare",
  });
  const legacy = [
    channel?.address ?? f.id.functionKey,
    channel?.usage === "spare" ? "SPARE" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return [
    !printable &&
    measure(legacy, TERMINAL_TEXT_SIZE) > measure(caption, TERMINAL_TEXT_SIZE)
      ? legacy
      : caption,
    ...(channel?.signal
      ? circuitTextLines(channel.signal, 38, TERMINAL_TEXT_SIZE)
      : []),
  ];
};
const pinLabel = (p: Pin) => p.label + (p.outside ? ` [+${p.outside}]` : "");
const conductorLabelLines = (c: PhysicalConductor) => [
  c.label,
  ...(!c.jumper && c.detail ? circuitTextLines(c.detail, 42) : []),
];

function validateRequest(request: CircuitViewRequest): void {
  if (
    !record(request) ||
    request.format !== "circuit-view-request/0.1" ||
    !keysOnly(request, [
      "format",
      "title",
      "groups",
      "flow",
      "columns",
      "terminalLayout",
      "notes",
    ]) ||
    !shortText(request.title) ||
    !Array.isArray(request.groups) ||
    !request.groups.length ||
    request.groups.length > 200 ||
    (request.flow !== undefined &&
      !["left-to-right", "top-to-bottom"].includes(request.flow)) ||
    (request.columns !== undefined && ![1, 2].includes(request.columns)) ||
    (request.terminalLayout !== undefined &&
      !["grouped", "distributed"].includes(request.terminalLayout)) ||
    (request.notes !== undefined &&
      (!Array.isArray(request.notes) ||
        request.notes.length > 12 ||
        request.notes.some((v) => !shortText(v, 400))))
  )
    throw new Error(
      "Invalid circuit view: supply a title, 1–200 source-selected groups, optional flow, 1 or 2 columns and notes.",
    );
  const ids = new Set<string>();
  for (const g of request.groups) {
    if (
      !record(g) ||
      !keysOnly(g, [
        "id",
        "label",
        "lineReference",
        "conductors",
        "functions",
      ]) ||
      !shortText(g.id, 80) ||
      ids.has(g.id) ||
      (g.label !== undefined && !shortText(g.label)) ||
      (g.lineReference !== undefined && !shortText(g.lineReference, 40)) ||
      !Array.isArray(g.conductors) ||
      g.conductors.length > 120 ||
      g.conductors.some((c) => !shortText(c, 200)) ||
      !Array.isArray(g.functions) ||
      !g.functions.length ||
      g.functions.length > 80
    )
      throw new Error(
        "Invalid circuit group: unique id, optional label/lineReference, up to 120 conductors and 1–80 functions are required.",
      );
    ids.add(g.id);
    for (const f of g.functions)
      if (
        !record(f) ||
        !keysOnly(f, ["device", "key"]) ||
        !shortText(f.key, 120) ||
        !record(f.device) ||
        !keysOnly(f.device, ["by", "value"]) ||
        !["uid", "designation"].includes(String(f.device.by)) ||
        !shortText(f.device.value, 200)
      )
        throw new Error(
          `Invalid function selector in circuit ${g.id}. Use {device:{by:uid|designation,value},key}.`,
        );
  }
}

function physicalConductors(ir: Readonly<ElectricalIr>): PhysicalConductor[] {
  const nets = new Map(
    ir.indexes.netIdByTerminal.map((e) => [key(e.key), e.value]),
  );
  return [
    ...ir.wires.map((w) => ({
      id: w.uid,
      name: w.designation,
      label: w.properties?.label ?? w.designation,
      ends: w.endpoints.map((e) => e.terminal),
      detail: [w.properties?.size, w.properties?.color]
        .filter(Boolean)
        .join(" / "),
      jumper: false,
    })),
    ...ir.jumpers.map((w) => ({
      id: w.uid,
      name: w.designation ?? w.uid,
      label: w.designation ?? "Jumper",
      ends: w.endpoints.map((e) => e.terminal),
      detail: "Jumper",
      jumper: true,
    })),
    ...ir.cableConductors.map((w) => ({
      id: JSON.stringify(w.id),
      name: `${ir.cables.find((c) => c.uid === w.cableUid)!.designation}/${w.id.conductorId}`,
      label: `${ir.cables.find((c) => c.uid === w.cableUid)!.designation}/${w.id.conductorId}`,
      ends: w.endpoints.map((e) => e.terminal),
      detail: [w.typeConductor?.color, w.typeConductor?.size]
        .filter(Boolean)
        .join(" / "),
      jumper: false,
    })),
  ].map((c) => ({ ...c, netId: nets.get(key(c.ends[0]!))! }));
}

function selectedFunctions(
  ir: Readonly<ElectricalIr>,
  group: CircuitGroupRequest,
): IrFunction[] {
  const result = group.functions.map((s) => {
    const devices = ir.devices.filter((d) =>
      s.device.by === "uid"
        ? d.uid === s.device.value
        : d.designation === s.device.value,
    );
    if (devices.length !== 1)
      throw new Error(
        `Circuit ${group.id}: device ${s.device.value} does not resolve uniquely.`,
      );
    const f = ir.functions.find(
      (f) => f.id.deviceUid === devices[0]!.uid && f.id.functionKey === s.key,
    );
    if (!f)
      throw new Error(
        `Circuit ${group.id}: ${s.device.value}/${s.key} is not a declared device function.`,
      );
    return f;
  });
  if (new Set(result.map(fkey)).size !== result.length)
    throw new Error(`Circuit ${group.id} repeats a source function.`);
  return result;
}

function selectConductors(
  all: PhysicalConductor[],
  group: CircuitGroupRequest,
): PhysicalConductor[] {
  const result = group.conductors.map((s) => {
    const found = all.filter((c) => c.id === s || c.name === s);
    if (found.length !== 1)
      throw new Error(
        `Circuit ${group.id}: conductor ${s} does not resolve uniquely to fully terminated wiring.`,
      );
    return found[0]!;
  });
  if (new Set(result.map((c) => c.id)).size !== result.length)
    throw new Error(`Circuit ${group.id} repeats a conductor identity.`);
  return result.sort((a, b) => compare(a.id, b.id));
}

function selectedSourceTerminals(
  ir: Readonly<ElectricalIr>,
  uid: string,
  type: IrDeviceType,
) {
  return ir.functions
    .filter(
      (f) =>
        f.id.deviceUid === uid &&
        f.kind === "source" &&
        type.symbol !== "thermite:transformer" &&
        type.circuitSymbols?.[f.id.functionKey] !== "winding",
    )
    .flatMap((f) => f.terminals.map((t) => t.terminalKey));
}

const circuitNodeHooks = {
  key,
  fkey,
  compare,
  oneSidedFunction,
  channelLabelLines,
  pinLabel,
  selectedSourceTerminals,
  conductorLabelLines,
  emitNode,
};

function mechanicalGangs(
  node: DeviceNode,
  vertical: boolean,
  diagramCenterY: number,
) {
  const result: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    functions: IrFunction["id"][];
  }[] = [];
  for (const gang of node.gangs) {
    const members = node.rows.filter((r) => gang.includes(r.f.id.functionKey));
    for (let i = 1; i < members.length; i++) {
      const first = members[i - 1]!,
        last = members[i]!;
      if (
        node.rows.some(
          (r) =>
            r.center > first.center &&
            r.center < last.center &&
            !gang.includes(r.f.id.functionKey),
        )
      )
        continue;
      const blade =
        ["breaker", "disconnector"].includes(first.mark) &&
        first.mark === last.mark;
      const functions = [first.f.id, last.f.id];
      if (vertical)
        result.push({
          from: {
            x: verticalLaneX(first.center, node) + (blade ? 0.7 : 0),
            y: diagramCenterY - (blade ? 0.3 : 0),
          },
          to: {
            x: verticalLaneX(last.center, node) + (blade ? 0.7 : 0),
            y: diagramCenterY - (blade ? 0.3 : 0),
          },
          functions,
        });
      else
        result.push({
          from: {
            x: node.width / 2 - (blade ? 0.3 : 0),
            y: first.center - (blade ? 0.7 : 0),
          },
          to: {
            x: node.width / 2 - (blade ? 0.3 : 0),
            y: last.center - (blade ? 0.7 : 0),
          },
          functions,
        });
    }
  }
  return result;
}

function circuitNodeAttributes(node: DeviceNode): string {
  return ` data-device-uid="${attr(node.device.uid)}" data-circuit-functions="${attr(JSON.stringify(node.functions.map((f) => f.id)))}" data-related-functions="${attr(JSON.stringify(node.relations))}" data-layout-width="${n(node.width)}" data-layout-height="${n(node.height)}"`;
}

function emitNode(
  node: DeviceNode,
  x: number,
  y: number,
  vertical: boolean,
  conductors: PhysicalConductor[],
  diagnostics: Diagnostic[],
  omitDesignation = false,
  attachmentWeights?: ReadonlyMap<string, number>,
): string {
  return emitCircuitNode(
    {
      node,
      x,
      y,
      vertical,
      conductors,
      diagnostics,
      omitDesignation,
      attachmentWeights,
    },
    {
      n,
      key,
      fkey,
      text,
      pinLabel,
      oneSidedFunction,
      channelLabelLines,
      mechanicalGangs,
      circuitNodeAttributes,
      emitNode,
    },
  );
}

async function layoutGroup(
  ...args: Parameters<typeof layoutGroupUnchecked>
): Promise<CircuitDrawing> {
  args[8] ??= circuitInlineContext.getStore()?.currentRun;
  try {
    return await layoutGroupUnchecked(...args);
  } catch (error) {
    if (args[8]?.quality) throw error;
    if (error instanceof CircuitRenderError) throw error;
    const [ir, group, fs, cs] = args;
    const functionKeys = fs.map(
      (f) =>
        `${ir.devices.find((d) => d.uid === f.id.deviceUid)!.designation}/${f.id.functionKey}`,
    );
    const conductorKeys = cs.map((c) => c.name);
    const message =
      error instanceof Error ? error.message : "Circuit layout failed.";
    throw new CircuitRenderError({
      code: "R006",
      root: "packet",
      reason: "unprintable-layout",
      message: `${message} Selected keys: functions ${functionKeys.join(", ")}; conductors ${conductorKeys.join(", ") || "none"}.`,
      details: { groupId: group.id, functionKeys, conductorKeys },
    });
  }
}

async function layoutGroupUnchecked(
  ir: Readonly<ElectricalIr>,
  group: CircuitGroupRequest,
  fs: IrFunction[],
  cs: PhysicalConductor[],
  all: PhysicalConductor[],
  vertical: boolean,
  appearances: Map<string, string[]>,
  distributed: boolean,
  run?: CircuitLayoutRun,
): Promise<CircuitDrawing> {
  const hooks = {
    key,
    fkey,
    compare,
    n,
    text,
    conductorLabelLines,
    circuitDeviceTags,
    emitNode,
  };
  const nodes = makeCircuitNodes(
    ir,
    fs,
    cs,
    all,
    vertical,
    appearances,
    distributed,
    circuitNodeHooks,
  );
  const pins = circuitGraphPins(nodes, key);
  const children = circuitGraphChildren(nodes);
  const selfLoops = new Set<number>();
  const edges = cs.map((c, i) =>
    circuitGraphEdge(c, i, group, pins, selfLoops, hooks),
  );
  const input = circuitGraphInput(children, edges, selfLoops, vertical, cs);
  const graph = await layoutCircuitGroup(
    input,
    run,
    new Map(cs.map((c, i) => [`e${i}`, c.jumper ? 0.55 : 0.32])),
    circuitPortGroups(nodes),
  );
  const state = circuitRouteState(graph, nodes, cs, group, hooks);
  return rememberCircuitDrawing(
    renderCircuitLayout(state, fs, pins, selfLoops, vertical),
    input,
    run,
  );
}

/** All geometry is derived from compiled source and closed catalog profiles; no source mutation. */
function circuitDeviceTags(nodes: DeviceNode[]) {
  return nodes.flatMap((node) => (node.tagLane ? [node.tagLane.plan] : []));
}

export function circuitFunctionAppearances(
  ir: Readonly<ElectricalIr>,
  requests: readonly CircuitViewRequest[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const request of requests) {
    validateRequest(request);
    for (const g of request.groups) {
      const label = circuitGroupPrintReference(request, g);
      for (const f of selectedFunctions(ir, g)) {
        const labels = result.get(fkey(f)) ?? [];
        if (!labels.includes(label)) labels.push(label);
        result.set(fkey(f), labels);
      }
    }
  }
  return result;
}

export async function prepareCircuitView(
  ir: Readonly<ElectricalIr>,
  request: CircuitViewRequest,
  packetAppearances?: Map<string, string[]>,
): Promise<PreparedCircuitView> {
  validateRequest(request);
  const all = physicalConductors(ir),
    selected = request.groups.map((g) => ({
      g,
      fs: selectedFunctions(ir, g),
      cs: selectConductors(all, g),
    }));
  // Validate every selected function before any ELK work. Explicit circuit marks
  // remain authoritative; circuitMark checks them before looking at profiles.
  for (const { fs } of selected)
    for (const f of fs) {
      const device = ir.devices.find((d) => d.uid === f.id.deviceUid)!;
      const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
      try {
        const mark = circuitMark(type, f);
        if (
          symbolProfile(type) === "thermite:sensor-3wire" &&
          mark === "sensor-3wire" &&
          f.kind === "load" &&
          f.terminals.length === 2
        ) {
          const supply = resolveSensorSupply(
            f.terminals.map((t) => ({
              key: t.terminalKey,
              role: type.terminals.find((p) => p.key === t.terminalKey)?.role,
            })),
          );
          if (!supply.ok)
            throw Error(
              `Invalid sensor supply roles for function ${JSON.stringify(f.id.functionKey)}: ${supply.reason}`,
            );
        }
      } catch (error) {
        throw new CircuitRenderError(
          unsupportedProfileError(
            ir,
            {
              code: "R006",
              root: "packet",
              reason: "unprintable-layout",
              message: "Unsupported circuit mapping.",
            },
            device,
            f,
            "circuit",
            error instanceof Error ? error.message : undefined,
          ),
        );
      }
    }
  const appearances =
    packetAppearances ?? circuitFunctionAppearances(ir, [request]);
  const groups: CircuitDrawing[] = [];
  for (const { g, fs, cs } of selected)
    groups.push(
      await layoutGroup(
        ir,
        g,
        fs,
        cs,
        all,
        request.flow === "top-to-bottom",
        appearances,
        request.terminalLayout === "distributed",
      ),
    );
  return {
    title: request.title,
    columns: request.columns ?? 1,
    notes: request.notes ?? [],
    groups,
  };
}

/** Packet-only projection: whole conductors and complete selected symbols. */
export async function paginateCircuitGroup(
  ir: Readonly<ElectricalIr>,
  request: CircuitViewRequest,
  index: number,
  original: CircuitDrawing,
  fits: (drawing: CircuitDrawing) => boolean,
  appearances?: Map<string, string[]>,
  fitBounds?: { w: number; h: number },
): Promise<CircuitDrawing[]> {
  if (fits(original)) return [original];
  const group = request.groups[index]!;
  const all = physicalConductors(ir);
  const fs = selectedFunctions(ir, group),
    cs = selectConductors(all, group);
  // Keep selected mechanical gangs and a transformer's shared core together.
  const clusters = fs.map((f) => new Set([fkey(f)]));
  const merge = (ids: string[]) => {
    const matches = clusters.filter((c) => ids.some((id) => c.has(id)));
    if (matches.length < 2) return;
    const combined = new Set(matches.flatMap((c) => [...c]));
    for (const c of matches) clusters.splice(clusters.indexOf(c), 1);
    clusters.push(combined);
  };
  for (const gang of ir.gangedGroups)
    merge(
      gang.functionIds.map((f) => JSON.stringify([f.deviceUid, f.functionKey])),
    );
  for (const device of ir.devices) {
    const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
    if (type.symbol === "thermite:transformer")
      merge(fs.filter((f) => f.id.deviceUid === device.uid).map(fkey));
  }
  type Unit = {
    cs: PhysicalConductor[];
    fs: IrFunction[];
    terminals: Set<string>;
  };
  const unit = (
    conductors: PhysicalConductor[],
    functions: IrFunction[],
  ): Unit => ({
    cs: conductors,
    fs: functions,
    terminals: new Set([
      ...conductors.flatMap((c) => c.ends.map(key)),
      ...functions.flatMap((f) => f.terminals.map(key)),
    ]),
  });
  const units = cs.map((c) => {
    const touching = circuitConductorFunctions(fs, cs, c);
    const members = new Set(
      clusters
        .filter((cluster) => touching.some((f) => cluster.has(fkey(f))))
        .flatMap((cluster) => [...cluster]),
    );
    return unit(
      [c],
      fs.filter((f) => members.has(fkey(f))),
    );
  });
  const used = new Set(units.flatMap((u) => u.fs.map(fkey)));
  for (const cluster of clusters)
    if (![...cluster].some((id) => used.has(id)))
      units.push(
        unit(
          [],
          fs.filter((f) => cluster.has(fkey(f))),
        ),
      );
  const references = circuitPartReferences(
    ir,
    request,
    fs.map(fkey),
    appearances ?? circuitFunctionAppearances(ir, [request]),
  );
  const widest = Number("8".repeat(String(units.length).length));
  const draw = async (items: Unit[], part: number, total: number) => {
    const chosen = new Set(items.flatMap((u) => u.fs.map(fkey)));
    const drawing = await layoutGroup(
      ir,
      group,
      fs.filter((f) => chosen.has(fkey(f))),
      items.flatMap((u) => u.cs),
      all,
      request.flow === "top-to-bottom",
      references.appearances,
      request.terminalLayout === "distributed",
    );
    drawing.label = `${original.label ? original.label + " - " : ""}Part ${part}/${total}`;
    drawing.pagination = {
      part,
      total,
      terminals: references.terminals(drawing.coverage.terminalIds, (id) =>
        units
          .filter((u) => !items.includes(u) && u.terminals.has(id))
          .map(() => widest),
      ),
    };
    return drawing;
  };
  const parts: Unit[][] = [];
  let current: Unit[] = [];
  for (const u of units) {
    const candidate = [...current, u];
    if (fits(await draw(candidate, widest, widest))) {
      current = candidate;
      continue;
    }
    if (!current.length)
      throw circuitPartFitError(group.id, original, fitBounds);
    parts.push(current);
    current = [u];
    if (!fits(await draw(current, widest, widest)))
      throw circuitPartFitError(group.id, original, fitBounds);
  }
  parts.push(current);
  const drawings: CircuitDrawing[] = [];
  for (const [i, items] of parts.entries())
    drawings.push(await draw(items, i + 1, parts.length));
  for (const drawing of drawings) {
    drawing.pagination!.terminals = references.terminals(
      drawing.coverage.terminalIds,
      (id) =>
        drawings
          .filter((d) => d !== drawing && d.coverage.terminalIds.includes(id))
          .map((d) => d.pagination!.part),
    );
    drawing.content = `<g data-circuit-part="${drawing.pagination!.part}" data-circuit-parts="${parts.length}">${drawing.content}</g>`;
    if (!fits(drawing)) throw circuitPartFitError(group.id, drawing, fitBounds);
  }
  const equal = (a: string[], b: string[]) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (
    !equal(
      drawings.flatMap((d) => d.coverage.conductorIds),
      original.coverage.conductorIds,
    ) ||
    !equal(
      [...new Set(drawings.flatMap((d) => d.coverage.functionIds))],
      original.coverage.functionIds,
    ) ||
    !equal(
      [...new Set(drawings.flatMap((d) => d.coverage.terminalIds))],
      original.coverage.terminalIds,
    )
  )
    throw new Error(
      `Circuit ${group.id}: pagination did not conserve the original source selection.`,
    );
  return drawings;
}

function circuitPartFitError(
  groupId: string,
  drawing: CircuitDrawing,
  available?: { w: number; h: number },
) {
  const fit = available
    ? deviceTagFitDetails(drawing, available.w, available.h)
    : undefined;
  return new CircuitRenderError({
    code: "R006",
    root: "packet",
    reason: "unprintable-layout",
    message: `Circuit ${groupId}: a complete conductor, symbol or continuation block cannot fit at readable size.${fit?.message ?? ""}`,
    details: { groupId, ...fit },
  });
}
