import { appendJsonPointer } from "@thermite/schema";

import type { AgentToolName, JsonValue } from "./contracts.js";
import { createA001Error, type A001Error } from "./errors.js";

export type JsonRecord = { readonly [key: string]: JsonValue };

export type FieldValidationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: A001Error };

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function recordValue(
  tool: AgentToolName,
  value: JsonValue,
  field: string,
): FieldValidationResult<JsonRecord> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: createA001Error(tool, field, "wrong-type") };
  }
  return { ok: true, value: value as JsonRecord };
}

export function requiredRecord(
  tool: AgentToolName,
  record: JsonRecord,
  key: string,
  parentField = "",
): FieldValidationResult<JsonRecord> {
  const field = appendJsonPointer(parentField, key);
  if (!Object.hasOwn(record, key)) {
    return { ok: false, error: createA001Error(tool, field, "missing") };
  }
  return recordValue(tool, record[key]!, field);
}

export function requiredString(
  tool: AgentToolName,
  record: JsonRecord,
  key: string,
  parentField = "",
  literals?: ReadonlySet<string>,
  allowEmpty = false,
): FieldValidationResult<string> {
  const field = appendJsonPointer(parentField, key);
  if (!Object.hasOwn(record, key)) {
    return { ok: false, error: createA001Error(tool, field, "missing") };
  }

  const value = record[key];
  if (typeof value !== "string") {
    return { ok: false, error: createA001Error(tool, field, "wrong-type") };
  }
  if (!allowEmpty && value.length === 0) {
    return { ok: false, error: createA001Error(tool, field, "empty-string") };
  }
  if (literals !== undefined && !literals.has(value)) {
    return {
      ok: false,
      error: createA001Error(tool, field, "unsupported-value"),
    };
  }
  return { ok: true, value };
}

export function requiredArray(
  tool: AgentToolName,
  record: JsonRecord,
  key: string,
  parentField = "",
): FieldValidationResult<readonly JsonValue[]> {
  const field = appendJsonPointer(parentField, key);
  if (!Object.hasOwn(record, key)) {
    return { ok: false, error: createA001Error(tool, field, "missing") };
  }
  const value = record[key];
  if (!Array.isArray(value)) {
    return { ok: false, error: createA001Error(tool, field, "wrong-type") };
  }
  if (value.length === 0) {
    return { ok: false, error: createA001Error(tool, field, "empty-array") };
  }
  return { ok: true, value };
}

export function requiredValue(
  tool: AgentToolName,
  record: JsonRecord,
  key: string,
  parentField = "",
): FieldValidationResult<JsonValue> {
  const field = appendJsonPointer(parentField, key);
  if (!Object.hasOwn(record, key)) {
    return { ok: false, error: createA001Error(tool, field, "missing") };
  }
  return { ok: true, value: record[key]! };
}

export function optionalString(
  tool: AgentToolName,
  record: JsonRecord,
  key: string,
  parentField = "",
  literals?: ReadonlySet<string>,
): FieldValidationResult<string | undefined> {
  if (!Object.hasOwn(record, key)) return { ok: true, value: undefined };
  return requiredString(tool, record, key, parentField, literals);
}

export function requiredBoolean(
  tool: AgentToolName,
  record: JsonRecord,
  key: string,
  parentField = "",
): FieldValidationResult<boolean> {
  const field = appendJsonPointer(parentField, key);
  if (!Object.hasOwn(record, key)) {
    return { ok: false, error: createA001Error(tool, field, "missing") };
  }
  const value = record[key];
  if (typeof value !== "boolean") {
    return { ok: false, error: createA001Error(tool, field, "wrong-type") };
  }
  return { ok: true, value };
}

export function firstAdditionalProperty(
  tool: AgentToolName,
  record: JsonRecord,
  allowed: ReadonlySet<string>,
  parentField = "",
): A001Error | undefined {
  const key = Object.keys(record)
    .filter((candidate) => !allowed.has(candidate))
    .sort(compareCodeUnits)[0];
  return key === undefined
    ? undefined
    : createA001Error(
        tool,
        appendJsonPointer(parentField, key),
        "additional-property",
      );
}
