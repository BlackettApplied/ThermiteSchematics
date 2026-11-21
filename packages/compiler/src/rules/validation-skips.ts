import type { Diagnostic } from "@thermite/schema";
import { summarizeAffected } from "../diagnostic-summary.js";
import type { RuleContext } from "./context.js";
import { displayNet } from "./potential-assessment.js";

/** Report actual local gates after rule evaluation, once per project. */
export function skippedNetChecks(
  context: RuleContext,
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  const parts: string[] = [];
  const nets = (ids: ReadonlySet<string>) =>
    context.ir.nets
      .filter((n) => ids.has(n.id))
      .map((n) => displayNet(context, n));
  if (context.topologicallyAffectedNetIds.size) {
    const causes = [
      ...new Set(
        diagnostics
          .filter((d) => d.code === "E200" || d.code === "E201")
          .map((d) => d.code),
      ),
    ].sort();
    parts.push(
      `${causes.join("/")} topology gate: skipped E300, E301, E302, W902, W303, I304, I305 on ${summarizeAffected(nets(context.topologicallyAffectedNetIds), "net")}`,
    );
  }
  if (context.conflictingPotentialNetIds.size)
    parts.push(
      `E300 potential-conflict gate: skipped E301, E302 on ${summarizeAffected(nets(context.conflictingPotentialNetIds), "net")}`,
    );
  if (context.voltageTypeAffectedTerminalIds.size) {
    const terminals = context.ir.terminals
      .filter((t) => context.isVoltageTypeAffectedTerminal(t.id))
      .map((t) => context.displayTerminal(t.id));
    parts.push(
      `E301 voltage-type gate: skipped E302 on ${summarizeAffected(terminals, "terminal")}`,
    );
  }
  return parts.length
    ? [
        {
          ...context.ir.project.source,
          code: "I208",
          severity: "info",
          message: `Checks not completed: ${parts.join("; ")}.`,
        },
      ]
    : [];
}
