import { type Diagnostic } from "@thermite/schema";
import type { ElectricalRule } from "./types.js";

/** Port links describe communication topology; they never join electrical nets. */
export const communicationConnectionsRule: ElectricalRule = {
  id: "E204",
  evaluate({ ir }) {
    const diagnostics: Diagnostic[] = [];
    const devices = new Map(ir.devices.map((d) => [d.uid, d]));
    const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
    const occupied = new Map<string, (typeof ir.relations)[number]>();
    for (const link of [...ir.relations].sort((a, b) =>
      a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0,
    )) {
      const c = link.connection;
      if (!c) continue;
      const error = (
        message: string,
        related = link.source,
        note = `Communication relation ${JSON.stringify(link.designation ?? link.uid)} is declared here.`,
      ) => {
        diagnostics.push({
          ...link.source,
          uid: link.uid,
          code: "E204",
          severity: "error",
          message,
          related: [
            {
              file: related.file,
              line: related.line,
              column: related.column,
              note,
            },
          ],
        });
      };
      if (link.verb !== "associated_with")
        error("A communication connection must use associated_with.");
      if (link.fromDeviceUid === link.toDeviceUid)
        error("A physical communication link must connect different devices.");
      for (const [uid, key] of [
        [link.fromDeviceUid, c.fromPort],
        [link.toDeviceUid, c.toPort],
      ] as const) {
        const device = devices.get(uid)!;
        const type = types.get(device.typeId)!;
        const port = type.ports?.[key];
        if (!port) {
          error(
            `${device.designation}.${key} is not a declared communication port.`,
            type.source,
            `Device type ${JSON.stringify(type.id)} declares the valid communication ports.`,
          );
          continue;
        }
        if (port.medium !== c.medium)
          error(
            `${device.designation}.${key} uses ${port.medium}, not ${c.medium}.`,
            type.source,
            `Device type ${JSON.stringify(type.id)} declares this port medium.`,
          );
        const identity = JSON.stringify([uid, key]);
        const previous = occupied.get(identity);
        if (previous)
          error(
            `${device.designation}.${key} is occupied by both ${previous.designation ?? previous.uid} and ${link.designation ?? link.uid}.`,
            previous.source,
            `Connection ${JSON.stringify(previous.designation ?? previous.uid)} also occupies this port.`,
          );
        else occupied.set(identity, link);
      }
    }
    return diagnostics;
  },
};
