import type { Diagnostic } from "@thermite/schema";

const ANSI_RED = "\u001b[31m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_RESET = "\u001b[0m";

function colorize(text: string, color: string, enabled: boolean): string {
  return enabled ? `${color}${text}${ANSI_RESET}` : text;
}

export function formatHumanDiagnostics(
  diagnostics: readonly Diagnostic[],
  color = false,
): string {
  const lines: string[] = [];
  let previousFile: string | undefined;

  for (const diagnostic of diagnostics) {
    if (previousFile !== undefined && previousFile !== diagnostic.file) {
      lines.push("");
    }

    const location = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`;
    const severityColor =
      diagnostic.severity === "error"
        ? ANSI_RED
        : diagnostic.severity === "warning"
          ? ANSI_YELLOW
          : ANSI_CYAN;
    lines.push(
      `${colorize(location, ANSI_CYAN, color)} ${colorize(diagnostic.code, severityColor, color)} ${diagnostic.message}`,
    );
    previousFile = diagnostic.file;
  }

  return lines.join("\n");
}
