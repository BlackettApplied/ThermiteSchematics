import type { Diagnostic } from "@thermite/schema";

import type { RuleContext } from "./context.js";
import { analyzeTerminalCompatibility } from "./terminal-compatibility.js";
import type { ElectricalRule } from "./types.js";

function displayTerminals(displays: readonly string[]): string {
  return displays.map((display) => JSON.stringify(display)).join(", ");
}

export const nominalVoltageClassRule: ElectricalRule = {
  id: "E302",

  evaluate(context: RuleContext): Diagnostic[] {
    return analyzeTerminalCompatibility(context)
      .nominalVoltage.map(({ effective, origin, terminals }) => {
        const unsuppressed = terminals.filter(
          ({ terminal }) => !context.isVoltageTypeAffectedTerminal(terminal.id),
        );

        return {
          code: "E302",
          severity: "error",
          message: `Effective nominal voltage ${String(
            effective.electrical.nominal_voltage,
          )} V is incompatible with terminal ratings at ${displayTerminals(
            unsuppressed.map(({ display }) => display),
          )}.`,
          file: origin.source.file,
          line: origin.source.line,
          column: origin.source.column,
          jsonPointer: origin.source.jsonPointer,
          uid: origin.uid,
          related: unsuppressed.map(({ terminal, display }) => ({
            file: terminal.source.file,
            line: terminal.source.line,
            column: terminal.source.column,
            note:
              `Terminal ${JSON.stringify(display)} is rated for nominal voltage ` +
              `${String(terminal.rating?.nominal_voltage)} V here.`,
          })),
        } satisfies Diagnostic;
      })
      .filter(({ related }) => related.length > 0);
  },
};
