import { types } from "node:util";

import type { AgentToolName, JsonValue } from "./contracts.js";
import { createA001Error, type A001Error } from "./errors.js";

export interface PlainJsonDependencies {
  readonly isProxy: (value: object) => boolean;
  readonly isArray: (value: unknown) => value is unknown[];
  readonly getPrototypeOf: (value: object) => object | null;
  readonly ownKeys: (value: object) => readonly PropertyKey[];
  readonly getOwnPropertyDescriptor: (
    value: object,
    key: PropertyKey,
  ) => PropertyDescriptor | undefined;
  readonly freeze: <Value extends object>(value: Value) => Readonly<Value>;
}

export const plainJsonDependencies: PlainJsonDependencies = Object.freeze({
  isProxy: types.isProxy,
  isArray: Array.isArray,
  getPrototypeOf: Object.getPrototypeOf,
  ownKeys: Reflect.ownKeys,
  getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  freeze: Object.freeze,
});

export type PlainJsonDetachResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly error: A001Error };

type MutableJsonRecord = Record<string, JsonValue>;

const detachedRecordKeyOrders = new WeakMap<object, readonly string[]>();

export function detachedJsonRecordKeys(value: object): readonly string[] {
  return detachedRecordKeyOrders.get(value) ?? Object.keys(value);
}

interface JsonPath {
  readonly parent: JsonPath | undefined;
  readonly token: string | number;
}

interface DetachContext {
  readonly tool: AgentToolName;
  readonly dependencies: PlainJsonDependencies;
  readonly ancestors: Set<object>;
}

type Destination =
  | { readonly kind: "root" }
  | {
      readonly kind: "array";
      readonly parent: JsonValue[];
      readonly index: number;
    }
  | {
      readonly kind: "record";
      readonly parent: MutableJsonRecord;
      readonly key: string;
    };

interface VisitFrame {
  readonly kind: "visit";
  readonly source: unknown;
  readonly path: JsonPath | undefined;
  readonly destination: Destination;
}

interface LeaveFrame {
  readonly kind: "leave";
  readonly source: object;
  readonly clone: object;
}

type DetachFrame = VisitFrame | LeaveFrame;

interface ChildVisit {
  readonly source: unknown;
  readonly path: JsonPath;
  readonly destination: Destination;
}

interface InspectedContainer {
  readonly clone: JsonValue[] | MutableJsonRecord;
  readonly children: readonly ChildVisit[];
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function childPath(
  parent: JsonPath | undefined,
  token: string | number,
): JsonPath {
  return { parent, token };
}

function jsonPointer(path: JsonPath | undefined): string {
  if (path === undefined) return "";
  const tokens: (string | number)[] = [];
  let current: JsonPath | undefined = path;
  while (current !== undefined) {
    tokens.push(current.token);
    current = current.parent;
  }
  tokens.reverse();
  return tokens
    .map(
      (token) =>
        `/${String(token).replaceAll("~", "~0").replaceAll("/", "~1")}`,
    )
    .join("");
}

function failure(
  tool: AgentToolName,
  path: JsonPath | undefined,
  reason: "non-finite-number" | "unsupported-value" | "hostile-object",
): PlainJsonDetachResult {
  return { ok: false, error: createA001Error(tool, jsonPointer(path), reason) };
}

function descriptorFor(
  value: object,
  key: string,
  path: JsonPath,
  context: DetachContext,
):
  | { readonly ok: true; readonly descriptor: PropertyDescriptor }
  | { readonly ok: false; readonly result: PlainJsonDetachResult } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = context.dependencies.getOwnPropertyDescriptor(value, key);
  } catch {
    return {
      ok: false,
      result: failure(context.tool, path, "hostile-object"),
    };
  }
  if (descriptor === undefined) {
    return {
      ok: false,
      result: failure(context.tool, path, "hostile-object"),
    };
  }
  return { ok: true, descriptor };
}

function isExpectedArrayKey(key: string, length: number): boolean {
  if (key === "length") return true;
  if (key === "0") return length > 0;
  if (!/^[1-9][0-9]*$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index < length;
}

function inspectArray(
  value: unknown[],
  keys: readonly string[],
  path: JsonPath | undefined,
  context: DetachContext,
): PlainJsonDetachResult | InspectedContainer {
  const lengthPath = childPath(path, "length");
  const lengthResult = descriptorFor(value, "length", lengthPath, context);
  if (!lengthResult.ok) return lengthResult.result;
  const lengthDescriptor = lengthResult.descriptor;
  if (!("value" in lengthDescriptor)) {
    return failure(context.tool, lengthPath, "hostile-object");
  }
  if (
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return failure(context.tool, path, "unsupported-value");
  }
  const length = lengthDescriptor.value;
  const keySet = new Set(keys);
  const descriptors: PropertyDescriptor[] = [];

  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const memberPath = childPath(path, index);
    if (!keySet.has(key)) {
      return failure(context.tool, memberPath, "unsupported-value");
    }
    const descriptorResult = descriptorFor(value, key, memberPath, context);
    if (!descriptorResult.ok) return descriptorResult.result;
    const descriptor = descriptorResult.descriptor;
    if (!("value" in descriptor)) {
      return failure(context.tool, memberPath, "hostile-object");
    }
    if (!descriptor.enumerable) {
      return failure(context.tool, memberPath, "unsupported-value");
    }
    descriptors.push(descriptor);
  }

  const extraKey = keys
    .filter((key) => !isExpectedArrayKey(key, length))
    .sort(compareCodeUnits)[0];
  if (extraKey !== undefined) {
    const extraPath = childPath(path, extraKey);
    const descriptorResult = descriptorFor(value, extraKey, extraPath, context);
    if (!descriptorResult.ok) return descriptorResult.result;
    return "value" in descriptorResult.descriptor
      ? failure(context.tool, extraPath, "unsupported-value")
      : failure(context.tool, extraPath, "hostile-object");
  }

  const clone = new Array<JsonValue>(length);
  return {
    clone,
    children: descriptors.map((descriptor, index) => ({
      source: descriptor.value,
      path: childPath(path, index),
      destination: { kind: "array", parent: clone, index },
    })),
  };
}

function inspectRecord(
  value: object,
  keys: readonly string[],
  path: JsonPath | undefined,
  context: DetachContext,
): PlainJsonDetachResult | InspectedContainer {
  const sortedKeys = [...keys].sort(compareCodeUnits);
  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of sortedKeys) {
    const memberPath = childPath(path, key);
    const descriptorResult = descriptorFor(value, key, memberPath, context);
    if (!descriptorResult.ok) return descriptorResult.result;
    const descriptor = descriptorResult.descriptor;
    if (!("value" in descriptor)) {
      return failure(context.tool, memberPath, "hostile-object");
    }
    if (!descriptor.enumerable) {
      return failure(context.tool, memberPath, "unsupported-value");
    }
    descriptors.set(key, descriptor);
  }

  const clone: MutableJsonRecord = Object.create(null) as MutableJsonRecord;
  detachedRecordKeyOrders.set(clone, Object.freeze([...keys]));
  return {
    clone,
    children: sortedKeys.map((key) => ({
      source: descriptors.get(key)!.value,
      path: childPath(path, key),
      destination: { kind: "record", parent: clone, key },
    })),
  };
}

function inspectContainer(
  value: object,
  path: JsonPath | undefined,
  context: DetachContext,
): PlainJsonDetachResult | InspectedContainer {
  if (context.dependencies.isProxy(value)) {
    return failure(context.tool, path, "hostile-object");
  }
  if (context.ancestors.has(value)) {
    return failure(context.tool, path, "unsupported-value");
  }

  let isArray: boolean;
  try {
    isArray = context.dependencies.isArray(value);
  } catch {
    return failure(context.tool, path, "hostile-object");
  }
  if (!isArray) {
    let prototype: object | null;
    try {
      prototype = context.dependencies.getPrototypeOf(value);
    } catch {
      return failure(context.tool, path, "hostile-object");
    }
    if (prototype !== Object.prototype && prototype !== null) {
      return failure(context.tool, path, "unsupported-value");
    }
  }

  let keys: readonly PropertyKey[];
  try {
    keys = context.dependencies.ownKeys(value);
  } catch {
    return failure(context.tool, path, "hostile-object");
  }
  if (keys.some((key) => typeof key === "symbol")) {
    return failure(context.tool, path, "unsupported-value");
  }
  const stringKeys = keys as readonly string[];
  return isArray
    ? inspectArray(value as unknown[], stringKeys, path, context)
    : inspectRecord(value, stringKeys, path, context);
}

function assignValue(
  destination: Destination,
  value: JsonValue,
  root: { value: JsonValue | undefined },
): void {
  switch (destination.kind) {
    case "root":
      root.value = value;
      break;
    case "array":
      destination.parent[destination.index] = value;
      break;
    case "record":
      destination.parent[destination.key] = value;
      break;
  }
}

export function detachAndFreezePlainJson(
  tool: AgentToolName,
  value: unknown,
  dependencies: PlainJsonDependencies = plainJsonDependencies,
): PlainJsonDetachResult {
  const context: DetachContext = {
    tool,
    dependencies,
    ancestors: new Set<object>(),
  };
  const root: { value: JsonValue | undefined } = { value: undefined };
  const stack: DetachFrame[] = [
    {
      kind: "visit",
      source: value,
      path: undefined,
      destination: { kind: "root" },
    },
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === "leave") {
      dependencies.freeze(frame.clone);
      context.ancestors.delete(frame.source);
      continue;
    }

    const source = frame.source;
    if (
      source === null ||
      typeof source === "boolean" ||
      typeof source === "string"
    ) {
      assignValue(frame.destination, source, root);
      continue;
    }
    if (typeof source === "number") {
      if (!Number.isFinite(source)) {
        return failure(tool, frame.path, "non-finite-number");
      }
      assignValue(frame.destination, source, root);
      continue;
    }
    if (typeof source !== "object") {
      return failure(tool, frame.path, "unsupported-value");
    }

    const inspected = inspectContainer(source, frame.path, context);
    if ("ok" in inspected) return inspected;
    assignValue(frame.destination, inspected.clone as JsonValue, root);
    context.ancestors.add(source);
    stack.push({ kind: "leave", source, clone: inspected.clone });
    for (let index = inspected.children.length - 1; index >= 0; index -= 1) {
      const child = inspected.children[index]!;
      stack.push({ kind: "visit", ...child });
    }
  }

  if (root.value === undefined) {
    throw new TypeError("Plain JSON detachment did not produce a root value.");
  }
  return { ok: true, value: root.value };
}
