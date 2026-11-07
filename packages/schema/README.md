# `@thermite/schema`

The current source workflow uses Bun 1.4.2. See the [repository quick start](../../README.md).

This private package contains the canonical JSON Schemas, schema-derived TypeScript
source types, strict JSON parser, schema registry, and source-location-aware
diagnostic infrastructure used by Thermite Schematics 0.2.0. It is bundled inside the
private CLI artifact and is not published to a public registry.
The current public Bun runtime and source checkout also use this schema package.

The canonical definitions are the ordinary files in the
[schemas directory](./schemas/).

## Project and presentation documents

`system.json` retains format `electrical-system/0.1`. Its compatible M8 extensions
are one optional portable `presentation` path and the path-optional shipped-library
dependency arm:

```json
{
  "format": "electrical-system/0.1",
  "project": { "name": "Motor Starter Example" },
  "sources": [
    "devices/**/*.json",
    "connections/**/*.json",
    "potentials/**/*.json"
  ],
  "presentation": "presentation.json",
  "libraries": [{ "name": "core", "version": "0.1.0" }]
}
```

An explicit dependency `path` retains the original local-library meaning for every
accepted value. Omitting `path` requests a shipped library by exact name and
version; the shipped set is `core@0.1.0` and `core@0.2.0`.

The referenced presentation uses `project-presentation/0.1`:

```json
{
  "format": "project-presentation/0.1",
  "revision": "A",
  "backgroundColor": "#ffffff",
  "titleBlock": { "lines": ["Motor starter reference"] }
}
```

`revision` is 1-128 Unicode code points. `backgroundColor` is exactly lowercase
`#rrggbb`. The optional closed `titleBlock` contains zero to four ordered
single-line strings of 1-160 code points. Revision and title lines reject TAB, LF,
CR, NEL, LINE SEPARATOR, and PARAGRAPH SEPARATOR. The compiler supplies revision
`UNSPECIFIED`, white background, and no authored lines when the manifest omits
`presentation`.

The existing project-name schema remains exactly a plain JSON string for backward
compatibility. Renderability bounds and complete composed-title checks are enforced
by the renderer rather than by changing the `electrical-system/0.1` loader contract.

## Library lock compatibility

The lock schema keeps its original ID and `lockfile_version: 1`. Each library entry
still requires exactly `version`, `path`, `integrity`, and `files`. The optional
`resolutionKind` is either `local` or `shipped`; absence is accepted on read and
normalizes internally to `local`. Every canonical lock writer emits the field.

Manifest dependency paths are non-empty portable POSIX-style relative paths. Parent
segments remain allowed for local libraries, while POSIX/Windows absolute paths,
drive-relative paths, backslashes, NUL, and C0/C1 controls are rejected.
Presentation paths are project-contained and additionally reject empty, `.`, and
`..` segments.

## Source conventions

Device instances may declare `nonProcurement: { "reason": "Existing site utility" }`.
The optional closed object requires a string reason containing non-whitespace.
The BOM keeps the device and authored quantity, marked `Not purchased` with the
reason; no profile or type implies this flag. The schema and project format IDs
stay unchanged as an additive extension; existing files remain valid, while
older strict runtimes reject the new property. See
[formats and compatibility](../../docs/formats-and-compatibility.md#documentation-and-library-metadata).

Quantities are bare JSON numbers in these canonical units:

| Property          | Canonical unit                                        |
| ----------------- | ----------------------------------------------------- |
| `nominal_voltage` | volts (V)                                             |
| `current`         | amperes (A)                                           |
| `power`           | watts (W)                                             |
| `frequency`       | hertz (Hz)                                            |
| conductor `size`  | trade-designation string, such as `18AWG` or `1.5mm2` |

Source references are structured objects:

```json
[{ "device": "K1" }, { "device": "K1", "terminal": "13/NO" }]
```

These entries demonstrate the `deviceRef` and `terminalRef` forms. Dotted forms
such as `K1.A1` are display and CLI syntax only.

A designation is an opaque, non-empty string with no control characters or leading
or trailing whitespace. Where a `uid` is required, it is lowercase canonical RFC
4122/9562 text, version 1 through 8, with the RFC variant. Identity is separate from
mutable human-facing designation.

Project source objects may be `device`, `wire`, `cable`, `jumper`, `relation`,
or `potential`. Library types may be `device_type` or `cable_type`. Nested
device functions use `coil`, `contact`, `channel`, `source`, `load`, `bus`,
`mechanism`, or `other`.

Device-type terminals may declare `connection_policy: "exclusive"` or
`"shared"`. Absence makes no exclusivity assertion. The compiler copies that
property to materialized terminal IR.

## Validation and generated types

The registry dispatches closed schemas by document and object kind so diagnostics
retain stable JSON Pointer/source anchors. `validateProjectManifest` applies the
supported-format and dependency-name policies after schema validation.
`validateSourceDocument` exposes envelope, kind dispatch, and local structural
validation for an already-parsed source document.

`createInMemoryCanonicalSchemaRegistry()` returns the production in-memory schema
bundle used by deterministic init preparation. It has the same parsed schemas, IDs,
registrations, and validation behavior as filesystem-loaded canonical schemas, with
no schema discovery I/O.

Generated types are committed under `src/generated`. Repository maintainers run
`bun run generate:types` after changing a schema;
`bun run generate:types:check` performs the byte-for-byte drift check used by the
root repository check.

The parsing layer uses `jsonc-parser` 3.3.1 in strict JSON mode. It rejects duplicate
members, invalid tokens, unexpected EOF, and raw control characters while preserving
the syntax-tree offsets needed for deterministic line, column, pointer, and related
locations. CRLF counts as one newline and tabs as one column.

## Valid alternatives in diagnostics

Some diagnostics carry additive repair-discovery fields. Codes, pointers,
severities, and the other fields do not change. `allowed` lists at most 50 valid
alternatives and `allowedCount` gives the size of the complete set. If `allowed` is
truncated, `allowedLookup` names the exact place to read the whole set. Messages
quote at most 10 values and then say `and N more`. No guess is ranked or applied.

| Code   | `allowed`                                            | Order           |
| ------ | ---------------------------------------------------- | --------------- |
| `E014` | The schema `enum` (or `const`) values                | Schema order    |
| `E016` | Valid source object kinds or library type kinds      | Declared order  |
| `E017` | Supported project manifest formats                   | Declared order  |
| `E102` | Terminal keys of the resolved device type            | Code-unit order |
| `E103` | Device or cable type IDs from the resolved libraries | Code-unit order |

`E103` always sets `allowedLookup`, because no command lists types while a project
fails to resolve. It names the `types` entries of the expected kind in the
`sources` files of each resolved library manifest. `E102` names the type's
`terminals` the same way when it truncates. Each lookup names a file you can
open, not the logical `file` used for display. A local library path is relative to
the project manifest directory. The shipped core library is named twice:
`node_modules/@thermite/core-library/library/...` below the runtime package root,
and `packages/core-library/library/...` in a source checkout for 0.1.0;
0.2.0 uses `versions/0.2.0/...` in that package instead. `E013`
pattern failures also carry `pattern`, the raw ECMAScript regular expression, and
their message describes it in words. A pattern without a description is quoted as
`/regex/`.

## Connection coverage

Device types accept `connectionCoverage.status` values `complete`, `partial` and
`generic`, with nonblank notes. Generic means a reviewed abstract interface;
partial still applies to a model missing part of its own interface. The published
schema's catalog-dependent enum rejects generic coverage when exact-part
manufacturer/order-number catalog metadata is declared (E014 at the status).
[Connection completeness](../../docs/completeness.md) defines the review scope,
W904 warnings and informational I005 inventory findings. Diagnostic and agent
report schemas admit I005 with info severity.

## Diagnostic transport schemas

`diagnostic.schema.json` is the closed compiler-diagnostic contract. Its severity
values are `error`, `warning` and `info`. Info is advisory and never changes the
exit status, including strict validation. `agent-tool-report.schema.json` uses
that same diagnostic schema; reports go to stderr for both success and failure.
`agent-tool-result.schema.json` describes the separate successful stdout envelope.
Both envelopes are closed; the tool-specific value and error payload objects
retain their public TypeScript API contracts rather than duplicating those
contracts in the envelope schemas. These schemas are exported through the same
`@thermite/schema/schemas/*` subpath and bundled canonical registry as entity
schemas. Generate their in-memory copies with `bun run generate:types`.
