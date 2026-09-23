# Machine Documentation Demo

This synthetic two-cabinet example uses illustrative equipment and wiring.

# Thermite Schematics project guide

This project uses the TypeScript + ELK alpha. Run the project's pinned Thermite
checkout with `bun /absolute/path/to/thermite/thermite.mjs`.
The source checkout needs the Bun 1.4.2 and `bun install --frozen-lockfile && bun run build`
once. Use that same checkout for every command; upgrade it deliberately.

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
Other kinds: `terminals`, `bom`, `wires`, `cables`; `--device PLC1` limits terminal
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
