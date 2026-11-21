import type { RenderOutcome } from "../../types.js";
import { failure } from "../../packet/errors.js";
import type { TitleDiagnostic } from "./model.js";
/** Keep title-field text and capacity failures distinct from request errors. */
export function titleFailure(
  diagnostics: readonly TitleDiagnostic[],
): RenderOutcome<never> {
  const first = diagnostics[0];
  const message = diagnostics.map((d) => d.message).join("\n");
  if (first?.code === "R005")
    return {
      ok: false,
      error: {
        code: "R005",
        root: "packet",
        ownerKind: "title-field",
        ownerId: first.ownerId ?? first.jsonPointer,
        field: first.field ?? first.jsonPointer,
        reason: first.reason ?? "unsupported-glyph",
        message,
        details: { titleDiagnostics: diagnostics },
      },
    };
  return failure(
    first?.reason === "unprintable-layout"
      ? "unprintable-layout"
      : "invalid-packet",
    message,
    { ...first?.details, titleDiagnostics: diagnostics },
  );
}
