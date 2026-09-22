import type { Diagnostic } from "@thermite/schema";

import type { RuleContext } from "./context.js";
import { analyzePotentialDeclarations } from "./potential-analysis.js";
import type { ElectricalRule } from "./types.js";

function displayFields(fields: readonly string[]): string {
  const noun = fields.length === 1 ? "field" : "fields";
  return `${noun} ${fields.map((field) => JSON.stringify(field)).join(", ")}`;
}

export const potentialConflictRule: ElectricalRule = {
  id: "E300",

  evaluate(context: RuleContext): Diagnostic[] {
    return analyzePotentialDeclarations(context).conflicts.map(
      ({ later, earlier, fields }) => ({
        code: "E300",
        severity: "error",
        message:
          `Potential declaration ${JSON.stringify(later.name)} conflicts with ` +
          `earlier declarations on the same net in ${displayFields(fields)}.`,
        file: later.source.file,
        line: later.source.line,
        column: later.source.column,
        jsonPointer: later.source.jsonPointer,
        uid: later.uid,
        related: earlier.map(({ potential, fields: earlierFields }) => ({
          file: potential.source.file,
          line: potential.source.line,
          column: potential.source.column,
          note:
            `Earlier potential declaration uid ${JSON.stringify(potential.uid)} ` +
            `conflicts here in ${displayFields(earlierFields)}.`,
        })),
      }),
    );
  },
};
