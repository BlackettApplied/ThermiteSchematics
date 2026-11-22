import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrFunction,
  FunctionId,
  ConductiveElementId,
  TerminalId,
} from "@thermite/compiler";
import type {
  SelectedSubgraph,
  PresentationGraph,
  RenderSummary,
  SelectedPath,
  PresentationEdge,
  PresentationLabel,
  SelectedBoundary,
  BoundaryConstraint,
  LocationGroup,
  DeviceGroup,
  JunctionPresentationNode,
} from "../types.js";
import type {
  DeviceTypeSymbolMapping,
  FunctionSymbolRule,
  AggregateSymbolRule,
} from "../symbols/mappings.js";
import type { SymbolDefinition, SymbolSide } from "../symbols/types.js";
import type {
  UnsupportedSymbolMappingError,
  InvalidSheetError,
  InvalidRenderTextError,
} from "../errors.js";
import type { SemanticOrder } from "../semantic-order.js";

export interface BuildPresentationGraphRequest {
  readonly ir: Readonly<ElectricalIr>;
  readonly selected: Readonly<SelectedSubgraph>;
  readonly mappings?: readonly DeviceTypeSymbolMapping[];
  readonly catalog?: readonly SymbolDefinition[];
  readonly offViewPlacements?: Readonly<Record<string, number>>;
}

export type BuildPresentationGraphResult =
  | {
      readonly ok: true;
      readonly value: Readonly<{
        graph: PresentationGraph;
        summary: RenderSummary;
      }>;
    }
  | {
      readonly ok: false;
      readonly error:
        | UnsupportedSymbolMappingError
        | InvalidSheetError
        | InvalidRenderTextError;
    };

export interface PresentationContext {
  readonly order: SemanticOrder;
  orderedPaths?: readonly SelectedPath[];
  readonly directLoadPair: boolean;
  readonly ir: Readonly<ElectricalIr>;
  readonly selected: Readonly<SelectedSubgraph>;
  readonly mappings: readonly DeviceTypeSymbolMapping[];
  readonly catalog: readonly SymbolDefinition[];
  readonly deviceByUid: ReadonlyMap<string, IrDevice>;
  readonly typeById: ReadonlyMap<string, IrDeviceType>;
  readonly mappingByTypeId: ReadonlyMap<string, DeviceTypeSymbolMapping>;
  readonly functionByKey: ReadonlyMap<string, IrFunction>;
  readonly netIdByTerminal: ReadonlyMap<string, string>;
  readonly symbolById: ReadonlyMap<SymbolDefinition["id"], SymbolDefinition>;
  readonly selectedNetIds: ReadonlySet<string>;
}

export interface SymbolRepresentation {
  readonly id: string;
  readonly kind: "function" | "aggregate" | "terminal";
  readonly device: IrDevice;
  readonly deviceType: IrDeviceType;
  readonly rule: FunctionSymbolRule | AggregateSymbolRule;
  readonly functionIds: readonly FunctionId[];
}

export interface MutablePresentationEdge {
  readonly authoredOrderKey?: string;
  readonly id: string;
  readonly parentId: "root";
  readonly kind: "conductor" | "boundary-segment";
  sourcePortId: string;
  targetPortId: string;
  readonly netId: string;
  readonly elementIds: readonly ConductiveElementId[];
  readonly conductor?: NonNullable<PresentationEdge["conductor"]>;
  readonly endpoints: readonly [TerminalId, TerminalId];
  readonly pathRank: number;
  readonly label?: PresentationLabel;
  netLabel?: PresentationLabel;
}

export interface EndpointUse {
  readonly edge: MutablePresentationEdge;
  readonly end: "source" | "target";
  readonly terminal: TerminalId;
}

export interface BoundaryRecord {
  readonly boundary: SelectedBoundary;
  readonly constraint: BoundaryConstraint;
  readonly pathRank: number;
}

export interface SelectedEndpointFacts {
  readonly boundaries: ReadonlyMap<string, BoundaryRecord>;
  readonly constraints: ReadonlyMap<string, BoundaryConstraint>;
}

export interface PresentationGroups {
  readonly locationGroups: readonly LocationGroup[];
  readonly deviceGroups: readonly DeviceGroup[];
  readonly locationByDeviceUid: ReadonlyMap<string, LocationGroup>;
  readonly deviceByUid: ReadonlyMap<string, DeviceGroup>;
}

export interface IrConductorRecord {
  readonly id: ConductiveElementId;
  readonly endpoints: readonly [TerminalId, TerminalId];
}

export interface BuiltConductors {
  readonly edges: MutablePresentationEdge[];
  readonly endpointUses: ReadonlyMap<string, readonly EndpointUse[]>;
}

export interface TraceSignalDagEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly stableRank: number;
}

export interface TraceSignalDag {
  readonly root: string;
  readonly sink: string;
  readonly edges: readonly TraceSignalDagEdge[];
}

export interface TraceSignalOrder {
  readonly path: SelectedPath;
  readonly dag: TraceSignalDag;
  readonly rankByEdgeId: ReadonlyMap<string, number>;
}

export type StructuralRole = "P" | "Q" | "R" | "S";

export interface ClosedRoleAssignment {
  readonly incidence:
    | { readonly kind: "edge"; readonly edgeId: string }
    | { readonly kind: "attachment" }
    | { readonly kind: "link-in"; readonly index: number }
    | { readonly kind: "link-out"; readonly index: number };
  readonly role: StructuralRole;
  readonly side: SymbolSide;
  readonly order: number;
}

export interface ClosedComponentTemplate {
  readonly index: number;
  readonly assignments: readonly ClosedRoleAssignment[];
}

export interface ClosedRoleTemplate {
  readonly kind: "root" | "via" | "merge";
  readonly components: readonly ClosedComponentTemplate[];
}

export interface TraceDagIndex {
  readonly incoming: ReadonlyMap<string, readonly TraceSignalDagEdge[]>;
  readonly outgoing: ReadonlyMap<string, readonly TraceSignalDagEdge[]>;
}

export type TraceOrigin =
  | {
      readonly kind: "ROOT";
      readonly role: StructuralRole;
      readonly rank: number;
    }
  | { readonly kind: "CONTINUATION"; readonly rank: number }
  | { readonly kind: "OTHER"; readonly rank: number };

export interface JunctionInsertionResult {
  readonly junctions: readonly JunctionPresentationNode[];
  readonly boundaryEdges: readonly MutablePresentationEdge[];
}

export interface ClosedTraceIncidence {
  readonly orderedUses: readonly EndpointUse[];
  readonly template: ClosedRoleTemplate;
}

export type ClosedTraceSignature = "root" | "merge" | "via";

export interface ClosedTraceValidationRecord {
  readonly originalId: string;
  readonly role: "split" | "merge";
  readonly componentIndex: number;
  readonly componentIds: readonly string[];
  readonly conductorIds: readonly string[];
  readonly terminalKey: string;
  readonly netId: string;
}

export interface ClosedTraceValidationIndex {
  readonly byNodeId: ReadonlyMap<string, ClosedTraceValidationRecord>;
  readonly byTerminalKey: ReadonlyMap<string, ClosedTraceValidationRecord>;
}
