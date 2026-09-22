import type { Diagnostic } from "@thermite/schema";

import type { RuleContext } from "./context.js";
import { analyzeTerminalCompatibility } from "./terminal-compatibility.js";
import type { ElectricalRule } from "./types.js";

function displayTerminals(displays: readonly string[]): string {
  return displays.map((display) => JSON.stringify(display)).join(", ");
}

export const voltageTypeCompatibilityRule: ElectricalRule = {
  id: "E301",

  evaluate(context: RuleContext): Diagnostic[] {
    return analyzeTerminalCompatibility(context).voltageType.map(
      ({ effective, origin, terminals }) => {
        for (const { terminal } of terminals) {
          context.markVoltageTypeAffectedTerminal(terminal.id);
        }

        const effectiveVoltageType = effective.electrical.voltage_type;
        return {
          code: "E301",
          severity: "error",
          message:
            `Effective voltage type ${JSON.stringify(effectiveVoltageType)} is ` +
            `incompatible with terminal ratings at ${displayTerminals(
              terminals.map(({ display }) => display),
            )}.`,
          file: origin.source.file,
          line: origin.source.line,
          column: origin.source.column,
          jsonPointer: origin.source.jsonPointer,
          uid: origin.uid,
          related: terminals.map(({ terminal, display }) => ({
            file: terminal.source.file,
            line: terminal.source.line,
            column: terminal.source.column,
            note:
              `Terminal ${JSON.stringify(display)} is rated for voltage type ` +
              `${JSON.stringify(terminal.rating?.voltage_type)} here.`,
          })),
        };
      },
    );
  },
};
