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
files are produced. The six JSON agent commands below retain their existing
request/result contracts in the alpha; its direct printable CLI is an additional
workflow. For development verification use `bun run test -- <file>` and
`bun run check`; full checks also require Python 3.12 or later.

## Historical private 0.2.0 runtime

The remaining reference describes only the original private offline tarball and
its source revision. In that runtime, `thermite init` targeted the current empty
directory without a path operand. Those installation and initialization rules do
not apply to the public alpha source entry point above. The historical runtime
requires Node.js `^22.12.0 || >=24` (excluding Node 23).

### Private offline install

Obtain the authorized private Release assets
`thermite-cli-0.2.0.tgz` and
`thermite-cli-0.2.0.tgz.sha256`. Verify the downloaded tarball against the
supplied SHA-256 file before installation. Create a new isolated prefix, empty cache,
empty user npmrc, and empty global npmrc, then run this exact command with absolute
paths substituted for the placeholders:

```sh
npm install --global --prefix <isolated-prefix> --offline --ignore-scripts --no-audit --no-fund --package-lock=false --install-links=false --omit=dev --workspaces=false --userconfig <empty-user-npmrc> --globalconfig <empty-global-npmrc> --cache <empty-cache> <absolute-downloaded-thermite-cli-0.2.0.tgz>
```

Invoke only the `thermite` shim installed under that prefix. The package is not published
to a public npm registry.

### Initialize and inspect a project

`thermite init` always targets the current existing directory. It requires that directory
to be empty and ordinary; it has no path operand, `--force`, merge, overwrite,
prompt, or inferred directory-name default.

From a new empty directory:

```sh
thermite --version
thermite init --name "My First Electrical Project" --revision "A"
thermite validate .
thermite inspect PS1 --project .
thermite net PS1.+ --project .
thermite view PS1 --loads --project . --output ps1-loads.svg
```

The version output is `0.2.0`. Init writes `AGENTS.md`, `system.json`,
`presentation.json`, `electrical-system.lock.json`, and the three fixed source
files under `devices/`, `connections/`, and `potentials/`. Defaults are project
name `Thermite Schematics Starter Project` and revision `0.1.0`. Supplied names are 1-160
XML-valid single-line Unicode code points; revisions are 1-128.

Read the initialized `AGENTS.md` before asking a coding agent to edit the project.
JSON project files are authoritative. SVG and serialized IR are generated output.

### Human commands

Project lifecycle commands accept a project directory or direct `system.json` path
and default to the current directory:

- `thermite validate [path] [--strict] [--json]` runs the complete compiler and rules.
- `thermite lock [path] [--check] [--json]` writes or verifies the canonical library
  lock.
- `thermite compile [path] [-o|--output <file>] [--diagnostics-json]` emits canonical
  `electrical-ir/0.1`.

Read-only query commands are:

- `thermite inspect <designation> [--project <path>] [--json]`;
- `thermite neighbors <designation> [--project <path>] [--json]`;
- `thermite trace <designation> [--project <path>] [--json]`;
- `thermite net [reference] [--device <designation> --terminal <key>]
[--project <path>] [--json]`; and
- `thermite cable <designation> [--project <path>] [--json]`.

The positional net form chooses the longest exact compiled device-designation prefix
before a dot. Use `--device` with `--terminal` when either part itself contains
dots. Exactly one addressing form is required.

The direct renderer is
`thermite render <designation> --family <control|power>` with optional
`--flow <left-to-right|top-to-bottom>`, `--project <path>`,
`-o|--output <file>`, and `--json`.

The higher-level view command is `thermite view <designation>` with exactly one of
`--power`, `--actuation`, `--to <designation>`, `--conductors`, or
`--loads`. It also accepts `--include-power` only with `--to`, plus the same
`--flow`, `--project`, `--output`, and `--json` options as render.

All views are deterministic generated SVG. Each `render/0.3` SVG begins with one
opaque full-canvas background and includes visible Project, Revision, View, and Tool
identity lines. Rendering never stores drawing coordinates in project source.

### Agent JSON commands

The six commands are:

- `thermite agent resolve --input <file|->`;
- `thermite agent inspect --input <file|->`;
- `thermite agent query --input <file|->`;
- `thermite agent validate --input <file|->`;
- `thermite agent create-view --input <file|->`; and
- `thermite agent apply-source-patch --input <file|->`.

`--input` is required. A filename is resolved from the command cwd; `-` reads one
UTF-8 JSON request to EOF. Every request is a closed
`agent-tool-request/0.1` object with its own non-empty `project`. There is no
implicit stdin, positional project, `--json`, strict flag, natural-language request,
daemon, or persistent session.

Use the loop frozen in the initialized `AGENTS.md`:
`validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view`.
The agent consumes compiler diagnostics and renderer output; it does not invent
electrical validity or SVG geometry.

After dispatch, stdout and stderr are separate canonical JSON streams:

- success writes one `agent-tool-result/0.1` object to stdout and one
  `agent-tool-report/0.1` object with `error: null` to stderr;
- failure leaves stdout empty and writes only the report to stderr; and
- both non-empty streams use UTF-8, two-space JSON, LF, one final newline, and no
  ANSI or progress text.

Exit `0` means success, including success with compiler warnings. Exit `1` means
authored compiler diagnostics or an expected A-, Q-, or R-error. Exit `2` means
usage, request I/O, tool, staging, write/rollback, invariant, or unexpected failure.

### Guarded patches

`apply-source-patch` accepts only `json-patch/0.1`, a required `dryRun`
boolean, and a non-empty file list. Each file supplies its current
`sha256-<base64>` integrity and ordered `test`, `add`, `remove`, or `replace`
operations.

Dry-run first, review the returned proposed integrity and diagnostics, then send the
same guarded request with `dryRun: false`. A successful multi-file request commits
with per-file atomic replacement; it is not a crash-atomic project transaction.

Only manifest-matched project source documents and the one referenced
`project_presentation` document are eligible. The patch tool cannot create, delete,
or rename files and cannot mutate `system.json`, the lock, local or shipped library
bytes, or `AGENTS.md`.

### Local libraries

Name/version-only dependencies are reserved for libraries shipped with
Thermite Schematics; the shipped set is exactly `core@0.1.0`. To author a local library,
use an explicit portable relative `path` in `system.json`, put its manifest in
`library.json`, put its declared type sources below that directory, and run
`thermite lock` after changing its bytes. Any explicit `path` selects local resolution,
even when the dependency is named `core`.

The canonical lock records the exact library files, integrity, authored path or
internal shipped locator, and explicit `local` or `shipped` provenance. Validation
and compilation never update it.

### Direct command streams

Human query and render success writes its result to stdout; compiler warnings use
stderr. With `--json`, stdout contains the command result and stderr contains a
separate report. Expected query or render failure leaves stdout empty. File output is
atomic and is not created or replaced when compilation or rendering fails.

Direct command exits use the same `0` success, `1` authored/expected failure, and
`2` usage/tool failure classification. `validate --strict` may return exit `1`
for warnings without changing their diagnostic severity. Help and version exit `0`.
