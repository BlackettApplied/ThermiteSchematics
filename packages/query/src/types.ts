import type {
  CableConductorId,
  IrCableType,
  IrFunction,
  IrInternalRelation,
  IrPotential,
  IrProjectRelation,
  IrTerminal,
  IrWire,
  TerminalId,
} from "@thermite/compiler";

export type ObjectSelector =
  | { readonly by: "uid"; readonly value: string }
  | { readonly by: "designation"; readonly value: string };

export type TerminalSelector =
  | { readonly by: "id"; readonly value: TerminalId }
  | {
      readonly by: "parts";
      readonly deviceDesignation: string;
      readonly terminalKey: string;
    }
  | { readonly by: "display"; readonly value: string };

export type QueryResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: QueryError };

export type QueryErrorCode = "Q001" | "Q002" | "Q003" | "Q004";

export interface QueryError {
  readonly code: QueryErrorCode;
  readonly message: string;
  readonly input: string;
  readonly expectedKind?: "device" | "cable";
  readonly actualKind?: ProjectObjectKind;
  readonly deviceDesignation?: string;
  readonly terminalKey?: string;
}

export interface ProjectObjectView {
  readonly kind:
    "device" | "wire" | "jumper" | "cable" | "relation" | "potential";
  readonly uid: string;
  readonly designation?: string;
  readonly description?: string;
  readonly aliases: readonly string[];
}

export type ProjectObjectKind = ProjectObjectView["kind"];

export interface DeviceView extends ProjectObjectView {
  readonly connectionReview?: import("@thermite/compiler").IrDevice["connectionReview"];
  readonly io?: import("@thermite/compiler").IrDevice["io"];
  readonly kind: "device";
  readonly designation: string;
  readonly typeId: string;
  readonly location?: string;
}

export interface TerminalView {
  readonly id: TerminalId;
  readonly deviceDesignation: string;
  readonly display: string;
  readonly required?: boolean;
  readonly role?: string;
  readonly rating?: IrTerminal["rating"];
  readonly connectionPolicy?: "exclusive" | "shared";
  readonly description?: string;
}

export interface PotentialView {
  readonly uid: string;
  readonly name: string;
  readonly electrical: IrPotential["electrical"];
}

export interface NetSummaryView {
  readonly id: string;
  readonly potentials: readonly PotentialView[];
}

export interface ProjectRelationView {
  readonly connection?: IrProjectRelation["connection"];
  readonly assembly?: IrProjectRelation["assembly"];
  readonly uid: string;
  readonly designation?: string;
  readonly display: string;
  readonly verb: IrProjectRelation["verb"];
  readonly from: DeviceView;
  readonly to: DeviceView;
}

export type ConductiveElementView =
  | {
      readonly kind: "wire";
      readonly uid: string;
      readonly designation: string;
      readonly display: string;
    }
  | {
      readonly kind: "jumper";
      readonly uid: string;
      readonly designation?: string;
      readonly display: string;
    }
  | {
      readonly kind: "cable_conductor";
      readonly cableUid: string;
      readonly cableDesignation: string;
      readonly conductorId: string;
      readonly display: string;
    };

export interface ConductiveEdgeView {
  readonly element: ConductiveElementView;
  readonly endpoints: readonly [TerminalView, TerminalView];
}

export interface InspectResult {
  readonly command: "inspect";
  readonly object: InspectedObject;
}

export interface FunctionView {
  readonly key: string;
  readonly kind: IrFunction["kind"];
  readonly normalState?: "open" | "closed";
  readonly direction?: "input" | "output";
  readonly terminals: readonly TerminalView[];
}

export interface InternalRelationView {
  readonly verb: IrInternalRelation["verb"];
  readonly fromFunctionKey: string;
  readonly toFunctionKey: string;
}

export interface GangedGroupView {
  readonly id: string;
  readonly functionKeys: readonly string[];
}

export interface IncidentProjectRelationView {
  readonly relation: ProjectRelationView;
  readonly direction: "incoming" | "outgoing" | "self";
  readonly otherDevice: DeviceView;
}

export interface InspectedTerminalView extends TerminalView {
  readonly net: NetSummaryView;
  readonly elements: readonly ConductiveElementView[];
}

export type InspectedObject =
  | (DeviceView & {
      readonly connectionCoverage?: import("@thermite/compiler").IrDeviceType["connectionCoverage"];
      readonly ports?: import("@thermite/compiler").IrDeviceType["ports"];
      readonly connectorPorts?: import("@thermite/compiler").IrDeviceType["connectorPorts"];
      readonly terminals: readonly InspectedTerminalView[];
      readonly functions: readonly FunctionView[];
      readonly gangedGroups: readonly GangedGroupView[];
      readonly internalRelations: readonly InternalRelationView[];
      readonly projectRelations: readonly IncidentProjectRelationView[];
    })
  | (ProjectObjectView & {
      readonly kind: "wire";
      readonly designation: string;
      readonly properties?: IrWire["properties"];
      readonly endpoints: readonly [TerminalView, TerminalView];
      readonly net: NetSummaryView;
    })
  | (ProjectObjectView & {
      readonly kind: "jumper";
      readonly endpoints: readonly [TerminalView, TerminalView];
      readonly net: NetSummaryView;
    })
  | (ProjectObjectView & {
      readonly kind: "cable";
      readonly designation: string;
      readonly typeId: string;
      readonly cableType: {
        readonly id: string;
        readonly shield?: boolean;
        readonly construction?: IrCableType["construction"];
      };
      readonly conductorCount: number;
      readonly conductorIds: readonly CableConductorId[];
    })
  | (ProjectObjectView & {
      readonly kind: "relation";
      readonly connection?: IrProjectRelation["connection"];
      readonly assembly?: IrProjectRelation["assembly"];
      readonly verb: IrProjectRelation["verb"];
      readonly from: DeviceView;
      readonly to: DeviceView;
    })
  | (ProjectObjectView & {
      readonly kind: "potential";
      readonly name: string;
      readonly electrical: IrPotential["electrical"];
      readonly terminal: TerminalView;
      readonly net: NetSummaryView;
    });

export interface ConductiveNeighbor {
  readonly terminal: TerminalView;
  readonly element: ConductiveElementView;
  readonly otherTerminal: TerminalView;
  readonly otherDevice: DeviceView;
}

export interface RelationNeighbor {
  readonly relation: ProjectRelationView;
  readonly direction: "incoming" | "outgoing" | "self";
  readonly otherDevice: DeviceView;
}

export interface NeighborsResult {
  readonly command: "neighbors";
  readonly device: DeviceView;
  readonly conductive: readonly ConductiveNeighbor[];
  readonly relations: readonly RelationNeighbor[];
}

export interface TraceVisit {
  readonly terminal: TerminalView;
  readonly hops: number;
  readonly via?: {
    readonly from: TerminalView;
    readonly element: ConductiveElementView;
  };
}

export interface TraceComponent {
  readonly net: {
    readonly id: string;
    readonly potentials: readonly PotentialView[];
  };
  readonly roots: readonly TerminalView[];
  readonly visits: readonly TraceVisit[];
  readonly elements: readonly ConductiveEdgeView[];
}

export interface TraceResult {
  readonly command: "trace";
  readonly device: DeviceView;
  readonly components: readonly TraceComponent[];
}

export interface NetResult {
  readonly command: "net";
  readonly selectedTerminal: TerminalView;
  readonly net: {
    readonly id: string;
    readonly potentials: readonly PotentialView[];
    readonly terminals: readonly TerminalView[];
    readonly elements: readonly ConductiveEdgeView[];
  };
}

export interface CableConductorView {
  readonly id: CableConductorId;
  readonly display: string;
  readonly color: string;
  readonly size?: string;
  readonly endpoints: readonly [TerminalView, TerminalView];
  readonly net: {
    readonly id: string;
    readonly potentials: readonly PotentialView[];
  };
}

export interface CableResult {
  readonly schedule?: import("./cable-schedule.js").CableSchedule;
  readonly command: "cable";
  readonly cable: ProjectObjectView & {
    readonly kind: "cable";
    readonly designation: string;
    readonly typeId: string;
  };
  readonly cableType: {
    readonly id: string;
    readonly shield?: boolean;
    readonly construction?: IrCableType["construction"];
  };
  readonly conductors: readonly CableConductorView[];
}

export type QueryCommandResult =
  InspectResult | NeighborsResult | TraceResult | NetResult | CableResult;

export interface QueryEngine {
  resolveObject(selector: ObjectSelector): QueryResult<ProjectObjectView>;
  resolveTerminal(selector: TerminalSelector): QueryResult<TerminalView>;
  inspect(selector: ObjectSelector): QueryResult<InspectResult>;
  neighbors(selector: ObjectSelector): QueryResult<NeighborsResult>;
  trace(selector: ObjectSelector): QueryResult<TraceResult>;
  net(selector: TerminalSelector): QueryResult<NetResult>;
  cable(selector: ObjectSelector): QueryResult<CableResult>;
  followConductive(
    starts: readonly TerminalId[],
  ): QueryResult<readonly TraceComponent[]>;
}
