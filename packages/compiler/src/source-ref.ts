import { normalizeDiagnosticFile } from "@thermite/schema";
import type { LoadedDocument } from "./loader.js";
import type { SourceRef } from "./resolution.js";

export function sourceRef(
  document: LoadedDocument<unknown>,
  jsonPointer: string,
): SourceRef {
  const location = document.nodes.get(jsonPointer)?.value;
  return {
    file: normalizeDiagnosticFile(document.file),
    line: location?.line ?? 1,
    column: location?.column ?? 1,
    jsonPointer,
  };
}
