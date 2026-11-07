# Thermite Schematics project guide

This TypeScript + ELK alpha uses Bun 1.4.2. Here `thermite` means
`bun <thermite>/thermite.mjs`; use one runtime/source folder's absolute path
(ask if unknown), separate from this project. No `thermite` is on PATH.
Never install/build in a downloaded runtime. Source checkouts need
`bun install --frozen-lockfile && bun run build` before use and
after engine changes.

```sh
thermite init ../conveyor --name "Conveyor 1"
thermite init ../cabinets --template cabinets
```

`init` needs a new directory. The default `starter` template has PS1, a 24 VDC
supply feeding PLC1; `cabinets` has TB1 and TB2 joined by cable CBL1 (two used,
two spare cores). `--name` sets `project.name`, the title-block heading.

When using a runtime package, report bugs, missing capabilities, and unclear
documentation at https://github.com/BlackettApplied/ThermiteSchematics/issues
after checking existing issues. Include the use case, expected and actual
behavior, a minimal reproduction, relevant diagnostics, Thermite/Bun versions and
operating system; redact hostnames and absolute paths from A005/W801 diagnostics.
Without GitHub access, write a ready-to-submit issue title and body. Do not patch
a downloaded runtime in place.

From source, make focused engine fixes in the separate engine checkout and open a
pull request following its AGENTS.md and CONTRIBUTING.md, keeping this project's
private machine data and credentials out of issues and pull requests. The human
contributor must accept any CLA; an agent must not sign it.
`thermite guide` lists topics, schemas and diagnostic codes.

## Authority and workflow

Electrical JSON is authoritative. PDF, SVG and HTML are generated outputs. Never
hand-author schematic geometry, infer an engineering repair, or suppress compiler
diagnostics. Device functions do not automatically join physical nets.

To change existing source or presentation files:

`validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view`

The six stateless tools run as `thermite agent <tool> --input <file|->`. Every
request has `"format": "agent-tool-request/0.1"` and `"project": "."`. stdout
carries the result, on success only; stderr always carries the report
(diagnostics and error). Keep streams separate. Exit 0 means success, 1 an
authored/expected failure, and 2 usage or infrastructure failure. Diagnostics may
carry `allowed`, `allowedCount`, `allowedLookup` (where to read the full list)
and `pattern`.

- `validate`: no other fields.
- `resolve`: `target: {by: "uid"|"designation"|"type"|"text", value}`.
- `inspect`: `selector: {by: "uid"|"designation", value}`.
- `query`: `query: {operation: "neighbors"|"trace"|"cable", selector: {by: "uid"|"designation", value}}`,
  or `query: {operation: "net", selector: {by: "display", value: "PS1.+"}}`.
- `apply-source-patch`: `patchFormat: "json-patch/0.1"`, `dryRun`, and `files`,
  each with `path`, current `expectedIntegrity` and JSON Patch `operations`
  (`test`, `add`, `remove`, `replace` only). Dry-run first, review the result,
  then apply the same request with `dryRun: false`. Only existing referenced
  source and presentation files qualify (A003 otherwise): not `system.json`,
  the library lock, libraries or this guide. Per-file atomicity and snapshot
  guards apply.
- `create-view`: `spec`, one schematic view request without `page`. It returns
  the original continuous SVG, or a cable's complete core sheet; a view needing
  several sheets fails R006, so use the printing commands below.

Applies (not dry runs) reserve `.thermite-schematics-write.lock` in the canonical
project root through revalidation, commit and rollback; it is not the library
lock. Never commit it (alpha `init` adds it to `.gitignore`). A005/exit 1 reports
contention with the exact path, owner PID/hostname/version, creation time and age.
Wait for a live owner. A dead PID on the recorded host indicates abandonment:
confirm all writers are stopped, then remove exactly that path. Check the host of
an unknown/other-host owner; age alone is insufficient. Re-inspect and rebuild
the patch after another edit; do not just copy a new integrity into an old
request. On POSIX the CLI releases on unhandled SIGINT/SIGTERM/SIGHUP then
re-raises; embedded hosts keep their own handlers, and signal-revoked writes fail
closed. Forced termination may leave the reservation. A commit whose release
fails stays successful with W801 naming the path: verify the committed state
instead of replaying, and remove the leftover once that command has exited and no
other writer runs. Failed applies also name any leftover path. Rollback refuses
changed chains or bytes; an incomplete restore is exit 2 and lists restored and
unrestored files with reasons.

Get guards from agent `inspect`/`resolve` with `include: ["source"]`: use
`source.file` as `files[].path` and `source.integrity` as `expectedIntegrity`
(one entry per file; `sourceFiles` also covers empty sources and presentation).
Patch only `patchEligible: true` sources. Pointers are pre-patch positions:
immediately before each object's edits add
`{"op":"test","path":"<source.pointer>/uid","value":"<source.uid>"}`; escape
appended segments (`~`→`~0`, `/`→`~1`). After A004, re-inspect and rebuild.
When compilation fails (no guards returned), hash the raw source bytes and guard
a schema or semantic repair with UID tests; see `thermite guide agent-requests`.
Invalid JSON needs an ordinary edit, then validation. Make UUIDs with the second line:

```sh
bun -e "const b=require('fs').readFileSync(process.argv[1]);console.log('sha256-'+require('crypto').createHash('sha256').update(b).digest('base64'))" devices/equipment.json
bun -e "console.log(crypto.randomUUID())"
```

New files, `system.json` and libraries are ordinary file edits; list new source
files in `system.json` `sources`, then validate. Every new object needs a fresh
lowercase UUID `uid` (uppercase fails E013). Wire, jumper and cable-core
endpoints and potential `at` are `{"device": "PLC1", "terminal": "X2.0"}`: a
designation and an exact, case-sensitive terminal key (E101/E102 otherwise).
Dotted `PLC1.X2.0` is display syntax only. Function keys are not terminal keys:
core `plc-compact` function `do0` is terminal `X2.0`. Take UIDs and keys from
`inspect`, never from names. An `exclusive` terminal takes one conductor (E201).

Voltage checks (E300-E302) run only on nets that carry a `potential`
(`{uid, kind: "potential", name, at, electrical: {nominal_voltage, voltage_type}}`).
Terminal ratings never create one, even on a source: 480 VAC wired to a 24 VDC
input warns W303 (ratings disagree) until potentials declare voltage_type.
I304/I305 list unassessed multi-/single-rated nets; I208 lists skipped checks.
Info exits 0, even with `--strict`. The starter declares only +24VDC and 0VDC
at PS1; declare potentials at the sources you add.

Write large outputs to files: `create-view` returns tens of KB and
`inspect` several KB; `view`, `packet` or `report` without `-o` print a whole
HTML document.

## Printable drawings

Commands default to `--project .`; `validate`/`lock` also take a path, never both
(`thermite validate . --strict`).

```sh
thermite view PS1 --loads -o drawings/ps1-loads.pdf
thermite view CBL1 --conductors -o drawings/cbl1.html
thermite view PS1 --power # R002: AC input PS1.L is unfed
```

Each view needs a matching root, else R001: `--power` a load with mapped load
terminals (a motor, or PS1's AC input), `--actuation` a mapped two-terminal coil,
`--loads` a source with source/return terminals (PS1), `--conductors` a cable (else
Q002), and `--to <device> [--include-power]` only a switch with one NO contact or
a three-wire sensor (`core:limit-switch-2wire`, `core:prox-pnp-3wire`). Roots
bind by `symbol` and function shape, not type ID, so a cloned core type keeps its
views. `--flow left-to-right|top-to-bottom`,
`--paper letter|tabloid|a4|a3`, `--orientation landscape|portrait`,
`--margin <mm>` (5-25), `--layout compact` and `--index` override project page
settings. `-o` writes `.html` (all sheets), `.pdf`, `.json`, or `.svg` for a
single sheet only (R006 otherwise).

Rooted views are bounded: unequal parallel paths and authored conductors at drawn
terminals can be omitted without markers. Audit with circuit/wiring views and
packet coverage.

Packet: `format: "schematic-packet-request/0.1"`, optional `page`, `layout:
"compact"`, `index: true`, and `views`: `schematic-view-request/0.1` (`family:
"power"|"control"`) or `0.2` (loads/conductors/trace).
Page settings: packet/presentation, never views.
W906: undrawn devices in drawing packets; warnings exit 0 or 1 with `--strict`.
This packet puts every starter device on a schematic sheet; for `cabinets`, use
root `CBL1` and intent `conductors`.

```json
{
  "format": "schematic-packet-request/0.1",
  "index": true,
  "views": [
    {
      "format": "schematic-view-request/0.2",
      "root": { "by": "designation", "value": "PS1" },
      "intent": { "kind": "loads" }
    },
    { "format": "documentation-view-request/0.1", "kind": "bom" }
  ]
}
```

```sh
thermite packet --input packet.json -o drawings/packet.pdf
```

Print at 100% on matching paper and disable browser headers/footers.

## Visible component libraries

Init copies `core@0.2.0` to `libraries/core`; 0.1.0 locks persist.
system.json selects path/version; electrical-system.lock.json pins bytes.
After edits run `thermite lock .`, then validate (E107/E108 otherwise).
Starter PS1.L/N are required but deferred: strict fails W905; cabinets passes.
Invent no pins/ratings; keep manufacturer document/revision and review notes.
See `thermite guide libraries` for optional-library limits.

## Multi-conductor cables

`thermite cable CBL1 --json` lists every physical core. Cable `fromLocation` /
`toLocation` name end A / end B. Conductor `endpoints` has exactly two slots,
ordered A then B. `usage` is `in-use` or `spare`. Only an explicitly spare core
can have a null endpoint. Two real endpoints remain connected even for a spare;
one real endpoint still occupies its terminal. An omitted core is unassigned,
never implicitly spare. A core without usage is unspecified; a cable with no
usage or locations uses canonical end order. Shield construction never implies a
shield bond.

## Reports and change review

```sh
thermite report <bom|wires|cables|terminals|io|io-ports|network|assemblies> -o drawings/report.csv
```

`--device PLC1` scopes `terminals`, `io` and `io-ports`. Any kind accepts
`--filter <file>` (or `-`), a device/type/location filter, but not with
`--device`; packets use `{"format": "documentation-view-request/0.1", "kind":
"network", "filter": {"devices": ["PLC1"]}}`. Filters keep whole incident rows,
peer details, cable inventories and endpoint-free records; CSV selection metadata
is on stderr, packets expose `documentationSelections`. With `index: true`,
`references: {"appearances": "drawings", "filter": {...}}` scopes only the
reference index; `references: false` omits reference pages.
See `thermite guide report-filtering`. PLC addresses and spare usage
live in the device's `io` object; never infer spare from a missing connection.
E202 checks channel keys and duplicate addresses (case-insensitive), not PLC
byte/word overlap or programming validity.

`thermite continuity --input <file>` checks a `continuity-check-request/0.1`
with `checks: [{id, reason, from, to}]` (terminal selectors as in `net` queries)
and exits 1 when a declared path is not modeled.

```sh
thermite snapshot -o drawings/before.json
thermite review --before drawings/before.json --json
```

Snapshot before a change; review after the guarded workflow, then regenerate the
packet. Semantic review does not replace source/lock/presentation review or
engineering judgment. UIDs identify devices; page numbers may change.

`thermite watch --input packet.json -o drawings/packet.html` polls declared inputs
one second after work finishes; failures preserve the previous packet.
`.pdf` is direct vector PDF with physical paper dimensions and fonts.
Unsupported PDF glyphs fail explicitly; use supported labels or SVG/HTML.

## Communication connections

Types may declare `ports` with `medium: "ethernet"|"nrg-bus"` and a `connector`.
An `associated_with` relation can carry `connection` with `fromPort`, `toPort`,
`medium`, `protocol`, and optional `status: "planned"|"verified"`. E204 checks
declared ports, media and exclusive port occupancy. These links never join nets;
protocol and status are author claims, implying no pinouts, shielding, PoE or
live communications.

Packets draw them with `{"format": "communication-view-request/0.1", "medium":
"ethernet"}`, optionally `devices: ["PLC1", "RIO1"]`: links touching a listed
device, with each far end as a boundary device without its other links. A
`network` report lists every link and unconnected port; an unconnected port is
not automatically spare.

## Field-device hookup pages

A packet can include `signal-loop-view-request/0.1` with
`from: {device: "PT1", function: "signal"}`, `to: {device: "AI1", function:
"ch0"}`, optional `flow` and up to six short `notes`: a two-wire transmitter,
authored cordset, continuous bulkhead contacts, optional feed-through terminals
and the input channel. The opt-in `field-interfaces` library supplies proposed
generic M12 profiles. See `thermite guide signal-loops` for limits and fixtures.

Both paths must be complete and unbranched, with every traversed cable core
represented; extra cores must be explicitly spare and terminated at both ends.
Loose cores, active cores outside explicit auxiliary pairs or hidden branches
fail R006: inspect them in a conductor view, and never change connectivity just
to obtain a drawing. A bulkhead pin is one continuous terminal with front/rear
access, not a function that shorts contacts. Numbered symbols are not connector
face views; sensor/cordset pin assignments remain subject to part review.

For a molded cordset overview, add `cableAssemblies: [{cable: "CB1", connector:
"M12", description: "4-pole molded cordset (proposed)"}]`: one jacket line with
connector ends and the actual pin map, never merging nets. Omit it for core/color
detail. Descriptions are presentation claims, not manufacturer facts; loose or
hidden branched cores still fail.

`enclosures: [{label: "Main cabinet", devices: ["XP1", "XT1", "AI1"],
wallDevice: "XP1"}]` draws location boundaries. Membership must be explicit,
unique and contiguous in the chain; location strings never imply it. The optional
wall device must be the first or last member, have a bulkhead profile and
accompany interior devices.

For a powered analog actuator, `from` may be a two-terminal output channel and
`to` a two-terminal function on a `thermite:analog-actuator` profile. Up to two
`auxiliary: [{from: {device: "XT1", function: "aux1"}, to: {device: "V1",
function: "supply"}}]` pairs show explicit power in the same chain; each must be
complete, unbranched, forward in the chain and on separate nets. No supply or
command/power commoning is inferred. Mark unfinished feeds and provisional
pinouts in source descriptions and view notes.

## Connection completeness

Run `thermite diagnostics --json` for all declared terminals/ports, required
connections, incomplete models and review dispositions. `--device HMI1` or
`--location "HMI console"` focuses it; `-o audit.csv` writes the full connection
table. Compiler diagnostics remain on stderr.

Library terminals and ports can declare `required: true`. Give new device types
`connectionCoverage: {status: "complete"|"partial"|"generic", notes: "..."}` with
nonblank notes. Complete reviews all an exact part's physical connections; generic
reviews an abstract interface without exact-part catalog facts (E014 otherwise).
I005 reports generic limits and notes once per device. Missing coverage is
unreviewed; a model omitting its own interface's connections stays partial.
Never invent pins for completeness.

On a device, `connectionReview.terminals`, `.ports` and `.connectorPorts` map
declared keys to `{status: "required"|"intentionally-unused"|"deferred", reason:
"..."}` with a nonblank reason. Use required for application-specific
connections. Deferred work remains visible even on connected terminals, and
unused notes cannot waive a library requirement. Unknown keys fail E205.

W903 flags non-deferred required points not fully connected, W904 partial models,
and W905 deferred or contradictory reviews; preserve them. Optional unconnected
points, spares and unreviewed models stay visible as information. A single-ended
cable core does not satisfy a required connection. Connected does not prove an
upstream supply, correct voltage, protection, bonding or safety. Never mark
points unused just to clear a finding.

## Terminal wiring and communication cable records

Packets accept `wiring-view-request/0.1` with `title`, unique `conductors`
(wire/jumper tags or UIDs, or cores terminated at both ends such as `CBL1/1+`),
optional `notes`, and optional `deviceOrder` listing every included device. These
horizontal views show selected physical wiring; `[ +N ]` marks other connections
at a terminal, and omitted terminals are counted. Add terminal/wire schedules for
complete detail. Continuity through functions is not inferred. Oversize
selections fail R006.

A communication relation's `connection.cable` requires `specification` and may
add `lengthM` (at least 0.001 m) and `route`, shown in network schedules and
reviews apart from electrical cable inventories. A conduit route does not imply
a shield or protective bond.

## Function-based circuit drawings

Packets also accept `circuit-view-request/0.1` with `title`, `groups` and
optional `flow`, `columns: 1|2` and `notes`. Each group has a unique `id`,
optional `label` and `lineReference`, `conductors`, and `functions` selectors
such as `{device: {by: "designation", value: "PLC1"}, key: "do0"}`. Use real
function keys and conductor identities. An empty conductor list shows unconnected
functions without implying spare status. Group order is presentation, not
connectivity; order functions by reading stage (PLC outputs, terminal points,
interlocks, coils), as a device's first appearance sets its display order.

The view draws selected functions from a closed symbol catalog with terminal
labels, wire numbers and cross-references. A wire's `properties.label` is its
printed number, separate from its source identity; repeated labels never join
nets. Boundary counts expose connections outside the selection; a circuit view is
not a completeness audit. ELK owns placement and routing. A group too large for
one sheet splits into numbered parts that keep each conductor whole; R006 means
a conductor, coupled symbol or label still cannot fit. Narrow the selection or
use a larger sheet; never change topology to obtain a drawing.

Library `circuitSymbols` maps real function keys to explicit closed-catalog marks,
for example different marks for a device's main and auxiliary contacts. E206
checks function existence, kind, terminal count and contact state.
Follow `thermite guide circuit-symbols` and `thermite guide circuit-views`; never
infer a mark from a tag or part-number substring. Marks do not create continuity
or bonds.

Reconstructing a drawing: record page/line provenance, separate aliases from
verified pins, preserve conflicting labels as review issues, and assert critical
endpoints and nets independently.
