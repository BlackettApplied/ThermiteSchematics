import type { DiagnosticAllowedValue } from "./diagnostic-alternatives.js";
import type { DiagnosticCode } from "./diagnostic-catalog.js";

export interface RelatedDiagnosticLocation {
  file: string;
  line: number;
  column: number;
  note: string;
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: "error" | "warning" | "info";
  message: string;
  file: string;
  line: number;
  column: number;
  jsonPointer: string;
  uid?: string;
  related?: RelatedDiagnosticLocation[];
  /** Valid alternatives for the rejected value: at most 50, in a stable order. */
  allowed?: DiagnosticAllowedValue[];
  /** Size of the complete valid set whenever `allowed` is present. */
  allowedCount?: number;
  /** Exact place to read the complete valid set when `allowed` is incomplete. */
  allowedLookup?: string;
  /** Raw ECMAScript regular expression the rejected string must match. */
  pattern?: string;
  /** Packet W906 inventory; schedules and indexes do not count as schematics. */
  devices?: {
    uid: string;
    designation: string;
    appearance: "reports-only" | "absent";
    reportSheets: number[];
  }[];
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function compareDiagnostics(
  left: Diagnostic,
  right: Diagnostic,
): number {
  return (
    compareText(left.file, right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    compareText(left.code, right.code)
  );
}

export function normalizeDiagnostics(
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  const sorted = [...diagnostics].sort(compareDiagnostics);
  const seen = new Set<string>();

  return sorted.filter((diagnostic) => {
    const key = JSON.stringify([
      diagnostic.code,
      diagnostic.file,
      diagnostic.jsonPointer,
    ]);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function normalizeDiagnosticFile(file: string): string {
  return file.replaceAll("\\", "/");
}
