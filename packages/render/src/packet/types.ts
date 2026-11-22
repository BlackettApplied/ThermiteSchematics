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
  ScheduleReferences,
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
export interface LegacySchematicPacketRequest {
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
  /** Both modes may fold validated rooted strips. Standard retains standard
   * spacing; compact additionally compares compact/dense spacing profiles.
   * TB may also compose the selected winner's vertical strips horizontally,
   * without more layout search. Composition preserves routed geometry,
   * minimum type and final peer zones. */
  readonly layout?: "standard" | "compact";
  readonly references?:
    | false
    | {
        readonly filter?: DeviceFilter;
        readonly appearances?: "all" | "drawings";
      };
}
export type SchematicPacketRequest =
  | LegacySchematicPacketRequest
  | import("../internal/title-data/model.js").PacketRequest;
export interface SheetReference {
  readonly deviceUid: string;
  readonly designation: string;
  readonly functions: readonly string[];
  readonly representation?: "terminal" | "terminal-strip";
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
    | "circuit"
    | "terminal-strip";
  readonly title: string;
}
export interface RenderedSheet {
  readonly sheetKey?: string;
  readonly occurrenceIds?: readonly string[];
  readonly annotationIds?: readonly string[];
  readonly number: number;
  readonly view: NormalizedSchematicView | NormalizedDocumentationView;
  readonly references: readonly SheetReference[];
  readonly svg: string;
  readonly continuations: readonly {
    readonly id: string;
    readonly toSheet: number;
    readonly conductor: string;
    readonly netId: string;
    readonly designation?: string;
    readonly toZone?: string;
    readonly provenance?: import("@thermite/compiler").ConductiveElementId;
    readonly end?: 0 | 1;
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
  readonly presentationFormat?: "project-presentation/0.3";
  readonly navigation?: import("./navigation-types.js").IssuedNavigation;
  readonly format: "schematic-packet/0.1";
  readonly page: PaperPage;
  readonly sheets: readonly RenderedSheet[];
  /**
   * Read-only standalone print document with embedded fonts.
   * Reading this property or serializing the packet can throw R007 when the
   * HTML font block exceeds 500 KiB.
   */
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
  designation?: string;
  provenance?: import("@thermite/compiler").ConductiveElementId;
  descriptor?: string;
  end?: 0 | 1;
  toZone?: string;
  label?: import("./continuation-label.js").ContinuationLabel;
  netId: string;
  x: number;
  y: number;
  side: "left" | "right" | "top" | "bottom";
}
export interface RootedLegendSource {
  prepared: import("../renderer.js").PreparedSchematicDrawing;
  grid: import("./rooted-plans.js").RootedGrid;
  scale: number;
  profile?: "compact" | "dense";
}
export interface Draft {
  rootedPaginationFailure?: import("../types.js").RenderFailure;
  terminalStrip?: import("./terminal-strip.js").TerminalStripSheet;
  terminalStripPlan?: import("./terminal-strip.js").StripDrawing;
  documentKind?: string;
  inlineDocumentBounds?: import("../device-legend/geometry.js").Rect;
  resolvedTitle?: import("../internal/title-data/model.js").ResolvedTitle;
  documentNeeds?: readonly import("./document-types.js").DocumentNeedSeed[];
  issuedDocument?: import("./document-types.js").DocumentIdentity;
  documentRows?: readonly import("./document-types.js").DocumentRowDraft[];
  documentHeader?: import("./document-types.js").DocumentHeaderDraft;
  autoDocumentOrigin?: import("./document-types.js").GeneratedDocumentOrigin;
  navigationInputs?: readonly import("./navigation-types.js").NavigationDraftInput[];
  navigationSeeds?: readonly import("./navigation-types.js").NativeOccurrenceSeed[];
  navigationView?: import("./navigation-types.js").NavigationView;
  /** The selected, already routed drawing: legend bands never rerun ELK. */
  rootedLegendSource?: RootedLegendSource;
  /** Validated source strips retained for legend-space pagination, without ELK. */
  rootedParts?: readonly Draft[];
  rootedBank?: import("./continuation-bank.js").ContinuationBank;
  rootedPartAxis?: "x" | "y";
  rootedPartSizes?: readonly number[];
  rootedSections?: {
    viewport: import("./rooted-ink.js").InkBox;
    continuedLocationIds: readonly string[];
  }[];
  rootedScoreBounds?: DrawingBounds;
  rootedContent?: import("./rooted-content.js").RootedContent;
  continuedCaption?: string;
  continuedCaptionY?: number;
  rootedCaptionInk?: import("./rooted-ink.js").InkBox[];
  rootedShapes?: import("./rooted-ink.js").InkBox[];
  rootedInk?: import("./rooted-ink.js").InkBox;
  rootedFit?: { basePages: number; actualPages: number; context: string };
  referenceNotes?: readonly string[];
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
  scheduleReferences?: ScheduleReferences;
}
export interface NativePartTarget {
  part: number;
  sheet: number;
  zone?: string;
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
    targets: NativePartTarget[];
    ports?: { key: string; targets: NativePartTarget[] }[];
  }[];
}
export interface CircuitContinuationBlock {
  noticeAfterTargets: boolean;
  group: string;
  part: number;
  x: number;
  y: number;
  width: number;
  rows: {
    id: string;
    label: string;
    targets: NativePartTarget[];
  }[];
}

/** Printable drawing rectangle in millimetres, shared by framing and references. */
export interface DrawingBounds {
  /** Compact band destinations extend the outer grid cells to this service edge. */
  frameService?: Readonly<{ x: number; y: number; w: number; h: number }>;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PacketRenderOptions {
  readonly source?: {
    readonly file: string;
    readonly nodes: import("@thermite/schema").JsonPointerNodeMap;
  };
}
