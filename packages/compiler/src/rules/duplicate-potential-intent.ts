import type { Diagnostic } from "@thermite/schema";

import type { RuleContext } from "./context.js";
import { analyzePotentialDeclarations } from "./potential-analysis.js";
import type { ElectricalRule } from "./types.js";

export const duplicatePotentialIntentRule: ElectricalRule = {
  id: "W902",

  evaluate(context: RuleContext): Diagnostic[] {
    return analyzePotentialDeclarations(context).duplicates.map(
      ({ later, earliestExactDuplicate }) => ({
        code: "W902",
        severity: "warning",
        message:
          `Potential declaration ${JSON.stringify(later.name)} exactly duplicates ` +
          "an earlier declaration's complete intent on the same net.",
        file: later.source.file,
        line: later.source.line,
        column: later.source.column,
        jsonPointer: later.source.jsonPointer,
        uid: later.uid,
        related: [
          {
            file: earliestExactDuplicate.source.file,
            line: earliestExactDuplicate.source.line,
            column: earliestExactDuplicate.source.column,
            note:
              `Earliest exact duplicate declaration uid ` +
              `${JSON.stringify(earliestExactDuplicate.uid)} is here.`,
          },
        ],
      }),
    );
  },
};
