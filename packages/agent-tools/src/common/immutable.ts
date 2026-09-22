import type { DeepReadonly } from "./contracts.js";

function isObject(value: unknown): value is object {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null
  );
}

function freezeRecursively(value: unknown): void {
  if (!isObject(value)) return;
  const seen = new Set<object>();
  const pending: object[] = [value];
  const postorder: object[] = [];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    postorder.push(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        descriptor !== undefined &&
        "value" in descriptor &&
        isObject(descriptor.value)
      ) {
        pending.push(descriptor.value);
      }
    }
  }

  for (let index = postorder.length - 1; index >= 0; index -= 1) {
    Object.freeze(postorder[index]!);
  }
}

export function detachedFrozenCopy<Value>(value: Value): DeepReadonly<Value> {
  const copy = structuredClone(value);
  freezeRecursively(copy);
  return copy as DeepReadonly<Value>;
}
