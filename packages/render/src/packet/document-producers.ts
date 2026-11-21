import { required } from "../presentation/util.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type { DocumentNeedSeed } from "./document-types.js";
import { sourceIncidences } from "./navigation-incidence.js";
import { navigationHash } from "./navigation-identity.js";
const terminalKey = (t: TerminalId) =>
  JSON.stringify([t.deviceUid, t.terminalKey]);
export function wiringHiddenIncidences(
  ir: Readonly<ElectricalIr>,
  chosen: ReadonlySet<string>,
  terminals: ReadonlyMap<string, TerminalId>,
) {
  const incidences = sourceIncidences(ir);
  const hidden = (key: string) =>
    incidences.filter((i) => {
      const id =
        i.element.kind === "cable_conductor"
          ? JSON.stringify({
              cableUid: i.element.cableUid,
              conductorId: i.element.conductorId,
            })
          : i.element.uid;
      return terminalKey(i.terminal) === key && !chosen.has(id);
    });
  const needs: DocumentNeedSeed[] = [...terminals].flatMap(([key, terminal]) =>
    hidden(key).length
      ? [
          {
            noteId: `wiring-incidence/${key}`,
            need: "conductor-incidence",
            requiredFacts: hidden(key).map((i) => ({
              kind: "conductor-incidence",
              ...i,
            })),
            requiredColumns: ["identity", "endpoints", "status"],
            subject: `${
              required(
                ir.devices.find((d) => d.uid === terminal.deviceUid),
                "Missing document source",
              ).designation
            }.${terminal.terminalKey}`,
            count: hidden(key).length,
          },
        ]
      : [],
  );
  return {
    needs,
    boundary: new Map([...terminals.keys()].map((k) => [k, hidden(k).length])),
  };
}
export function omittedTerminalNeed(
  ir: Readonly<ElectricalIr>,
  uid: string,
  drawn: readonly string[],
): DocumentNeedSeed | undefined {
  const device = required(
      ir.devices.find((d) => d.uid === uid),
      "Missing document source",
    ),
    type = required(
      ir.deviceTypes.find((t) => t.id === device.typeId),
      "Missing document source",
    );
  const omitted = type.terminals.filter((t) => !drawn.includes(t.key));
  return omitted.length
    ? {
        noteId: `wiring-terminals/${uid}`,
        need: "terminal-inventory",
        requiredFacts: omitted.map((t) => ({
          kind: "terminal-inventory",
          terminal: { deviceUid: uid, terminalKey: t.key },
        })),
        requiredColumns: ["identity", "connections", "status"],
        subject: device.designation,
        count: omitted.length,
      }
    : undefined;
}
export function communicationDocumentNeeds(
  ir: Readonly<ElectricalIr>,
  devices: readonly string[],
  medium: string,
  links: readonly string[],
): DocumentNeedSeed[] {
  return [
    {
      noteId: `communication-status/${navigationHash([devices, links])}`,
      need: "port-link-status",
      requiredFacts: devices.flatMap((deviceUid) =>
        Object.entries(
          required(
            ir.deviceTypes.find(
              (t) =>
                t.id ===
                required(
                  ir.devices.find((d) => d.uid === deviceUid),
                  "Missing document source",
                ).typeId,
            ),
            "Missing document source",
          ).ports ?? {},
        )
          .filter(([, p]) => p.medium === medium)
          .map(([portKey]) => ({
            kind: "port-link-status",
            deviceUid,
            portKey,
          })),
      ),
      requiredColumns: ["identity", "endpoints", "protocol", "status"],
      subject: "Port protocol, status and unconnected ports",
    },
  ];
}
export function directLoopDocumentNeeds(
  ir: Readonly<ElectricalIr>,
  cables: ReadonlySet<string>,
  devices: readonly string[],
): DocumentNeedSeed[] {
  if (!cables.size) return [];
  const needs: DocumentNeedSeed[] = [
    {
      noteId: "loop-core-details",
      need: "core-inventory",
      requiredFacts: [...cables].flatMap((cableUid) => {
        const cable = required(
          ir.cables.find((c) => c.uid === cableUid),
          "Missing document source",
        );
        return required(
          ir.cableTypes.find((t) => t.id === cable.typeId),
          "Missing document source",
        ).conductors.map((c) => ({
          kind: "core-inventory",
          cableUid,
          conductorId: c.id,
        }));
      }),
      requiredColumns: ["identity", "endpoints", "status"],
      subject: "Cable core details",
    },
  ];
  const relations = ir.relations.filter(
    (r) =>
      r.assembly &&
      (devices.includes(r.fromDeviceUid) || devices.includes(r.toDeviceUid)),
  );
  if (relations.length)
    needs.push({
      noteId: "loop-assembly-pin-maps",
      need: "assembly-pin-map",
      requiredFacts: relations.map((r) => ({
        kind: "assembly-pin-map",
        relationUid: r.uid,
      })),
      requiredColumns: ["identity", "endpoints", "status", "pin-map"],
      subject: "Assembly pin maps",
    });
  return needs;
}
