import {
  validateSourceDocument,
  type ParsedDocument,
  type SchemaRegistry,
} from "@thermite/schema";

export function validateProjectSource(
  registry: SchemaRegistry,
  document: ParsedDocument,
) {
  return validateSourceDocument(registry, document).map((diagnostic) =>
    diagnostic.code === "E011" && diagnostic.jsonPointer
      ? {
          ...diagnostic,
          message: `${diagnostic.message} Repair this source shape with a guarded patch. See thermite guide agent-requests (Repair schema errors through the guarded loop).`,
        }
      : diagnostic,
  );
}
