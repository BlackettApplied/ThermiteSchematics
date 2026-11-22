# Data Model

## Offline schemas and validation

`thermite guide schema` lists every shipped JSON Schema; `thermite guide schema
--json` returns each name, `$id`, `$schema` dialect and absolute installed path.
`thermite guide schema device` serves the original bytes (the filename or `$id`
URL also works); choose
`source-file` for a source document envelope or `device-type` for a library type.
Device I/O, ports and connection reviews are defined within these schemas.

The identifiers remain unchanged. They identify schemas and do not require an
HTTP fetch. To validate a project offline, run `thermite validate <project>`;
the runtime registers all shipped schemas locally, resolves their `$ref` links
by `$id`, and runs the compiler's additional structural and engineering checks.
For an editor or another JSON Schema 2020-12 validator, register every listed
local file under its `$id` and select the matching schema for the document.
Use its built-in dialect support; disable remote retrieval. Validating just an
individual object does not check project references, locks or connectivity.

## Authority and versions

Thermite Schematics stores project and presentation facts in version-controlled JSON.
`electrical-system/0.1` is the project format. Its manifest supports an optional
`presentation` reference and local or name/version-only shipped library references.
Electrical topology remains `electrical-ir/0.1`; presentation is compiled separately.
[Views and packets](views.md) describe printable requests; the
[format reference](formats-and-compatibility.md#cable-assignments) describes cable extensions.

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
libraries/core/library.json
libraries/core/types/*.json
```

`system.json` names the project, source patterns, optional presentation file, and
exact libraries. Source files may group multiple objects; file boundaries are a
source-management concern, not electrical identity.

`presentation.json` can contain the original format:

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
electrical IR or semantic view selection. `project-presentation/0.2` also supports
printable page settings; see [paper and packets](views.md#paper-and-packets).

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

See [libraries and type shapes](libraries.md).

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

An instance may explicitly declare that it is outside purchasing scope with
`nonProcurement: { "reason": "Existing site utility; outside purchasing scope" }`.

This optional device field requires a reason containing non-whitespace text.
The BOM retains the instance and its quantity and marks it `Not purchased` with
that reason. The flag never follows from a type, profile, designation or device
function: a source might also be purchased equipment. Omission makes no claim
that an item has been ordered, selected or approved. See
[report semantics](report-filtering.md#report-columns-and-authored-meaning) and
[compatibility](formats-and-compatibility.md#documentation-and-library-metadata).

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
    { "device": "PLC1", "terminal": "X2.0" }
  ],
  "properties": {
    "label": "104",
    "size": "18AWG",
    "color": "blue"
  }
}
```

The synthetic coil example composes with the starter by adding its separate
return wire, following the [motor-starter control source](../examples/motor-starter/connections/control-chain.json):

```json
{
  "uid": "0195f2cc-2235-7123-8123-123456789abc",
  "kind": "wire",
  "designation": "W105",
  "endpoints": [
    { "device": "K1", "terminal": "A2" },
    { "device": "PS1", "terminal": "-" }
  ]
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
      "id": "1+",
      "endpoints": [
        { "device": "TB1", "terminal": "1" },
        { "device": "TB2", "terminal": "1" }
      ]
    }
  ]
}
```

The cable type supplies invariant conductor metadata. Every authored conductor
becomes independently addressable in IR. Annotated cables can preserve end A/B
ordering and explicitly spare, partially terminated cores; see
[cable assignments](formats-and-compatibility.md#cable-assignments). Missing
assignments never imply spare status.

## I/O assignments and connection review

Instances assign addresses to declared channel function keys, not terminal keys.
The starter PLC's `di0` function uses terminal `X1.0`; its `do0` uses `X2.0`, and `do1` uses `X2.1`.
From the documentation metadata and completeness contracts:

```json
{
  "io": {
    "addressSpace": "iec",
    "channels": {
      "di0": { "address": "%I0.0", "signal": "Start request", "usage": "in-use" },
      "do1": { "address": "%Q0.1", "usage": "spare" }
    }
  },
  "connectionReview": {
    "terminals": {
      "X2.1": { "status": "intentionally-unused", "reason": "Reserved output in this synthetic example." }
    }
  }
}
```

This fragment applies to a device instance. Channels accept `address`, `signal`
and `usage`; they do not accept `description`. E202 rejects unknown channel keys
and duplicate addresses in one address space. Address overlap and PLC online
configuration are not assessed. An unassigned channel is never implicitly spare.
Review reasons and statuses must reflect authored intent; see
[connection completeness](completeness.md) for required/deferred/unused rules.

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

The successful compile also returns detached presentation. The original fields are:

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
