import { nodeCaptionSegments } from "../symbols/circuit-node-ink.js";
import { type CaptionBox } from "../symbols/circuit-caption.js";
import { strokeBoxes } from "../symbols/caption-ink.js";
import type { Diagnostic } from "@thermite/schema";
import type { IrFunction } from "@thermite/compiler";
import { type CircuitMark } from "../symbols/circuit.js";
import type {
  DeviceNode,
  PhysicalConductor,
  FunctionRow,
  Point,
} from "./types.js";
import type { LayoutHooks } from "./layout-input.js";
import type { NodeContext } from "./nodes.js";
export type EmissionHooks = Pick<
  LayoutHooks,
  "key" | "fkey" | "n" | "text" | "emitNode"
> &
  Pick<NodeContext, "pinLabel" | "oneSidedFunction" | "channelLabelLines"> & {
    circuitNodeAttributes: (node: DeviceNode) => string;
    mechanicalGangs: (
      node: DeviceNode,
      vertical: boolean,
      diagramCenterY: number,
    ) => { from: Point; to: Point; functions: IrFunction["id"][] }[];
  };
export type EmissionInput = {
  node: DeviceNode;
  x: number;
  y: number;
  vertical: boolean;
  conductors: PhysicalConductor[];
  diagnostics: Diagnostic[];
  omitDesignation: boolean;
  attachmentWeights: ReadonlyMap<string, number> | undefined;
};
export type EmissionBase = EmissionInput & EmissionHooks & { out: string[] };
export type EmissionPlaced = EmissionBase & {
  coilRow: FunctionRow | undefined;
  designationX: number;
  designationAnchor: "start" | "middle";
  designationIndex: number;
  diagramCenterY: number;
  coupled: boolean;
};
export type CaptionCenter = {
  key: string;
  x: number;
  y: number;
  bounds: CaptionBox;
};
export type EmissionState = EmissionPlaced & {
  captionCenters: CaptionCenter[];
  captionSegments: ReturnType<typeof nodeCaptionSegments>["captionSegments"];
  ownerSegments: ReturnType<typeof nodeCaptionSegments>["ownerSegments"];
  captionBoxes: CaptionBox[];
  bounds: CaptionBox;
  obstacles: ReturnType<typeof strokeBoxes>;
};
export type EmissionRow = EmissionState & {
  row: FunctionRow;
  f: IrFunction;
  mark: CircuitMark;
  cx: number;
  cy: number;
};
