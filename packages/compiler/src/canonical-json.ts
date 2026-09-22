export type JsonPath = readonly (string | number)[];

export type JsonKeyOrder = (
  value: Readonly<Record<string, unknown>>,
  path: JsonPath,
) => readonly string[];

function serializeValue(
  value: unknown,
  path: JsonPath,
  depth: number,
  keyOrder: JsonKeyOrder,
): string | undefined {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    const indent = "  ".repeat(depth);
    const memberIndent = "  ".repeat(depth + 1);
    const members = value.map(
      (member, index) =>
        serializeValue(member, [...path, index], depth + 1, keyOrder) ?? "null",
    );
    return `[
${members.map((member) => `${memberIndent}${member}`).join(",\n")}
${indent}]`;
  }

  if (typeof value === "object") {
    const object = value as Readonly<Record<string, unknown>>;
    const members = keyOrder(object, path).flatMap((key) => {
      if (!Object.hasOwn(object, key)) {
        return [];
      }

      const serialized = serializeValue(
        object[key],
        [...path, key],
        depth + 1,
        keyOrder,
      );
      return serialized === undefined ? [] : [[key, serialized] as const];
    });

    if (members.length === 0) {
      return "{}";
    }

    const indent = "  ".repeat(depth);
    const memberIndent = "  ".repeat(depth + 1);
    return `{
${members
  .map(([key, member]) => `${memberIndent}${JSON.stringify(key)}: ${member}`)
  .join(",\n")}
${indent}}`;
  }

  return JSON.stringify(value);
}

export function stringifyJson(value: unknown, keyOrder: JsonKeyOrder): string {
  const serialized = serializeValue(value, [], 0, keyOrder);

  if (serialized === undefined) {
    throw new TypeError("Canonical JSON root value is not serializable.");
  }

  return serialized;
}
