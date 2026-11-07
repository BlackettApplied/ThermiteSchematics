# `@thermite/cli`

The public alpha runs from a source checkout or a prebuilt runtime package using
Bun 1.4.2. These source-checkout commands start at the repository root. See the
[quick start](../../README.md) for runtime downloads and
[CONTRIBUTING](../../CONTRIBUTING.md) for engine development.

## Source alpha: initialize and inspect

```sh
bun install --frozen-lockfile
bun run build
bun thermite.mjs --help
bun thermite.mjs init ../electrical-project --name "My Electrical Project" --revision A
bun thermite.mjs validate ../electrical-project
bun thermite.mjs inspect PS1 --project ../electrical-project --json
bun thermite.mjs net --device PS1 --terminal + --project ../electrical-project --json
bun thermite.mjs view PS1 --loads --project ../electrical-project -o ../electrical-project/drawings/control-power.html
```

Use a new destination directory: alpha `init <directory>` takes an explicit path
and creates the project plus a visible local core library. Its defaults are name
`Thermite Electrical Project`, revision `A` and template `starter`.
`--template cabinets` instead creates a cable-and-cabinet teaching example.
Read the generated `AGENTS.md` before editing. Keep the engine checkout separate
from electrical project data, and rebuild after engine changes. No global npm
installation is needed for this workflow.

JSON project files are authoritative. HTML, PDF, SVG and serialized IR are
generated output. Existing source and presentation edits use the guarded
validate, inspect, dry-run, apply, validate and create-view workflow described in
the project guide. Local library edits require an intentional `lock` followed by
validation; neither validation nor rendering updates library bytes or the lock.

## Source alpha: repeatable drawings and reports

Save semantic view requests so the same selections can be regenerated after
source changes. A packet accepts a `schematic-packet-request/0.1` JSON file or
stdin with `--input -`; requests select identities and intentions rather than
page coordinates. This repository teaching example combines power, control,
supply, PLC trace and cable views:

```sh
bun thermite.mjs packet --project examples/motor-starter --input examples/alpha/motor-starter.packet.json --index -o alpha-out/motor-starter.html
bun thermite.mjs packet --project examples/motor-starter --input examples/alpha/motor-starter-documentation.packet.json -o alpha-out/motor-starter-documentation.html
bun thermite.mjs report io --project examples/motor-starter --device PLC1 -o alpha-out/plc-io.csv
bun thermite.mjs report terminals --project examples/motor-starter --device TB1 -o alpha-out/terminal-plan.csv
bun thermite.mjs diagnostics --project examples/motor-starter --json
```

The second saved request combines an explicit command-circuit group, the PLC
I/O schedule, terminal-strip plan and field cable hookup in one indexed packet.
It preserves external connections as boundaries and does not claim whole-project
coverage. CSV reports provide the same underlying I/O and terminal inventories.

Packets and views accept `.html`, `.pdf` or `.json` outputs; `.svg` requires a
single sheet. Reports also accept `.csv`. PDF export is built in. Choose matching
paper and 100% scale when printing HTML. Flow and paper orientation are separate
options; unresolved selectors or an unsafe fit fail explicitly instead of
silently dropping connections. A selected view is not proof that the entire
project has been drawn.

For explicit complete circuit groups and authored conductor selections, see
[circuit views](../../docs/circuit-views.md). For terminal marshalling and cable
hookups, see [terminal wiring](../../docs/terminal-wiring.md). For required
connections and model review limits, see
[connection completeness](../../docs/completeness.md). The
[machine demo runbook](../../docs/machine-demo.md) demonstrates a larger packet,
I/O and terminal schedules, and a guarded source change.

Each call compiles fresh against the authoritative source and verified library
lock. Preserve compiler diagnostics on stderr even when JSON results or drawing
files are produced. The six JSON agent commands retain their existing
request/result contracts in the alpha; see the current
[Bun agent request examples](../../docs/agent-requests.md). Its direct printable
CLI is an additional workflow. For development verification use
`bun run test -- <file>` and
`bun run check`; full checks also require Python 3.12 or later.

## Offline reference guide

Use the same launcher in a source checkout or runtime package:

```sh
bun thermite.mjs guide
bun thermite.mjs guide --json
bun thermite.mjs guide agent-requests
bun thermite.mjs guide modeling
bun thermite.mjs guide symbols --json
bun thermite.mjs guide diagnostics W903 --json
bun thermite.mjs guide schema --json
bun thermite.mjs guide schema device
bun thermite.mjs guide --path
```

The index lists topic IDs, titles, read-before triggers and approximate tokens
(served UTF-8 bytes divided by four, rounded up; catalog estimates use text output). Topic output is Markdown on stdout.
The symbol and full E/W/I/R/Q/A/T/INIT diagnostic catalogs come from the running schema package.
Every `agent <tool> --help` prints executable starter requests and accepted literals
from the validators' shared catalog.
Unknown topics or codes exit 2. `--path` prints the directory of resolved, shipped Markdown copies. It matches
`guide <id>` output.
Topics need no repository, Git executable, network or writable installation.
Links to other shipped topics become guide commands; other links point to the
running runtime's source commit (or the source build's Git HEAD).
Optional libraries and linked source fixtures remain separately acquired files;
`guide libraries` explains those limits. Existing `$schema` identifiers are
unchanged; `guide schema [name]` lists installed schemas or serves exact bytes.
Its JSON listing supplies `$id`, `$schema` and local paths. `validate <project>`
loads them locally without fetching their identifiers; `guide modeling` explains
registration in another offline validator.

## Existing commands

For command-specific options, run `bun thermite.mjs <command> --help`, replacing
`<command>` with `validate`, `lock`, `compile`, `inspect`, `neighbors`, `trace`,
`net`, `render` or `agent`. From the repository root, these examples use the
motor-starter reference project:

```sh
mkdir -p alpha-out
bun thermite.mjs compile examples/motor-starter -o alpha-out/motor-starter.ir.json --diagnostics-json
bun thermite.mjs neighbors K1 --project examples/motor-starter --json
bun thermite.mjs trace K1 --project examples/motor-starter --json
bun thermite.mjs render K1 --family control --project examples/motor-starter -o alpha-out/k1-control.svg
bun thermite.mjs net PS1.+ --project examples/motor-starter --json
bun thermite.mjs net --device PS1 --terminal + --project examples/motor-starter --json
```

`compile -o` writes canonical `electrical-ir/0.1`; `--diagnostics-json` writes
diagnostics as JSON on stderr. `neighbors` lists immediate device neighbors;
`trace` follows conductive topology from the device. Direct `render` writes SVG
and requires `--family control` or `--family power`; the selected root must
support that family. See the [view reference](../../docs/views.md) for higher-level
views and packets.

The positional `net` form chooses the longest exact compiled device-designation
prefix before a dot. Use `--device` with `--terminal` to pass exact parts when
either contains dots. Exactly one addressing form is required. For structured
queries and edits, see [agent requests](../../docs/agent-requests.md) and the
[guarded patch contract](../agent-tools/README.md#integrity-guarded-source-patches).

The [private runtime command reference](../../docs/legacy/cli-private-runtime.md)
preserves the original runtime's installation, initialization and command text.

## Local libraries

Name/version-only dependencies are reserved for libraries shipped with
Thermite Schematics; the shipped set is `core@0.1.0` and `core@0.2.0`.
Init selects 0.2.0; alpha init copies it into `libraries/core`. Existing copies
and locks never update automatically. See the [core version and migration guide](../core-library/README.md).
Core 0.2.0's reviewed generic interfaces produce info I005 in `diagnostics`,
with no I003 or W904. The starter's required, deferred PS1.L/N feed still produces
W905, so `validate --strict` exits 1 until that work is completed. Fresh
cabinets strict validation exits 0. To author a local library,
use an explicit portable relative `path` in `system.json`, put its manifest in
`library.json`, put its declared type sources below that directory, and run
`thermite lock` after changing its bytes. Any explicit `path` selects local resolution,
even when the dependency is named `core`.

The canonical lock records the exact library files, integrity, authored path or
internal shipped locator, and explicit `local` or `shipped` provenance. Validation
and compilation never update it.

## Direct command streams

Human query and render success writes its result to stdout; compiler warnings use
stderr. With `--json`, stdout contains the command result and stderr contains a
separate report. Expected query or render failure leaves stdout empty. File output is
atomic and is not created or replaced when compilation or rendering fails.

Direct command exits use the same `0` success, `1` authored/expected failure, and
`2` usage/tool failure classification. `validate --strict` may return exit `1`
for warnings without changing their diagnostic severity. Help and version exit `0`.
