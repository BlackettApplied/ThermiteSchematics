import type { ElectricalIr } from "../ir.js";

type IrCable = ElectricalIr["cables"][number];
type IrCableConductor = ElectricalIr["cableConductors"][number];
type IrCableType = ElectricalIr["cableTypes"][number];
type ConductiveElementId =
  ElectricalIr["nets"][number]["conductiveElementIds"][number];
type IrDevice = ElectricalIr["devices"][number];
type IrJumper = ElectricalIr["jumpers"][number];
type IrNet = ElectricalIr["nets"][number];
type IrPotential = ElectricalIr["potentials"][number];
type IrTerminal = ElectricalIr["terminals"][number];
type IrWire = ElectricalIr["wires"][number];
type SourceRef = IrWire["endpoints"][number]["source"];
type TerminalId = IrTerminal["id"];

export type PotentialElectricalIntent = IrPotential["electrical"];
export type PotentialElectricalField = keyof PotentialElectricalIntent;

export interface PotentialIntentOrigin {
  readonly uid: string;
  readonly source: SourceRef;
}

export interface EffectivePotentialIntent {
  readonly name: string;
  readonly electrical: Readonly<PotentialElectricalIntent>;
  readonly origins: {
    readonly name: PotentialIntentOrigin;
    readonly electrical: Readonly<
      Partial<Record<PotentialElectricalField, PotentialIntentOrigin>>
    >;
  };
}

export interface DirectTerminalAssignment {
  readonly elementId: ConductiveElementId;
  readonly source: SourceRef;
  readonly uid: string;
  readonly display: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function terminalKey(terminal: TerminalId): string {
  return JSON.stringify([terminal.deviceUid, terminal.terminalKey]);
}

function sameTerminal(left: TerminalId, right: TerminalId): boolean {
  return (
    left.deviceUid === right.deviceUid && left.terminalKey === right.terminalKey
  );
}

function cableConductorKey(
  conductor: Pick<IrCableConductor, "cableUid" | "id">,
): string {
  return JSON.stringify([conductor.cableUid, conductor.id.conductorId]);
}

function conductiveCableConductorKey(
  id: Extract<
    IrNet["conductiveElementIds"][number],
    { kind: "cable_conductor" }
  >,
): string {
  return JSON.stringify([id.cableUid, id.conductorId]);
}

function uniqueMap<Key, Value>(
  entries: Iterable<readonly [Key, Value]>,
  display: (key: Key) => string,
): Map<Key, Value> {
  const result = new Map<Key, Value>();

  for (const [key, value] of entries) {
    if (result.has(key)) {
      throw new Error(`Electrical IR contains duplicate ${display(key)}.`);
    }
    result.set(key, value);
  }

  return result;
}

function required<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
  description: string,
): Value {
  const value = map.get(key);

  if (value === undefined) {
    throw new Error(`Electrical IR is missing ${description}.`);
  }

  return value;
}

/**
 * Per-evaluation state hydrated exclusively from the resolved IR tables/indexes.
 * Its mutable sets are rule-engine state; the input IR remains untouched.
 */
export class RuleContext {
  readonly ir: Readonly<ElectricalIr>;

  readonly cablesByUid: ReadonlyMap<string, IrCable>;
  readonly cableTypesById: ReadonlyMap<string, IrCableType>;
  readonly cableConductorsById: ReadonlyMap<string, IrCableConductor>;
  readonly devicesByUid: ReadonlyMap<string, IrDevice>;
  readonly wiresByUid: ReadonlyMap<string, IrWire>;
  readonly jumpersByUid: ReadonlyMap<string, IrJumper>;
  readonly terminalsById: ReadonlyMap<string, IrTerminal>;
  readonly potentialsByUid: ReadonlyMap<string, IrPotential>;
  readonly netsById: ReadonlyMap<string, IrNet>;
  readonly conductiveElementIdsByTerminalId: ReadonlyMap<
    string,
    readonly ConductiveElementId[]
  >;
  readonly netIdsByTerminalId: ReadonlyMap<string, string>;
  readonly netIdsByCableConductorId: ReadonlyMap<string, string>;

  /** Invalid conductors are excluded from later direct-assignment counts. */
  readonly invalidCableConductorIds = new Set<string>();
  /** E200/E201 mark nets here to suppress net-dependent electrical rules. */
  readonly topologicallyAffectedNetIds = new Set<string>();
  /** E300 marks nets here to suppress E301/E302. */
  readonly conflictingPotentialNetIds = new Set<string>();
  /** D7's compatible merge is analysis-only and is never written into the IR. */
  readonly effectivePotentialIntentsByNetId = new Map<
    string,
    EffectivePotentialIntent
  >();
  /** E301 marks terminals here so E302 suppresses only the same terminal. */
  readonly voltageTypeAffectedTerminalIds = new Set<string>();

  constructor(ir: ElectricalIr) {
    this.ir = ir;
    this.cablesByUid = uniqueMap(
      ir.cables.map((cable) => [cable.uid, cable] as const),
      (uid) => `cable uid ${JSON.stringify(uid)}`,
    );
    this.cableTypesById = uniqueMap(
      ir.cableTypes.map((type) => [type.id, type] as const),
      (id) => `cable type id ${JSON.stringify(id)}`,
    );
    this.cableConductorsById = uniqueMap(
      ir.cableConductors.map(
        (conductor) => [cableConductorKey(conductor), conductor] as const,
      ),
      (id) => `cable conductor id ${id}`,
    );
    this.devicesByUid = uniqueMap(
      ir.devices.map((device) => [device.uid, device] as const),
      (uid) => `device uid ${JSON.stringify(uid)}`,
    );
    this.wiresByUid = uniqueMap(
      ir.wires.map((wire) => [wire.uid, wire] as const),
      (uid) => `wire uid ${JSON.stringify(uid)}`,
    );
    this.jumpersByUid = uniqueMap(
      ir.jumpers.map((jumper) => [jumper.uid, jumper] as const),
      (uid) => `jumper uid ${JSON.stringify(uid)}`,
    );
    this.terminalsById = uniqueMap(
      ir.terminals.map(
        (terminal) => [terminalKey(terminal.id), terminal] as const,
      ),
      (id) => `terminal id ${id}`,
    );
    this.potentialsByUid = uniqueMap(
      ir.potentials.map((potential) => [potential.uid, potential] as const),
      (uid) => `potential uid ${JSON.stringify(uid)}`,
    );
    this.netsById = uniqueMap(
      ir.nets.map((net) => [net.id, net] as const),
      (id) => `net id ${JSON.stringify(id)}`,
    );
    this.conductiveElementIdsByTerminalId = uniqueMap(
      ir.indexes.conductiveElementIdsByTerminal.map(
        ({ key, value }) => [terminalKey(key), value] as const,
      ),
      (id) => `conductive-element index terminal id ${id}`,
    );
    this.netIdsByTerminalId = uniqueMap(
      ir.indexes.netIdByTerminal.map(
        ({ key, value }) => [terminalKey(key), value] as const,
      ),
      (id) => `net index terminal id ${id}`,
    );

    const netIdsByCableConductorId: Array<readonly [string, string]> = [];
    for (const net of ir.nets) {
      for (const element of net.conductiveElementIds) {
        if (element.kind === "cable_conductor") {
          netIdsByCableConductorId.push([
            conductiveCableConductorKey(element),
            net.id,
          ]);
        }
      }
    }
    this.netIdsByCableConductorId = uniqueMap(
      netIdsByCableConductorId,
      (id) => `net cable-conductor id ${id}`,
    );
  }

  cable(conductor: IrCableConductor): IrCable {
    return required(
      this.cablesByUid,
      conductor.cableUid,
      `parent cable ${JSON.stringify(conductor.cableUid)}`,
    );
  }

  cableType(conductor: IrCableConductor): IrCableType {
    return required(
      this.cableTypesById,
      conductor.typeId,
      `selected cable type ${JSON.stringify(conductor.typeId)}`,
    );
  }

  availableConductorIds(type: IrCableType): string[] {
    return type.conductors.map(({ id }) => id).sort(compareText);
  }

  displayCable(conductor: IrCableConductor): string {
    return this.cable(conductor).designation;
  }

  displayTerminal(terminal: TerminalId): string {
    const device = required(
      this.devicesByUid,
      terminal.deviceUid,
      `terminal device ${JSON.stringify(terminal.deviceUid)}`,
    );
    return `${device.designation}.${terminal.terminalKey}`;
  }

  displayIdList(ids: readonly string[]): string {
    return `[${[...ids]
      .sort(compareText)
      .map((id) => JSON.stringify(id))
      .join(", ")}]`;
  }

  conductiveElementIdsForTerminal(
    terminal: TerminalId,
  ): readonly ConductiveElementId[] {
    return required(
      this.conductiveElementIdsByTerminalId,
      terminalKey(terminal),
      `conductive-element index for terminal ${terminalKey(terminal)}`,
    );
  }

  directTerminalAssignment(
    elementId: ConductiveElementId,
    terminal: TerminalId,
  ): DirectTerminalAssignment {
    if (elementId.kind === "wire") {
      const wire = required(
        this.wiresByUid,
        elementId.uid,
        `wire ${JSON.stringify(elementId.uid)}`,
      );
      const endpoint = wire.endpoints.find(({ terminal: candidate }) =>
        sameTerminal(candidate, terminal),
      );
      if (endpoint === undefined) {
        throw new Error(
          `Electrical IR wire ${JSON.stringify(elementId.uid)} does not land on terminal ${terminalKey(terminal)}.`,
        );
      }
      return {
        elementId,
        source: endpoint.source,
        uid: wire.uid,
        display: `wire ${JSON.stringify(wire.designation)}`,
      };
    }

    if (elementId.kind === "jumper") {
      const jumper = required(
        this.jumpersByUid,
        elementId.uid,
        `jumper ${JSON.stringify(elementId.uid)}`,
      );
      const endpoint = jumper.endpoints.find(({ terminal: candidate }) =>
        sameTerminal(candidate, terminal),
      );
      if (endpoint === undefined) {
        throw new Error(
          `Electrical IR jumper ${JSON.stringify(elementId.uid)} does not land on terminal ${terminalKey(terminal)}.`,
        );
      }
      return {
        elementId,
        source: endpoint.source,
        uid: jumper.uid,
        display:
          jumper.designation === undefined
            ? `jumper uid ${JSON.stringify(jumper.uid)}`
            : `jumper ${JSON.stringify(jumper.designation)}`,
      };
    }

    const conductor = required(
      this.cableConductorsById,
      conductiveCableConductorKey(elementId),
      `cable conductor ${conductiveCableConductorKey(elementId)}`,
    );
    const endpoint = conductor.endpoints.find(({ terminal: candidate }) =>
      sameTerminal(candidate, terminal),
    );
    if (endpoint === undefined) {
      throw new Error(
        `Electrical IR cable conductor ${conductiveCableConductorKey(elementId)} does not land on terminal ${terminalKey(terminal)}.`,
      );
    }
    return {
      elementId,
      source: endpoint.source,
      uid: conductor.cableUid,
      display:
        `cable ${JSON.stringify(this.displayCable(conductor))} conductor ` +
        JSON.stringify(conductor.id.conductorId),
    };
  }

  partialCableAssignments(terminal: TerminalId): DirectTerminalAssignment[] {
    return this.ir.cables.flatMap((cable) =>
      (cable.assignments ?? []).flatMap((assignment) => {
        if (
          assignment.endpoints.every((endpoint) => endpoint !== null) ||
          !this.cableTypesById
            .get(cable.typeId)
            ?.conductors.some(({ id }) => id === assignment.id)
        )
          return [];
        const endpoint = assignment.endpoints.find(
          (candidate) =>
            candidate !== null && sameTerminal(candidate.terminal, terminal),
        );
        return endpoint == null
          ? []
          : [
              {
                elementId: {
                  kind: "cable_conductor" as const,
                  cableUid: cable.uid,
                  conductorId: assignment.id,
                },
                source: endpoint.source,
                uid: cable.uid,
                display: `cable ${JSON.stringify(cable.designation)} conductor ${JSON.stringify(assignment.id)}`,
              },
            ];
      }),
    );
  }

  isInvalidCableConductor(elementId: ConductiveElementId): boolean {
    return (
      elementId.kind === "cable_conductor" &&
      this.invalidCableConductorIds.has(conductiveCableConductorKey(elementId))
    );
  }

  netIdForCableConductor(conductor: IrCableConductor): string {
    return required(
      this.netIdsByCableConductorId,
      cableConductorKey(conductor),
      `net for cable conductor ${cableConductorKey(conductor)}`,
    );
  }

  netIdForTerminal(terminal: TerminalId): string {
    return required(
      this.netIdsByTerminalId,
      terminalKey(terminal),
      `net for terminal ${terminalKey(terminal)}`,
    );
  }

  terminal(id: TerminalId): IrTerminal {
    return required(
      this.terminalsById,
      terminalKey(id),
      `terminal ${terminalKey(id)}`,
    );
  }

  terminalsForNet(net: IrNet): IrTerminal[] {
    return net.terminalIds.map((id) => this.terminal(id));
  }

  potentialsForNet(net: IrNet): IrPotential[] {
    return net.potentialUids.map((uid) => {
      const potential = required(
        this.potentialsByUid,
        uid,
        `potential ${JSON.stringify(uid)} on net ${JSON.stringify(net.id)}`,
      );

      if (potential.netId !== net.id) {
        throw new Error(
          `Electrical IR potential ${JSON.stringify(uid)} names net ${JSON.stringify(potential.netId)} but is indexed by net ${JSON.stringify(net.id)}.`,
        );
      }

      return potential;
    });
  }

  markInvalidCableConductor(conductor: IrCableConductor): void {
    this.invalidCableConductorIds.add(cableConductorKey(conductor));
    this.topologicallyAffectedNetIds.add(
      this.netIdForCableConductor(conductor),
    );
  }

  markExclusiveTerminal(terminal: TerminalId): void {
    this.topologicallyAffectedNetIds.add(this.netIdForTerminal(terminal));
  }

  markVoltageTypeAffectedTerminal(terminal: TerminalId): void {
    this.voltageTypeAffectedTerminalIds.add(terminalKey(terminal));
  }

  isVoltageTypeAffectedTerminal(terminal: TerminalId): boolean {
    return this.voltageTypeAffectedTerminalIds.has(terminalKey(terminal));
  }
}

export function createRuleContext(ir: ElectricalIr): RuleContext {
  return new RuleContext(ir);
}
