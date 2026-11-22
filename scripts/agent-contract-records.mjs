const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function identities(value) {
  if (!record(value)) return [];
  const keys = [];
  if (
    ["code", "file", "jsonPointer"].every(
      (key) => typeof value[key] === "string",
    )
  )
    keys.push(
      JSON.stringify(["diagnostic", value.code, value.file, value.jsonPointer]),
    );
  for (const key of ["uid", "id"])
    if (typeof value[key] === "string") {
      keys.push(JSON.stringify([key, value[key]]));
      keys.push(JSON.stringify(["identifier", value[key]]));
    }
  return [...new Set(keys)];
}

function uniqueRecords(values) {
  const index = new Map();
  for (const [position, value] of values.entries())
    for (const key of identities(value))
      index.set(key, index.has(key) ? null : { position, value });
  return index;
}

/** A diagnostic insertion is data, not removal of fields from the next record. */
function matchedRecords(before, after) {
  const index = uniqueRecords(after),
    oldIndex = uniqueRecords(before);
  const pairs = [],
    pending = [],
    used = new Set();
  for (const [position, value] of before.entries()) {
    if (!record(value)) continue;
    const key = identities(value).find(
      (key) =>
        oldIndex.get(key) &&
        index.get(key) &&
        !used.has(index.get(key).position),
    );
    if (key !== undefined) {
      const match = index.get(key);
      pairs.push({ before: value, ...match });
      used.add(match.position);
    } else pending.push({ value, position });
  }
  return [...pairs, ...anonymousPairs(before, after, pending, used)];
}

function anonymousPairs(before, after, pending, used) {
  if (before.length !== after.length) return [];
  const remaining = after.flatMap((value, position) =>
    record(value) && !used.has(position) ? [{ value, position }] : [],
  );
  if (
    pending.length === 1 &&
    remaining.length === 1 &&
    (!identities(pending[0].value).length ||
      !identities(remaining[0].value).length)
  )
    return [{ before: pending[0].value, ...remaining[0] }];
  return pending.flatMap(({ value, position }) =>
    !used.has(position) &&
    record(after[position]) &&
    !identities(after[position]).length
      ? [{ before: value, value: after[position], position }]
      : [],
  );
}

/** Supplement collection shapes with fields of matching individual records. */
export function compareRecords(before, after, compare, path = "") {
  if (Array.isArray(before) && Array.isArray(after))
    return matchedRecords(before, after).flatMap((pair) => {
      const prefix = `${path}/${pair.position}`;
      return compare(pair.before, pair.value).map((change) => ({
        ...change,
        path: prefix + change.path,
        ...(change.to === undefined ? {} : { to: prefix + change.to }),
      }));
    });
  if (!record(before) || !record(after)) return [];
  return Object.keys(before)
    .filter((key) => key in after)
    .flatMap((key) =>
      compareRecords(
        before[key],
        after[key],
        compare,
        `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      ),
    );
}
