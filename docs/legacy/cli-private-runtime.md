# Private runtime command reference

Archived from the CLI README. For the current runtime and source workflows,
see the [CLI reference](../../packages/cli/README.md).

The remaining reference describes only the original private offline tarball and
its source revision. In that runtime, `thermite init` targeted the current empty
directory without a path operand. Those installation and initialization rules do
not apply to the public alpha [source entry point](../../packages/cli/README.md). The historical runtime
requires Node.js `^22.12.0 || >=24` (excluding Node 23).

The former root guide's complete private-runtime rules and requests are in the
[legacy agent guide](private-release-agent-guide.md).

## Private offline install

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

## Initialize and inspect a project

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

## Human commands

Project lifecycle commands accept a project directory or direct `system.json` path
and default to the current directory:

- `thermite validate [path] [--strict] [--json]` runs the complete compiler and rules.
- `thermite lock [path] [--check] [--json]` writes or verifies the canonical library
  lock.
- `thermite compile [path] [-o|--output <file>] [--diagnostics-json]` emits canonical
  `electrical-ir/0.1`.

Read-only query commands are:

- `thermite inspect <designation> [--type-description] [--project <path>] [--json]`;
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

## Agent JSON commands

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

## Guarded patches

`apply-source-patch` accepts only `json-patch/0.1`, a required `dryRun`
boolean, and a non-empty file list. Each file supplies its current
`sha256-<base64>` integrity and ordered `test`, `add`, `remove`, or `replace`
operations.

Dry-run first, review the returned proposed integrity and diagnostics, then send the
same guarded request with `dryRun: false`. A successful multi-file request commits
with per-file atomic replacement; it is not a crash-atomic project transaction.
A005/exit 1 reports a held write reservation, including its path, owner and age;
it is separate from A004 integrity drift. Re-inspect and rebuild stale patches.
An incomplete rollback is exit 2 with per-file reasons. Release failure after
commit preserves success with W801; verify the committed state before recovering
that reservation. See the [reservation recovery contract](../../packages/agent-tools/README.md#integrity-guarded-source-patches).
Never commit `.thermite-schematics-write.lock`; alpha `init` adds it to `.gitignore`.

Only manifest-matched project source documents and the one referenced
`project_presentation` document are eligible. The patch tool cannot create, delete,
or rename files and cannot mutate `system.json`, the lock, local or shipped library
bytes, or `AGENTS.md`.
