# Libraries and type shapes

A project dependency is either local or shipped:

```json
[
  {
    "name": "plant-library",
    "version": "1.0.0",
    "path": "libraries/plant"
  },
  { "name": "core", "version": "0.1.0" }
]
```

The first entry is local and the second is shipped. Any explicit portable relative
`path` selects a local user-authored library. Its
root contains `library.json` and the type files declared by that manifest. Omitting
`path` requests an exact shipped library; the shipped set is
`core@0.1.0` and `core@0.2.0`.

Read `node_modules/@thermite/core-library/README.md` under the engine/runtime root, section “L2 interface conventions and limits”, for the terminal scheme and generic power/cordset/pair cable caveats: empty colors mean unknown; shield, size, construction and ratings are unspecified; review both ends and spares.

The lock and IR record `resolutionKind: "local" | "shipped"`. Local provenance
retains the authored path. Shipped core uses internal locator
`ais-shipped:core@<version>` and stable display paths rooted at
`@thermite/core-library`. That locator is not authored source or a registry URL.

A reusable device type defines terminals, functions, internal relations, ratings,
and symbol mapping:

```json
{
  "kind": "device_type",
  "id": "core:contactor-3p-1no",
  "terminals": {
    "A1": {
      "role": "coil",
      "connection_policy": "exclusive",
      "rating": {
        "nominal_voltage": 24,
        "voltage_type": "DC"
      }
    },
    "A2": { "role": "coil_return" }
  },
  "functions": {
    "coil": { "kind": "coil", "terminals": ["A1", "A2"] }
  }
}
```

The compiler materializes type facts on instances. Instance overrides are constrained;
project source cannot casually redefine immutable type terminals or manufacturer
facts.

## Profiles, evidence and byte locks

`type.symbol` selects a reusable profile. Read the runtime catalog with
`thermite guide symbols --json`: it lists aliases, function shapes and each
renderer family's support. [Circuit profiles](circuit-views.md#library-symbols)
and [explicit function marks](circuit-symbols.md) describe the mapping constraints.
A matching profile does not guarantee a connected root or printable layout.
Never infer a terminal role, pinout or electrical rating from a profile or name.

A local library contains `library.json` with `name`, `version` and
`sources` (relative paths or globs for JSON type source files). The type file
contains a `types` array of `device_type` and/or `cable_type` definitions.
Use the visible `libraries/core` files as shape examples, preserving actual
function and terminal facts. A type's `catalog` records exact-part manufacturer,
order number and official document URL/title/revision/pages; see the
[contribution requirements](../CONTRIBUTING.md#component-library-submissions).
[Connection coverage](completeness.md) distinguishes reviewed generic interfaces,
partial models and complete exact-part models. Generic does not mean certified.

After an intentional library change, run:

```sh
thermite lock .
thermite lock . --check
thermite validate .
```

The lock binds exact library bytes. Never hand-edit it or refresh it merely to
silence a mismatch. The guarded patch tool cannot edit libraries or `system.json`.
See [agent requests](agent-requests.md) for patch eligibility and integrity guards.

## Runtime limits and optional libraries

The runtime ships only `core@0.1.0` and `core@0.2.0`; init copies core 0.2.0 to
`libraries/core` and locks that local copy. None of the repository's optional `libraries/*` ship in the runtime. The complete
current inventory is:

| Optional library | Ships in the runtime? |
| --- | --- |
| `abb-pilot` | No |
| `field-interfaces` | No |
| `industrial-pilot` | No |
| `murr-pilot` | No |
| `phoenix-terminal-pilot` | No |
| `releco-pilot` | No |
| `schneider-pilot` | No |
| `siemens-et200pro-pilot` | No |
| `siemens-pilot` | No |
| `stahl-pilot` | No |
| `weidmueller-pilot` | No |

Examples and CLI fixtures also do not ship. A name/version-only reference to
any optional library fails with E032; it cannot download that library.
Thermite has no library registry, automatic fetch or optional-library installer.

The [Siemens pilot inventory](../libraries/siemens-pilot/README.md) documents its
exact supported parts and exclusions. The [field-interfaces inventory](../libraries/field-interfaces/README.md)
contains proposed generic interfaces, not verified universal M12 pinouts.
The [analog-output example](../packages/cli/fixtures/analog-output/source.json)
and [request](../packages/cli/fixtures/analog-output/packet.request.json) are source
fixtures, not runtime files. Their hookup contract is available offline in
[signal loops](signal-loops.md).

If an optional model is needed, obtain its reviewed files separately from the
source revision linked here, copy the library directory into the electrical
project, reference its explicit local path in `system.json`, then lock and
validate. That acquisition requires source access; the guide itself works
offline. Without the files or verified hardware facts, report the limitation
and retain the unresolved engineering work. Do not invent a substitute pinout.

For engine changes, the [engine guide](../AGENTS.md) and
[contribution workflow](../CONTRIBUTING.md) are source references. A human must
read and accept the CLA. Runtime agents can prepare an issue draft without
reading engine source or patching their installation.
