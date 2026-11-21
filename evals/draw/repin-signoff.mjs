// Provenance is recorded, not an identity/independence attestation by the tool.
import assert from "node:assert/strict";
export function signOffs(entry) {
  const validate = (s, counter = false) => {
    assert(
      s &&
        !Array.isArray(s) &&
        Object.keys(s).every((k) => ["kind", "by"].includes(k)),
      "Invalid signOff object",
    );
    assert(
      ["person", "agent"].includes(s.kind),
      "signOff.kind must be person or agent",
    );
    assert(
      typeof s.by === "string" && s.by.trim(),
      "signOff.by must be non-empty",
    );
    assert(
      !counter || s.kind === "person",
      "Countersignatures must be person sign-offs",
    );
    return {
      kind: s.kind,
      by: s.by,
      label: s.kind === "agent" ? "agent review" : "person review",
    };
  };
  assert(entry.signOff, "Missing signOff provenance");
  assert(
    entry.counterSignOffs === undefined || Array.isArray(entry.counterSignOffs),
    "counterSignOffs must be an array",
  );
  const signed = [
    validate(entry.signOff),
    ...(entry.counterSignOffs ?? []).map((s) => validate(s, true)),
  ];
  assert(
    new Set(signed.map((s) => JSON.stringify([s.kind, s.by]))).size ===
      signed.length,
    "Duplicate sign-off",
  );
  return signed;
}
