import type { Diagnostic } from "@thermite/schema";
import type { ElectricalRule } from "./types.js";
import type { ElectricalIr } from "../ir.js";
type SourceRef = ElectricalIr["deviceTypes"][number]["source"];

/** Connector occupancy and documentary pin identities only; never electrical continuity. */
export const connectorAssembliesRule: ElectricalRule = {
  id: "E207",
  evaluate({ ir }) {
    const diagnostics: Diagnostic[] = [];
    const error = (
      source: SourceRef,
      message: string,
      related: SourceRef = source,
    ) =>
      diagnostics.push({
        ...source,
        ...(ir.relations.find((r) => r.source === source)
          ? { uid: ir.relations.find((r) => r.source === source)!.uid }
          : {}),
        code: "E207",
        severity: "error",
        message,
        related: [
          {
            file: related.file,
            line: related.line,
            column: related.column,
            note: "Connector definition or conflicting assembly is declared here.",
          },
        ],
      });
    const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
    const devices = new Map(ir.devices.map((d) => [d.uid, d]));
    for (const type of ir.deviceTypes) {
      for (const [name, port] of Object.entries(type.connectorPorts ?? {})) {
        if (Object.hasOwn(type.ports ?? {}, name))
          error(
            type.source,
            `${type.id}.${name} is declared as both a communication and connector port.`,
          );
        for (const [pin, definition] of Object.entries(port.pins ?? {}))
          if (
            definition.terminal !== undefined &&
            !type.terminals.some((t) => t.key === definition.terminal)
          )
            error(
              type.source,
              `${type.id}.${name} pin ${pin} references undeclared terminal ${definition.terminal}.`,
            );
      }
    }
    const occupied = new Map<string, (typeof ir.relations)[number]>();
    for (const relation of [...ir.relations].sort((a, b) =>
      a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0,
    )) {
      const assembly = relation.assembly;
      if (!assembly) continue;
      const name = relation.designation ?? relation.uid;
      if (relation.connection)
        error(
          relation.source,
          `${name} cannot declare both assembly and communication connection.`,
        );
      if (relation.verb !== "associated_with")
        error(
          relation.source,
          `${name}: a connector assembly must use associated_with.`,
        );
      if (relation.fromDeviceUid === relation.toDeviceUid)
        error(
          relation.source,
          `${name}: an assembly must connect different devices.`,
        );
      if (assembly.kind === "cable" && !assembly.cable)
        error(
          relation.source,
          `${name}: a cable assembly requires a cable specification.`,
        );
      if (assembly.kind !== "cable" && assembly.cable)
        error(
          relation.source,
          `${name}: only a cable assembly accepts cable metadata.`,
        );
      if (
        assembly.pinMapping.status !==
        (assembly.kind === "cap" ? "not-applicable" : "unresolved")
      )
        error(
          relation.source,
          `${name}: cap mappings are not-applicable; cable and direct mappings must explicitly remain unresolved.`,
        );
      for (const [uid, portKey] of [
        [relation.fromDeviceUid, assembly.fromPort],
        [relation.toDeviceUid, assembly.toPort],
      ] as const) {
        const device = devices.get(uid)!,
          type = types.get(device.typeId)!;
        if (!Object.hasOwn(type.connectorPorts ?? {}, portKey)) {
          error(
            relation.source,
            `${device.designation}.${portKey} is not a declared connector port.`,
            type.source,
          );
          continue;
        }
        const key = JSON.stringify([uid, portKey]),
          previous = occupied.get(key);
        if (previous)
          error(
            relation.source,
            `${device.designation}.${portKey} is occupied by both ${previous.designation ?? previous.uid} and ${name}.`,
            previous.source,
          );
        else occupied.set(key, relation);
      }
    }
    return diagnostics;
  },
};
