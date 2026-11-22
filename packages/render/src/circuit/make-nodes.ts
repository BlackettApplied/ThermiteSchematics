import { circuitRoutePitch } from "../symbols/circuit-route-pitch.js";
import {
  reserveCircuitCaptions,
  reserveCircuitDeviceTag,
} from "../symbols/circuit-caption-reservation.js";
import type { Diagnostic } from "@thermite/schema";
import type { ElectricalIr, IrFunction, TerminalId } from "@thermite/compiler";
import { circuitMark, isCircuitTerminalStrip } from "../symbols/circuit.js";
import type { DeviceNode, PhysicalConductor } from "./types.js";
import { buildDeviceNode, type NodeContext, type NodeSpec } from "./nodes.js";
type NodeHooks = Pick<
  NodeContext,
  | "key"
  | "fkey"
  | "compare"
  | "oneSidedFunction"
  | "channelLabelLines"
  | "pinLabel"
  | "selectedSourceTerminals"
> & {
  conductorLabelLines: (c: PhysicalConductor) => string[];
  emitNode: (
    node: DeviceNode,
    x: number,
    y: number,
    vertical: boolean,
    conductors: PhysicalConductor[],
    diagnostics: Diagnostic[],
  ) => string;
};
type SelectionState = NodeContext & { distributed: boolean };

export function makeCircuitNodes(
  ir: Readonly<ElectricalIr>,
  fs: IrFunction[],
  conductors: PhysicalConductor[],
  all: PhysicalConductor[],
  vertical: boolean,
  appearances: Map<string, string[]>,
  distributed: boolean,
  hooks: NodeHooks,
): DeviceNode[] {
  const state = nodeSelectionState(
    ir,
    fs,
    conductors,
    all,
    vertical,
    appearances,
    distributed,
    hooks,
  );
  const ownerSpecs = state.owners.flatMap<NodeSpec>((uid) =>
    nodeOwnerSpec(uid, state),
  );
  const result: DeviceNode[] = ownerSpecs.map((spec, index) =>
    buildDeviceNode(spec, index, state),
  );
  const { emitNode } = hooks;
  reserveCircuitCaptions(result, vertical, (node) =>
    emitNode(node, 0, 0, vertical, conductors, []),
  );
  return result.map((node) => reserveCircuitDeviceTag(node, vertical));
}

function nodeSelectionState(
  ir: Readonly<ElectricalIr>,
  fs: IrFunction[],
  conductors: PhysicalConductor[],
  all: PhysicalConductor[],
  vertical: boolean,
  appearances: Map<string, string[]>,
  distributed: boolean,
  hooks: NodeHooks,
): SelectionState {
  const { key, conductorLabelLines, oneSidedFunction } = hooks;
  const pitch = circuitRoutePitch(
    conductors,
    (c) => 3.8 + (conductorLabelLines(c).length - 1) * 3.1,
  );
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
  const boundarySide = (terminal: TerminalId) =>
    boundaryTerminalSide(terminal, {
      ir,
      fs,
      conductors,
      key,
      oneSidedFunction,
    });
  return {
    ...hooks,
    ir,
    fs,
    conductors,
    all,
    vertical,
    appearances,
    distributed,
    pitch,
    chosen,
    terminalSet,
    owners,
    selectedTerminals,
    boundarySide,
  };
}

function boundaryTerminalSide(
  terminal: TerminalId,
  context: Pick<
    NodeContext,
    "ir" | "fs" | "conductors" | "key" | "oneSidedFunction"
  >,
): "WEST" | "EAST" {
  const { ir, fs, conductors, key, oneSidedFunction } = context;
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
  const role = type.terminals.find((t) => t.key === terminal.terminalKey)?.role;
  return [
    "dc_return_output",
    "dc_return_input",
    "neutral",
    "ac_neutral",
    "protective_earth",
  ].includes(role ?? "")
    ? "WEST"
    : "EAST";
}

function nodeOwnerSpec(uid: string, state: SelectionState): NodeSpec[] {
  const { fs, ir, terminalSet, distributed, key, boundarySide } = state;
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
}
