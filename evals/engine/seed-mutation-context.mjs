// Fresh per-recipe state and the original row factories. Expected diagnostics stay authored.
export const devices = "devices/equipment.json",
  wires = "connections/wires.json",
  cables = "cables/cables.json",
  potentials = "potentials/potentials.json",
  type = "library/types/node.json";

function addMutation(rows, id, family, changes, expected, extra = {}) {
  const rules = {
    "required-property": "required-property",
    "property-type": "property-type",
    "unknown-property": "unknown-property",
    "string-pattern": "pattern",
    enum: "allowed",
    cardinality: "cardinality",
    "object-kind": "kinds",
    "manifest-version": "manifest-version",
    "duplicate-identity": "duplicate-identity",
    "duplicate-designation": "duplicate-designation",
    "device-reference": "device-reference",
    "terminal-reference": "terminals",
    "type-reference": "types",
    "type-kind": "type-kind",
    "duplicate-core": "duplicate-core",
    "identical-endpoints": "identical-endpoints",
    "library-reference": "library-reference",
    "library-lock": "library-lock",
    "cable-id": "cable-id",
    "exclusive-landing": "exclusive-landing",
    "potential-rating": "potential-rating",
    "potential-conflict": "potential-conflict",
    "required-connection": "required-connection",
    "deferred-connection": "deferred-connection",
    "partial-potential": "partial-potential",
    "multi-fault": "multi-fault",
    "json-syntax": "json-syntax",
    "json-duplicate": "json-duplicate",
    "ratings-only-pair": "potential-rating",
    "ratings-only": "rating-assessment",
    "symbol-profile": "profile-assessment",
  };
  rows.push({
    id,
    family,
    provenance: [
      family === "enum"
        ? "CO/PU authoring shapes; GI F5"
        : family === "string-pattern"
          ? "GI F5; EA F7"
          : "EA synthetic authoring and guard controls",
    ],
    changes,
    expected,
    predicate: rules[family],
    ...extra,
  });
}

export function createMutationContext() {
  const rows = [];
  const change = (file, pointer, value, op = "set") => ({
    file,
    pointer,
    op,
    ...(op !== "delete" && { value }),
  });
  const diagnostic = (file, jsonPointer, code, severity = "error") => ({
    file,
    jsonPointer,
    code,
    severity,
  });
  const add = (...args) => addMutation(rows, ...args);
  function one(id, family, file, pointer, value, code, extra = {}) {
    add(
      id,
      family,
      [change(file, pointer, value)],
      [diagnostic(file, pointer, code)],
      extra,
    );
  }
  return { rows, add, one, change, diagnostic };
}
