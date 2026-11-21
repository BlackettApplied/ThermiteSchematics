import {
  measure,
  channelRowSlots,
  TERMINAL_TEXT_SIZE,
} from "../symbols/circuit-text.js";
import {
  CIRCUIT_TAG_COLUMN_WIDTH,
  LONG_CIRCUIT_DESTINATION_WIDTH,
  relatedCaptionWidth,
  relationCaptionPlan,
} from "../symbols/circuit-relations.js";
import { measureText, printableTextMetrics } from "../text-metrics.js";
import { resolveSensorSupply } from "@thermite/schema";
import { symbolProfile } from "../symbols/profiles.js";
import { lateralPinClearanceWidth } from "./pin-clearance.js";
import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrFunction,
  TerminalId,
} from "@thermite/compiler";
import {
  circuitMark,
  circuitLegendReservation,
  type CircuitMark,
} from "../symbols/circuit.js";
import type {
  PhysicalConductor,
  DeviceNode,
  Pin,
  FunctionRow,
} from "./types.js";
export type NodeSpec = {
  uid: string;
  only: string[] | undefined;
  functionKeys?: string[];
};
export interface NodeContext {
  ir: Readonly<ElectricalIr>;
  fs: IrFunction[];
  conductors: PhysicalConductor[];
  all: PhysicalConductor[];
  vertical: boolean;
  appearances: Map<string, string[]>;
  pitch: number;
  chosen: Set<string>;
  terminalSet: Map<string, TerminalId>;
  selectedTerminals: Set<string>;
  owners: string[];
  boundarySide: (terminal: TerminalId) => "WEST" | "EAST";
  key: (t: TerminalId) => string;
  fkey: (f: IrFunction) => string;
  compare: (a: string, b: string) => number;
  oneSidedFunction: (f: IrFunction, mark: CircuitMark) => boolean;
  channelLabelLines: (
    d: IrDevice,
    f: IrFunction,
    type: IrDeviceType,
    printable?: boolean,
  ) => string[];
  pinLabel: (p: Pin) => string;
  selectedSourceTerminals: (
    ir: Readonly<ElectricalIr>,
    uid: string,
    type: IrDeviceType,
  ) => string[];
}
type BuildState = ReturnType<typeof nodeInitial>;
type PinState = BuildState & {
  f: IrFunction;
  mark: CircuitMark;
  oneSided: boolean;
  center: number;
};
type GeometryState = BuildState & {
  width: number;
  bodyHeight: number;
  priorWidth: number;
  printableRelated: string[];
  tagColumnCaptions: string[];
  relations: DeviceNode["relations"];
  height: number;
  verticalOffsetX: number;
  verticalScaleX: number;
};
export function buildDeviceNode(
  spec: NodeSpec,
  index: number,
  context: NodeContext,
): DeviceNode {
  const state = nodeInitial(spec, index, context);
  const drawingFunctions = nodeDrawingFunctions(state);
  for (const f of drawingFunctions) state.slot = nodeFunctionRow(f, state);
  state.slot = nodeExtraPins(state);
  const width = nodeWidth(state),
    bodyHeight = 6 + Math.max(1, state.slot) * state.pitch;
  const related = nodeRelations(state, width);
  for (const p of state.pins) p.x = p.side === "WEST" ? 0 : related.width;
  const geometry = {
    ...state,
    ...related,
    bodyHeight,
    height: bodyHeight + 2 + related.printableRelated.length * 3.1,
    verticalOffsetX: 0,
    verticalScaleX: 1,
  };
  if (state.vertical) {
    geometry.verticalScaleX = nodeVerticalScale(geometry);
    const bounds = nodeVerticalBounds(geometry);
    const bounded = Object.assign(geometry, bounds);
    Object.assign(geometry, nodeVerticalSize(bounded, bounds.designationLeft));
    nodeVerticalPins(geometry);
  }
  return nodeResult(geometry, nodeRank(geometry), nodeGangs(geometry));
}

function nodeInitial(spec: NodeSpec, index: number, context: NodeContext) {
  const { ir, fs } = context;
  const { uid, only, functionKeys } = spec;
  const device = ir.devices.find((d) => d.uid === uid)!,
    type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
  const functions = fs.filter(
      (f) =>
        f.id.deviceUid === uid &&
        (functionKeys === undefined || functionKeys.includes(f.id.functionKey)),
    ),
    boundary = !functions.length;
  const pins: Pin[] = [],
    rows: FunctionRow[] = [];
  let slot = 0;
  const coupled = type.symbol === "thermite:transformer";
  const windingSlots = { load: 0, source: 0 };
  return {
    ...context,
    uid,
    only,
    functionKeys,
    device,
    type,
    functions,
    boundary,
    pins,
    rows,
    slot,
    coupled,
    windingSlots,
    index,
  };
}

function nodeDrawingFunctions(state: BuildState) {
  const { functions, coupled, type } = state;
  const drawingFunctions = coupled
    ? [
        ...functions.filter((f) => circuitMark(type, f) === "winding"),
        ...functions.filter((f) => circuitMark(type, f) !== "winding"),
      ]
    : symbolProfile(type) === "thermite:sensor-3wire"
      ? functions.map((f) => {
          if (f.kind !== "load" || f.terminals.length !== 2) return f;
          if (circuitMark(type, f) !== "sensor-3wire") return f;
          const supplied = resolveSensorSupply(
            f.terminals.map((t) => ({
              key: t.terminalKey,
              role: type.terminals.find((p) => p.key === t.terminalKey)?.role,
            })),
          );
          if (!supplied.ok)
            throw new Error(
              `Invalid sensor supply ${type.id}/${f.id.functionKey}: ${supplied.reason}`,
            );
          return {
            ...f,
            terminals: [
              f.terminals.find((t) => t.terminalKey === supplied.positive)!,
              f.terminals.find((t) => t.terminalKey === supplied.return)!,
            ],
          };
        })
      : functions;
  return drawingFunctions;
}

function nodeFunctionRow(f: IrFunction, state: BuildState) {
  const {
    type,
    device,
    vertical,
    pitch,
    coupled,
    windingSlots,
    rows,
    channelLabelLines,
    oneSidedFunction,
  } = state;
  let { slot } = state;
  const mark = circuitMark(type, f);
  const oneSided = oneSidedFunction(f, mark);
  const channelLines =
    f.kind === "channel" ? channelLabelLines(device, f, type) : undefined;
  const slots = Math.max(
    Math.ceil(circuitLegendReservation(mark, vertical).row / pitch),
    mark === "sensor-3wire" && f.kind === "load" ? 3 : 1,
    oneSided ? f.terminals.length : 1,
    channelRowSlots(channelLines, vertical, mark, pitch),
  );
  const winding =
    coupled && mark === "winding" && (f.kind === "load" || f.kind === "source");
  const start = winding ? windingSlots[f.kind as "load" | "source"] : slot;
  const center = 6 + (start + slots / 2) * pitch;
  rows.push({
    f,
    mark,
    start,
    slots,
    center,
    ...(channelLines ? { channelLines } : {}),
  });
  f.terminals.forEach((terminal, i) =>
    appendNodePin(terminal, i, { ...state, f, mark, oneSided, center }),
  );
  if (winding) {
    windingSlots[f.kind as "load" | "source"] += slots;
    slot = Math.max(slot, ...Object.values(windingSlots));
  } else slot += slots;
  return slot;
}

function appendNodePin(terminal: TerminalId, i: number, state: PinState) {
  const { pins, key, f, mark, oneSided, center, pitch, index, all, chosen } =
    state;
  if (pins.some((p) => key(p.terminal) === key(terminal))) return;
  let side: "EAST" | "WEST" = oneSided
    ? f.kind === "source" || (f.kind === "channel" && f.direction === "output")
      ? "EAST"
      : "WEST"
    : i === 0
      ? "WEST"
      : "EAST";
  side = nodePinSide(terminal, side, state);
  const outside = all.filter(
    (c) => !chosen.has(c.id) && c.ends.some((t) => key(t) === key(terminal)),
  ).length;
  pins.push({
    id: `n${index}p${pins.length}`,
    terminal,
    x: 0,
    y: oneSided ? center + (i - (f.terminals.length - 1) / 2) * pitch : center,
    side,
    label:
      mark === "sensor-3wire"
        ? `${terminal.terminalKey} (${f.kind === "channel" ? "OUT" : i === 0 ? "+" : "-"})`
        : terminal.terminalKey,
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
}

function nodePinSide(
  terminal: TerminalId,
  side: "EAST" | "WEST",
  state: PinState,
) {
  const { f, mark, conductors, key, uid, owners } = state;
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
  return side;
}

function nodeExtraPins(state: BuildState) {
  const {
    terminalSet,
    uid,
    selectedTerminals,
    key,
    only,
    compare,
    boundarySide,
    all,
    chosen,
    pins,
    index,
    pitch,
  } = state;
  let { slot } = state;
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
      (c) => !chosen.has(c.id) && c.ends.some((t) => key(t) === key(terminal)),
    ).length;
    pins.push({
      id: `n${index}p${pins.length}`,
      terminal,
      x: 0,
      y: 6 + pitch / 2 + slot++ * pitch,
      side,
      label: terminal.terminalKey,
      outside,
    });
  }
  return slot;
}

function nodeWidth(state: BuildState) {
  const { pins, pinLabel, rows, vertical, boundary, device, functions } = state;
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
    left +
      right +
      Math.max(
        14,
        ...rows.map(
          (row) => circuitLegendReservation(row.mark, vertical).block,
        ),
      ),
  );
  if (functions.some((f) => f.kind === "channel")) width = Math.max(width, 42);
  for (const row of rows.filter((r) => r.channelLines)) {
    width = Math.max(
      width,
      left +
        right +
        Math.max(
          ...row.channelLines!.map((line) => measure(line, TERMINAL_TEXT_SIZE)),
        ) +
        8,
    );
  }
  if (!vertical)
    width = Math.max(
      width,
      lateralPinClearanceWidth(
        pins,
        rows,
        state.pitch,
        state.coupled,
        pinLabel,
      ),
    );
  if (width > 90)
    throw new Error(
      `Circuit terminal/device labels for ${device.designation} exceed readable block width.`,
    );
  return width;
}

function nodeRelations(state: BuildState, width: number) {
  const { ir, uid, functions, fkey, appearances } = state;
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
    const selected = functions.some((f) => fkey(f) === from || fkey(f) === to);
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
  // Caption width is horizontal ink, not the vertical symbol body's length.
  const captions = [...relationGroups].map(([destination, keys]) => ({
    kind: "relation" as const,
    destination,
    functions: keys.map((k) =>
      ir.functions.find(
        (f) => f.id.deviceUid === uid && f.id.functionKey === k,
      )!,
    ),
  }));
  // In vertical flow, a long caption can share the tag's column without
  // competing with the lower terminal approaches in the symbol's footer.
  const useTagColumn =
    state.vertical &&
    captions.some(
      (caption) =>
        relatedCaptionWidth(caption.destination) >
        LONG_CIRCUIT_DESTINATION_WIDTH,
    );
  // Keep related captions within a standalone channel panel's measured body.
  const standaloneChannels =
    !state.vertical &&
    state.conductors.length === 0 &&
    functions.some((fn) => fn.kind === "channel");
  const wrapWidth = useTagColumn
    ? CIRCUIT_TAG_COLUMN_WIDTH
    : standaloneChannels
      ? width
      : undefined;
  const related = relationCaptionPlan(captions, width, wrapWidth);
  return {
    width: useTagColumn ? width : related.width,
    priorWidth: width,
    printableRelated: useTagColumn ? [] : related.lines,
    tagColumnCaptions: useTagColumn ? related.lines : [],
    relations,
  };
}

export function verticalLaneX(
  lateralY: number,
  frame: Pick<DeviceNode, "verticalOffsetX" | "verticalScaleX">,
) {
  return lateralY * frame.verticalScaleX + frame.verticalOffsetX;
}

function nodeVerticalScale(state: GeometryState) {
  const { pins, device, pinLabel, conductors } = state;
  let { verticalScaleX } = state;
  const routed = conductors.some((c) =>
    c.ends.some((terminal) => terminal.deviceUid === device.uid),
  );
  // Vertical terminal captions share a horizontal baseline. Routed landings
  // keep the fallback envelope. Standalone symbols fit the exact print face.
  for (const side of ["WEST", "EAST"] as const) {
    const baseline = pins
      .filter((p) => p.side === side)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < baseline.length; i++) {
      const left = baseline[i - 1]!,
        right = baseline[i]!;
      const gap = right.y - left.y;
      if (gap <= 0)
        throw new Error(
          `Circuit terminal labels for ${device.designation} share an unreadable vertical position.`,
        );
      const label = pinLabel(left);
      const width = routed
        ? measureText(label, TERMINAL_TEXT_SIZE).width
        : measure(label, TERMINAL_TEXT_SIZE);
      verticalScaleX = Math.max(verticalScaleX, (width + 2) / gap);
    }
  }
  return verticalScaleX;
}

function nodeVerticalBounds(state: GeometryState) {
  const {
    rows,
    pitch,
    verticalScaleX,
    bodyHeight,
    pins,
    pinLabel,
    printableRelated,
  } = state;
  const spans = rows.map((row) => {
    const half = row.channelLines
      ? Math.max(
          ...row.channelLines.map((line) => measure(line, TERMINAL_TEXT_SIZE)),
        ) / 2
      : row.mark === "motor"
        ? Math.max(5, (row.slots * pitch * verticalScaleX) / 2 - 2)
        : 4;
    const center = verticalLaneX(row.center, state);
    return { left: center - half, right: center + half };
  });
  const leftBound = Math.min(0, ...spans.map((s) => s.left));
  const rightBound = Math.max(
    bodyHeight * verticalScaleX,
    ...spans.map((s) => s.right),
    ...pins.map(
      (p) =>
        verticalLaneX(p.y, state) +
        1 +
        measure(pinLabel(p), TERMINAL_TEXT_SIZE),
    ),
  );
  const verticalOffsetX = 1 - leftBound;
  const coilRow = rows.find((row) => row.f.kind === "coil");
  const designationLeft =
    printableRelated.length && coilRow
      ? verticalLaneX(coilRow.center, state) + verticalOffsetX + 3
      : 0;
  return { leftBound, rightBound, verticalOffsetX, designationLeft };
}

function nodeVerticalSize(
  state: GeometryState & { leftBound: number; rightBound: number },
  designationLeft: number,
) {
  const {
    rows,
    pitch,
    verticalScaleX,
    device,
    rightBound,
    leftBound,
    printableRelated,
    boundary,
    priorWidth,
  } = state;
  let { width, height } = state;
  width = Math.max(
    rightBound - leftBound + 2,
    measure(device.designation, 2.7) + Math.max(4, designationLeft + 2),
    ...printableRelated.map(
      (s) =>
        Math.max(measure(s, 2.5), printableTextMetrics(s, 2.5).advance) +
        Math.max(4, designationLeft + 1),
    ),
  );
  height =
    Math.max(
      priorWidth + 6,
      ...rows.map(
        (row) =>
          (row.channelLines?.length ?? 0) * 3.1 +
          12 +
          (row.mark === "level-sensor" ? 9 : 0),
      ),
      ...rows
        .filter((row) => row.mark === "motor")
        .map((row) => row.slots * pitch * verticalScaleX + 12),
    ) +
    printableRelated.length * 3.1 +
    (boundary || printableRelated.length ? 5 : 0);
  return { width, height };
}

function nodeVerticalPins(state: GeometryState) {
  const { pins, height } = state;
  for (const p of pins) {
    p.x = verticalLaneX(p.y, state);
    p.y = p.side === "WEST" ? 0 : height;
    p.side = p.side === "WEST" ? "NORTH" : "SOUTH";
  }
}

function nodeRank(state: GeometryState) {
  const { index, functions, boundary, pins } = state;
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
  return rank;
}

function nodeGangs(state: GeometryState) {
  const { ir, uid, functions } = state;
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
  return gangs;
}

function nodeResult(
  state: GeometryState,
  rank: number,
  gangs: string[][],
): DeviceNode {
  const {
    index,
    device,
    type,
    functions,
    pins,
    rows,
    boundary,
    width,
    height,
    pitch,
    verticalOffsetX,
    verticalScaleX,
    printableRelated,
    tagColumnCaptions,
    selectedSourceTerminals,
    ir,
    uid,
    relations,
  } = state;
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
    pitch,
    verticalOffsetX,
    verticalScaleX,
    relationLabels: printableRelated,
    tagColumnCaptions,
    sourceTerminalKeys: selectedSourceTerminals(ir, uid, type),
    relations,
    gangs,
  };
}
