import { required } from "../presentation/util.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type { DocumentFact } from "./document-types.js";
import { printedPortEndpoint } from "@thermite/query";
export function documentRowLabel(
  ir: Readonly<ElectricalIr>,
  facts: readonly DocumentFact[],
  fallback: string,
): string {
  const endpoint = (t: TerminalId) =>
    `${
      required(
        ir.devices.find((d) => d.uid === t.deviceUid),
        "Missing document source",
      ).designation
    }.${t.terminalKey}`;
  const first = facts[0];
  if (first?.kind === "terminal-inventory") return endpoint(first.terminal);
  if (first?.kind === "conductor-incidence") {
    const id = first.element;
    if (id.kind === "cable_conductor")
      return `${
        required(
          ir.cables.find((c) => c.uid === id.cableUid),
          "Missing document source",
        ).designation
      }/${id.conductorId}`;
    const conductor = required(
      [...ir.wires, ...ir.jumpers].find((w) => w.uid === id.uid),
      "Missing document source",
    );
    return (
      conductor.designation ??
      conductor.endpoints.map((e) => endpoint(e.terminal)).join(" ↔ ")
    );
  }
  if (first?.kind === "connector-port-status")
    return `${
      required(
        ir.devices.find((d) => d.uid === first.deviceUid),
        "Missing connector owner",
      ).designation
    } / ${first.portKey}`;
  if (first?.kind === "core-inventory")
    return `${
      required(
        ir.cables.find((c) => c.uid === first.cableUid),
        "Missing document source",
      ).designation
    }/${first.conductorId}`;
  if (
    first?.kind === "assembly-pin-map" ||
    first?.kind === "port-link-status"
  ) {
    return relationLabel(ir, first) ?? fallback;
  }

  return fallback;
}

function relationLabel(
  ir: Readonly<ElectricalIr>,
  first: Extract<
    DocumentFact,
    { kind: "assembly-pin-map" | "port-link-status" }
  >,
): string | undefined {
  const relation =
    first.kind === "assembly-pin-map"
      ? ir.relations.find((r) => r.uid === first.relationUid)
      : ir.relations.find(
          (r) =>
            r.connection &&
            ((r.fromDeviceUid === first.deviceUid &&
              r.connection.fromPort === first.portKey) ||
              (r.toDeviceUid === first.deviceUid &&
                r.connection.toPort === first.portKey)),
        );
  if (relation?.designation) return relation.designation;
  if (first.kind === "port-link-status")
    return printedPortEndpoint(ir, first.deviceUid, first.portKey, "identity");
  if (relation?.assembly)
    return `${
      required(
        ir.devices.find((d) => d.uid === relation.fromDeviceUid),
        "Missing assembly end",
      ).designation
    }.${relation.assembly.fromPort} ↔ ${
      required(
        ir.devices.find((d) => d.uid === relation.toDeviceUid),
        "Missing assembly end",
      ).designation
    }.${relation.assembly.toPort}`;
}
