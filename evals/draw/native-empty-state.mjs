// native-empty-state/1: shared M3 delivery and DQ-19 null-policy vocabulary.
// These describe absent source facts, never inferred peers, protocols or values.
export const explicitEmptyStates = {
  "no-same-location-connections": [
    "No connections",
    "No same-location connections",
  ],
  "no-other-location-connections": [
    "No connections",
    "No other / unspecified location connections",
  ],
  "unspecified-status": ["Not specified", "Status not specified"],
  "unspecified-medium": ["Not specified", "Protocol / medium not specified"],
};
const legacy = (state) => (state.startsWith("no-") ? "None" : "Unspecified");
const compact = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/\s/gu, "");
export const nativeEmptyState = (state, suffix = "") => {
  if (!explicitEmptyStates[state]) throw Error("Unknown native empty state");
  return { nativeEmptyState: state, suffix };
};
export function matchesNativeEmptyState(value, expected) {
  const forms = explicitEmptyStates[expected.nativeEmptyState];
  if (!forms || value === undefined) return false;
  const actual = compact(value),
    suffix = compact(expected.suffix);
  if (!actual.endsWith(suffix)) return false;
  const state = suffix ? actual.slice(0, -suffix.length) : actual;
  return [...forms, legacy(expected.nativeEmptyState)].some(
    (form) => state.toLowerCase() === compact(form).toLowerCase(),
  );
}
export const isExplicitEmptyState = (text) =>
  Object.values(explicitEmptyStates)
    .flat()
    .some(
      (form) => compact(text).toLowerCase() === compact(form).toLowerCase(),
    );
export const isNullPlaceholder = (text) =>
  /^(None|Unspecified|null)$/i.test(text);
