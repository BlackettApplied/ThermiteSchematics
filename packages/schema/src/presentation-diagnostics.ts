import { validatePresentationStructure } from "./internal/title-data/presentation.js";
import { isObject } from "./internal/title-data/validation-common.js";
import type { Ajv2020, ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import { mapAjvErrors, type AjvDiagnosticContext } from "./ajv-validation.js";
import type { Diagnostic } from "./diagnostics.js";
import type { JsonValue } from "./parser.js";

/** Known formats use their own validators. Only discriminator failures reach here. */
export function validatePresentationDiscriminator(
  validate: ValidateFunction,
  value: JsonValue,
  context: Omit<AjvDiagnosticContext, "value">,
): Diagnostic[] {
  if (validate(value)) return [];
  const errors = validate.errors ?? [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const type = errors.find(
      (error) => error.keyword === "type" && error.instancePath === "",
    );
    if (type === undefined)
      throw new Error("Missing presentation root type error.");
    return mapAjvErrors([type], { ...context, value });
  }
  const union = errors.find(
    (error) => error.keyword === "anyOf" && error.instancePath === "",
  );
  if (union === undefined)
    throw new Error("Missing presentation format error.");
  // The accepted versions come from the canonical schema, never a parallel list.
  const schema = validate.schema as {
    $defs: {
      legacy: { properties: { format: { enum: string[] } } };
      compact: { properties: { format: { const: string } } };
    };
  };
  const allowedValues = [
    ...schema.$defs.legacy.properties.format.enum,
    schema.$defs.compact.properties.format.const,
  ];
  const error: ErrorObject = {
    ...union,
    params: { ...union.params, discriminator: "format", allowedValues },
  };
  return mapAjvErrors([error], { ...context, value });
}

/** Known legacy formats retain the registry's existing strict validator. */
export function validatePresentationEntity(
  ajv: Ajv2020,
  value: JsonValue,
  context: Omit<AjvDiagnosticContext, "value">,
): Diagnostic[] | undefined {
  if (isObject(value) && value.format === "project-presentation/0.3")
    return compactPresentationDiagnostics(value, context);
  if (
    isObject(value) &&
    (value.format === "project-presentation/0.1" ||
      value.format === "project-presentation/0.2")
  )
    return undefined;
  const root = ajv.getSchema(
    "https://thermiteschematics.com/schemas/0.1/project-presentation.schema.json",
  );
  if (root === undefined) throw new Error("Missing presentation schema.");
  return validatePresentationDiscriminator(root, value, context);
}

function compactPresentationDiagnostics(
  value: JsonValue,
  context: Omit<AjvDiagnosticContext, "value">,
): Diagnostic[] {
  return validatePresentationStructure(
    value,
    context.file,
    context.nodes,
  ).diagnostics.map((diagnostic) => {
    // Public compiler diagnostics retain the established Diagnostic shape.
    const publicDiagnostic = {
      ...diagnostic,
      code: diagnostic.code === "R005" ? "E013" : diagnostic.code,
    } as Diagnostic & Record<string, unknown>;
    for (const key of ["reason", "ownerKind", "ownerId", "field", "details"])
      delete publicDiagnostic[key];
    return publicDiagnostic;
  });
}
