import { Buffer } from "node:buffer";

import { appendJsonPointer } from "@thermite/schema";

import type { AgentToolRequestBase, JsonValue } from "./common/contracts.js";
import {
  createA001Error,
  createA002Error,
  createA003Error,
  type A001Error,
  type A002Error,
  type A003Error,
} from "./common/errors.js";
import { detachAndFreezePlainJson } from "./common/plain-json.js";
import {
  firstAdditionalProperty,
  recordValue,
  requiredArray,
  requiredBoolean,
  requiredRecord,
  requiredString,
  requiredValue,
  type JsonRecord,
} from "./common/request-validation.js";

export type SourcePatchOperation =
  | { readonly op: "test"; readonly path: string; readonly value: JsonValue }
  | { readonly op: "add"; readonly path: string; readonly value: JsonValue }
  | { readonly op: "remove"; readonly path: string }
  | {
      readonly op: "replace";
      readonly path: string;
      readonly value: JsonValue;
    };

export interface SourceFilePatch {
  readonly path: string;
  readonly expectedIntegrity: string;
  readonly operations: readonly SourcePatchOperation[];
}

export interface ApplySourcePatchRequest extends AgentToolRequestBase {
  readonly patchFormat: "json-patch/0.1";
  readonly dryRun: boolean;
  readonly files: readonly SourceFilePatch[];
}

export type ApplySourcePatchRequestError = A001Error | A002Error | A003Error;

export type ApplySourcePatchRequestValidationResult =
  | { readonly ok: true; readonly value: ApplySourcePatchRequest }
  | { readonly ok: false; readonly error: ApplySourcePatchRequestError };

export type JsonPointerParseResult =
  | { readonly ok: true; readonly tokens: readonly string[] }
  | { readonly ok: false };

const REQUEST_FIELDS = new Set([
  "format",
  "project",
  "patchFormat",
  "dryRun",
  "files",
]);
const FILE_FIELDS = new Set(["path", "expectedIntegrity", "operations"]);
const VALUE_OPERATION_FIELDS = new Set(["op", "path", "value"]);
const REMOVE_OPERATION_FIELDS = new Set(["op", "path"]);
const REQUEST_FORMATS = new Set(["agent-tool-request/0.1"]);
const PATCH_FORMATS = new Set(["json-patch/0.1"]);
const PATCH_OPERATIONS = new Set(["test", "add", "remove", "replace"]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/u;

function validateOperation(
  value: JsonValue,
  fileIndex: number,
  operationIndex: number,
): { readonly ok: true } | { readonly ok: false; readonly error: A001Error } {
  const field = appendJsonPointer(
    appendJsonPointer(
      appendJsonPointer(appendJsonPointer("", "files"), fileIndex),
      "operations",
    ),
    operationIndex,
  );
  const operation = recordValue("apply-source-patch", value, field);
  if (!operation.ok) return operation;

  const op = requiredString(
    "apply-source-patch",
    operation.value,
    "op",
    field,
    PATCH_OPERATIONS,
  );
  if (!op.ok) return op;
  const path = requiredString(
    "apply-source-patch",
    operation.value,
    "path",
    field,
    undefined,
    true,
  );
  if (!path.ok) return path;
  if (op.value !== "remove") {
    const patchValue = requiredValue(
      "apply-source-patch",
      operation.value,
      "value",
      field,
    );
    if (!patchValue.ok) return patchValue;
  }

  const additional = firstAdditionalProperty(
    "apply-source-patch",
    operation.value,
    op.value === "remove" ? REMOVE_OPERATION_FIELDS : VALUE_OPERATION_FIELDS,
    field,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return { ok: true };
}

function validateFile(
  value: JsonValue,
  fileIndex: number,
): { readonly ok: true } | { readonly ok: false; readonly error: A001Error } {
  const field = appendJsonPointer(appendJsonPointer("", "files"), fileIndex);
  const file = recordValue("apply-source-patch", value, field);
  if (!file.ok) return file;

  const path = requiredString("apply-source-patch", file.value, "path", field);
  if (!path.ok) return path;
  const expectedIntegrity = requiredString(
    "apply-source-patch",
    file.value,
    "expectedIntegrity",
    field,
  );
  if (!expectedIntegrity.ok) return expectedIntegrity;
  const operations = requiredArray(
    "apply-source-patch",
    file.value,
    "operations",
    field,
  );
  if (!operations.ok) return operations;

  for (
    let operationIndex = 0;
    operationIndex < operations.value.length;
    operationIndex += 1
  ) {
    const operation = operations.value[operationIndex]!;
    const operationResult = validateOperation(
      operation,
      fileIndex,
      operationIndex,
    );
    if (!operationResult.ok) return operationResult;
  }

  const additional = firstAdditionalProperty(
    "apply-source-patch",
    file.value,
    FILE_FIELDS,
    field,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return { ok: true };
}

function validateLayer1(
  value: JsonValue,
):
  | { readonly ok: true; readonly value: ApplySourcePatchRequest }
  | { readonly ok: false; readonly error: A001Error } {
  const request = recordValue("apply-source-patch", value, "");
  if (!request.ok) return request;
  const format = requiredString(
    "apply-source-patch",
    request.value,
    "format",
    "",
    REQUEST_FORMATS,
  );
  if (!format.ok) return format;
  const project = requiredString(
    "apply-source-patch",
    request.value,
    "project",
  );
  if (!project.ok) return project;
  const patchFormat = requiredString(
    "apply-source-patch",
    request.value,
    "patchFormat",
    "",
    PATCH_FORMATS,
  );
  if (!patchFormat.ok) return patchFormat;
  const dryRun = requiredBoolean("apply-source-patch", request.value, "dryRun");
  if (!dryRun.ok) return dryRun;
  const files = requiredArray("apply-source-patch", request.value, "files");
  if (!files.ok) return files;

  for (let fileIndex = 0; fileIndex < files.value.length; fileIndex += 1) {
    const file = files.value[fileIndex]!;
    const fileResult = validateFile(file, fileIndex);
    if (!fileResult.ok) return fileResult;
  }

  const additional = firstAdditionalProperty(
    "apply-source-patch",
    request.value,
    REQUEST_FIELDS,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: value as unknown as ApplySourcePatchRequest,
  };
}

export function isPortableSourcePatchPath(path: string): boolean {
  if (
    path.startsWith("/") ||
    DRIVE_PREFIX_PATTERN.test(path) ||
    path.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(path)
  ) {
    return false;
  }
  return path
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

export function isCanonicalFileIntegrity(integrity: string): boolean {
  if (!integrity.startsWith("sha256-")) return false;
  const encoded = integrity.slice("sha256-".length);
  const decoded = Buffer.from(encoded, "base64");
  return decoded.length === 32 && decoded.toString("base64") === encoded;
}

export function parseJsonPointer(pointer: string): JsonPointerParseResult {
  if (pointer === "") return { ok: true, tokens: Object.freeze([]) };
  if (!pointer.startsWith("/")) return { ok: false };

  const encodedTokens = pointer.slice(1).split("/");
  for (const token of encodedTokens) {
    for (let index = 0; index < token.length; index += 1) {
      if (token[index] !== "~") continue;
      const escaped = token[index + 1];
      if (escaped !== "0" && escaped !== "1") return { ok: false };
      index += 1;
    }
  }
  return {
    ok: true,
    tokens: Object.freeze(
      encodedTokens.map((token) =>
        token.replaceAll("~1", "/").replaceAll("~0", "~"),
      ),
    ),
  };
}

function validateLayer2a(
  request: ApplySourcePatchRequest,
): ApplySourcePatchRequestValidationResult {
  const seenFiles = new Set<string>();
  for (let fileIndex = 0; fileIndex < request.files.length; fileIndex += 1) {
    const file = request.files[fileIndex]!;
    if (!isPortableSourcePatchPath(file.path)) {
      return {
        ok: false,
        error: createA003Error("<patch-target>", "invalid-path"),
      };
    }
    if (seenFiles.has(file.path)) {
      return {
        ok: false,
        error: createA003Error(file.path, "duplicate-file"),
      };
    }
    seenFiles.add(file.path);

    if (!isCanonicalFileIntegrity(file.expectedIntegrity)) {
      return {
        ok: false,
        error: createA001Error(
          "apply-source-patch",
          appendJsonPointer(
            appendJsonPointer(appendJsonPointer("", "files"), fileIndex),
            "expectedIntegrity",
          ),
          "invalid-integrity",
        ),
      };
    }

    for (
      let operationIndex = 0;
      operationIndex < file.operations.length;
      operationIndex += 1
    ) {
      const operation = file.operations[operationIndex]!;
      if (!parseJsonPointer(operation.path).ok) {
        return {
          ok: false,
          error: createA002Error(
            file.path,
            operationIndex,
            operation.path,
            "invalid-pointer",
          ),
        };
      }
    }
  }
  return { ok: true, value: request };
}

export function validateApplySourcePatchRequest(
  request: unknown,
): ApplySourcePatchRequestValidationResult {
  const detached = detachAndFreezePlainJson("apply-source-patch", request);
  if (!detached.ok) return detached;
  const layer1 = validateLayer1(detached.value);
  if (!layer1.ok) return layer1;
  return validateLayer2a(layer1.value);
}
