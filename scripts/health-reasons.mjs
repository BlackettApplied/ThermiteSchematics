import { isDeepStrictEqual } from "node:util";
// v4 accepts legacy single records on read; writers preserve an append-only list.
export const reasonList = (value) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
export const latestReason = (value) => reasonList(value).at(-1);
export function reasonMatches(value, identity, from, to) {
  const record = latestReason(value);
  return (
    record &&
    record.identity === identity &&
    record.from === from &&
    record.to === to &&
    typeof record.reason === "string" &&
    Boolean(record.reason.trim())
  );
}
// A cast authorization is spent when it enters the base, even if the count later
// falls. Require a fresh final record and preserve the authenticated prefix.
function normalizedReason(record) {
  return record && typeof record.reason === "string"
    ? {
        ...record,
        reason: record.reason.replace(
          /[\s\p{Cf}\p{Default_Ignorable_Code_Point}]+/gu,
          "",
        ),
      }
    : record;
}
export function appendedReasonMatches(value, baseValue, identity, from, to) {
  const records = reasonList(value),
    before = reasonList(baseValue),
    last = records.at(-1);
  return (
    records.length > before.length &&
    before.every((record, i) => isDeepStrictEqual(record, records[i])) &&
    !before.some((record) =>
      isDeepStrictEqual(normalizedReason(record), normalizedReason(last)),
    ) &&
    reasonMatches(value, identity, from, to)
  );
}
export function migrateReasonLists(budget) {
  return {
    ...budget,
    reasons: Object.fromEntries(
      Object.entries(budget.reasons).map(([id, value]) => [
        id,
        structuredClone(reasonList(value)),
      ]),
    ),
  };
}
export function appendReason(budget, identity, record) {
  const records = reasonList(budget.reasons[identity]);
  if (!isDeepStrictEqual(records.at(-1), record)) records.push(record);
  budget.reasons[identity] = records;
}
export function reasonHistoryRegressions(budget, base) {
  const errors = [];
  for (const [identity, value] of Object.entries(base.reasons)) {
    const before = reasonList(value),
      after = reasonList(budget.reasons[identity]);
    if (before.some((record, i) => !isDeepStrictEqual(record, after[i])))
      errors.push("Reason history must append without rewriting: " + identity);
  }
  return errors;
}
