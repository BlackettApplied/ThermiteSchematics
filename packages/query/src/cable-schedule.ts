import type { ElectricalIr, TerminalId } from "@thermite/compiler";

export interface CableScheduleEndpoint {
  readonly terminal: TerminalId;
  readonly display: string;
  readonly location: string | null;
}
export interface CableScheduleCore {
  readonly id: string;
  readonly color: string;
  readonly size?: string;
  readonly usage: "in-use" | "spare" | "unspecified" | "unassigned";
  readonly status:
    "connected" | "partially-terminated" | "unterminated" | "unassigned";
  readonly endpoints: readonly [
    CableScheduleEndpoint | null,
    CableScheduleEndpoint | null,
  ];
  readonly netId: string | null;
}
export interface CableSchedule {
  readonly format: "cable-schedule/0.1";
  readonly cableUid: string;
  readonly designation: string;
  readonly typeId: string;
  readonly fromLocation: string | null;
  readonly toLocation: string | null;
  readonly endOrder: "authored" | "canonical";
  readonly shield: boolean | null;
  readonly cores: readonly CableScheduleCore[];
  readonly counts: {
    readonly total: number;
    readonly connected: number;
    readonly spare: number;
    readonly unassigned: number;
  };
}

/** Physical core inventory. Construction/shield metadata never implies bonding. */
export function buildCableSchedule(
  ir: Readonly<ElectricalIr>,
  cableUid: string,
): CableSchedule {
  const cable = ir.cables.find(({ uid }) => uid === cableUid);
  if (cable === undefined) throw new Error(`Missing cable ${cableUid}.`);
  const type = ir.cableTypes.find(({ id }) => id === cable.typeId);
  if (type === undefined)
    throw new Error(`Missing cable type ${cable.typeId}.`);
  const devices = new Map(ir.devices.map((device) => [device.uid, device]));
  const connected = new Map(
    ir.cableConductors
      .filter((core) => core.cableUid === cableUid)
      .map((core) => [core.id.conductorId, core]),
  );
  const authored = new Map(cable.assignments?.map((core) => [core.id, core]));
  function endpoint(terminal: TerminalId): CableScheduleEndpoint {
    const device = devices.get(terminal.deviceUid);
    if (device === undefined)
      throw new Error(`Missing cable endpoint device ${terminal.deviceUid}.`);
    return {
      terminal: { ...terminal },
      display: `${device.designation}.${terminal.terminalKey}`,
      location: device.location ?? null,
    };
  }
  const cores: CableScheduleCore[] = [...type.conductors]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((definition) => {
      const assignment = authored.get(definition.id);
      const physical = connected.get(definition.id);
      const ends = assignment?.endpoints ?? physical?.endpoints;
      const endpoints: CableScheduleCore["endpoints"] = [
        ends?.[0] == null ? null : endpoint(ends[0].terminal),
        ends?.[1] == null ? null : endpoint(ends[1].terminal),
      ];
      const count = endpoints.filter((end) => end !== null).length;
      const netId =
        physical === undefined
          ? null
          : ir.indexes.netIdByTerminal.find(
              ({ key }) =>
                key.deviceUid === physical.endpoints[0].terminal.deviceUid &&
                key.terminalKey === physical.endpoints[0].terminal.terminalKey,
            )?.value;
      if (netId === undefined)
        throw new Error(`Missing connected cable net ${definition.id}.`);
      return {
        id: definition.id,
        color: definition.color,
        ...(definition.size === undefined ? {} : { size: definition.size }),
        usage:
          assignment?.usage ??
          (ends === undefined ? "unassigned" : "unspecified"),
        status:
          ends === undefined
            ? "unassigned"
            : count === 2
              ? "connected"
              : count === 1
                ? "partially-terminated"
                : "unterminated",
        endpoints,
        netId,
      };
    });
  return {
    format: "cable-schedule/0.1",
    cableUid,
    designation: cable.designation,
    typeId: cable.typeId,
    fromLocation: cable.fromLocation ?? null,
    toLocation: cable.toLocation ?? null,
    endOrder: cable.assignments === undefined ? "canonical" : "authored",
    shield: type.shield ?? null,
    cores,
    counts: {
      total: cores.length,
      connected: cores.filter((core) => core.status === "connected").length,
      spare: cores.filter((core) => core.usage === "spare").length,
      unassigned: cores.filter((core) => core.usage === "unassigned").length,
    },
  };
}
