import type {
  ConductiveElementId,
  TerminalId,
  FunctionId,
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrFunction,
  IrPotential,
} from "@thermite/compiler";
import type {
  QueryError,
  QueryEngine,
  NetResult,
  ObjectSelector,
} from "@thermite/query";
import type {
  IncompletePathError,
  UnsupportedSymbolMappingError,
} from "../errors.js";
import type { SemanticOrder } from "../semantic-order.js";
import type { DeviceTypeSymbolMapping } from "../symbols/mappings.js";
import type { SymbolDefinition } from "../symbols/types.js";
import type {
  SelectedBoundary,
  SelectedPath,
  NormalizedDeviceSchematicView,
  SelectedSubgraph,
  NormalizedIntentSchematicView,
} from "../types.js";

export interface ConductorSearchEdge {
  readonly kind: "conductor";
  readonly elementId: ConductiveElementId;
  readonly from: TerminalId;
  readonly to: TerminalId;
  readonly netId: string;
}

export interface FunctionSearchEdge {
  readonly kind: "function";
  readonly functionId: FunctionId;
  readonly from: TerminalId;
  readonly to: TerminalId;
  readonly normalState?: "open" | "closed";
}

export type SearchEdge = ConductorSearchEdge | FunctionSearchEdge;

export interface Predecessor {
  readonly previous: TerminalId;
  readonly edge: SearchEdge;
}

export interface BoundaryCandidate {
  readonly classRank: number;
  readonly distance: number;
  readonly displayName?: string;
  readonly potentialUid?: string;
  readonly boundary: SelectedBoundary;
  readonly functionIds: readonly FunctionId[];
}

export type SearchSpec =
  | { readonly kind: "control-input"; readonly lane: "input" }
  | { readonly kind: "control-return"; readonly lane: "return" }
  | {
      readonly kind: "power-phase";
      readonly lane: string;
      readonly laneRank: number;
    }
  | { readonly kind: "power-pe"; readonly lane: string };

export interface SearchSuccess {
  readonly candidate: BoundaryCandidate;
  readonly path: SelectedPath;
}

export type SearchResult =
  | {
      readonly ok: true;
      readonly value?: SearchSuccess;
      readonly stoppedAt?: readonly TerminalId[];
    }
  | { readonly ok: false; readonly error: QueryError };

export interface IrConductor {
  readonly id: ConductiveElementId;
  readonly endpoints: readonly [TerminalId, TerminalId];
}

export interface SymbolMappingContext {
  readonly ir: Readonly<ElectricalIr>;
  readonly mappings: readonly DeviceTypeSymbolMapping[];
  readonly deviceByUid: ReadonlyMap<string, IrDevice>;
  readonly deviceTypeById: ReadonlyMap<string, IrDeviceType>;
  readonly mappingByTypeId: ReadonlyMap<string, DeviceTypeSymbolMapping>;
  readonly functionByKey: ReadonlyMap<string, IrFunction>;
}

/** Per-request graph snapshot. The queries are read-only; the only mutable
 * state is local net caching and conductor/IR agreement checks. Actuation and
 * power may use catalog-approved functionAdjacency; trace and loads construct
 * this context with no function edges. Conductors use only the cable query
 * and SymbolMappingContext, without a traversal context. */
export interface SelectionContext extends SymbolMappingContext {
  readonly order: SemanticOrder;
  readonly view: NormalizedDeviceSchematicView;
  readonly engine: Pick<QueryEngine, "net" | "followConductive">;
  readonly terminalByKey: ReadonlyMap<
    string,
    ElectricalIr["terminals"][number]
  >;
  readonly functionAdjacency: ReadonlyMap<
    string,
    readonly FunctionSearchEdge[]
  >;
  readonly potentialAnchors: ReadonlyMap<string, readonly IrPotential[]>;
  readonly conductorByKey: ReadonlyMap<string, IrConductor>;
  readonly netCache: Map<string, NetResult>;
  readonly verifiedConductors: Set<string>;
}

export interface SelectSemanticSubgraphRequest {
  readonly ir: Readonly<ElectricalIr>;
  readonly view: NormalizedDeviceSchematicView;
  readonly engine: QueryEngine;
  readonly mappings?: readonly DeviceTypeSymbolMapping[];
}

export type SelectSemanticSubgraphResult =
  | { readonly ok: true; readonly value: SelectedSubgraph }
  | {
      readonly ok: false;
      readonly error:
        QueryError | IncompletePathError | UnsupportedSymbolMappingError;
    };

export interface SelectTraceSubgraphRequest extends SelectSemanticSubgraphRequest {
  readonly target: {
    readonly deviceUid: string;
    readonly designation: string;
  };
  readonly includePower: boolean;
}

export type IncompleteTraceSelectionError = Extract<
  IncompletePathError,
  { readonly intent: "trace" }
>;

export type SelectTraceSubgraphResult =
  | { readonly ok: true; readonly value: SelectedSubgraph }
  | {
      readonly ok: false;
      readonly error:
        | QueryError
        | IncompleteTraceSelectionError
        | UnsupportedSymbolMappingError;
    };

export interface SelectCableConductorsRequest {
  readonly ir: Readonly<ElectricalIr>;
  readonly root: ObjectSelector;
  readonly engine: QueryEngine;
  readonly mappings?: readonly DeviceTypeSymbolMapping[];
}

export interface CableConductorSelection {
  readonly cableUid: string;
  readonly designation: string;
  readonly paths: readonly SelectedPath[];
  readonly deviceUids: readonly string[];
  readonly terminalIds: readonly TerminalId[];
  readonly functionIds: readonly FunctionId[];
  readonly conductiveElementIds: readonly ConductiveElementId[];
  readonly netIds: readonly string[];
}

export type IncompleteCableConductorSelectionError = Extract<
  IncompletePathError,
  { readonly intent: "conductors" }
>;

export type SelectCableConductorsResult =
  | { readonly ok: true; readonly value: CableConductorSelection }
  | {
      readonly ok: false;
      readonly error:
        | QueryError
        | IncompleteCableConductorSelectionError
        | UnsupportedSymbolMappingError;
    };

export interface SelectCableConductorSubgraphRequest extends SelectCableConductorsRequest {
  readonly view: Extract<
    NormalizedIntentSchematicView,
    { readonly intent: "conductors" }
  >;
}

export type SelectCableConductorSubgraphResult =
  | { readonly ok: true; readonly value: SelectedSubgraph }
  | {
      readonly ok: false;
      readonly error:
        | QueryError
        | IncompleteCableConductorSelectionError
        | UnsupportedSymbolMappingError;
    };

export interface SelectLoadsSubgraphRequest extends SelectSemanticSubgraphRequest {
  readonly catalog?: readonly SymbolDefinition[];
}

export type IncompleteLoadsSelectionError = Extract<
  IncompletePathError,
  { readonly intent: "loads" }
>;

export type SelectLoadsSubgraphResult =
  | { readonly ok: true; readonly value: SelectedSubgraph }
  | {
      readonly ok: false;
      readonly error:
        | QueryError
        | IncompleteLoadsSelectionError
        | UnsupportedSymbolMappingError;
    };

interface ConductorSearchTree<Stop> {
  readonly stops: readonly Stop[];
  readonly distances: ReadonlyMap<string, number>;
  readonly predecessors: ReadonlyMap<string, readonly Predecessor[]>;
}

export type ConductorSearchTreeResult<Stop> =
  | { readonly ok: true; readonly value: ConductorSearchTree<Stop> }
  | { readonly ok: false; readonly error: QueryError };

/** A family supplies stop policy and orientation, never new graph edges.
 * The shared breadth-first search visits exactly the existing conductive edges
 * and, when allowed, catalog-approved two-terminal functions. */
export interface RootedPathSearch {
  readonly lane: string;
  readonly allowFunctions: boolean;
  readonly boundaryAtEnd: boolean;
  readonly constrainRoot: boolean;
  readonly boundaries: (
    context: SelectionContext,
    terminal: TerminalId,
    net: NetResult,
    distance: number,
  ) => readonly BoundaryCandidate[];
}

/** Each successful family search supplies complete root lanes and their
 * function owners. Conservation validates pass-through ownership before any
 * subgraph is returned. Failure carries the original query or mapping error. */
export type RootPathSelectionResult =
  | {
      readonly ok: true;
      readonly paths: readonly SearchSuccess[];
      readonly rootFunctionIds: readonly FunctionId[];
    }
  | {
      readonly ok: false;
      readonly error:
        QueryError | IncompletePathError | UnsupportedSymbolMappingError;
    };

/** A conserved subgraph includes all selected function terminals and endpoint
 * devices, exactly the selected physical conductors, and their original net
 * identities plus explicit provenance nets. Arrays and IDs are frozen. */
export type SelectedIdentities = Pick<
  SelectedSubgraph,
  | "deviceUids"
  | "terminalIds"
  | "functionIds"
  | "conductiveElementIds"
  | "netIds"
>;
