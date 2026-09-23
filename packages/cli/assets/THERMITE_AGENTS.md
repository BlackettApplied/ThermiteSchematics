# Thermite Schematics project guide

This project uses the TypeScript + ELK alpha. Run its pinned Thermite runtime
package or source checkout with `bun /absolute/path/to/thermite/thermite.mjs`.
Use Bun 1.4.2 and the same runtime folder for every command; upgrade deliberately.
A downloaded runtime package is ready to use: do not install dependencies or
build inside it. A source checkout needs
`bun install --frozen-lockfile && bun run build` before use, and a rebuild after
engine changes. Keep the runtime or engine checkout separate from this project.

When you find a bug, missing capability, or unclear documentation, clone
https://github.com/BlackettApplied/ThermiteSchematics into a separate engine
checkout (or use your existing one), make a focused fix, and contribute it
upstream following its AGENTS.md and CONTRIBUTING.md. Do not patch a downloaded
runtime in place. Keep this project's machine data out of engine pull requests.
The human contributor must review and accept any CLA; an agent must not sign it.
Advanced documentation and examples referenced below live in that source repository.

## Authority and workflow

Electrical JSON is authoritative. PDF, SVG and HTML are generated outputs. Never
hand-author schematic geometry, infer an engineering repair, or suppress compiler
diagnostics. Device functions do not automatically join physical nets.

For changes to existing electrical source or presentation files, follow:

`validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view`

The six stateless commands under `thermite agent` accept JSON via `--input file`
or `--input -`. Use `format: "agent-tool-request/0.1"` and `project` in every
request. Results are on stdout; diagnostic reports are on stderr. Keep streams
separate. Exit 0 means success, 1 means an authored/expected failure, and 2 means
usage or infrastructure failure.

- `validate`: no other fields.
- `resolve`: `target: {by: "designation", value: "PS1"}`.
- `inspect`: `selector: {by: "designation", value: "PS1"}`.
- `query`: for example `query: {operation: "cable", selector: {by: "designation", value: "CBL1"}}`.
- `apply-source-patch`: `patchFormat: "json-patch/0.1"`, `dryRun`, and `files`.
  Each file requires its current `expectedIntegrity` and JSON Patch `operations`.
  Dry-run first, review the result, then apply the same request with `dryRun: false`.
  Only add/remove/replace/test operations on existing referenced source or
  presentation documents are allowed. Per-file atomicity and snapshot guards
  apply. The patch tool cannot create/delete/rename files or change the manifest,
  lock, libraries, or this guide.
- `create-view`: `spec` containing an existing schematic view request. Legacy sources retain the original continuous SVG contract. Annotated cables
  return the complete core sheet; inventories that need multiple sheets return
  R006 and must use the printing commands below.

Resolve current UIDs, terminal keys, and source hashes through inspection; never
reuse illustrative hashes. Newly created source files must be explicitly
referenced by system.json and validated. File creation and library authoring are
ordinary file operations, outside apply-source-patch.

## Printable drawings

`thermite view M1 --power --project . -o drawings/motor-power.html`

Other views: `--actuation`, `--loads`, `--to PLC1 --include-power`, and
`--conductors` for a cable. Flow can be `left-to-right` or `top-to-bottom`.
`--paper letter|tabloid|a4|a3` and `--orientation landscape|portrait` override the
project's page settings. SVG is a vector image. HTML contains all SVG sheets and
responsive screen/print styling. A multi-sheet drawing requires HTML, PDF or JSON;
the CLI refuses to silently save only its first sheet to SVG.

`thermite packet --project . --input packet.request.json -o drawings/packet.html`

A packet request contains `format: "schematic-packet-request/0.1"`, optional
shared `page`, optional `layout: "compact"`, optional `index: true`, and a
`views` array of schematic or documentation view requests. Use
`schematic-view-request/0.1` with `family: "power"|"control"` for power/actuation,
or `schematic-view-request/0.2` with a loads, conductors, or trace intent.
Page settings belong to the packet or presentation, never an individual view.
Print at 100% on matching paper and disable browser headers/footers.

## Visible component libraries

The generic core library lives in `libraries/core`. Its source JSON files are
editable and readable by people and agents. system.json references its relative
path; electrical-system.lock.json pins its bytes. Run `thermite lock .`
after an intentional library change, then validate. Do not invent manufacturer
ratings or pin assignments; keep the manufacturer's document/revision and review
notes alongside any new types. The source checkout includes a small `siemens-pilot` library; use its exact
document references and exclusions. It is not copied by generic initialization.

## Multi-conductor cables

`thermite cable CBL1 --project . --json` lists every physical core.
Cable `fromLocation` / `toLocation` name end A / end B. Conductor `endpoints`
contains exactly two slots, ordered A then B. `usage` is `in-use` or `spare`.
Only an explicitly spare core can have a null endpoint. Two real endpoints
remain connected even for a spare; one real endpoint still occupies its terminal.
An omitted core is unassigned, never implicitly spare. Legacy assignments without
usage remain unspecified. Shield construction never implies a shield bond.

## Reports and change review

`thermite report io --project . -o drawings/io.csv` exports every declared channel.
Other kinds: `terminals`, `bom`, `wires`, `cables`, `network`; `--device PLC1` limits terminal
or I/O reports. For packets use `{ "format": "documentation-view-request/0.1",
"kind": "io" }`. Address and usage assignments live in the device's `io` object;
never infer spare status from missing connections. E202 checks channel keys and
exact duplicate addresses, not PLC byte/word overlap or programming validity.

Before a change, use `thermite snapshot --project . -o drawings/before.json`.
After the guarded workflow, use `thermite review --project . --before
 drawings/before.json --json` and regenerate the packet. Semantic review does not
replace source/lock/presentation review or engineering judgment. Persistent UIDs
identify devices; page numbers may change as the drawing grows.

`thermite watch --project . --input packet.request.json -o drawings/packet.html`
checks declared inputs once per second and preserves the previous packet on
failure. Keep diagnostics visible and refresh the HTML after successful builds.
Use `.pdf` for direct vector PDF output with physical paper dimensions and fonts.
Unsupported PDF glyphs fail explicitly; use supported labels or SVG/HTML.

## Communication connections

Types may declare `ports` with `medium: "ethernet"|"nrg-bus"` and a connector
description. An `associated_with` relation can carry `connection` with
`fromPort`, `toPort`, `medium`, `protocol`, and optional `status: "planned"|"verified"`.
E204 checks declared ports, media and exclusive port occupancy. These links
never join electrical nets; protocol and verification status are author claims.
Do not infer pinouts, shielding, PoE or live communications from them.

For packet diagrams use `{ "format": "communication-view-request/0.1",
"medium": "ethernet" }`, optionally with `devices: ["PLC1", "RIO1"]`.
Filtered views retain adjacent boundary devices and their incident links.
Include a `network` report to show the complete link inventory and unconnected
ports. An unconnected port is not automatically spare. Use the guarded workflow
for relation edits and lock/validate after changing library port definitions.

## Field-device hookup pages

A packet can include `signal-loop-view-request/0.1` with
`from: {device: "PT1", function: "signal"}` and
`to: {device: "AI1", function: "ch0"}`, optional `flow` and up to six short
`notes`. This shows a two-wire transmitter, authored cordset, continuous bulkhead
contacts, optional feed-through terminals and the selected input channel.
The opt-in `field-interfaces` library supplies proposed generic M12 profiles.
Use the engine's `docs/signal-loops.md` and its minimal source fixture.

Both paths must be complete and unbranched. Every traversed cable core is represented;
extra cores must be explicitly spare and terminated at both ends. Loose cores,
additional active cores outside explicit auxiliary pairs or hidden branches fail with R006. Use a conductor view
to inspect these cases; do not modify connectivity just to obtain a drawing.
A bulkhead pin is one continuous terminal with front/rear access, not a function
that shorts different contacts. Numbered symbols are not connector face views.
Exact sensor/cordset pin assignments remain subject to selected-part review.

For a molded cordset overview, add `cableAssemblies: [{cable: "CB1", connector:
"M12", description: "4-pole molded cordset (proposed)"}]`. It draws one jacket
line with connector ends and an actual pin map; it never merges electrical nets.
Omit this option for individual core/color detail. Assembly descriptions are
explicit presentation claims, not inferred manufacturer facts. Loose/unassigned
or hidden branched cores still fail; do not collapse them to hide missing data.

Add `enclosures: [{label: "Main cabinet", devices: ["XP1", "XT1", "AI1"],
wallDevice: "XP1"}]` to show location boundaries. Membership must be explicit,
unique and contiguous in the shown chain. The optional wall device must be the
first or last member, have a bulkhead profile and accompany interior devices.
Location strings alone do not establish cabinet membership. See `docs/signal-loops.md`
for limits and examples; these display options do not alter electrical source.

For a powered analog actuator, `from` may select a two-terminal output channel
and `to` a two-terminal function on a `thermite:analog-actuator` profile. Add
`auxiliary: [{from: {device: "XT1", function: "aux1"}, to: {device: "V1",
function: "supply"}}]` to show an explicit power pair within the same chain.
At most two auxiliary pairs are supported; every pair must remain complete,
unbranched, forward in the chain, and on separate nets. No power supply or
command/power commoning is inferred. Mark unfinished feeds and provisional
connector pinouts in source descriptions and view notes. See `docs/signal-loops.md`
and the engine's `packages/cli/fixtures/analog-output` example.

## Connection completeness

Run `thermite diagnostics --project . --json` for all declared terminals/ports,
required connections, incomplete models and review dispositions. Use `--device
HMI1` or `--location "HMI console"` for a focused inventory, and `-o audit.csv`
for a full connection table. Compiler diagnostics remain on stderr.

Library terminals and ports can declare `required: true`. Declare
`connectionCoverage: {status: "complete"|"partial", notes: "..."}` on new device
types; review every physical connection, including power, return, bonding,
shield and optional connectors. Missing coverage is unreviewed; a partial model
must state its omissions. Never invent pins to make a model appear complete.

On a device, `connectionReview.terminals` and `connectionReview.ports` map declared
keys to `{status: "required"|"intentionally-unused"|"deferred", reason: "..."}`.
Use required for application-specific connections. Every review needs a nonblank
reason. Deferred work remains visible even on connected terminals, and unused
notes cannot waive a library requirement. Unknown keys fail validation. Use the
guarded patch workflow for existing device-source review changes.

W903 flags required points without a complete connection, W904 flags partial
models, and W905 flags deferred or contradictory review entries. Preserve these
warnings. Optional unconnected points, intentional spares and unreviewed models
remain visible as information in the audit. A single-ended cable core does not
satisfy a required connection. Connected does not prove an upstream supply path,
correct voltage, protection, bonding or electrical safety. Do not infer an
engineering repair or mark unused solely to clear a finding.

## Terminal wiring and communication cable records

Packets accept `wiring-view-request/0.1` with `title`, a unique `conductors` list
(wire/jumper tags or UIDs, or cable/core names such as CBL1/A), optional `notes`,
and optional `deviceOrder` listing every included device. These horizontal views
show selected physical wiring; `[ +N ]` marks other connections at a terminal,
and omitted device terminals are explicitly counted. Include terminal/wire
schedules for complete detail. Device internals and electrical continuity through
functions are not inferred. Oversize selections fail R006.

A communication relation's `connection.cable` may contain `specification`,
`lengthM` (at least 0.001 m) and `route`. These appear in network schedules and semantic
reviews, independently of electrical cable/core inventories. A conduit route
note does not imply a shield or protective bond.

## Function-based circuit drawings

Packets also accept `circuit-view-request/0.1` with `title`, `groups`, optional
`flow`, optional `columns: 1|2`, and optional `notes`. Each group has a unique
`id`, optional `label` and `lineReference`, a `conductors` list, and a `functions`
list of `{device: {by: "designation", value: "K1"}, key: "coil"}` selectors.
Resolve actual function keys and conductor identities before authoring a request.
Empty conductor lists can show declared unconnected functions; they do not imply
spare status. Group order is presentation intent, not electrical connectivity.
Order function selections by intended reading stages: for example, PLC outputs,
terminal points, interlocks, then coils. The first appearance of each device
guides its display order; list all thermocouple sensors before terminal points
and the input module to keep the sensors on the same side of that module.

This view shows selected functions using a closed symbol catalog, with terminal
labels, wire numbers and references to other appearances in the packet. A wire's
`properties.label` preserves its printed number separately from its unique source
identity. Repeated labels never join nets. Boundary counts expose connections
outside the selection; a circuit view is not a completeness audit. ELK owns
placement and routing. Oversize groups fail R006; narrow the selection or choose
a larger sheet without changing the source topology to obtain a drawing.

Library `circuitSymbols` maps real function keys to explicit closed-catalog marks.
Use it when one device needs different marks for its main and auxiliary contacts.
E206 checks function existence, kind, terminal count and contact state. Follow
the engine's `docs/CIRCUIT_SYMBOLS.md` and `docs/circuit-views.md`; never infer a
mark from a tag or part-number substring. Marks do not create continuity or bonds.
After an intentional library edit, lock and validate the project again.

When reconstructing an existing drawing, record page/line provenance, distinguish
reference aliases from verified physical pins, and preserve conflicting labels
as review issues. Keep independent endpoint and net assertions for critical
branches. A plausible catalog match is a candidate until its physical terminal
mapping has been established from manufacturer evidence.
