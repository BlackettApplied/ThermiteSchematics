import type {
  CompiledProjectPresentation,
  ConductiveElementId,
  ElectricalIr,
  FunctionId,
  TerminalId,
} from "@thermite/compiler";
import type { ObjectSelector, QueryError } from "@thermite/query";

import type {
  RenderError,
  RenderTextField,
  RenderTextOwnerKind,
} from "./errors.js";
import type { PresentationClass } from "./ordering.js";
import type {
  SymbolDefinition,
  SymbolOrientation,
  SymbolPoint,
  SymbolSide,
} from "./symbols/types.js";

export const RENDERER_VERSION = "render/0.3";
export const SYMBOL_CATALOG_VERSION = "ais-symbols/0.3";
export const LAYOUT_CONFIG_VERSION = "elk-layered/0.4+elkjs-0.12.0";

export type SchematicViewFamily = "control" | "power";
export type SchematicFlow = "left-to-right" | "top-to-bottom";

export interface LegacySchematicViewRequest {
  readonly format: "schematic-view-request/0.1";
  readonly family: SchematicViewFamily;
  readonly root: ObjectSelector;
  readonly flow?: SchematicFlow;
}

export type DemonstrationViewIntent =
  | {
      readonly kind: "trace";
      readonly to: ObjectSelector;
      readonly includePower: boolean;
    }
  | { readonly kind: "conductors" }
  | { readonly kind: "loads" };

export interface IntentSchematicViewRequest {
  readonly format: "schematic-view-request/0.2";
  readonly root: ObjectSelector;
  readonly intent: DemonstrationViewIntent;
  readonly flow?: SchematicFlow;
}

export type SchematicViewRequest =
  LegacySchematicViewRequest | IntentSchematicViewRequest;

export interface NormalizedLegacySchematicView {
  readonly format: "schematic-view/0.1";
  readonly family: SchematicViewFamily;
  readonly root: {
    readonly deviceUid: string;
    readonly designation: string;
  };
  readonly flow: SchematicFlow;
}

export type NormalizedIntentSchematicView =
  | {
      readonly format: "schematic-view/0.2";
      readonly family: "control";
      readonly intent: "trace";
      readonly root: {
        readonly kind: "device";
        readonly deviceUid: string;
        readonly designation: string;
      };
      readonly target: {
        readonly deviceUid: string;
        readonly designation: string;
      };
      readonly includePower: boolean;
      readonly flow: SchematicFlow;
    }
  | {
      readonly format: "schematic-view/0.2";
      readonly family: "control";
      readonly intent: "conductors";
      readonly root: {
        readonly kind: "cable";
        readonly cableUid: string;
        readonly designation: string;
      };
      readonly flow: SchematicFlow;
    }
  | {
      readonly format: "schematic-view/0.2";
      readonly family: "control";
      readonly intent: "loads";
      readonly root: {
        readonly kind: "device";
        readonly deviceUid: string;
        readonly designation: string;
      };
      readonly flow: SchematicFlow;
    };

export type NormalizedDeviceSchematicView =
  | NormalizedLegacySchematicView
  | Extract<
      NormalizedIntentSchematicView,
      { readonly root: { readonly kind: "device" } }
    >;

export type NormalizedSchematicView =
  NormalizedLegacySchematicView | NormalizedIntentSchematicView;

export type RenderFailure = QueryError | RenderError;
export type RenderOutcome<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: RenderFailure };

export interface RenderSummary {
  readonly deviceUids: readonly string[];
  readonly terminalIds: readonly TerminalId[];
  readonly functionIds: readonly FunctionId[];
  readonly conductiveElementIds: readonly ConductiveElementId[];
  readonly netIds: readonly string[];
  readonly presentationNodeIds: readonly string[];
}

export interface RenderedSchematic {
  readonly view: NormalizedSchematicView;
  readonly summary: RenderSummary;
  readonly svg: string;
}

export interface SchematicRenderer {
  render(
    ir: Readonly<ElectricalIr>,
    request: Readonly<SchematicViewRequest>,
    presentation?: Readonly<CompiledProjectPresentation>,
  ): Promise<RenderOutcome<RenderedSchematic>>;
}

export interface SelectedConductorStep {
  readonly kind: "conductor";
  readonly elementId: ConductiveElementId;
  readonly from: TerminalId;
  readonly to: TerminalId;
  readonly netId: string;
}

export interface SelectedFunctionStep {
  readonly kind: "function";
  readonly functionId: FunctionId;
  readonly from: TerminalId;
  readonly to: TerminalId;
  readonly normalState?: "open" | "closed";
}

export interface SelectedBoundary {
  readonly kind: "channel" | "source" | "potential" | "return";
  readonly terminal: TerminalId;
  readonly netId: string;
  readonly potentialUid?: string;
  readonly label: string;
}

export type BoundaryConstraint = "FIRST" | "LAST";

export interface SelectedPathEndpoint {
  readonly terminal: TerminalId;
  readonly boundary?: SelectedBoundary;
  readonly constraint?: BoundaryConstraint;
}

export interface SelectedPath {
  readonly id: string;
  readonly lane: string;
  readonly start: SelectedPathEndpoint;
  readonly steps: readonly (SelectedConductorStep | SelectedFunctionStep)[];
  readonly end: SelectedPathEndpoint;
}

export interface SelectedSubgraph {
  readonly view: NormalizedSchematicView;
  readonly paths: readonly SelectedPath[];
  readonly deviceUids: readonly string[];
  readonly terminalIds: readonly TerminalId[];
  readonly functionIds: readonly FunctionId[];
  readonly conductiveElementIds: readonly ConductiveElementId[];
  readonly netIds: readonly string[];
}

export type LocationIdentity =
  readonly ["authored", string] | readonly ["virtual", "UNSPECIFIED"];

export interface RenderTextSource {
  readonly ownerKind: RenderTextOwnerKind;
  readonly ownerId: string;
  readonly field: RenderTextField;
  readonly value: string;
}

export type PresentationLabelRole =
  | "location"
  | "device"
  | "function"
  | "aggregate"
  | "rail"
  | "terminal"
  | "conductor"
  | "net";

export type PresentationLabelOwnerKind =
  "location" | "device" | "symbol" | "rail" | "port" | "edge";

export interface PresentationLabel {
  readonly id: string;
  readonly ownerKind: PresentationLabelOwnerKind;
  readonly ownerId: string;
  readonly role: PresentationLabelRole;
  readonly text: string;
  readonly textSources: readonly RenderTextSource[];
  readonly width: number;
  readonly height: number;
  readonly textLength: number;
}

export interface LocationGroup {
  readonly id: string;
  readonly parentId: "root";
  readonly identity: LocationIdentity;
  readonly label: PresentationLabel;
}

export interface DeviceGroup {
  readonly id: string;
  readonly parentId: LocationGroup["id"];
  readonly deviceUid: string;
  readonly designation: string;
  readonly typeId: string;
  readonly label: PresentationLabel;
}

export interface PresentationPort {
  readonly id: string;
  readonly symbolPortId: string;
  readonly terminal: TerminalId;
  readonly memberFunctionId?: FunctionId;
  readonly netId: string;
  readonly side: SymbolSide;
  readonly offset: number;
  readonly order: number;
  readonly label: string;
}

export type SemanticAttachmentKind =
  "function" | "channel" | "aggregate" | "collapsed-boundary";

export interface SemanticAttachment {
  readonly kind: SemanticAttachmentKind;
  readonly nodeId: string;
  readonly terminal: TerminalId;
  readonly netId: string;
  readonly portIds: readonly string[];
}

export interface SymbolPresentationNode {
  readonly kind: "symbol";
  readonly representation: "function" | "aggregate";
  readonly id: string;
  readonly deviceUid: string;
  readonly designation: string;
  readonly typeId: string;
  readonly functionIds: readonly FunctionId[];
  readonly symbolId: SymbolDefinition["id"];
  readonly classification: PresentationClass;
  readonly parentId: DeviceGroup["id"];
  readonly boundaryConstraint?: BoundaryConstraint;
  readonly locationGroupId: string;
  readonly deviceGroupId: string;
  readonly orientation: SymbolOrientation;
  readonly symbolSize: Readonly<{ width: number; height: number }>;
  readonly width: number;
  readonly height: number;
  readonly primitiveOrigin: SymbolPoint;
  readonly ports: readonly PresentationPort[];
  readonly attachments: readonly SemanticAttachment[];
  readonly labels: readonly PresentationLabel[];
}

export interface RailPresentationNode {
  readonly kind: "rail";
  readonly id: string;
  readonly parentId: "root";
  readonly boundaryConstraint: BoundaryConstraint;
  readonly deviceUid: string;
  readonly designation: string;
  readonly typeId: string;
  readonly functionIds: readonly FunctionId[];
  readonly symbolId: "ais:rail-source" | "ais:rail-return";
  readonly classification: "rail";
  readonly orientation: SymbolOrientation;
  readonly symbolSize: Readonly<{ width: number; height: number }>;
  readonly width: number;
  readonly height: number;
  readonly primitiveOrigin: SymbolPoint;
  readonly boundary: SelectedBoundary;
  readonly ports: readonly [PresentationPort];
  readonly attachments: readonly [SemanticAttachment];
  readonly labels: readonly PresentationLabel[];
}

export interface JunctionPresentationNode {
  readonly kind: "junction";
  readonly id: string;
  readonly parentId: "root" | LocationGroup["id"] | DeviceGroup["id"];
  readonly classification: "junction";
  readonly netId: string;
  readonly terminal: TerminalId;
  readonly ports: readonly PresentationPort[];
}

export type PresentationNode =
  SymbolPresentationNode | RailPresentationNode | JunctionPresentationNode;

export interface PresentationEdge {
  readonly id: string;
  readonly parentId: "root";
  readonly kind: "conductor" | "boundary-segment";
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly netId: string;
  readonly elementIds: readonly ConductiveElementId[];
  readonly conductor?:
    | {
        readonly kind: "wire";
        readonly uid: string;
        readonly designation: string;
      }
    | {
        readonly kind: "jumper";
        readonly uid: string;
        readonly designation: string;
      }
    | {
        readonly kind: "cable-conductor";
        readonly cableUid: string;
        readonly cableDesignation: string;
        readonly conductorId: string;
      };
  readonly endpoints: readonly [TerminalId, TerminalId];
  readonly pathRank: number;
  readonly label?: PresentationLabel;
  readonly netLabel?: PresentationLabel;
}

export interface PresentationGraph {
  readonly format: "schematic-presentation/0.1";
  readonly view: NormalizedSchematicView;
  readonly locationGroups: readonly LocationGroup[];
  readonly deviceGroups: readonly DeviceGroup[];
  readonly nodes: readonly PresentationNode[];
  readonly edges: readonly PresentationEdge[];
  readonly metadataTextSources: readonly RenderTextSource[];
}

export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
}

export type LayoutNodeKind =
  "location" | "device" | "symbol" | "rail" | "junction";

export interface LayoutNode {
  readonly id: string;
  readonly parentId: string;
  readonly kind: LayoutNodeKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly primitiveOrigin?: LayoutPoint;
}

export interface LayoutPort {
  readonly id: string;
  readonly nodeId: string;
  readonly side: SymbolSide;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutLabel {
  readonly id: string;
  readonly ownerKind: PresentationLabelOwnerKind;
  readonly ownerId: string;
  readonly role: PresentationLabelRole;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutEdgeSection {
  readonly id: string;
  readonly points: readonly LayoutPoint[];
}

export interface LayoutEdge {
  readonly id: string;
  readonly kind: PresentationEdge["kind"];
  readonly netId: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sectionIds: readonly string[];
  readonly sections: readonly LayoutEdgeSection[];
  readonly points: readonly LayoutPoint[];
}

export interface LayoutCrossing {
  readonly edgeIds: readonly [string, string];
  readonly netIds: readonly [string, string];
  readonly point: LayoutPoint;
}

export interface NormalizedSchematicLayout {
  readonly format: "schematic-layout/0.1";
  readonly view: NormalizedSchematicView;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly LayoutNode[];
  readonly ports: readonly LayoutPort[];
  readonly labels: readonly LayoutLabel[];
  readonly edges: readonly LayoutEdge[];
  readonly crossings: readonly LayoutCrossing[];
}
