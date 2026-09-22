import type { Diagnostic } from "@thermite/schema";

import { compareSourceRef } from "../ir.js";
import type { DirectTerminalAssignment, RuleContext } from "./context.js";
import type { ElectricalRule } from "./types.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareAssignment(
  left: DirectTerminalAssignment,
  right: DirectTerminalAssignment,
): number {
  return (
    compareSourceRef(left.source, right.source) ||
    compareText(left.uid, right.uid)
  );
}

export const exclusiveTerminalAssignmentRule: ElectricalRule = {
  id: "E201",

  evaluate(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const terminal of context.ir.terminals) {
      if (terminal.connectionPolicy !== "exclusive") {
        continue;
      }

      const assignments = context
        .conductiveElementIdsForTerminal(terminal.id)
        .filter((elementId) => !context.isInvalidCableConductor(elementId))
        .map((elementId) =>
          context.directTerminalAssignment(elementId, terminal.id),
        )
        .concat(context.partialCableAssignments(terminal.id))
        .sort(compareAssignment);

      const permitted = assignments[0];
      if (permitted === undefined || assignments.length === 1) {
        continue;
      }

      const displayedTerminal = context.displayTerminal(terminal.id);
      context.markExclusiveTerminal(terminal.id);

      for (const excess of assignments.slice(1)) {
        diagnostics.push({
          code: "E201",
          severity: "error",
          message:
            `Terminal ${JSON.stringify(displayedTerminal)} has connection policy ` +
            `"exclusive", but ${excess.display} is an excess direct conductive assignment.`,
          file: excess.source.file,
          line: excess.source.line,
          column: excess.source.column,
          jsonPointer: excess.source.jsonPointer,
          uid: excess.uid,
          related: [
            {
              file: terminal.source.file,
              line: terminal.source.line,
              column: terminal.source.column,
              note:
                `The library terminal ${JSON.stringify(displayedTerminal)} ` +
                `declares connection policy "exclusive" here.`,
            },
            {
              file: permitted.source.file,
              line: permitted.source.line,
              column: permitted.source.column,
              note: `Earlier permitted direct assignment from ${permitted.display} lands here.`,
            },
          ],
        });
      }
    }

    return diagnostics;
  },
};
