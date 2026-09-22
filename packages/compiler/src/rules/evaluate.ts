import { normalizeDiagnostics, type Diagnostic } from "@thermite/schema";

import type { ElectricalIr } from "../ir.js";
import { createRuleContext } from "./context.js";
import { ELECTRICAL_RULES } from "./registry.js";

export function evaluateRules(ir: ElectricalIr): Diagnostic[] {
  const context = createRuleContext(ir);
  const diagnostics: Diagnostic[] = [];

  for (const rule of ELECTRICAL_RULES) {
    for (const diagnostic of rule.evaluate(context)) {
      if (diagnostic.code !== rule.id) {
        throw new Error(
          `Electrical rule ${rule.id} emitted diagnostic ${diagnostic.code}.`,
        );
      }
      diagnostics.push(diagnostic);
    }
  }

  return normalizeDiagnostics(diagnostics);
}
