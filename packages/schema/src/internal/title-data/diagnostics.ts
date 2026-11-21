import type { Diagnostic } from "../../diagnostics.js";
export interface TitleDiagnostic extends Omit<Diagnostic, "code"> {
  readonly code: Diagnostic["code"] | "R005" | "R006";
  readonly reason?: string;
  readonly ownerKind?: "title-field";
  readonly ownerId?: string;
  readonly field?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
export interface Result<T> {
  readonly value?: T;
  readonly diagnostics: readonly TitleDiagnostic[];
}
