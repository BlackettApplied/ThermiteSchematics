# Data Model

## Authority and versions

Thermite Schematics stores project and presentation facts in version-controlled JSON.
`electrical-system/0.1` remains the project format. M8 adds two compatible manifest
extensions: an optional `presentation` reference and a name/version-only dependency
arm for shipped libraries. Electrical topology remains `electrical-ir/0.1`;
presentation normalizes separately as `project-presentation/0.1`.

Source describes physical and functional engineering facts. Locks bind library bytes.
Derived nets, reverse indexes, normalized views, layout, SVG, reports, and serialized
IR are never authoritative source.

## Project documents

The initialized project shape is:

```text
AGENTS.md
system.json
presentation.json
electrical-system.lock.json
devices/equipment.json
connections/control-power.json
potentials/potentials.json
```

`system.json` names the project, source patterns, optional presentation file, and
exact libraries. Source files may group multiple objects; file boundaries are a
source-management concern, not electrical identity.

`presentation.json` contains:

```json
{
  "format": "project-presentation/0.1",
  "revision": "A",
  "backgroundColor": "#ffffff",
  "titleBlock": { "lines": ["Motor starter reference"] }
}
```

Revision is 1-128 Unicode code points. The background is lowercase `#rrggbb`. The
optional title block has zero to four ordered single-line strings of 1-160 code
points. Presentation changes drawing identity and canvas only; it does not change
electrical IR or semantic view selection.

## Identity and designation

Every meaningful project entity has:

- an immutable lowercase canonical RFC 4122/9562 `uid`, version 1 through 8 with
  the RFC variant;
- a human-facing designation where appropriate;
- a closed `kind`; and
- optional description and aliases where its schema permits them.

```json
{
  "uid": "0195f2cc-1234-7123-8123-123456789abc",
  "kind": "device",
  "designation": "K1",
  "type": "core:contactor-3p-1no",
  "description": "Conveyor motor contactor"
}
```

Renaming a designation does not create a new entity. Designations and terminal keys
are opaque strings subject to their source constraints; the compiler does not infer
electrical meaning from naming conventions.

## Library references and types

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
`path` requests an exact shipped library; the closed shipped set is currently
`core@0.1.0`.

The lock and IR record `resolutionKind: "local" | "shipped"`. Local provenance
retains the authored path. Shipped core uses internal locator
`ais-shipped:core@0.1.0` and stable display paths rooted at
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

## Devices and terminal references

A project device is an occurrence of one exact library type:

```json
{
  "uid": "0195f2cc-1234-7123-8123-123456789abc",
  "kind": "device",
  "designation": "K1",
  "type": "core:contactor-3p-1no",
  "description": "Conveyor motor contactor",
  "location": "PANEL1"
}
```

Terminals normally live in the type and are materialized into IR. Source addresses a
terminal structurally:

```json
{ "device": "K1", "terminal": "A1" }
```

Dotted `K1.A1` is display/CLI syntax only. It is not source syntax. The compiler
resolves structured references to stable UID-based identity.

`connection_policy: "exclusive"` permits at most one direct conductor landing;
`"shared"` explicitly permits several. Absence makes no exclusivity assertion.

## Physical conductive entities

A wire owns exactly two endpoints:

```json
{
  "uid": "0195f2cc-2234-7123-8123-123456789abc",
  "kind": "wire",
  "designation": "W104",
  "endpoints": [
    { "device": "K1", "terminal": "A1" },
    { "device": "PLC1", "terminal": "X2.14" }
  ],
  "properties": {
    "label": "104",
    "size": "18AWG",
    "color": "blue"
  }
}
```

Devices do not redundantly list incident wires. The compiler derives reverse indexes.
Jumpers use the same two-endpoint conductive semantics.

A cable is a typed physical assembly whose authored conductors each have an ID and
two endpoints:

```json
{
  "uid": "0195f2cc-3234-7123-8123-123456789abc",
  "kind": "cable",
  "designation": "CBL104",
  "type": "core:cable-2pair-shielded",
  "conductors": [
    {
      "id": "1",
      "endpoints": [
        { "device": "JB1", "terminal": "X1.1" },
        { "device": "LS1", "terminal": "1" }
      ]
    }
  ]
}
```

The cable type supplies invariant conductor metadata. Every authored conductor
becomes independently addressable in IR.

## Functional relations

Not every engineering relationship is conductive. Project relations and
component-internal functions describe facts such as actuation, protection, control,
measurement, monitoring, and mechanical ganging.

```json
{
  "uid": "0195f2cc-4234-7123-8123-123456789abc",
  "kind": "relation",
  "relation": "protects",
  "from": { "device": "CB1" },
  "to": { "device": "M1" }
}
```

These relations do not join electrical nets unless a specific conductive source
entity also owns endpoints.

## Derived nets and declared potentials

An electrical net is a compiler-derived connected component of wires, jumpers, and
cable conductors. It is not authored as a repeated list of terminals.

A potential declares intended electrical facts at one structural terminal:

```json
{
  "uid": "0195f2cc-5234-7123-8123-123456789abc",
  "kind": "potential",
  "name": "+24VDC",
  "at": { "device": "PS1", "terminal": "+" },
  "electrical": {
    "nominal_voltage": 24,
    "voltage_type": "DC",
    "polarity": "positive"
  }
}
```

The compiler propagates the declaration across the derived conductive net. Conflicting
potential declarations or incompatible terminal ratings produce deterministic
diagnostics. A physical conductor, a derived net, and declared electrical intent are
distinct concepts.

Endpoint array order does not imply universal upstream/downstream direction. Direction
used for one view comes from supported terminal/function semantics and that view's
context, not from wire orientation or designation text.

## Electrical IR and presentation

Successful compilation produces a detached, normalized IR containing devices,
materialized terminals, conductive entities, nets, typed relations, effective
electrical properties, source provenance, reverse indexes, and local/shipped library
provenance.

The successful compile also returns detached presentation:

```text
format: project-presentation/0.1
revision: authored value or UNSPECIFIED
backgroundColor: authored value or #ffffff
titleBlockLines: authored order or empty
```

The renderer combines IR, a normalized semantic view, and that presentation only at
render time. It owns symbol geometry, layout, one opaque canvas, and the visible title
block. No source entity stores X/Y coordinates, bends, pages, or generated SVG.

## Normalization rules

Stable authored and generated diffs rely on:

- immutable UIDs and explicit references;
- schema-defined object field order and semantic array order;
- canonical writer formatting with UTF-8, LF, and one final newline;
- no authored reverse indexes, derived nets, geometry, timestamps, or host paths;
- exact library versions plus content integrity; and
- explicit local/shipped provenance in every newly written lock and IR.

The model intentionally does not simulate contact state, energization, current flow,
voltage drop, protective-device coordination, or code compliance. More advanced
engineering rules require deterministic domain definitions and reviewed provenance;
they are not inferred by an agent.
