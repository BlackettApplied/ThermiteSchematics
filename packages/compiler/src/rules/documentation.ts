import { type Diagnostic } from "@thermite/schema";
import type { ElectricalRule } from "./types.js";

export const channelAssignmentsRule: ElectricalRule = {
  id: "E202",
  evaluate({ ir }) {
    const errors: Diagnostic[] = [];
    const addresses = new Map<string, string>();
    for (const device of ir.devices) {
      if (!device.io) continue;
      const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
      const related = [
        {
          file: type.source.file,
          line: type.source.line,
          column: type.source.column,
          note: `Device type ${JSON.stringify(type.id)} declares the valid channel functions.`,
        },
      ];
      const functions = ir.functions.filter(
        (f) => f.id.deviceUid === device.uid && f.kind === "channel",
      );
      for (const [key, assignment] of Object.entries(device.io.channels).sort(
        ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
      )) {
        if (!assignment) continue;
        let message: string | undefined;
        if (!functions.some((f) => f.id.functionKey === key))
          message = `${device.designation}.${key} is not a declared I/O channel.`;
        else if (assignment.address) {
          const id = JSON.stringify([
            device.io.addressSpace,
            assignment.address.toUpperCase(),
          ]);
          const previous = addresses.get(id);
          if (previous)
            message = `Address ${assignment.address} in ${device.io.addressSpace} is assigned to both ${previous} and ${device.designation}.${key}.`;
          else addresses.set(id, `${device.designation}.${key}`);
        }
        if (message)
          errors.push({
            ...device.source,
            uid: device.uid,
            code: "E202",
            severity: "error",
            message,
            related,
          });
      }
    }
    return errors;
  },
};
export const terminalOrderRule: ElectricalRule = {
  id: "E203",
  evaluate({ ir }) {
    return ir.deviceTypes.flatMap((type) => {
      const order = type.terminalOrder;
      if (
        !order ||
        (order.length === type.terminals.length &&
          new Set(order).size === order.length &&
          order.every((k) => type.terminals.some((t) => t.key === k)))
      )
        return [];
      return [
        {
          ...type.source,
          related: type.terminals.map((t) => ({
            file: t.source.file,
            line: t.source.line,
            column: t.source.column,
            note: `Declared terminal ${JSON.stringify(t.key)} must appear once in the order.`,
          })),
          code: "E203" as const,
          severity: "error" as const,
          message: `${type.id} terminalOrder must list every declared terminal exactly once.`,
        },
      ];
    });
  },
};
