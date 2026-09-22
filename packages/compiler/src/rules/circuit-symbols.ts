import { appendJsonPointer, type Diagnostic } from "@thermite/schema";

import type { IrDeviceType, IrDeviceTypeFunction } from "../expansion.js";
import type { ElectricalRule } from "./types.js";

type CircuitSymbol = NonNullable<IrDeviceType["circuitSymbols"]>[string];

/** Rendering metadata must agree with electrical facts; it never changes them. */
function acceptsMark(f: IrDeviceTypeFunction, mark: CircuitSymbol): boolean {
  const count = f.terminalKeys.length;
  switch (f.kind) {
    case "contact":
      if (count !== 2) return false;
      switch (mark) {
        case "contact-no":
        case "switch-no":
        case "pushbutton-no":
          return f.normal_state === "open";
        case "contact-nc":
        case "switch-nc":
        case "pushbutton-nc":
          return f.normal_state === "closed";
        case "breaker":
        case "overload":
        case "fuse":
          return true;
        default:
          return false;
      }
    case "coil":
      return count === 2 && (mark === "coil" || mark === "solenoid");
    case "load":
      return (
        ((count === 2 || count === 3) &&
          (mark === "motor" || mark === "heater" || mark === "load")) ||
        (count === 2 && (mark === "lamp" || mark === "winding"))
      );
    case "source":
      return (
        (count >= 1 && count <= 4 && mark === "source") ||
        (count === 2 && mark === "winding")
      );
    case "bus":
      return count === 1 && (mark === "terminal" || mark === "earth");
    case "channel":
      return (count === 1 || count === 2) && mark === "interface";
    case "other":
      return (
        (count >= 1 && count <= 8 && mark === "interface") ||
        (count === 2 && (mark === "thermocouple" || mark === "fuse"))
      );
    case "mechanism":
      return false;
  }
}

export const circuitSymbolsRule: ElectricalRule = {
  id: "E206",
  evaluate({ ir }) {
    const errors: Diagnostic[] = [];
    for (const type of ir.deviceTypes) {
      for (const [key, mark] of Object.entries(type.circuitSymbols ?? {}).sort(
        ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
      )) {
        const f = type.functions.find((candidate) => candidate.key === key);
        if (f && acceptsMark(f, mark)) continue;
        const relatedSource = f?.source ?? type.source;
        errors.push({
          ...(type.circuitSymbolSources?.[key] ?? {
            ...type.source,
            jsonPointer: appendJsonPointer(
              appendJsonPointer(type.source.jsonPointer, "circuitSymbols"),
              key,
            ),
          }),
          code: "E206",
          severity: "error",
          message: f
            ? `${type.id} circuitSymbols mark ${JSON.stringify(mark)} is incompatible with function ${JSON.stringify(key)} (${f.kind}, ${f.terminalKeys.length} terminals${f.kind === "contact" ? `, normally ${f.normal_state}` : ""}).`
            : `${type.id} circuitSymbols references undeclared function ${JSON.stringify(key)}.`,
          related: [
            {
              file: relatedSource.file,
              line: relatedSource.line,
              column: relatedSource.column,
              note: f
                ? `The declared function ${JSON.stringify(key)} determines the permitted kind, terminal count and contact state.`
                : `Device type ${JSON.stringify(type.id)} declares the available functions.`,
            },
          ],
        });
      }
    }
    return errors;
  },
};
