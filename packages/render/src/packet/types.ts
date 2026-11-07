// Public packet API types and internal drafts share this module; preserve public signatures.
import type { TopologyDrawingCoverage } from "../topology-coverage.js";
import type { WiringViewRequest } from "../wiring.js";
import type { CircuitDrawing, CircuitViewRequest } from "../circuit.js";
import type { CommunicationViewRequest } from "../communication.js";
import type { ConnectorAssemblyViewRequest } from "../connector-assembly.js";
import type { SignalLoopViewRequest } from "../signal-loop.js";
import type { PacketCoverage, DrawingCoverage } from "../coverage.js";

import type {
  DocumentationRequest,
  DocumentationTable,
  DocumentationSelection,
  DeviceFilter,
} from "@thermite/query";

import type { SchematicTitleContext } from "../title-block.js";
import type {
  NormalizedSchematicView,
  SchematicViewRequest,
} from "../types.js";

export interface PageSettings {
  readonly size?: "letter" | "tabloid" | "a4" | "a3";
  readonly orientation?: "landscape" | "portrait";
  readonly marginMm?: number;
}
export interface PaperPage {
  readonly size: NonNullable<PageSettings["size"]>;
  readonly orientation: NonNullable<PageSettings["orientation"]>;
  readonly marginMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}
export interface SchematicPacketRequest {
  readonly format: "schematic-packet-request/0.1";
  readonly page?: PageSettings;
  readonly views: readonly (
    | SchematicViewRequest
    | DocumentationRequest
    | CommunicationViewRequest
    | ConnectorAssemblyViewRequest
    | SignalLoopViewRequest
    | WiringViewRequest
    | CircuitViewRequest
  )[];
  readonly index?: boolean;
  readonly layout?: "standard" | "compact";
  readonly references?:
    | false
    | {
        readonly filter?: DeviceFilter;
        readonly appearances?: "all" | "drawings";
      };
}
export interface SheetReference {
  readonly deviceUid: string;
  readonly designation: string;
  readonly functions: readonly string[];
  readonly zone: string;
  readonly xMm?: number;
  readonly yMm?: number;
}
export interface NormalizedDocumentationView {
  readonly format: "documentation-view/0.1";
  readonly kind:
    | DocumentationTable["kind"]
    | "communication"
    | "connector-assembly"
    | "signal-loop"
    | "wiring"
    | "circuit";
  readonly title: string;
}
export interface RenderedSheet {
  readonly number: number;
  readonly view: NormalizedSchematicView | NormalizedDocumentationView;
  readonly references: readonly SheetReference[];
  readonly svg: string;
  readonly continuations: readonly {
    readonly id: string;
    readonly toSheet: number;
    readonly conductor: string;
    readonly netId: string;
  }[];
  readonly circuitContinuations?: readonly CircuitContinuation[];
  readonly communicationContinuations?: readonly CommunicationContinuation[];
}
export interface CommunicationContinuation {
  /** One-based authored packet view; independent repeated views stay separate. */
  readonly view: number;
  readonly fromPart: number;
  readonly toPart: number;
  readonly toSheet: number;
  readonly deviceUid: string;
}
export interface CircuitContinuation {
  readonly group: string;
  readonly fromPart: number;
  readonly toPart: number;
  readonly toSheet: number;
  /** JSON-encoded [deviceUid, terminalKey], retaining the physical terminal. */
  readonly terminalId: string;
  readonly netId: string | null;
}
export interface RenderedPacket {
  readonly format: "schematic-packet/0.1";
  readonly page: PaperPage;
  readonly sheets: readonly RenderedSheet[];
  readonly html: string;
  readonly coverage: PacketCoverage;
  readonly documentationSelections?: readonly (DocumentationSelection & {
    readonly view: number;
  })[];
  readonly referenceSelection?: ReferenceSelection;
}
export interface ReferenceSelection {
  readonly format: "reference-selection/0.1";
  readonly enabled: boolean;
  readonly appearances: "all" | "drawings";
  readonly filter?: DeviceFilter;
  readonly deviceUids: readonly string[];
  readonly outsideDeviceUids: readonly string[];
  readonly totalGroups: number;
  readonly retainedGroups: number;
  readonly omittedGroupKeys: readonly string[];
}
export interface Link {
  id: string;
  to: number;
  conductor: string;
  netId: string;
  x: number;
  y: number;
  side: "left" | "right" | "top" | "bottom";
}
export interface Draft {
  diagnostics?: import("@thermite/schema").Diagnostic[];
  views?: import("./errors.js").PacketViewContext[];
  view: NormalizedSchematicView | NormalizedDocumentationView;
  references?: SheetReference[];
  drawingBounds?: DrawingBounds;
  title: SchematicTitleContext;
  content: string;
  links: Link[];
  note: string;
  communicationHeight?: number;
  coverage?: DrawingCoverage[];
  topologyCoverage?: TopologyDrawingCoverage[];
  circuitParts?: {
    drawing: CircuitDrawing;
    x: number;
    y: number;
    width: number;
  }[];
  circuitBlocks?: CircuitContinuationBlock[];
  communicationBlock?: CommunicationContinuationBlock;
  documentationTable?: boolean;
  documentationSelection?: DocumentationSelection;
}
export interface CommunicationContinuationBlock {
  view: number;
  part: number;
  x: number;
  y: number;
  width: number;
  rows: {
    deviceUid: string;
    label: string;
    targets: { part: number; sheet: number }[];
  }[];
}
export interface CircuitContinuationBlock {
  group: string;
  part: number;
  x: number;
  y: number;
  width: number;
  rows: {
    id: string;
    label: string;
    targets: { part: number; sheet: number }[];
  }[];
}

/** Printable drawing rectangle in millimetres, shared by framing and references. */
export interface DrawingBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
