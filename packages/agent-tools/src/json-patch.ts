import type { JsonValue } from "./common/contracts.js";
import { detachedJsonRecordKeys } from "./common/plain-json.js";
import {
  createA002Error,
  type A002Error,
  type A002Reason,
} from "./common/errors.js";
import {
  parseJsonPointer,
  type SourcePatchOperation,
} from "./source-patch-request.js";

export type JsonPatchResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly error: A002Error };

type MutableJsonRecord = { [key: string]: MutableJsonValue };
type MutableJsonValue =
  | null
  | boolean
  | number
  | string
  | MutableJsonValue[]
  | { [key: string]: MutableJsonValue };

function isRecord(
  value: MutableJsonValue,
): value is { [key: string]: MutableJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRecord(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type MutableJsonContainer = MutableJsonValue[] | MutableJsonRecord;

function mutableContainer(value: JsonValue): MutableJsonContainer | undefined {
  if (Array.isArray(value)) return new Array<MutableJsonValue>(value.length);
  return isJsonRecord(value)
    ? (Object.create(null) as MutableJsonRecord)
    : undefined;
}

function cloneJsonValue(value: JsonValue): MutableJsonValue {
  const root = mutableContainer(value);
  if (root === undefined) return value as MutableJsonValue;
  const pending: {
    readonly source: JsonValue;
    readonly clone: MutableJsonContainer;
  }[] = [{ source: value, clone: root }];

  while (pending.length > 0) {
    const { source, clone } = pending.pop()!;
    if (Array.isArray(source)) {
      const arrayClone = clone as MutableJsonValue[];
      for (let index = 0; index < source.length; index += 1) {
        const member = source[index]!;
        const memberClone = mutableContainer(member);
        arrayClone[index] = memberClone ?? (member as MutableJsonValue);
        if (memberClone !== undefined) {
          pending.push({ source: member, clone: memberClone });
        }
      }
      continue;
    }

    const recordClone = clone as MutableJsonRecord;
    for (const key of detachedJsonRecordKeys(source as object)) {
      const member = (source as { readonly [key: string]: JsonValue })[key]!;
      const memberClone = mutableContainer(member);
      recordClone[key] = memberClone ?? (member as MutableJsonValue);
      if (memberClone !== undefined) {
        pending.push({ source: member, clone: memberClone });
      }
    }
  }
  return root;
}

function freezeJsonValue(value: MutableJsonValue): JsonValue {
  if (!Array.isArray(value) && !isRecord(value)) return value;
  const pending: MutableJsonContainer[] = [value];
  const postorder: MutableJsonContainer[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    postorder.push(current);
    const members = Array.isArray(current)
      ? current
      : Object.keys(current).map((key) => current[key]!);
    for (const member of members) {
      if (Array.isArray(member) || isRecord(member)) pending.push(member);
    }
  }
  for (let index = postorder.length - 1; index >= 0; index -= 1) {
    Object.freeze(postorder[index]!);
  }
  return value as JsonValue;
}

export function structurallyEqualJson(
  left: JsonValue,
  right: JsonValue,
): boolean {
  const pending: [JsonValue, JsonValue][] = [[left, right]];
  while (pending.length > 0) {
    const [currentLeft, currentRight] = pending.pop()!;
    if (currentLeft === currentRight) continue;
    if (Array.isArray(currentLeft)) {
      if (
        !Array.isArray(currentRight) ||
        currentLeft.length !== currentRight.length
      ) {
        return false;
      }
      for (let index = 0; index < currentLeft.length; index += 1) {
        pending.push([currentLeft[index]!, currentRight[index]!]);
      }
      continue;
    }
    if (
      Array.isArray(currentRight) ||
      !isJsonRecord(currentLeft) ||
      !isJsonRecord(currentRight)
    ) {
      return false;
    }

    const leftKeys = Object.keys(currentLeft);
    const rightKeys = Object.keys(currentRight);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.hasOwn(currentRight, key)) return false;
      pending.push([currentLeft[key]!, currentRight[key]!]);
    }
  }
  return true;
}

function arrayIndex(token: string): number | undefined {
  if (token === "0") return 0;
  if (!/^[1-9][0-9]*$/u.test(token)) return undefined;
  const index = Number(token);
  return Number.isSafeInteger(index) ? index : undefined;
}

function applicationFailure(
  file: string,
  operationIndex: number,
  path: string,
  reason: A002Reason,
): JsonPatchResult {
  return {
    ok: false,
    error: createA002Error(file, operationIndex, path, reason),
  };
}

type ParentResult =
  | {
      readonly ok: true;
      readonly parent: MutableJsonValue[] | MutableJsonRecord;
      readonly token: string;
    }
  | {
      readonly ok: false;
      readonly reason: "missing-target" | "invalid-array-index";
    };

function locateParent(
  root: MutableJsonValue,
  tokens: readonly string[],
): ParentResult {
  let current = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (Array.isArray(current)) {
      const memberIndex = arrayIndex(token);
      if (memberIndex === undefined || memberIndex >= current.length) {
        return { ok: false, reason: "invalid-array-index" };
      }
      current = current[memberIndex]!;
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, token)) {
      return { ok: false, reason: "missing-target" };
    }
    current = current[token]!;
  }

  if (!Array.isArray(current) && !isRecord(current)) {
    return { ok: false, reason: "missing-target" };
  }
  return {
    ok: true,
    parent: current,
    token: tokens[tokens.length - 1]!,
  };
}

function applyToArray(
  parent: MutableJsonValue[],
  token: string,
  operation: SourcePatchOperation,
): "missing-target" | "invalid-array-index" | "test-failed" | undefined {
  if (operation.op === "add" && token === "-") {
    parent[parent.length] = cloneJsonValue(operation.value);
    return undefined;
  }

  const index = arrayIndex(token);
  if (
    index === undefined ||
    index > parent.length ||
    (operation.op !== "add" && index === parent.length)
  ) {
    return "invalid-array-index";
  }

  switch (operation.op) {
    case "add":
      for (let moveIndex = parent.length; moveIndex > index; moveIndex -= 1) {
        parent[moveIndex] = parent[moveIndex - 1]!;
      }
      parent[index] = cloneJsonValue(operation.value);
      return undefined;
    case "remove":
      for (
        let moveIndex = index;
        moveIndex < parent.length - 1;
        moveIndex += 1
      ) {
        parent[moveIndex] = parent[moveIndex + 1]!;
      }
      parent.length -= 1;
      return undefined;
    case "replace":
      parent[index] = cloneJsonValue(operation.value);
      return undefined;
    case "test":
      return structurallyEqualJson(parent[index] as JsonValue, operation.value)
        ? undefined
        : "test-failed";
  }
}

function applyToRecord(
  parent: MutableJsonRecord,
  token: string,
  operation: SourcePatchOperation,
): "missing-target" | "test-failed" | undefined {
  const exists = Object.hasOwn(parent, token);
  if (operation.op !== "add" && !exists) return "missing-target";

  switch (operation.op) {
    case "add":
    case "replace":
      parent[token] = cloneJsonValue(operation.value);
      return undefined;
    case "remove":
      delete parent[token];
      return undefined;
    case "test":
      return structurallyEqualJson(parent[token] as JsonValue, operation.value)
        ? undefined
        : "test-failed";
  }
}

export function applyJsonPatch(
  file: string,
  document: JsonValue,
  operations: readonly SourcePatchOperation[],
): JsonPatchResult {
  const root = cloneJsonValue(document);
  for (
    let operationIndex = 0;
    operationIndex < operations.length;
    operationIndex += 1
  ) {
    const operation = operations[operationIndex]!;
    const parsed = parseJsonPointer(operation.path);
    if (!parsed.ok) {
      throw new TypeError(
        "JSON Patch application requires a Layer-2a-validated pointer.",
      );
    }

    if (parsed.tokens.length === 0) {
      if (operation.op !== "test") {
        return applicationFailure(
          file,
          operationIndex,
          operation.path,
          "root-mutation",
        );
      }
      if (!structurallyEqualJson(root as JsonValue, operation.value)) {
        return applicationFailure(
          file,
          operationIndex,
          operation.path,
          "test-failed",
        );
      }
      continue;
    }

    const parent = locateParent(root, parsed.tokens);
    if (!parent.ok) {
      return applicationFailure(
        file,
        operationIndex,
        operation.path,
        parent.reason,
      );
    }
    const reason = Array.isArray(parent.parent)
      ? applyToArray(parent.parent, parent.token, operation)
      : applyToRecord(parent.parent, parent.token, operation);
    if (reason !== undefined) {
      return applicationFailure(file, operationIndex, operation.path, reason);
    }
  }

  return { ok: true, value: freezeJsonValue(root) };
}
