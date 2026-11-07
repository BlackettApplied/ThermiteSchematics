import { type Diagnostic } from "@thermite/schema";
import type { ElectricalRule } from "./types.js";

export const channelAssignmentsRule: ElectricalRule = {
  id: "E202",
  evaluate({ ir }) {
    const errors: Diagnostic[] = [];
    const addresses = new Map<string, string>();
    for (const device of ir.devices) {
      if (!device.io && !device.connectorIo) continue;
      const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
      const related = [
        {
          file: type.source.file,
          line: type.source.line,
          column: type.source.column,
          note: `Device type ${JSON.stringify(type.id)} declares the valid channel functions and connector ports.`,
        },
      ];
      const functions = ir.functions.filter(
        (f) => f.id.deviceUid === device.uid && f.kind === "channel",
      );
      const groups = [
        {
          kind: "channel",
          assignments: device.io?.channels ?? {},
          addressSpace: device.io?.addressSpace,
        },
        {
          kind: "connector port",
          assignments: device.connectorIo?.ports ?? {},
          addressSpace: device.connectorIo?.addressSpace,
        },
      ];
      if (device.connectorIo && !Object.keys(type.connectorPorts ?? {}).length)
        errors.push({
          ...device.source,
          uid: device.uid,
          code: "E202",
          severity: "error",
          message: `${device.designation} declares connector I/O but its type has no connector ports.`,
          related,
        });
      for (const group of groups)
        for (const [key, assignment] of Object.entries(group.assignments).sort(
          ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
        )) {
          if (!assignment) continue;
          let message: string | undefined;
          const identity = `${device.designation}.${key}${group.kind === "channel" ? "" : " (connector port)"}`;
          const declared =
            group.kind === "channel"
              ? functions.some((f) => f.id.functionKey === key)
              : Object.hasOwn(type.connectorPorts ?? {}, key);
          if (!declared)
            message = `${device.designation}.${key} is not a declared I/O ${group.kind}.`;
          else if (assignment.address) {
            if (!group.addressSpace)
              message = `${identity} has an address but no authored address space.`;
            else {
              const id = JSON.stringify([
                group.addressSpace,
                assignment.address.toUpperCase(),
              ]);
              const previous = addresses.get(id);
              if (previous)
                message = `Address ${assignment.address} in ${group.addressSpace} is assigned to both ${previous} and ${identity}.`;
              else addresses.set(id, identity);
            }
          }
          if (message)
            errors.push({
              ...device.source,
              uid: device.uid,
              code: "E202",
              severity: "error",
              message,
              related:
                group.kind === "channel"
                  ? [
                      {
                        ...related[0]!,
                        note: `Device type ${JSON.stringify(type.id)} declares the valid channel functions.`,
                      },
                    ]
                  : related,
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
