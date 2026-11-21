# Project workflow recipes

## Printing

Commands default to the current project. `validate`/`lock` accept a positional
path or `--project <path>`. If supplied together, both must resolve to the same path.

```sh
thermite view PS1 --loads -o drawings/ps1-loads.pdf
thermite view CBL1 --conductors -o drawings/cbl1.html
thermite view PS1 --power # R002: AC input PS1.L is unfed
```

Roots (else R001): `--power` a load with mapped load terminals (motor or PS1 AC
input),
`--actuation` a mapped two-terminal coil,
`--loads` a source/return pair (PS1), `--conductors` a cable (else Q002),
and `--to <device> [--include-power]` a one-NO switch or three-wire sensor
(`core:limit-switch-2wire`, `core:prox-pnp-3wire`). Roots bind by `symbol` and function shape, not type ID; cloned core types keep their views. `--flow left-to-right|top-to-bottom`,
`--paper letter|tabloid|a4|a3`, `--orientation landscape|portrait`,
`--margin <mm>` (5-25), `--layout compact` and `--index` override project page
settings. `-o` writes `.html` (all sheets), `.pdf`, `.json`, or `.svg` for one
sheet (R006 otherwise).
Packet JSON `html` matches `.html` byte for byte. Text fitting uses bundled fonts.
Circuit bodies reserve space between split terminal captions and symbol strokes.

Cards name omissions. Continuations print the intact identity and peer `sheet.zone`
at 2.5 mm. Unnamed jumpers print `JUMPER` with the reciprocal reference.
Use one form per bank and a 2.5 mm gap. Audit with circuit/wiring views and packet coverage.
Flows may fold retained strips.
Network and assembly reports use the authored designation, then the printed endpoint pair, then the authored description. A blank reference needs source review.
One caption/terminal appearance, nearest its body; keep exact landings and split captions.
Omit net ink only when its anchored terminal prints the same name.

Packet: `format: "schematic-packet-request/0.1"`, optional `page`, `layout:
"compact"`, `index: true`, and `views`: `schematic-view-request/0.1` (`family:
"power"|"control"`) or `0.2` (loads/conductors/trace).
Page: packet/presentation, never views.
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

Print at 100% on matching paper; disable browser headers/footers.
Rooted legends key designation to description/part per UID/sheet; bands repaginate.
Rail/cable tags key owned terminals once per UID/page.
Em ≥2.7/2.5 mm; columns ≤50 mm, 3 mm clear. R006 gives device/field sizes.
Never omit/shrink text.

## Component libraries

Init copies `core@0.2.0` to `libraries/core`; 0.1.0 locks persist.
system.json selects path/version; electrical-system.lock.json pins bytes.
After edits: `thermite lock .`, then validate (else E107/E108).
Starter PS1.L/N are required but deferred: strict fails W905; cabinets passes.
Invent no pins/ratings; retain manufacturer document/revision and review notes.
See `thermite guide libraries` for optional-library limits.

## Multi-conductor cables

`thermite cable CBL1 --json` lists all physical cores. Cable `fromLocation`/`toLocation`: ends A/B. Conductor `endpoints`: two slots, A then B. `usage`: `in-use` or `spare`. Only explicit spares allow null endpoints. Two real ends stay connected even for spares; one real end still occupies its terminal. Omitted cores are unassigned, never spare. Missing usage is unspecified; without usage/locations, cables use canonical end order. Shielding implies no bond.

## Reports/review

Packets may append required companion inventories; requested filters stay unchanged.
Include appended sheets when reviewing page counts.

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
See `thermite guide report-filtering`. PLC addresses/spares: device `io`;
never infer spare from a missing connection.
E202 checks channel keys and duplicate addresses (case-insensitive), not PLC
byte/word overlap or programming validity.

`thermite continuity --input <file>` checks a `continuity-check-request/0.1`
with `checks: [{id, reason, from, to}]` (terminal selectors as in `net` queries)
and exits 1 for unmodeled declared paths.

```sh
thermite snapshot -o drawings/before.json
thermite review --before drawings/before.json --json
```

Snapshot before edits; review after the guarded workflow, then regenerate.
Semantic review cannot replace source/lock/presentation review or engineering
judgment. UIDs identify devices; page numbers may change.

`thermite watch --input packet.json -o drawings/packet.html` polls declared inputs 1 s after work finishes; failures retain the previous packet.
`.pdf` is direct vector PDF with physical paper dimensions and fonts.
Unsupported PDF glyphs fail; use supported labels or SVG/HTML.

## Export a delivery

After the final edit, validate the project, generate the files together, and
inspect the drawings. Check freshness again just before handoff.

```sh
thermite validate .
thermite export bundle --project . --input delivery.request.json --out-dir drawings
thermite export check --project . --input delivery.request.json --out-dir drawings --json
```

Save a strict `export-delivery-request/1` JSON file with a nonempty `jobs` array.
Each job declares its output formats and filenames. Resolve command-line paths
from the working directory, job inputs from the project directory, and output
filenames from the delivery directory. Use forward slashes for nested paths.

```json
{
  "format": "export-delivery-request/1",
  "jobs": [
    {
      "kind": "packet",
      "input": "packet.request.json",
      "index": true,
      "strict": false,
      "outputs": {
        "json": "packet.json",
        "html": "packet.html",
        "pdf": "packet.pdf"
      }
    },
    {
      "kind": "view",
      "designation": "M1",
      "intent": "power",
      "flow": "top-to-bottom",
      "outputs": { "html": "motor-power.html", "pdf": "motor-power.pdf" }
    },
    {
      "kind": "view",
      "designation": "K1",
      "intent": "actuation",
      "outputs": { "pdf": "actuation.pdf" }
    },
    { "kind": "report", "report": "bom", "outputs": { "csv": "bom.csv" } },
    {
      "kind": "report",
      "report": "terminals",
      "filter": "cabinet.filter.json",
      "outputs": { "csv": "terminals.csv" }
    },
    { "kind": "diagnostics", "outputs": { "json": "completeness.json" } },
    {
      "kind": "cable",
      "designation": "CBL1",
      "outputs": { "json": "cable.json" }
    },
    {
      "kind": "review",
      "before": "before.json",
      "outputs": { "json": "review.json" }
    }
  ]
}
```

- **Packet.** Use an existing packet request. Optional `page` (`size`,
  `orientation`, `marginMm`), `layout` and `index: true` apply the same overrides
  as packet flags. `strict: true` rejects compiler or packet coverage warnings.
- **View.** Choose `power`, `actuation`, `loads`, `conductors` or `trace`.
  Trace also takes `to` and optional `includePower`. Use either drawing flow
  and the same page, layout and index settings as `view`. Packet and view
  jobs also support `svg` for a single sheet. Use HTML, PDF or JSON for
  multiple sheets.
- **Report.** Use any `thermite report <kind>` kind. Use `filter` for a named filter
  or `device` where the standalone report accepts it. CSV uses the same
  columns, selection and row policy as `thermite report <kind> -o <file>.csv`. A report job
  can also issue printable formats with the same page, layout and index
  settings as a standalone report.
- **Diagnostics.** The completeness inventory supports optional `device`
  or exact `location` scope and the standalone JSON, CSV and TXT formats.
- **Cable and review.** Cable uses a designation. Review uses the JSON
  baseline saved with the snapshot command before the edit.

The bundle compiles once. It stages the requested files, rechecks the source
and request bytes, and publishes `export-manifest.json` last. The manifest
records the expected files, their hashes, the effective export options and
warning scopes. The CLI reports compiler diagnostics once and reports packet
coverage on the packet job.

A failure before publication preserves the previous generation. Check that
generation against current inputs before relying on it. If publication stops
partway, rerun the bundle to replace the incomplete delivery. The bundle checks
its output directories for publication locks before compiling. It automatically
clears a lock when the recorded host is local and the owner PID no longer
exists. If a lock remains after the writer exits, verify that no publisher
is using the delivery, remove the `.thermite-export.lock` directory and its
owner metadata at the path reported by the CLI, then rerun the bundle.

For a custom delivery, opt in to sidecars as in
`thermite view M1 --power -o <file>.pdf --receipt`. The same flag is available
for named report, packet, diagnostics, cable and review exports. Keep each
receipt sidecar beside its artifact. List the expected options and
files in a delivery request and run
`thermite export check --input <file> --out-dir <dir> --receipts`.

The check hashes inputs and files without laying out drawings. Exit 0 means
fresh, 1 means stale or invalid, and 2 means usage or infrastructure failure.
JSON output includes machine-readable reason codes and paths. Format-only
source and request edits count as changes. A timestamp edit with identical
bytes preserves freshness.

## Communication links

Types may declare `ports` with `medium: "ethernet"|"nrg-bus"` and a `connector`.
An `associated_with` relation accepts `connection` with `fromPort`, `toPort`,
`medium`, `protocol`, and optional `status: "planned"|"verified"`. E204 checks
declared ports, media and exclusive port occupancy. Links never join nets;
protocol and status are author claims, implying no pinouts, shielding, PoE or
live communications.

Packets draw them with `{"format": "communication-view-request/0.1", "medium":
"ethernet"}`, optionally `devices: ["PLC1", "RIO1"]`: links touching a listed
device, with each far end as a boundary device without its other links. A
`network` report lists every link and unconnected port; an unconnected port is
not automatically spare.

## Field hookups

Packets accept `signal-loop-view-request/0.1` with
`from: {device: "PT1", function: "signal"}`, `to: {device: "AI1", function:
"ch0"}`, optional `flow` and up to six short `notes`: a two-wire transmitter,
authored cordset, continuous bulkhead contacts, optional feed-through terminals
and the input channel. Opt-in `field-interfaces` offers proposed M12 profiles. See `thermite guide signal-loops` for series power.
Channels: address or proven AI/AO/DI/DO/IN/OUT; notes: tag/terminals, no keys.

Both paths must be complete and unbranched, with every traversed cable core
represented; extra cores must be explicitly spare and terminated at both ends.
Loose cores, active cores outside explicit auxiliary pairs or hidden branches
fail R006: inspect them in a conductor view, and never change connectivity just
to obtain a drawing. A bulkhead pin is one continuous terminal with front/rear
access, not a function that shorts contacts. Symbols are not connector face views; verify sensor/cordset pins for the part.

Molded cordset overview: add `cableAssemblies: [{cable: "CB1", connector:
"M12", description: "4-pole molded cordset (proposed)"}]`: one jacket line with
connector ends and the actual pin map, never merging nets. Omit it for core/color
detail. Descriptions are presentation claims, not manufacturer facts; loose or
hidden branched cores still fail.

`enclosures: [{label: "Main cabinet", devices: ["XP1", "XT1", "AI1"],
wallDevice: "XP1"}]` draws location boundaries. Membership must be explicit,
unique and contiguous in the chain; location strings never imply it. An optional wall device must be first/last, have a bulkhead profile and accompany interior devices.

For powered analog actuators, `from` may be a two-terminal output channel and
`to` a two-terminal function on a `thermite:analog-actuator` profile. Up to two
`auxiliary: [{from: {device: "XT1", function: "aux1"}, to: {device: "V1",
function: "supply"}}]` pairs show explicit power in the same chain; each must be
complete, unbranched, forward in the chain and on separate nets. No supply or
command/power commoning is inferred. Mark unfinished feeds and provisional
pinouts in source descriptions and view notes.

## Connection completeness

`thermite diagnostics --json`: all declared terminals/ports, required connections, incomplete models and review dispositions. `--device HMI1`/`--location "HMI console"` scopes it; `-o audit.csv`: full connection table. Compiler diagnostics: stderr.

Library terminals/ports may declare `required: true`. Give new device types
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
points, spares and unreviewed models stay informational. A single-ended
cable core cannot satisfy a required connection. Connectivity proves no supply, voltage, protection, bond or safety. Mark unused only with
explicit user intent. Power view switch gangs: ink/R006.

## Wiring/communication records

Packets accept `wiring-view-request/0.1` with `title`, unique `conductors`
(wire/jumper tags or UIDs, or cores terminated at both ends such as `CBL1/1+`),
optional `notes`, and optional `deviceOrder` listing every included device. These
horizontal views show selected physical wiring; `[ +N ]` marks other connections
at a terminal, and omitted terminals are counted. Add terminal/wire schedules for
complete detail. Continuity through functions is not inferred. Oversize
selections fail R006.

Communication `connection.cable` requires `specification`; optional `lengthM`
(≥0.001 m) and `route` appear in network schedules/reviews, apart from electrical
cable inventories. Conduit implies no shield or protective bond.

## Circuit drawings

Packets accept `circuit-view-request/0.1` with `title`, `groups`, optional
`flow`, `columns: 1|2` and `notes`. Groups have unique `id`, optional `label`/`lineReference`, `conductors` and `functions` selectors, e.g.
`{device: {by: "designation", value: "PLC1"}, key: "do0"}`. Use real function
keys and conductor identities. Empty conductors show unconnected functions, not spares. Group order sets presentation; order functions by reading stage (PLC outputs, terminal points, interlocks, coils). First appearance sets device display order.

Tags: designation ≥2.7 mm; instance/else-type description and catalog part ≥2.5 mm. Selected functions retain terminals, wire numbers and references.
`properties.label` prints a wire's number, independent of source identity;
repeated labels never join nets. Boundary counts show unselected connections;
circuit views are not completeness audits. ELK owns placement/routing. Large
groups split into numbered parts with whole conductors; R006 means a
conductor, coupled symbol or label cannot fit. Narrow selection or use larger
paper; never change topology to fit. References use kind/state and terminals;
I/O address/terminals; ports key plus authored description. Cable headings use
type description or state its absence. Function keys/type IDs stay in
metadata/CSV.
Attachment/tag-lane rays: lightest incident ink; unused faces: 0.35 mm.

Library `circuitSymbols` maps function keys to closed-catalog marks; main/auxiliary contact marks may differ. E206
checks function existence, kind, terminal count and contact state.
Read `thermite guide circuit-symbols` before disconnector or receptacle selection.
Also read `thermite guide circuit-views`; never guess marks; check
links/earth/DC ink in both flows. Marks create no continuity or bonds.

Reconstruction: record page/line provenance, separate aliases from verified pins, retain conflicts for review, assert critical endpoints/nets.

One repeat per device/view/sheet; fixed local slots, else own sheet.zone.
Repeat text keeps 4 mm horizontally from overlapping text bands; centroids
round half-up to 0.01 mm.

Mirrors: direct same-device coil/contact `actuates`; authored state/terminals, full locations or `not drawn`; no guessed counts. Fixed slots keep geometry/type. Local by ink: same sheet, ≤60 mm, adjacent zone, nearest coil frame; else heading has /ss.zone. Returns: all coils; native gangs/equal targets: caption/issued fragment. Notes add no pages; no vacancy: R006. Pairs: – unless bare keys have the same (possibly empty) letter prefix and integers >1 apart, or printed names have -/–/−/+; else /, or comma if they have /.

For packet frames, use presentation 0.3 named slots; see `thermite guide drawing-frames`.
Enter only supplied title/revision data. Unknown fields stay labelled blank;
unknown revision stays `UNSPECIFIED` and remains unmet at issue review.
Preview the whole packet after frame changes; handle R006 honestly.

Terminal plans link strips to inventory rows; single-sheet SVG exports retain the inventory without strip references.
Schedules can point to painted strip landings.
