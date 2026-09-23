import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
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
import { createElkEngine } from "./layout/elk-runtime.js";
import {
  circuitAttachment,
  circuitBlock,
  circuitMark,
  isCircuitTerminalStrip,
  circuitMotor,
  circuitMotorVertical,
  circuitWinding,
  circuitWindingVertical,
  circuitTerminal,
  emitCircuitMark,
  type CircuitMark,
} from "./symbols/circuit.js";

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
}
export interface PreparedCircuitView {
  title: string;
  columns: 1 | 2;
  notes: readonly string[];
  groups: CircuitDrawing[];
}

type Point = { x: number; y: number };
type PhysicalConductor = {
  id: string;
  name: string;
  label: string;
  ends: readonly TerminalId[];
  netId: string;
  detail: string;
  jumper: boolean;
};
type Pin = {
  id: string;
  terminal: TerminalId;
  x: number;
  y: number;
  side: "WEST" | "EAST" | "NORTH" | "SOUTH";
  label: string;
  outside: number;
};
type FunctionRow = {
  f: IrFunction;
  mark: CircuitMark;
  start: number;
  slots: number;
  center: number;
  channelLines?: string[];
};
type DeviceNode = {
  id: string;
  device: IrDevice;
  type: IrDeviceType;
  functions: IrFunction[];
  pins: Pin[];
  rows: FunctionRow[];
  boundary: boolean;
  width: number;
  height: number;
  rank: number;
  bodyHeight: number;
  verticalOffsetX: number;
  verticalScaleX: number;
  relationLabels: string[];
  relations: {
    functionId: { deviceUid: string; functionKey: string };
    destinations: string[];
  }[];
  gangs: string[][];
};
const PITCH = 7;
const TERMINAL_TEXT_SIZE = 2.5;
const n = (v: number) => String(Number(v.toFixed(3)));
const key = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);
const fkey = (f: IrFunction) =>
  JSON.stringify([f.id.deviceUid, f.id.functionKey]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const measure = (s: string, size = 2.5) =>
  [...s].reduce(
    (sum, c) =>
      sum +
      (/[ilI1 .,:;'|!]/u.test(c)
        ? 0.35
        : /[MW@%]/u.test(c)
          ? 1
          : c.codePointAt(0)! > 127
            ? 1.2
            : 0.64) *
        size,
    0,
  );
export function circuitTextLines(
  value: string,
  width: number,
  size = 2.5,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u)) {
    if (line && measure(`${line} ${word}`, size) > width) {
      lines.push(line);
      line = "";
    }
    if (measure(word, size) > width) {
      for (const c of word) {
        if (measure(line + c, size) > width) {
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
const text = (
  x: number,
  y: number,
  s: string,
  size = 2.5,
  anchor = "start",
  bold = false,
) =>
  `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="#17212b">${xml(s)}</text>`;
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
const channelLabelLines = (d: IrDevice, f: IrFunction): string[] => {
  const channel = channelAssignment(d, f.id.functionKey);
  return [
    [
      channel?.address ?? f.id.functionKey,
      channel?.usage === "spare" ? "SPARE" : undefined,
    ]
      .filter(Boolean)
      .join(" "),
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

function makeNodes(
  ir: Readonly<ElectricalIr>,
  fs: IrFunction[],
  conductors: PhysicalConductor[],
  all: PhysicalConductor[],
  vertical: boolean,
  appearances: Map<string, string[]>,
  distributed: boolean,
): DeviceNode[] {
  const chosen = new Set(conductors.map((c) => c.id));
  const terminalSet = new Map(
    [
      ...fs.flatMap((f) => f.terminals),
      ...conductors.flatMap((c) => c.ends),
    ].map((t) => [key(t), t]),
  );
  const owners = [
    ...new Set(
      [...fs.map((f) => f.id.deviceUid), ...terminalSet.values()].map((v) =>
        typeof v === "string" ? v : v.deviceUid,
      ),
    ),
  ];
  const selectedTerminals = new Set(fs.flatMap((f) => f.terminals.map(key)));
  const boundarySide = (terminal: TerminalId): "WEST" | "EAST" => {
    const neighbors = conductors
      .filter((c) => c.ends.some((t) => key(t) === key(terminal)))
      .flatMap((c) => c.ends.filter((t) => key(t) !== key(terminal)));
    const sides = neighbors.flatMap((t) =>
      fs
        .filter((f) => f.terminals.some((u) => key(t) === key(u)))
        .map((f) => {
          const owner = ir.deviceTypes.find(
            (v) =>
              v.id === ir.devices.find((d) => d.uid === f.id.deviceUid)!.typeId,
          )!;
          return oneSidedFunction(f, circuitMark(owner, f))
            ? f.kind === "source" ||
              (f.kind === "channel" && f.direction === "output")
              ? "EAST"
              : "WEST"
            : f.terminals.findIndex((u) => key(u) === key(t)) === 0
              ? "WEST"
              : "EAST";
        }),
    );
    if (sides.length && sides.every((s) => s === "EAST")) return "WEST";
    if (sides.length && sides.every((s) => s === "WEST")) return "EAST";
    const type = ir.deviceTypes.find(
      (v) =>
        v.id === ir.devices.find((d) => d.uid === terminal.deviceUid)!.typeId,
    )!;
    const role = type.terminals.find(
      (t) => t.key === terminal.terminalKey,
    )?.role;
    return [
      "dc_return_output",
      "dc_return_input",
      "neutral",
      "ac_neutral",
      "protective_earth",
    ].includes(role ?? "")
      ? "WEST"
      : "EAST";
  };
  // A device's unselected terminal stays a boundary, never an inferred function.
  const ownerSpecs = owners.flatMap<{
    uid: string;
    only: string[] | undefined;
    functionKeys?: string[];
  }>((uid) => {
    const selected = fs.filter((f) => f.id.deviceUid === uid);
    const device = ir.devices.find((d) => d.uid === uid)!;
    const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
    const terminals = [...terminalSet.values()].filter(
      (t) => t.deviceUid === uid,
    );
    if (distributed && isCircuitTerminalStrip(type)) {
      const seen = new Set<string>();
      for (const f of selected) {
        if (
          f.kind !== "bus" ||
          f.terminals.length !== 1 ||
          !["terminal", "earth"].includes(circuitMark(type, f))
        )
          throw new Error(
            `Distributed terminal layout requires single-terminal bus/earth functions on ${device.designation}.`,
          );
        const terminal = key(f.terminals[0]!);
        if (seen.has(terminal))
          throw new Error(
            `Distributed terminal layout cannot separate functions sharing physical terminal ${device.designation}.${f.terminals[0]!.terminalKey}. Select one function or use grouped layout.`,
          );
        seen.add(terminal);
      }
      return [
        ...selected.map((f) => ({
          uid,
          only: [key(f.terminals[0]!)],
          functionKeys: [f.id.functionKey],
        })),
        ...terminals
          .filter((t) => !seen.has(key(t)))
          .map((t) => ({ uid, only: [key(t)], functionKeys: [] })),
      ];
    }
    if (fs.some((f) => f.id.deviceUid === uid))
      return [{ uid, only: undefined as string[] | undefined }];
    return (["EAST", "WEST"] as const)
      .map((side) => ({
        uid,
        only: terminals.filter((t) => boundarySide(t) === side).map(key),
      }))
      .filter((v) => v.only.length);
  });
  const result: DeviceNode[] = ownerSpecs.map((spec, index) => {
    const { uid, only, functionKeys } = spec;
    const device = ir.devices.find((d) => d.uid === uid)!,
      type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
    const functions = fs.filter(
        (f) =>
          f.id.deviceUid === uid &&
          (functionKeys === undefined ||
            functionKeys.includes(f.id.functionKey)),
      ),
      boundary = !functions.length;
    const pins: Pin[] = [],
      rows: FunctionRow[] = [];
    let slot = 0;
    for (const f of functions) {
      const mark = circuitMark(type, f);
      const oneSided = oneSidedFunction(f, mark);
      const channelLines =
        f.kind === "channel" ? channelLabelLines(device, f) : undefined;
      const slots = Math.max(
        oneSided ? f.terminals.length : 1,
        channelLines
          ? Math.ceil(
              (vertical
                ? Math.max(
                    ...channelLines.map((line) =>
                      measure(line, TERMINAL_TEXT_SIZE),
                    ),
                  ) + 4
                : channelLines.length * 3.1 + 0.8) / PITCH,
            )
          : 1,
      );
      const center = 6 + (slot + slots / 2) * PITCH;
      rows.push({
        f,
        mark,
        start: slot,
        slots,
        center,
        ...(channelLines ? { channelLines } : {}),
      });
      f.terminals.forEach((terminal, i) => {
        if (pins.some((p) => key(p.terminal) === key(terminal))) return;
        let side: "EAST" | "WEST" = oneSided
          ? f.kind === "source" ||
            (f.kind === "channel" && f.direction === "output")
            ? "EAST"
            : "WEST"
          : i === 0
            ? "WEST"
            : "EAST";
        if (f.kind === "other" && mark === "interface") {
          const otherOwners = conductors
            .filter((c) => c.ends.some((t) => key(t) === key(terminal)))
            .flatMap((c) =>
              c.ends
                .filter((t) => t.deviceUid !== uid)
                .map((t) => owners.indexOf(t.deviceUid)),
            );
          if (
            otherOwners.length &&
            otherOwners.every((rank) => rank > owners.indexOf(uid))
          )
            side = "EAST";
        }
        const outside = all.filter(
          (c) =>
            !chosen.has(c.id) && c.ends.some((t) => key(t) === key(terminal)),
        ).length;
        pins.push({
          id: `n${index}p${pins.length}`,
          terminal,
          x: 0,
          y: oneSided
            ? center + (i - (f.terminals.length - 1) / 2) * PITCH
            : center,
          side,
          label: terminal.terminalKey,
          outside,
        });
        if (f.kind === "bus" && f.terminals.length === 1 && mark !== "earth")
          pins.push({
            id: `n${index}p${pins.length}`,
            terminal,
            x: 0,
            y: center,
            side: "EAST",
            label: terminal.terminalKey,
            outside,
          });
      });
      slot += slots;
    }
    const extras = [...terminalSet.values()]
      .filter(
        (t) =>
          t.deviceUid === uid &&
          !selectedTerminals.has(key(t)) &&
          (only === undefined || only.includes(key(t))),
      )
      .sort((a, b) => compare(a.terminalKey, b.terminalKey));
    for (const terminal of extras) {
      const side = boundarySide(terminal);
      const outside = all.filter(
        (c) =>
          !chosen.has(c.id) && c.ends.some((t) => key(t) === key(terminal)),
      ).length;
      pins.push({
        id: `n${index}p${pins.length}`,
        terminal,
        x: 0,
        y: 6 + PITCH / 2 + slot++ * PITCH,
        side,
        label: terminal.terminalKey,
        outside,
      });
    }
    const left = Math.max(
      0,
      ...pins
        .filter((p) => p.side === "WEST")
        .map((p) => measure(pinLabel(p), TERMINAL_TEXT_SIZE)),
    );
    const right = Math.max(
      0,
      ...pins
        .filter((p) => p.side === "EAST")
        .map((p) => measure(pinLabel(p), TERMINAL_TEXT_SIZE)),
    );
    let width = Math.max(
      boundary ? 24 : 26,
      measure(device.designation, 2.7) + 4,
      left + right + 14,
    );
    if (functions.some((f) => f.kind === "channel"))
      width = Math.max(width, 42);
    for (const row of rows.filter((r) => r.channelLines)) {
      width = Math.max(
        width,
        left +
          right +
          Math.max(
            ...row.channelLines!.map((line) =>
              measure(line, TERMINAL_TEXT_SIZE),
            ),
          ) +
          8,
      );
    }
    if (width > 90)
      throw new Error(
        `Circuit terminal/device labels for ${device.designation} exceed readable block width.`,
      );
    let bodyHeight = 6 + Math.max(1, slot) * PITCH;
    const relationGroups = new Map<string, string[]>(),
      relations: DeviceNode["relations"] = [];
    for (const relation of ir.internalRelations.filter(
      (r) => r.deviceUid === uid,
    )) {
      const from = JSON.stringify([
          relation.from.deviceUid,
          relation.from.functionKey,
        ]),
        to = JSON.stringify([relation.to.deviceUid, relation.to.functionKey]);
      const selected = functions.some(
        (f) => fkey(f) === from || fkey(f) === to,
      );
      if (!selected) continue;
      const target = functions.some((f) => fkey(f) === from) ? to : from;
      if (functions.some((f) => fkey(f) === target)) continue;
      const targetKey = JSON.parse(target)[1] as string;
      const destinations = appearances.get(target);
      if (destinations?.length) {
        const label = destinations.join(", "),
          keys = relationGroups.get(label) ?? [];
        if (!keys.includes(targetKey)) keys.push(targetKey);
        relationGroups.set(label, keys);
        if (!relations.some((r) => r.functionId.functionKey === targetKey))
          relations.push({
            functionId: { deviceUid: uid, functionKey: targetKey },
            destinations: [...destinations],
          });
      }
    }
    const related = [...relationGroups].map(
      ([destination, keys]) =>
        `${keys.length === 1 ? keys[0] : `${keys.length} functions`}: ${destination}`,
    );
    // Keep source-backed references concise; full membership remains in SVG metadata.
    width = Math.max(width, ...related.map((s) => measure(s, 2.3) + 4));
    if (width > 100)
      throw new Error(
        `Circuit references for ${device.designation} are too wide; shorten circuit line references.`,
      );
    for (const p of pins) p.x = p.side === "WEST" ? 0 : width;
    let height = bodyHeight + 2 + related.length * 3.1,
      verticalOffsetX = 0,
      verticalScaleX = 1;
    if (vertical) {
      const priorWidth = width;
      // Vertical terminal captions remain horizontal. Reserve their actual
      // extent between adjacent pins on each caption baseline before routing.
      for (const side of ["WEST", "EAST"] as const) {
        const baseline = pins
          .filter((p) => p.side === side)
          .sort((a, b) => b.y - a.y);
        for (let i = 1; i < baseline.length; i++) {
          const left = baseline[i - 1]!,
            right = baseline[i]!;
          const gap = left.y - right.y;
          if (gap <= 0)
            throw new Error(
              `Circuit terminal labels for ${device.designation} share an unreadable vertical position.`,
            );
          verticalScaleX = Math.max(
            verticalScaleX,
            (measure(pinLabel(left), TERMINAL_TEXT_SIZE) + 2) / gap,
          );
        }
      }
      const spans = rows.map((row) => {
        const half = row.channelLines
          ? Math.max(
              ...row.channelLines.map((line) =>
                measure(line, TERMINAL_TEXT_SIZE),
              ),
            ) / 2
          : row.mark === "motor"
            ? Math.max(5, (row.slots * PITCH * verticalScaleX) / 2 - 2)
            : 4;
        const center = (bodyHeight - row.center) * verticalScaleX;
        return { left: center - half, right: center + half };
      });
      const leftBound = Math.min(0, ...spans.map((s) => s.left));
      const rightBound = Math.max(
        bodyHeight * verticalScaleX,
        ...spans.map((s) => s.right),
        ...pins.map(
          (p) =>
            (bodyHeight - p.y) * verticalScaleX +
            1 +
            measure(pinLabel(p), TERMINAL_TEXT_SIZE),
        ),
      );
      verticalOffsetX = 1 - leftBound;
      width = Math.max(
        rightBound - leftBound + 2,
        measure(device.designation, 2.7) + 4,
        ...related.map((s) => measure(s, 2.3) + 4),
      );
      height =
        Math.max(
          priorWidth + 6,
          ...rows.map((row) => (row.channelLines?.length ?? 0) * 3.1 + 12),
          ...rows
            .filter((row) => row.mark === "motor")
            .map((row) => row.slots * PITCH * verticalScaleX + 12),
        ) +
        related.length * 3.1;
      for (const p of pins) {
        const oldY = p.y;
        p.x = (bodyHeight - oldY) * verticalScaleX + verticalOffsetX;
        p.y = p.side === "WEST" ? 0 : height;
        p.side = p.side === "WEST" ? "NORTH" : "SOUTH";
      }
    }
    let rank = index * 10;
    if (
      functions.length &&
      functions.every((f) => f.kind === "channel" && f.direction === "input")
    )
      rank = 8000 + index;
    if (
      functions.length &&
      functions.every((f) => f.kind === "channel" && f.direction === "output")
    )
      rank = -800 + index;
    if (functions.length && functions.every((f) => f.kind === "source"))
      rank = -900 + index;
    if (boundary)
      rank = pins.every((p) => ["WEST", "NORTH"].includes(p.side))
        ? 10000
        : -1000 + index;
    const gangs = ir.gangedGroups
      .map((g) =>
        g.functionIds
          .filter(
            (f) =>
              f.deviceUid === uid &&
              functions.some((s) => s.id.functionKey === f.functionKey),
          )
          .map((f) => f.functionKey),
      )
      .filter((g) => g.length >= 2);
    return {
      id: `n${index}`,
      device,
      type,
      functions,
      pins,
      rows,
      boundary,
      width,
      height,
      rank,
      bodyHeight,
      verticalOffsetX,
      verticalScaleX,
      relationLabels: related,
      relations,
      gangs,
    };
  });
  return result;
}

function emitNode(
  node: DeviceNode,
  x: number,
  y: number,
  vertical: boolean,
  conductors: PhysicalConductor[],
): string {
  const out = [
    `<g data-device-uid="${attr(node.device.uid)}" data-circuit-functions="${attr(JSON.stringify(node.functions.map((f) => f.id)))}" data-related-functions="${attr(JSON.stringify(node.relations))}" data-layout-width="${n(node.width)}" data-layout-height="${n(node.height)}" transform="translate(${n(x)} ${n(y)})"><title>${xml([node.device.description, node.type.catalog?.orderNumber, node.type.description].filter(Boolean).join(" | "))}</title>`,
  ];
  const block =
    node.boundary ||
    node.functions.some(
      (f) =>
        ["source", "load", "channel", "other"].includes(f.kind) &&
        !["motor", "heater", "lamp", "thermocouple", "fuse"].includes(
          circuitMark(node.type, f),
        ),
    );
  if (block) out.push(circuitBlock(node.width, node.height));
  out.push(
    text(node.width / 2, 3.3, node.device.designation, 2.7, "middle", true),
  );
  if (node.boundary)
    out.push(text(node.width / 2, node.height - 1, "BOUNDARY", 2.3, "middle"));
  for (const row of node.rows) {
    const { f, mark } = row;
    const cx = vertical
      ? (node.bodyHeight - row.center) * node.verticalScaleX +
        node.verticalOffsetX
      : node.width / 2;
    const cy = vertical ? node.height / 2 : row.center;
    out.push(
      `<g data-function-key="${attr(f.id.functionKey)}" data-function-id="${attr(fkey(f))}"><title>${xml(`${node.device.designation}/${f.id.functionKey}`)}</title>`,
    );
    if (f.kind === "channel") {
      const lines = row.channelLines!;
      for (const [i, line] of lines.entries())
        out.push(
          `<g data-channel-line="${i === 0 ? "address" : "signal"}">${text(cx, cy + 0.8 + (i - (lines.length - 1) / 2) * 3.1, line, TERMINAL_TEXT_SIZE, "middle")}</g>`,
        );
    } else {
      if (mark === "motor")
        out.push(
          vertical
            ? circuitMotorVertical(
                cx,
                cy,
                row.slots * PITCH * node.verticalScaleX,
                f.terminals.map(
                  (t) => node.pins.find((p) => key(p.terminal) === key(t))!.x,
                ),
              )
            : circuitMotor(
                node.width,
                6 + row.start * PITCH,
                row.slots * PITCH,
                f.terminals.map(
                  (t) => node.pins.find((p) => key(p.terminal) === key(t))!.y,
                ),
              ),
        );
      else if (mark === "winding") {
        const first = node.pins.find(
            (p) => key(p.terminal) === key(f.terminals[0]!),
          )!,
          last = node.pins.find(
            (p) => key(p.terminal) === key(f.terminals[1]!),
          )!;
        out.push(
          vertical
            ? circuitWindingVertical(
                node.height,
                first.x,
                last.x,
                f.kind === "source",
              )
            : circuitWinding(node.width, first.y, last.y, f.kind === "source"),
        );
      } else {
        if (mark === "heater" && f.terminals.length === 3 && !vertical)
          out.push(
            `<g transform="translate(0 ${n(6 + row.start * PITCH)})">${circuitBlock(node.width, row.slots * PITCH)}</g>`,
          );
        out.push(
          `<g transform="translate(${n(cx - 4)} ${n(cy - 4)}) scale(.666667)">${emitCircuitMark(mark, vertical)}</g>`,
        );
      }
      if (!oneSidedFunction(f, mark) || f.kind === "bus") {
        for (const [i, terminal] of [
          f.terminals[0]!,
          ...(mark === "earth" ? [] : [f.terminals.at(-1)!]),
        ].entries()) {
          const side = vertical
            ? i === 0
              ? "NORTH"
              : "SOUTH"
            : i === 0
              ? "WEST"
              : "EAST";
          const pin =
            node.pins.find(
              (p) => key(p.terminal) === key(terminal) && p.side === side,
            ) ?? node.pins.find((p) => key(p.terminal) === key(terminal))!;
          const target = vertical
            ? { x: cx, y: cy + (i === 0 ? -4 : 4) }
            : { x: cx + (i === 0 ? -4 : 4), y: cy };
          out.push(
            `<g data-terminal-attachment="${attr(key(terminal))}" data-attachment-from="${attr(JSON.stringify({ x: pin.x, y: pin.y }))}" data-attachment-to="${attr(JSON.stringify(target))}">${circuitAttachment(pin, target, side, node.width, node.height)}</g>`,
          );
        }
      }
    }
    out.push("</g>");
  }
  // Ganging is an explicitly non-conductive function association.
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
      const data = `data-mechanical-association="ganged" data-ganged-functions="${attr(JSON.stringify([first.f.id, last.f.id]))}"`;
      if (vertical)
        out.push(
          `<line ${data} x1="${n((node.bodyHeight - first.center) * node.verticalScaleX + node.verticalOffsetX)}" x2="${n((node.bodyHeight - last.center) * node.verticalScaleX + node.verticalOffsetX)}" y1="${n(node.height / 2)}" y2="${n(node.height / 2)}" stroke="#17212b" stroke-width=".25" stroke-dasharray="1.5 1"/>`,
        );
      else
        out.push(
          `<line ${data} x1="${n(node.width / 2)}" x2="${n(node.width / 2)}" y1="${n(first.center)}" y2="${n(last.center)}" stroke="#17212b" stroke-width=".25" stroke-dasharray="1.5 1"/>`,
        );
    }
  }
  for (const p of node.pins) {
    const connected = conductors.some((c) =>
      c.ends.some((t) => key(t) === key(p.terminal)),
    );
    out.push(
      `<g data-terminal-id="${attr(key(p.terminal))}" data-terminal-key="${attr(p.terminal.terminalKey)}"${p.outside ? ` data-outside-connections="${p.outside}"` : ""}>`,
      circuitTerminal(p.x, p.y, connected),
    );
    const label = pinLabel(p);
    if (p.side === "WEST")
      out.push(text(1.5, p.y - 1.5, label, TERMINAL_TEXT_SIZE));
    else if (p.side === "EAST")
      out.push(
        text(node.width - 1.5, p.y - 1.5, label, TERMINAL_TEXT_SIZE, "end"),
      );
    else if (p.side === "NORTH")
      out.push(text(p.x + 1, 6, label, TERMINAL_TEXT_SIZE));
    else out.push(text(p.x + 1, node.height - 1.5, label, TERMINAL_TEXT_SIZE));
    if (p.outside)
      out.push(
        `<title>${xml(`${node.device.designation}.${p.terminal.terminalKey}: ${p.outside} other physical connection(s) outside this group. See terminal schedule and circuit references.`)}</title>`,
      );
    out.push("</g>");
  }
  node.relationLabels.forEach((s, i) =>
    out.push(
      text(
        node.width / 2,
        node.height - 1 - (node.relationLabels.length - 1 - i) * 3.1,
        s,
        2.3,
        "middle",
      ),
    ),
  );
  out.push("</g>");
  return out.join("");
}

async function layoutGroup(
  ir: Readonly<ElectricalIr>,
  group: CircuitGroupRequest,
  fs: IrFunction[],
  conductors: PhysicalConductor[],
  all: PhysicalConductor[],
  vertical: boolean,
  appearances: Map<string, string[]>,
  distributed: boolean,
): Promise<CircuitDrawing> {
  const nodes = makeNodes(
      ir,
      fs,
      conductors,
      all,
      vertical,
      appearances,
      distributed,
    ),
    pins = new Map<string, { node: DeviceNode; pins: Pin[] }>();
  for (const node of nodes)
    for (const pin of node.pins) {
      const entry = pins.get(key(pin.terminal)) ?? { node, pins: [] };
      entry.pins.push(pin);
      pins.set(key(pin.terminal), entry);
    }
  const children: ElkNode[] = nodes.map((d) => ({
    id: d.id,
    width: d.width,
    height: d.height,
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports: d.pins.map((p) => ({
      id: p.id,
      width: 0,
      height: 0,
      x: p.x,
      y: p.y,
      layoutOptions: { "elk.port.side": p.side },
    })),
  }));
  const selfLoops = new Set<number>();
  const edges: ElkExtendedEdge[] = conductors.map((c, i) => {
    const lines = conductorLabelLines(c);
    let a = pins.get(key(c.ends[0]!))!,
      b = pins.get(key(c.ends[1]!))!;
    if (!a || !b)
      throw new Error(
        `Circuit ${group.id}: missing physical endpoint presentation.`,
      );
    if (a.node.rank > b.node.rank) [a, b] = [b, a];
    if (a.node === b.node) selfLoops.add(i);
    const ap =
      a.pins.find((p) => ["EAST", "SOUTH"].includes(p.side)) ?? a.pins[0]!;
    const bp =
      b.pins.find((p) => ["WEST", "NORTH"].includes(p.side)) ?? b.pins[0]!;
    return {
      id: `e${i}`,
      sources: [ap.id],
      targets: [bp.id],
      labels: [
        {
          text: lines.join("\n"),
          width: Math.max(...lines.map((line) => measure(line))) + 1.5,
          height: 3.8 + (lines.length - 1) * 3.1,
          layoutOptions: { "elk.edgeLabels.inline": "true" },
        },
      ],
    };
  });
  const graph: ElkNode = await createElkEngine().layout({
    id: "circuit",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": vertical ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "5",
      "elk.layered.spacing.nodeNodeBetweenLayers": "7",
      "elk.spacing.edgeNode": "3",
      "elk.spacing.edgeEdge": "3",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "3",
      "elk.layered.spacing.edgeNodeBetweenLayers": "3",
      "elk.spacing.edgeLabel": "1",
      "elk.padding": "[top=2,left=2,bottom=2,right=2]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.mergeEdges": "false",
    },
    children,
    edges,
  });
  if (
    ![graph.width, graph.height].every(Number.isFinite) ||
    graph.width! <= 0 ||
    graph.height! <= 0
  )
    throw new Error(`Circuit ${group.id}: invalid layout bounds.`);
  const laidNodes = new Map((graph.children ?? []).map((d) => [d.id, d]));
  for (const d of nodes) {
    const l = laidNodes.get(d.id);
    if (!l || ![l.x, l.y, l.width, l.height].every(Number.isFinite))
      throw new Error(`Circuit ${group.id}: missing device layout.`);
  }
  const routes: { index: number; points: Point[] }[] = [],
    labels: {
      index: number;
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
    }[] = [];
  const wireSvg: string[] = [];
  if (graph.edges?.length !== conductors.length)
    throw new Error(`Circuit ${group.id}: incomplete conductor coverage.`);
  for (const e of graph.edges ?? []) {
    const index = Number(e.id.slice(1)),
      c = conductors[index];
    if (!c || e.sections?.length !== 1)
      throw new Error(`Circuit ${group.id}: incomplete physical route.`);
    const section = e.sections[0]!,
      points = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      if (
        ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
        (Math.abs(a.x - b.x) > 1e-7 && Math.abs(a.y - b.y) > 1e-7)
      )
        throw new Error(`Circuit ${group.id}: nonorthogonal route.`);
      for (const d of laidNodes.values()) {
        const left = d.x! + 0.01,
          right = d.x! + d.width! - 0.01,
          top = d.y! + 0.01,
          bottom = d.y! + d.height! - 0.01;
        if (
          (a.x === b.x &&
            a.x > left &&
            a.x < right &&
            Math.max(a.y, b.y) > top &&
            Math.min(a.y, b.y) < bottom) ||
          (a.y === b.y &&
            a.y > top &&
            a.y < bottom &&
            Math.max(a.x, b.x) > left &&
            Math.min(a.x, b.x) < right)
        )
          throw new Error(
            `Circuit ${group.id}: a route crosses a device body.`,
          );
      }
    }
    const expected = [e.sources[0], e.targets[0]].map((id) => {
      const d = nodes.find((d) => d.pins.some((p) => p.id === id))!,
        p = d.pins.find((p) => p.id === id)!,
        l = laidNodes.get(d.id)!;
      return { x: l.x! + p.x, y: l.y! + p.y };
    });
    if (
      Math.hypot(points[0]!.x - expected[0]!.x, points[0]!.y - expected[0]!.y) >
        0.01 ||
      Math.hypot(
        points.at(-1)!.x - expected[1]!.x,
        points.at(-1)!.y - expected[1]!.y,
      ) > 0.01
    )
      throw new Error(
        `Circuit ${group.id}: route endpoints moved away from their source terminals.`,
      );
    routes.push({ index, points });
    const path = points
      .map((p, i) => `${i ? "L" : "M"} ${n(p.x)} ${n(p.y)}`)
      .join(" ");
    wireSvg.push(
      `<g data-circuit-conductor="${attr(c.id)}" data-conductor-designation="${attr(c.name)}" data-net-id="${attr(c.netId)}" data-endpoints="${attr(JSON.stringify(c.ends))}"><title>${xml([c.name, c.detail].filter(Boolean).join(" | "))}</title><path d="${path}" fill="none" stroke="white" stroke-width="1.1"/><path d="${path}" fill="none" stroke="#17212b" stroke-width="${c.jumper ? 0.55 : 0.32}"/></g>`,
    );
    for (const l of e.labels ?? []) {
      if (![l.x, l.y, l.width, l.height].every(Number.isFinite))
        throw new Error(`Circuit ${group.id}: unplaced conductor label.`);
      labels.push({
        index,
        x: l.x!,
        y: l.y!,
        width: l.width!,
        height: l.height!,
        text: l.text!,
      });
    }
  }
  const segments = routes.flatMap((r) =>
    r.points.slice(1).map((b, i) => ({ index: r.index, a: r.points[i]!, b })),
  );
  const on = (p: Point, a: Point, b: Point) =>
    p.x >= Math.min(a.x, b.x) - 1e-7 &&
    p.x <= Math.max(a.x, b.x) + 1e-7 &&
    p.y >= Math.min(a.y, b.y) - 1e-7 &&
    p.y <= Math.max(a.y, b.y) + 1e-7 &&
    (a.x === b.x ? Math.abs(p.x - a.x) < 1e-7 : Math.abs(p.y - a.y) < 1e-7);
  const common = (a: number, b: number) =>
    conductors[a]!.ends.some((t) =>
      conductors[b]!.ends.some((u) => key(t) === key(u)),
    );
  for (let i = 0; i < segments.length; i++)
    for (const s of segments.slice(i + 1)) {
      const t = segments[i]!;
      if (t.index === s.index || common(t.index, s.index)) continue;
      const v = t.a.x === t.b.x && s.a.x === s.b.x && t.a.x === s.a.x,
        h = t.a.y === t.b.y && s.a.y === s.b.y && t.a.y === s.a.y;
      const overlap = (axis: "x" | "y") =>
        Math.min(
          Math.max(t.a[axis], t.b[axis]),
          Math.max(s.a[axis], s.b[axis]),
        ) -
          Math.max(
            Math.min(t.a[axis], t.b[axis]),
            Math.min(s.a[axis], s.b[axis]),
          ) >
        1e-7;
      if ((v && overlap("y")) || (h && overlap("x")))
        throw new Error(`Circuit ${group.id}: unrelated conductors overlap.`);
    }
  const dots = new Map<string, Point>();
  for (const r of routes)
    for (const p of r.points) {
      const touching = segments.filter(
        (s) => common(s.index, r.index) && on(p, s.a, s.b),
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
      if (directions.size >= 3) {
        if (segments.some((s) => !common(s.index, r.index) && on(p, s.a, s.b)))
          throw new Error(
            `Circuit ${group.id}: unrelated wire touches a source-terminal junction.`,
          );
        dots.set(`${n(p.x)},${n(p.y)}`, p);
      }
    }
  const intersects = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width - 0.01 &&
    a.x + a.width > b.x + 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    a.y + a.height > b.y + 0.01;
  const segmentBox = (s: (typeof segments)[number]) => ({
    x: Math.min(s.a.x, s.b.x),
    y: Math.min(s.a.y, s.b.y),
    width: Math.abs(s.a.x - s.b.x),
    height: Math.abs(s.a.y - s.b.y),
  });
  const labelObstructed = (label: (typeof labels)[number]) =>
    [...laidNodes.values()].some((d) =>
      intersects(label, {
        x: d.x!,
        y: d.y!,
        width: d.width!,
        height: d.height!,
      }),
    ) ||
    labels.some(
      (other) => other.index !== label.index && intersects(label, other),
    ) ||
    segments.some(
      (s) => s.index !== label.index && intersects(label, segmentBox(s)),
    );
  // ELK can stack fixed-port self-loop labels away from their own loop and
  // across an unrelated incoming wire. Recover labels only, beside an actual
  // routed segment; never move the physical route or relax obstruction checks.
  for (const label of labels.filter((l) => selfLoops.has(l.index))) {
    const own = segments.filter((s) => s.index === label.index);
    if (!labelObstructed(label)) continue;
    const candidates = own.flatMap((s) => {
      const box = segmentBox(s);
      if (box.height >= label.height + 1)
        return [
          box.y + (box.height - label.height) / 2,
          box.y + box.height - label.height - 0.5,
          box.y + 0.5,
        ].flatMap((y) =>
          [box.x - label.width - 1, box.x + 1].map((x) => ({ ...label, x, y })),
        );
      if (box.width >= label.width + 1)
        return [
          box.x + (box.width - label.width) / 2,
          box.x + box.width - label.width - 0.5,
          box.x + 0.5,
        ].flatMap((x) =>
          [box.y - label.height - 1, box.y + 1].map((y) => ({
            ...label,
            x,
            y,
          })),
        );
      return [];
    });
    const free = candidates.find(
      (candidate) =>
        candidate.x >= 0 &&
        candidate.y >= 0 &&
        candidate.x + candidate.width <= graph.width! &&
        candidate.y + candidate.height <= graph.height! &&
        !labelObstructed(candidate),
    );
    if (!free)
      throw new Error(
        `Circuit ${group.id}: a self-loop wire label cannot fit beside its route without obscuring other drawing content.`,
      );
    label.x = free.x;
    label.y = free.y;
  }
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!;
    if (
      [...laidNodes.values()].some((d) =>
        intersects(l, { x: d.x!, y: d.y!, width: d.width!, height: d.height! }),
      ) ||
      labels.slice(i + 1).some((o) => intersects(l, o)) ||
      segments.some(
        (s) =>
          s.index !== l.index &&
          intersects(l, {
            x: Math.min(s.a.x, s.b.x),
            y: Math.min(s.a.y, s.b.y),
            width: Math.abs(s.a.x - s.b.x),
            height: Math.abs(s.a.y - s.b.y),
          }),
      )
    )
      throw new Error(
        `Circuit ${group.id}: a wire label overlaps other drawing content.`,
      );
  }
  const contents = [
    ...wireSvg,
    ...[...dots.values()].map(
      (p) =>
        `<circle data-circuit-junction="true" cx="${n(p.x)}" cy="${n(p.y)}" r=".55" fill="#17212b"/>`,
    ),
    ...labels.map(
      (l) =>
        `<g data-wire-label="${attr(conductors[l.index]!.id)}"><rect x="${n(l.x)}" y="${n(l.y)}" width="${n(l.width)}" height="${n(l.height)}" fill="white"/>${l.text
          .split("\n")
          .map((line, i) => text(l.x + 0.75, l.y + 2.8 + i * 3.1, line))
          .join("")}</g>`,
    ),
    ...nodes.map((d) => {
      const l = laidNodes.get(d.id)!;
      return emitNode(d, l.x!, l.y!, vertical, conductors);
    }),
  ].join("");
  const label = group.label ?? group.id;
  return {
    id: group.id,
    label,
    ...(group.lineReference ? { lineReference: group.lineReference } : {}),
    width: graph.width!,
    height: graph.height!,
    content: `<g data-circuit-group="${attr(group.id)}"${group.lineReference ? ` data-source-line-reference="${attr(group.lineReference)}"` : ""}>${contents}</g>`,
    references: nodes.map((d) => {
      const l = laidNodes.get(d.id)!;
      return {
        deviceUid: d.device.uid,
        designation: d.device.designation,
        functions: d.functions.map((f) => f.id.functionKey),
        x: l.x! + d.width / 2,
        y: l.y! + d.height / 2,
      };
    }),
    coverage: {
      conductorIds: conductors.map((c) => c.id),
      functionIds: fs.map(fkey).sort(compare),
      terminalIds: [...pins.keys()].sort(compare),
      boundaryTerminalIds: nodes
        .flatMap((d) =>
          d.pins
            .filter(
              (p) =>
                !d.functions.some((f) =>
                  f.terminals.some((t) => key(t) === key(p.terminal)),
                ),
            )
            .map((p) => key(p.terminal)),
        )
        .sort(compare),
    },
  };
}

/** All geometry is derived from compiled source and closed catalog profiles; no source mutation. */
export function circuitFunctionAppearances(
  ir: Readonly<ElectricalIr>,
  requests: readonly CircuitViewRequest[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const request of requests) {
    validateRequest(request);
    for (const g of request.groups)
      for (const f of selectedFunctions(ir, g)) {
        const labels = result.get(fkey(f)) ?? [];
        const label = g.lineReference ?? g.id;
        if (!labels.includes(label)) labels.push(label);
        result.set(fkey(f), labels);
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
