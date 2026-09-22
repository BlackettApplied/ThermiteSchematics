import type { DiagnosticCode } from "./diagnostic-catalog.js";

export interface RelatedDiagnosticLocation {
  file: string;
  line: number;
  column: number;
  note: string;
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: "error" | "warning";
  message: string;
  file: string;
  line: number;
  column: number;
  jsonPointer: string;
  uid?: string;
  related?: RelatedDiagnosticLocation[];
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
