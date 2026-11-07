// Maintainer recipe; expected diagnostics below are authored assertions, never
// learned from the compiler. Review changed expectations like checker changes.
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { corpus, json } from "./support.mjs";
const devices = "devices/equipment.json",
  wires = "connections/wires.json",
  cables = "cables/cables.json",
  potentials = "potentials/potentials.json",
  type = "library/types/node.json";
export function mutationRecipe() {
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
  function add(id, family, changes, expected, extra = {}) {
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
  function one(id, family, file, pointer, value, code, extra = {}) {
    add(
      id,
      family,
      [change(file, pointer, value)],
      [diagnostic(file, pointer, code)],
      extra,
    );
  }
  for (const field of ["uid", "designation", "type"])
    add(
      `missing-${field}`,
      "required-property",
      [change(devices, `/objects/0/${field}`, null, "delete")],
      [diagnostic(devices, `/objects/0/${field}`, "E010")],
    );
  for (const [field, value] of [
    ["description", 2],
    ["aliases", "alias"],
    ["location", false],
    ["type", 3],
  ])
    one(
      `type-${field}`,
      "property-type",
      devices,
      `/objects/0/${field}`,
      value,
      "E011",
    );
  for (let i = 0; i < 3; i++)
    one(
      `extra-device-${i}`,
      "unknown-property",
      devices,
      `/objects/${i}/invented`,
      true,
      "E012",
    );
  for (const [id, field, value] of [
    ["uuid", "uid", "NOT-A-UUID"],
    ["uuid-upper", "uid", "ABCDEF00-1234-5123-8123-123456789ABC"],
    ["tag-space", "designation", " X1"],
    ["type-unqualified", "type", "node"],
    ["tag-control", "designation", "X\u0001"],
  ])
    one(id, "string-pattern", devices, `/objects/0/${field}`, value, "E013", {
      predicate: "pattern",
    });
  for (const [id, file, pointer, value] of [
    ["voltage-enum", potentials, "/objects/0/electrical/voltage_type", "dc"],
    ["cable-usage", cables, "/objects/0/conductors/0/usage", "used"],
    ["relation-enum", wires, "/objects/4/relation", "connects"],
    [
      "review-enum",
      devices,
      "/objects/0/connectionReview",
      { terminals: { L: { status: "unused", reason: "Synthetic" } } },
    ],
  ]) {
    const diagnosticPointer =
      id === "review-enum"
        ? "/objects/0/connectionReview/terminals/L/status"
        : pointer;
    add(
      id,
      "enum",
      [change(file, pointer, value)],
      [diagnostic(file, diagnosticPointer, "E014")],
      {
        predicate: "allowed",
      },
    );
  }
  for (let i = 0; i < 3; i++)
    one(
      `endpoint-count-${i}`,
      "cardinality",
      wires,
      `/objects/${i}/endpoints`,
      [],
      "E015",
    );
  for (let i = 0; i < 2; i++)
    one(
      `kind-${i}`,
      "object-kind",
      devices,
      `/objects/${i}/kind`,
      "widget",
      "E016",
      { predicate: "kinds" },
    );
  one(
    "manifest-format",
    "manifest-version",
    "system.json",
    "/format",
    "electrical-system/99.0",
    "E017",
  );
  one(
    "duplicate-uid",
    "duplicate-identity",
    devices,
    "/objects/1/uid",
    "@copy:/objects/0/uid",
    "E020",
  );
  add(
    "duplicate-designation",
    "duplicate-designation",
    [change(devices, "/objects/2/designation", "X1")],
    [
      diagnostic(devices, "/objects/2/designation", "E100"),
      diagnostic(cables, "/objects/0/conductors/0/endpoints/1/device", "E101"),
      diagnostic(cables, "/objects/0/conductors/1/endpoints/1/device", "E101"),
      diagnostic(cables, "/objects/0/conductors/2/endpoints/0/device", "E101"),
    ],
  );
  for (let i = 0; i < 3; i++)
    one(
      `missing-device-${i}`,
      "device-reference",
      wires,
      `/objects/${i}/endpoints/0/device`,
      "ABSENT",
      "E101",
    );
  for (let i = 0; i < 3; i++)
    one(
      `terminal-${i}`,
      "terminal-reference",
      wires,
      `/objects/${i}/endpoints/0/terminal`,
      "ABSENT",
      "E102",
      { predicate: "terminals" },
    );
  for (let i = 0; i < 2; i++)
    one(
      `unknown-type-${i}`,
      "type-reference",
      devices,
      `/objects/${i}/type`,
      "core:absent",
      "E103",
      {
        predicate: "types",
      },
    );
  one(
    "wrong-device-type",
    "type-kind",
    devices,
    "/objects/0/type",
    "core:cable-2pair-shielded",
    "E104",
  );
  one(
    "wrong-cable-type",
    "type-kind",
    cables,
    "/objects/0/type",
    "core:terminal-block-8",
    "E104",
  );
  one(
    "duplicate-core",
    "duplicate-core",
    cables,
    "/objects/0/conductors/1/id",
    "1+",
    "E021",
  );
  add(
    "identical-endpoints",
    "identical-endpoints",
    [change(wires, "/objects/0/endpoints/1", { device: "PS1", terminal: "+" })],
    [diagnostic(wires, "/objects/0/endpoints/1", "E024")],
  );
  one(
    "function-terminal",
    "library-reference",
    type,
    "/types/0/functions/contact/terminals/0",
    "ABSENT",
    "E025",
  );
  add(
    "library-drift",
    "library-lock",
    [change(type, "/types/0/description", "Synthetic drift")],
    [diagnostic(type, "", "E108")],
  );
  for (let i = 0; i < 2; i++)
    add(
      `unknown-core-${i}`,
      "cable-id",
      [change(cables, `/objects/0/conductors/${i}/id`, "ABSENT")],
      [diagnostic(cables, `/objects/0/conductors/${i}`, "E200")],
    );
  add(
    "exclusive",
    "exclusive-landing",
    [change(wires, "/objects/0/endpoints/1", { device: "N1", terminal: "d" })],
    [diagnostic(wires, "/objects/2/endpoints/1", "E201")],
  );
  for (const [id, value, code] of [
    ["voltage-type", "AC", "E301"],
    ["voltage-rating", 480, "E302"],
  ])
    add(
      id,
      "potential-rating",
      [
        change(
          potentials,
          `/objects/0/electrical/${code === "E301" ? "voltage_type" : "nominal_voltage"}`,
          value,
        ),
      ],
      [diagnostic(potentials, "/objects/0", code)],
    );
  add(
    "potential-conflict",
    "potential-conflict",
    [
      change(potentials, "/objects/-", {
        uid: "00000000-0000-5000-8000-000000000001",
        kind: "potential",
        name: "OTHER",
        at: { device: "X1", terminal: "1" },
        electrical: { nominal_voltage: 24, voltage_type: "DC" },
      }),
    ],
    [diagnostic(potentials, "/objects/1", "E300")],
  );
  add(
    "required-terminal",
    "required-connection",
    [change(type, "/types/0/terminals/f/required", true)],
    [diagnostic(devices, "/objects/3", "W903", "warning")],
    { relock: true },
  );
  add(
    "disjoint-faults",
    "multi-fault",
    [
      change(wires, "/objects/0/endpoints/0/device", "ABSENT"),
      change(wires, "/objects/1/endpoints/0/terminal", "ABSENT"),
    ],
    [
      diagnostic(wires, "/objects/0/endpoints/0/device", "E101"),
      diagnostic(wires, "/objects/1/endpoints/0/terminal", "E102"),
    ],
  );
  for (const [id, electrical, code] of [
    ["ratings-voltage", { nominal_voltage: 24 }, "E302"],
    ["ratings-type", { voltage_type: "DC" }, "E301"],
  ])
    add(
      id,
      "ratings-only-pair",
      [
        change("objects.json", "/objects/-", {
          uid: "00000000-0000-5000-8000-000000000002",
          kind: "potential",
          name: "TEST",
          at: { device: "N1", terminal: "a" },
          electrical,
        }),
      ],
      [
        diagnostic("objects.json", "/objects/2", code),
        ...(id === "ratings-voltage"
          ? [
              diagnostic(
                "objects.json",
                "/objects/1/endpoints/0",
                "W303",
                "warning",
              ),
            ]
          : []),
      ],
      { fixture: "ratings-pair" },
    );
  // V2 #37: each potential leaves precisely the conflicting field undeclared.
  for (const [field, rating, electrical] of [
    [
      "voltage_type",
      { nominal_voltage: 24, voltage_type: "AC" },
      { nominal_voltage: 24 },
    ],
    [
      "nominal_voltage",
      { nominal_voltage: 5, voltage_type: "DC" },
      { voltage_type: "DC" },
    ],
  ])
    add(
      `partial-potential-missing-${field}`,
      "partial-potential",
      [
        change(type, "/types/0/terminals/b/rating", rating),
        change("objects.json", "/objects/-", {
          uid: "00000000-0000-5000-8000-000000000003",
          kind: "potential",
          name: "PARTIAL",
          at: { device: "N1", terminal: "a" },
          electrical,
        }),
      ],
      [diagnostic("objects.json", "/objects/1/endpoints/0", "W303", "warning")],
      {
        fixture: "ratings-pair",
        relock: true,
        missingField: field,
        provenance: [
          "V2 #37; Helm V2 decision 1; synthetic declared ratings only",
        ],
      },
    );
  // V2 #78: unconnected and single-ended required gaps have one W905 each.
  for (const state of ["unconnected", "dangling"])
    add(
      `deferred-required-${state}`,
      "deferred-connection",
      [
        change(type, "/types/0/terminals/f/required", true),
        change(devices, "/objects/3/connectionReview", {
          terminals: {
            f: {
              status: "deferred",
              reason: "Synthetic feed design is pending.",
            },
          },
        }),
        ...(state === "dangling"
          ? [
              change(cables, "/objects/0/conductors/3/endpoints/0", {
                device: "N1",
                terminal: "f",
              }),
            ]
          : []),
      ],
      [
        {
          ...diagnostic(devices, "/objects/3", "W905", "warning"),
          message: `N1: Required terminal N1.f is ${state} (${state === "dangling" ? "has only a cable core with an unfinished far end" : "has no connection"}). Deferred work: Synthetic feed design is pending.`,
        },
      ],
      {
        relock: true,
        provenance: [
          "V2 #78; Helm V2 decision 3; synthetic required connection and authored deferral",
        ],
      },
    );
  add("ratings-without-potential", "ratings-only", [], [], {
    fixture: "ratings-pair",
  });
  add(
    "unsupported-profile",
    "symbol-profile",
    [change(type, "/types/0/symbol", "eval:unsupported")],
    [],
    {
      relock: true,
    },
  );
  add(
    "truncated-json",
    "json-syntax",
    [{ file: devices, raw: '{"objects":[' }],
    [diagnostic(devices, "", "E002")],
  );
  add(
    "duplicate-member",
    "json-duplicate",
    [{ file: devices, duplicateMember: "kind" }],
    [diagnostic(devices, "/objects/0/kind", "E003")],
  );
  const kinds = ["device", "wire", "jumper", "cable", "potential", "relation"];
  const typeIds = [
    "breaker-3p",
    "cable-2pair-shielded",
    "contactor-3p-1no",
    "junction-box-8",
    "limit-switch-2wire",
    "motor-3ph",
    "overload-3p-1nc",
    "plc-compact",
    "prox-pnp-3wire",
    "psu-24vdc",
    "pushbutton-nc",
    "supply-480v-3ph",
    "terminal-block-8",
  ]
    .map((name) => `core:${name}`)
    .concat("eval:node")
    .sort();
  const alternatives = {
    "terminal-0": ["L", "N", "+", "-"],
    "terminal-1": ["1", "2", "3", "4", "5", "6", "7", "8"],
    "terminal-2": ["1", "2", "3", "4", "5", "6", "7", "8"],
    "disjoint-faults": ["1", "2", "3", "4", "5", "6", "7", "8"],
    "voltage-enum": ["AC", "DC"],
    "cable-usage": ["in-use", "spare"],
    "relation-enum": [
      "actuates",
      "protects",
      "controls",
      "measures",
      "monitors",
      "feeds",
      "associated_with",
    ],
    "review-enum": ["required", "intentionally-unused", "deferred"],
    "kind-0": kinds,
    "kind-1": kinds,
    "unknown-type-0": typeIds,
    "unknown-type-1": typeIds,
  };
  for (const row of rows)
    if (alternatives[row.id]) row.alternatives = alternatives[row.id];
  const extraTypes = Array.from({ length: 51 }, (_, i) => ({
    kind: "device_type",
    id: `eval:extra-${i}`,
    terminals: {},
    functions: {},
    internal_relations: [],
  }));
  add(
    "unknown-type-many",
    "type-reference",
    [
      ...extraTypes.map((value) => change(type, "/types/-", value)),
      change(devices, "/objects/0/type", "core:absent"),
    ],
    [diagnostic(devices, "/objects/0/type", "E103")],
    {
      relock: true,
      alternatives: [...typeIds, ...extraTypes.map((t) => t.id)].sort(),
    },
  );
  return { format: "thermite-eval-mutations/1.0", cases: rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await writeFile(join(corpus, "mutations.json"), json(mutationRecipe()));
