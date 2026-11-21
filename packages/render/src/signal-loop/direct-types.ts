import type {
  IrDevice,
  IrDeviceType,
  IrFunction,
  TerminalId,
} from "@thermite/compiler";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { DeviceTagPlan } from "../device-tags.js";
export interface DrawingEdge extends Omit<Conductor, "net"> {
  net?: string;
  assembly?: { connector: string; members: readonly Conductor[] };
}

export interface Conductor {
  id: string;
  ends: readonly [TerminalId, TerminalId];
  label: string[];
  net: string;
  cable?: string;
  spare: boolean;
}
export interface LoopSelection {
  from: { device: IrDevice; function: IrFunction; type: IrDeviceType };
  to: { device: IrDevice; function: IrFunction; type: IrDeviceType };
  output: boolean;
  auxiliary: { from: LoopSelection["from"]; to: LoopSelection["to"] }[];
  stages: string[];
  devices: Map<string, IrDevice>;
  types: Map<string, IrDeviceType>;
}
export interface LoopPort {
  id: string;
  terminal: string;
  side: "in" | "out";
  x: number;
  y: number;
  suppressed?: boolean;
  assembly?: DrawingEdge;
  unused?: boolean;
}
export interface LoopUtilities {
  key: (t: TerminalId) => string;
  compare: (a: string, b: string) => number;
  n: (v: number) => string;
  text: (
    x: number,
    y: number,
    value: string,
    size?: number,
    anchor?: string,
    bold?: boolean,
  ) => string;
  width: (value: string) => number;
  wrap: (value: string, max: number) => string[];
}
export interface LoopNodeContext extends LoopUtilities {
  selected: LoopSelection;
  stages: string[];
  devices: Map<string, IrDevice>;
  types: Map<string, IrDeviceType>;
  vertical: boolean;
  physicalEdges: Conductor[];
  assemblies: DrawingEdge[];
  tags: Map<string, DeviceTagPlan>;
  pinRows: Map<string, ReadonlyMap<number, string>>;
  captions: Map<string, string[]>;
  ports: Map<string, LoopPort[]>;
}
export interface LoopNodeGeometry {
  uid: string;
  index: number;
  device: IrDevice;
  type: IrDeviceType;
  captionWidth: number;
  w: number;
  h: number;
  header: number;
}
export interface LoopEmissionContext extends LoopNodeContext {
  out: string[];
  node: ElkNode;
  index: number;
  uid: string;
  device: IrDevice;
  type: IrDeviceType;
  list: LoopPort[];
}
