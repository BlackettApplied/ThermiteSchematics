import { compareRecords } from "./agent-contract-records.mjs";

const pointer = (path, key) =>
  `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
const kind = (value) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const stable = (value) => JSON.stringify(value);

/** Arrays are collections of instances, not positional field contracts. */
export function instanceShape(value, path = "", result = new Map()) {
  const entry = result.get(path) ?? { types: new Set(), constants: new Set() };
  entry.types.add(kind(value));
  if (/\/(format|tool|patchFormat)$/u.test(path))
    entry.constants.add(stable(value));
  result.set(path, entry);
  if (Array.isArray(value)) {
    for (const item of value) instanceShape(item, pointer(path, "*"), result);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      instanceShape(item, pointer(path, key), result);
  }
  return result;
}

export function compareInstances(before, after) {
  const old = instanceShape(before),
    next = instanceShape(after),
    changes = [];
  for (const [path, entry] of old) {
    const current = next.get(path);
    if (!current) changes.push({ classification: "removal", path });
    else if (
      stable([...entry.types].sort()) !== stable([...current.types].sort())
    )
      changes.push({
        classification: "type-change",
        path,
        before: [...entry.types],
        after: [...current.types],
      });
    else if ([...entry.constants].some((v) => !current.constants.has(v)))
      changes.push({
        classification: "meaning-change",
        path,
        before: [...entry.constants],
        after: [...current.constants],
      });
  }
  for (const path of next.keys())
    if (!old.has(path)) changes.push({ classification: "additive", path });
  return [
    ...identifyRenames(changes, old, next),
    ...compareRecords(before, after, compareInstances),
  ];
}

function identifyRenames(changes, old, next) {
  const removals = changes.filter((c) => c.classification === "removal");
  for (const removed of removals) {
    const parent = removed.path.slice(0, removed.path.lastIndexOf("/"));
    const siblings = changes.filter(
      (c) =>
        c.classification === "additive" &&
        c.path.slice(0, c.path.lastIndexOf("/")) === parent,
    );
    if (siblings.length !== 1) continue;
    const added = siblings[0];
    if (
      stable([...old.get(removed.path).types]) !==
      stable([...next.get(added.path).types])
    )
      continue;
    removed.classification = "rename";
    removed.to = added.path;
    removed.inferred = true;
  }
  return changes;
}

/** A schema is an acceptance contract; inspect keywords rather than sample values. */
export function compareSchemas(before, after, path = "", changes = []) {
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object"
  ) {
    if (stable(before) !== stable(after))
      changes.push({ classification: "meaning-change", path, before, after });
    return changes;
  }
  for (const [key, value] of Object.entries(before)) {
    const at = pointer(path, key);
    if (!(key in after)) changes.push({ classification: "removal", path: at });
    else if (key === "properties" || key === "$defs")
      compareSchemas(value, after[key], at, changes);
    else if (key === "enum") {
      for (const item of value)
        if (!after[key].some((v) => stable(v) === stable(item)))
          changes.push({
            classification: "meaning-change",
            path: at,
            removedLiteral: item,
          });
      if (after[key].length > value.length)
        changes.push({ classification: "additive", path: at });
    } else if (key === "description" || key === "title" || key === "$comment") {
      if (value !== after[key])
        changes.push({
          classification: "wording-review",
          path: at,
          before: value,
          after: after[key],
        });
    } else if (key === "required") {
      if (stable([...value].sort()) !== stable([...after[key]].sort()))
        changes.push({
          classification: "required-review",
          path: at,
          before: value,
          after: after[key],
        });
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    )
      compareSchemas(value, after[key], at, changes);
    else if (stable(value) !== stable(after[key]))
      changes.push({
        classification: key === "type" ? "type-change" : "meaning-change",
        path: at,
        before: value,
        after: after[key],
      });
  }
  for (const key of Object.keys(after))
    if (!(key in before))
      changes.push({ classification: "additive", path: pointer(path, key) });
  return changes;
}

export function requestExamples(markdown) {
  return [...markdown.matchAll(/```json[^\n]*\n([\s\S]*?)```/gu)].flatMap(
    (match) => {
      const value = JSON.parse(match[1]);
      return value?.format === "agent-tool-request/0.1" ? [value] : [];
    },
  );
}

export function compareExamples(before, after) {
  const changes = [];
  for (const [index, example] of before.entries()) {
    const candidates = after
      .filter((value) => exampleTool(value) === exampleTool(example))
      .map((value) => compareInstances(example, value));
    const compatible = candidates.find((delta) =>
      delta.every((c) => c.classification === "additive"),
    );
    if (!compatible)
      changes.push({
        classification: "removal",
        path: `/example/${index}`,
        before: example,
      });
  }
  if (after.length > before.length)
    changes.push({
      classification: "additive",
      path: "/examples",
      count: after.length - before.length,
    });
  return changes;
}

function exampleTool(value) {
  return (
    ["target", "selector", "query", "spec", "patchFormat"].find(
      (key) => key in value,
    ) ?? "validate"
  );
}
