import type { DeviceTagPlan } from "../device-tags.js";
import { circuitTagReservation } from "../symbols/circuit-caption-reservation.js";
import type {
  IrDevice,
  IrDeviceType,
  IrFunction,
  TerminalId,
} from "@thermite/compiler";
import { type CircuitMark } from "../symbols/circuit.js";
export type Point = { x: number; y: number };
export type PhysicalConductor = {
  id: string;
  name: string;
  label: string;
  ends: readonly TerminalId[];
  netId: string;
  detail: string;
  jumper: boolean;
};
export type Pin = {
  id: string;
  terminal: TerminalId;
  x: number;
  y: number;
  side: "WEST" | "EAST" | "NORTH" | "SOUTH";
  label: string;
  outside: number;
};
export type FunctionRow = {
  f: IrFunction;
  mark: CircuitMark;
  start: number;
  slots: number;
  center: number;
  channelLines?: string[];
};
export type DeviceNode = {
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
  pitch: number;
  verticalOffsetX: number;
  verticalScaleX: number;
  relationLabels: string[];
  tagColumnCaptions: string[];
  sourceTerminalKeys: readonly string[];
  relations: {
    functionId: { deviceUid: string; functionKey: string };
    destinations: string[];
  }[];
  gangs: string[][];
  tagLane?: {
    body: DeviceNode;
    plan: DeviceTagPlan;
    geometry: ReturnType<typeof circuitTagReservation>;
  };
};
