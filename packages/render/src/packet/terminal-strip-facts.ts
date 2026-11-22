import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import { buildCableSchedule, type DocumentationTable } from "@thermite/query";
import { required } from "../presentation/util.js";

export const stripTerminalKey = (t: TerminalId) =>
  JSON.stringify([t.deviceUid, t.terminalKey]);
export interface StripIncidence {
  identity: string;
  label: string;
  peer: TerminalId | null;
  sameLocation: boolean;
}
type StripGroup = {
  device: ElectricalIr["devices"][number];
  ordered: boolean;
  terminals: {
    id: TerminalId;
    key: string;
    ref: string;
    incidences: StripIncidence[];
  }[];
};
function stripGroups(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  devices: ReadonlyMap<string, ElectricalIr["devices"][number]>,
) {
  const groups = new Map<string, StripGroup>();
  for (const row of table.rows) {
    const [uid, key]: string[] = JSON.parse(row.key);
    const device = required(
      devices.get(required(uid, "Missing strip owner")),
      "Missing strip device",
    );
    let group = groups.get(device.uid);
    if (!group) {
      const type = required(
        ir.deviceTypes.find((t) => t.id === device.typeId),
        "Missing strip type",
      );
      groups.set(
        device.uid,
        (group = {
          device,
          ordered: type.terminalOrder !== undefined,
          terminals: [],
        }),
      );
    }
    group.terminals.push({
      id: {
        deviceUid: device.uid,
        terminalKey: required(key, "Missing strip key"),
      },
      key: row.key,
      ref: `T${groups.size}/R${group.terminals.length + 1}`,
      incidences: [],
    });
  }
  return groups;
}
function incidenceWriter(
  devices: ReadonlyMap<string, ElectricalIr["devices"][number]>,
  terminals: ReadonlyMap<string, StripGroup["terminals"][number]>,
) {
  const names = (t: TerminalId | null) =>
    t
      ? `${required(devices.get(t.deviceUid), "Missing strip peer").designation}.${t.terminalKey}`
      : "Unterminated";
  const add = (
    ends: readonly (TerminalId | null)[],
    identity: string,
    label: string,
  ) => {
    ends.forEach((end, i) => {
      if (!end) return;
      const t = terminals.get(stripTerminalKey(end));
      if (!t) return;
      const peer = ends[1 - i] ?? null;
      const location = devices.get(end.deviceUid)?.location;
      t.incidences.push({
        identity,
        label: `${label} → ${names(peer)}`,
        peer,
        sameLocation:
          !!peer &&
          location !== undefined &&
          devices.get(peer.deviceUid)?.location === location,
      });
    });
  };
  return add;
}
export function stripFacts(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
) {
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
  const groups = stripGroups(ir, table, devices);
  const terminals = new Map(
    [...groups.values()].flatMap((g) =>
      g.terminals.map((t) => [t.key, t] as const),
    ),
  );
  const bridges = ir.jumpers.filter(
    (j) =>
      j.endpoints.every((e) => terminals.has(stripTerminalKey(e.terminal))) &&
      j.endpoints[0].terminal.deviceUid === j.endpoints[1].terminal.deviceUid,
  );
  const add = incidenceWriter(devices, terminals);
  for (const w of ir.wires)
    add(
      w.endpoints.map((e) => e.terminal),
      w.uid,
      w.designation,
    );
  for (const j of ir.jumpers)
    if (!bridges.includes(j))
      add(
        j.endpoints.map((e) => e.terminal),
        j.uid,
        j.designation ?? "Jumper",
      );
  // Use the inventory's physical/assignment union, including single-ended spares.
  for (const c of ir.cables)
    for (const core of buildCableSchedule(ir, c.uid).cores)
      add(
        core.endpoints.map((e) => e?.terminal ?? null),
        JSON.stringify([c.uid, core.id]),
        `${c.designation}/${core.id}`,
      );
  for (const t of terminals.values())
    t.incidences.sort((a, b) =>
      a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
    );
  return { groups: [...groups.values()], terminals, bridges };
}
export type StripFacts = ReturnType<typeof stripFacts>;
