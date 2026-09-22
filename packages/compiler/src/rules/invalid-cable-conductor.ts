import type { Diagnostic } from "@thermite/schema";

import type { RuleContext } from "./context.js";
import type { ElectricalRule } from "./types.js";

export const invalidCableConductorRule: ElectricalRule = {
  id: "E200",

  evaluate(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const conductor of context.ir.cableConductors) {
      if (conductor.typeConductor !== null) {
        continue;
      }

      const cable = context.cable(conductor);
      const type = context.cableType(conductor);
      const availableIds = context.availableConductorIds(type);
      const displayedAvailableIds = context.displayIdList(availableIds);

      context.markInvalidCableConductor(conductor);
      diagnostics.push({
        code: "E200",
        severity: "error",
        message:
          `Cable ${JSON.stringify(cable.designation)} conductor ` +
          `${JSON.stringify(conductor.id.conductorId)} is not declared by ` +
          `selected cable type ${JSON.stringify(type.id)}. Available conductor ` +
          `IDs: ${displayedAvailableIds}.`,
        file: conductor.source.file,
        line: conductor.source.line,
        column: conductor.source.column,
        jsonPointer: conductor.source.jsonPointer,
        uid: cable.uid,
        related: [
          {
            file: type.source.file,
            line: type.source.line,
            column: type.source.column,
            note:
              `Selected cable type ${JSON.stringify(type.id)} is declared here. ` +
              `Available conductor IDs: ${displayedAvailableIds}.`,
          },
        ],
      });
    }

    // Unterminated cores are still authored assignments and must name a real core.
    for (const cable of context.ir.cables) {
      const type = context.cableTypesById.get(cable.typeId)!;
      for (const assignment of cable.assignments ?? []) {
        if (
          assignment.endpoints.every((endpoint) => endpoint !== null) ||
          type.conductors.some(({ id }) => id === assignment.id)
        )
          continue;
        for (const endpoint of assignment.endpoints) {
          if (endpoint !== null)
            context.markExclusiveTerminal(endpoint.terminal);
        }
        const available = context.displayIdList(
          context.availableConductorIds(type),
        );
        diagnostics.push({
          code: "E200",
          severity: "error",
          message: `Cable ${JSON.stringify(cable.designation)} conductor ${JSON.stringify(assignment.id)} is not declared by selected cable type ${JSON.stringify(type.id)}. Available conductor IDs: ${available}.`,
          ...assignment.source,
          uid: cable.uid,
          related: [
            {
              file: type.source.file,
              line: type.source.line,
              column: type.source.column,
              note: `Selected cable type ${JSON.stringify(type.id)} is declared here. Available conductor IDs: ${available}.`,
            },
          ],
        });
      }
    }

    return diagnostics;
  },
};
