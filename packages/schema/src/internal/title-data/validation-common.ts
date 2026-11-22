import { normalizeDiagnosticFile } from "../../diagnostics.js";
import type { JsonPointerNodeMap, JsonValue } from "../../parser.js";
import type { TitleDiagnostic } from "./diagnostics.js";
export class Issues {
  readonly diagnostics: TitleDiagnostic[] = [];
  constructor(
    readonly file: string,
    readonly nodes: JsonPointerNodeMap = new Map(),
  ) {}
  add(
    code: TitleDiagnostic["code"],
    pointer: string,
    message: string,
    reason?: string,
    details?: Readonly<Record<string, unknown>>,
  ): void {
    let anchor = pointer;
    while (!this.nodes.has(anchor) && anchor)
      anchor = anchor.slice(0, anchor.lastIndexOf("/"));
    const location = this.nodes.get(anchor)?.value;
    this.diagnostics.push({
      code,
      severity: "error",
      file: normalizeDiagnosticFile(this.file),
      line: location?.line ?? 1,
      column: location?.column ?? 1,
      jsonPointer: pointer,
      message,
      ...(reason
        ? code === "R006"
          ? reason === "unprintable-layout"
            ? { reason, ...(details === undefined ? {} : { details }) }
            : { reason: "invalid-packet", details: { reason, ...details } }
          : { reason }
        : {}),
      ...(code === "R005"
        ? {
            ownerKind: "title-field" as const,
            ownerId: pointer,
            field: pointer,
          }
        : {}),
    });
  }
  sorted(): TitleDiagnostic[] {
    const seen = new Set<string>();
    return [...this.diagnostics]
      .sort(
        (a, b) =>
          (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
          a.line - b.line ||
          a.column - b.column ||
          (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
      )
      .filter((d) => {
        const key = JSON.stringify([d.code, d.file, d.jsonPointer]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
}
export function isObject(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month - 1] ?? 0)
  );
}
export function checkLiteral(
  value: unknown,
  slot: string,
  pointer: string,
  issues: Issues,
): void {
  if (typeof value !== "string") return;
  const limit = titleLiteralLimit(slot);
  if (!value.trim() || [...value].length > limit)
    issues.add(
      "E013",
      pointer,
      `Title ${slot} must be nonblank and at most ${limit} code points.`,
    );
  if (slot === "date" && !validDate(value))
    issues.add(
      "E013",
      pointer,
      "Title date must be a valid Gregorian YYYY-MM-DD date.",
    );
}

/** Existing semantic code-point limits, shared with the schema parity controls. */
export function titleLiteralLimit(slot: string): number {
  return slot === "drawingNumber"
    ? 128
    : ["customer", "drawnBy", "checkedBy", "approvedBy"].includes(slot)
      ? 80
      : slot === "revision"
        ? 128
        : 160;
}
