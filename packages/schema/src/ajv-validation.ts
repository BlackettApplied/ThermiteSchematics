import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import {
  DIAGNOSTIC_CATALOG,
  type DiagnosticCode,
} from "./diagnostic-catalog.js";
import {
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
} from "./diagnostics.js";
import { appendJsonPointer, splitJsonPointer } from "./json-pointer.js";
import type {
  JsonNodeLocation,
  JsonPointerNodeMap,
  JsonValue,
} from "./parser.js";

export const AJV_KEYWORD_TO_CODE = {
  required: "E010",
  type: "E011",
  additionalProperties: "E012",
  pattern: "E013",
  format: "E013",
  propertyNames: "E013",
  minLength: "E013",
  maxLength: "E013",
  enum: "E014",
  const: "E014",
  minItems: "E015",
  maxItems: "E015",
  minimum: "E015",
  maximum: "E015",
} as const satisfies Record<string, DiagnosticCode>;

export type MappedAjvKeyword = keyof typeof AJV_KEYWORD_TO_CODE;

export class UnmappedAjvKeywordError extends Error {
  readonly keyword: string;

  constructor(keyword: string) {
    super(
      `Ajv keyword ${JSON.stringify(keyword)} has no diagnostic-code mapping.`,
    );
    this.name = "UnmappedAjvKeywordError";
    this.keyword = keyword;
  }
}

export interface AjvDiagnosticContext {
  file: string;
  nodes: JsonPointerNodeMap;
  value?: JsonValue;
}

interface ErrorTarget {
  pointer: string;
  anchor: "key" | "value";
  fallbackPointer: string;
  propertyName?: string;
}

export function createAjv2020(schemas: readonly AnySchema[] = []): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  for (const schema of schemas) {
    ajv.addSchema(schema);
  }

  return ajv;
}

export function diagnosticCodeForAjvKeyword(
  keyword: string,
): (typeof AJV_KEYWORD_TO_CODE)[MappedAjvKeyword] {
  if (!Object.hasOwn(AJV_KEYWORD_TO_CODE, keyword)) {
    throw new UnmappedAjvKeywordError(keyword);
  }

  return AJV_KEYWORD_TO_CODE[keyword as MappedAjvKeyword];
}

function stringParameter(error: ErrorObject, name: string): string | undefined {
  const value = (error.params as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function propertyNameFromError(error: ErrorObject): string | undefined {
  const directValue = (error as ErrorObject & { propertyName?: unknown })
    .propertyName;

  if (typeof directValue === "string") {
    return directValue;
  }

  return stringParameter(error, "propertyName");
}

function targetForError(error: ErrorObject): ErrorTarget {
  if (error.keyword === "required") {
    const missingProperty = stringParameter(error, "missingProperty") ?? "";
    return {
      pointer: appendJsonPointer(error.instancePath, missingProperty),
      anchor: "value",
      fallbackPointer: error.instancePath,
    };
  }

  if (error.keyword === "additionalProperties") {
    const additionalProperty =
      stringParameter(error, "additionalProperty") ?? "";
    return {
      pointer: appendJsonPointer(error.instancePath, additionalProperty),
      anchor: "key",
      fallbackPointer: error.instancePath,
      propertyName: additionalProperty,
    };
  }

  const propertyName = propertyNameFromError(error);

  if (error.keyword === "propertyNames" || propertyName !== undefined) {
    const resolvedPropertyName = propertyName ?? "";
    return {
      pointer: appendJsonPointer(error.instancePath, resolvedPropertyName),
      anchor: "key",
      fallbackPointer: error.instancePath,
      propertyName: resolvedPropertyName,
    };
  }

  return {
    pointer: error.instancePath,
    anchor: "value",
    fallbackPointer: error.instancePath,
  };
}

function findValueAnchor(
  nodes: JsonPointerNodeMap,
  pointer: string,
): JsonNodeLocation | undefined {
  let candidate = pointer;

  while (true) {
    const node = nodes.get(candidate)?.value;

    if (node !== undefined) {
      return node;
    }

    if (candidate === "") {
      return undefined;
    }

    candidate = candidate.slice(0, candidate.lastIndexOf("/"));
  }
}

function locationForTarget(
  target: ErrorTarget,
  nodes: JsonPointerNodeMap,
): { line: number; column: number } {
  if (target.anchor === "key") {
    const key = nodes.get(target.pointer)?.key;

    if (key !== undefined) {
      return { line: key.line, column: key.column };
    }
  }

  const value = findValueAnchor(nodes, target.fallbackPointer);
  return value === undefined
    ? { line: 1, column: 1 }
    : { line: value.line, column: value.column };
}

function describeExpectedType(error: ErrorObject): string {
  const expected = (error.params as Record<string, unknown>).type;

  if (Array.isArray(expected)) {
    return expected.join(" or ");
  }

  return typeof expected === "string" ? expected : "the required type";
}

function messageForError(
  error: ErrorObject,
  keyword: MappedAjvKeyword,
  target: ErrorTarget,
): string {
  if (target.propertyName !== undefined && keyword !== "additionalProperties") {
    return `Malformed property name ${JSON.stringify(target.propertyName)}.`;
  }

  switch (keyword) {
    case "required":
      return `Missing required property ${JSON.stringify(
        stringParameter(error, "missingProperty") ?? "",
      )}.`;
    case "type":
      return `Expected ${describeExpectedType(error)} value.`;
    case "additionalProperties":
      return `Unknown property ${JSON.stringify(
        stringParameter(error, "additionalProperty") ?? "",
      )}.`;
    case "pattern":
      return "String value does not match the required pattern.";
    case "format":
      return `String value does not match required format ${JSON.stringify(
        stringParameter(error, "format") ?? "",
      )}.`;
    case "propertyNames":
      return "Malformed property name.";
    case "minLength":
      return "String value is shorter than allowed.";
    case "maxLength":
      return "String value is longer than allowed.";
    case "enum":
      return "Value is not one of the allowed values.";
    case "const":
      return "Value does not equal the required constant.";
    case "minItems":
      return "Array has fewer items than allowed.";
    case "maxItems":
      return "Array has more items than allowed.";
    case "minimum":
      return "Number is smaller than allowed.";
    case "maximum":
      return "Number is larger than allowed.";
  }
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nearestUid(value: JsonValue, pointer: string): string | undefined {
  let current: JsonValue | undefined = value;
  let uid: string | undefined;

  const captureUid = (): void => {
    if (current !== undefined && isJsonObject(current)) {
      const candidate = current.uid;

      if (typeof candidate === "string") {
        uid = candidate;
      }
    }
  };

  captureUid();

  for (const segment of splitJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isSafeInteger(index) ? current[index] : undefined;
    } else if (current !== undefined && isJsonObject(current)) {
      current = current[segment];
    } else {
      current = undefined;
    }

    captureUid();
  }

  return uid;
}

export function mapAjvErrors(
  errors: readonly ErrorObject[],
  context: AjvDiagnosticContext,
): Diagnostic[] {
  const file = normalizeDiagnosticFile(context.file);
  const diagnostics = errors.map((error): Diagnostic => {
    const code = diagnosticCodeForAjvKeyword(error.keyword);
    const keyword = error.keyword as MappedAjvKeyword;
    const target = targetForError(error);
    const location = locationForTarget(target, context.nodes);
    const uid =
      context.value === undefined
        ? undefined
        : nearestUid(context.value, target.pointer);

    return {
      code,
      severity: DIAGNOSTIC_CATALOG[code].severity,
      message: messageForError(error, keyword, target),
      file,
      line: location.line,
      column: location.column,
      jsonPointer: target.pointer,
      ...(uid === undefined ? {} : { uid }),
    };
  });

  return normalizeDiagnostics(diagnostics);
}

export function validateJsonValue(
  validate: ValidateFunction,
  value: JsonValue,
  context: Omit<AjvDiagnosticContext, "value">,
): Diagnostic[] {
  if (validate(value)) {
    return [];
  }

  return mapAjvErrors(validate.errors ?? [], { ...context, value });
}
