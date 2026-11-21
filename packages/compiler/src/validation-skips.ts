import { normalizeDiagnostics, type Diagnostic } from "@thermite/schema";
import { summarizeAffected } from "./diagnostic-summary.js";
import { ELECTRICAL_RULES } from "./rules/registry.js";

const electricalChecks = `W111 and rules ${ELECTRICAL_RULES.map((r) => r.id).join(", ")}`;
const skippedChecksByStage = {
  "project loading/structural": `library-lock verification, reference resolution (E1xx), ${electricalChecks}`,
  structural: `library-lock verification, reference resolution (E1xx), ${electricalChecks}`,
  "library lock": `reference resolution (E1xx), ${electricalChecks}`,
  resolution: electricalChecks,
  // An unexpected failure does not establish which earlier checks completed.
  // Results after loading are unavailable; do not invent skipped work or claim
  // that lock verification/resolution supplied a complete result before a throw.
  "compilation tool failure": `library-lock verification, reference resolution (E1xx), ${electricalChecks}`,
} as const;

/** A failed prerequisite blocks all rule evaluation: no partial IR is built. */
export function withSkippedChecks(
  stage: keyof typeof skippedChecksByStage,
  diagnostics: readonly Diagnostic[],
  source?: Pick<Diagnostic, "file" | "line" | "column" | "jsonPointer">,
  completionUnknown = false,
): Diagnostic[] {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const anchor = source ?? errors[0];
  if (!anchor || !errors.length) return [...diagnostics];
  const causes = [...new Set(errors.map((d) => d.code))].sort().join(", ");
  const affected = errors.map(
    (d) =>
      `${d.uid ? `uid ${d.uid} at ` : ""}${d.file}:${d.line}:${d.column}${d.jsonPointer === "" ? "" : ` ${d.jsonPointer}`}`,
  );
  return normalizeDiagnostics([
    ...diagnostics,
    {
      file: anchor.file,
      line: anchor.line,
      column: anchor.column,
      jsonPointer: anchor.jsonPointer,
      code: "I208",
      severity: "info",
      message: `Checks not completed: ${stage} gate (${causes}); ${completionUnknown ? "no complete results available for" : "skipped"} ${skippedChecksByStage[stage]} for the whole project. Blocking objects/locations (${summarizeAffected(affected)}); ${completionUnknown ? "the failed stage supplied no trustworthy validation result" : "net IDs are unavailable before trustworthy IR exists"}.`,
    },
  ]);
}
