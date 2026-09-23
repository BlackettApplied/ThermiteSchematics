# Thermite Schematics

Requires Node.js `^22.12.0 || >=24`: use Node 22.12 or a supported later
release. Node 23 is excluded.

This is the historical private v0.2.0 distribution guide. The current source
alpha is licensed under [Apache-2.0](../LICENSE); start with the
[README](../README.md) for the source workflow.

The original POC was a private electrical-systems-as-code toolchain. JSON
project source is authoritative; the compiler validates and resolves the electrical
model, and deterministic render code generates SVG views on demand.

## Agent-first quick start

Copy this single instruction to the coding agent that will work in the new project:

```text
Obtain the authorized private Release assets thermite-cli-0.2.0.tgz and thermite-cli-0.2.0.tgz.sha256. Verify the tarball against the supplied SHA-256 file. With Node.js ^22.12.0 || >=24 (Node 23 excluded), create an isolated prefix, empty npm cache, empty user npmrc, and empty global npmrc, then install without registry access:

npm install --global --prefix <isolated-prefix> --offline --ignore-scripts --no-audit --no-fund --package-lock=false --install-links=false --omit=dev --workspaces=false --userconfig <empty-user-npmrc> --globalconfig <empty-global-npmrc> --cache <empty-cache> <absolute-downloaded-thermite-cli-0.2.0.tgz>

Invoke only the thermite command installed under that isolated prefix. In a new empty ordinary directory run:

thermite init --name "My First Electrical Project" --revision "A"

Read the generated AGENTS.md before editing anything. Follow its stateless loop exactly: validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view. Use the six thermite agent subcommands with JSON request files, consume compiler diagnostics, edit only authoritative JSON through guarded patches, and never hand-author SVG geometry.
```

`thermite init` creates this fixed project shape:

```text
AGENTS.md
system.json
presentation.json
electrical-system.lock.json
devices/equipment.json
connections/control-power.json
potentials/potentials.json
```

The initialized [`AGENTS.md`](../AGENTS.md) is the complete executable contract for
the six JSON agent tools, split streams, exit codes, guarded patches, and local
libraries. Each `thermite agent` call compiles the project fresh; there is no daemon,
persistent session, registry lookup, or agent-owned geometry.

## Concise human path

For a direct human workflow, start in a new empty ordinary directory, initialize the
starter, validate it, query its 24 VDC net, and generate the PS1 loads view:

```sh
thermite init --name "My First Electrical Project" --revision "A"
thermite validate .
thermite net PS1.+ --project .
thermite view PS1 --loads --project . --output ps1-loads.svg
```

The SVG is generated output. Change JSON source or `presentation.json`, validate,
and regenerate the view rather than editing the SVG.

To author a local component library, give its project dependency an explicit
portable relative `path`, place its manifest in `library.json`, place declared type
sources below that directory, then refresh and verify the lock:

```sh
thermite lock .
thermite validate .
```

Name/version-only dependencies are reserved for libraries shipped with
Thermite Schematics. The bundled library is exactly `core@0.1.0`; an explicit `path` always
selects a local user-authored library.

## Installed CLI

The private end-user artifact is `thermite-cli-0.2.0.tgz`. It is installed from
an authorized local download, never from a public npm registry. Verify its supplied
SHA-256 file before using the exact offline, prefix-scoped command in the agent
instruction above. Invoke only the package-manager-created `thermite` shim in that isolated
prefix.

The main human commands are:

```text
thermite init [--name <project-name>] [--revision <revision>]
thermite validate [path] [--strict] [--json]
thermite lock [path] [--check] [--json]
thermite compile [path] [-o|--output <file>] [--diagnostics-json]
thermite inspect <designation> [--project <path>] [--json]
thermite neighbors <designation> [--project <path>] [--json]
thermite trace <designation> [--project <path>] [--json]
thermite net [reference] [--device <designation> --terminal <key>] [--project <path>] [--json]
thermite cable <designation> [--project <path>] [--json]
thermite render <designation> --family <control|power> [--flow <left-to-right|top-to-bottom>] [--project <path>] [-o|--output <file>] [--json]
thermite view <designation> (--power | --actuation | --to <designation> | --conductors | --loads) [--include-power] [--flow <left-to-right|top-to-bottom>] [--project <path>] [-o|--output <file>] [--json]
```

See the packaged [`@thermite/cli` README](../packages/cli/README.md) for the
direct CLI and JSON-agent stream contracts.

## Project authority and formats

An initialized project is a version-controlled set of JSON documents:

- `system.json` uses `electrical-system/0.1` and references source,
  `presentation.json`, and exact library dependencies;
- `presentation.json` uses `project-presentation/0.1` and declares revision,
  canvas color, and up to four title lines;
- `electrical-system.lock.json` binds the exact library bytes and records local or
  shipped resolution provenance;
- files under `devices/`, `connections/`, and `potentials/` contain project facts;
  and
- SVG, serialized IR, indexes, and reports are derived artifacts.

The compiler produces `electrical-ir/0.1` plus detached compiled presentation
context. The renderer contract is `render/0.3`; semantic request/view formats remain
`schematic-view-request/0.1`, `schematic-view-request/0.2`,
`schematic-view/0.1`, and its `0.2` revision. Every SVG has one opaque canvas and a
visible project, revision, view, and tool identity block.

## Repository development

The npm workspace contains seven private packages: schema, core-library, compiler,
query, render, agent-tools, and CLI. For repository development only:

```sh
npm ci
npm run check
```

For the current source alpha, the root check verifies generated types, builds
all workspaces, runs the source-alpha Vitest suite, and checks formatting and
committed JSON stability. Ordinary CI runs on Apple Silicon macOS; it does not
build or publish a private release candidate.

## Private distribution boundary

Thermite Schematics is released under the Apache License 2.0. Every package is
still marked `private`, and no public npm publication path exists. The release design produces one link-free,
self-contained CLI tarball, tests one immutable candidate across the supported
matrix, and permits only a protected publisher to attach the tarball and its SHA file
to the authorized private GitHub Release.

The exact draft-asset, verification, explicit-publication, retry, and prohibition
rules are in the [private release checklist](RELEASE_CHECKLIST.md). Local builds,
direct asset uploads, a producer artifact without the successful gate receipt, and a
public, internal, or fork repository are never publication authority.

## Architecture and package references

- [Architecture](ARCHITECTURE.md) describes the current compiler, presentation,
  agent, and distribution boundaries.
- [Data model](DATA_MODEL.md) describes authoritative source entities, derived
  IR, presentation, and library references.
- [Schematic rendering](SCHEMATIC_RENDERING.md) explains the query-to-SVG
  rendering architecture.
- [`@thermite/schema`](../packages/schema/README.md) documents canonical source
  schemas and validation.
- [`@thermite/core-library`](../packages/core-library/README.md) documents the
  shipped `core@0.1.0` library.
- [`@thermite/compiler`](../packages/compiler/README.md) documents compilation,
  presentation context, and library resolution.
- [`@thermite/query`](../packages/query/README.md) documents read-only graph
  queries.
- [`@thermite/render`](../packages/render/README.md) documents deterministic
  selection, layout, title identity, and SVG bytes.
- [`@thermite/agent-tools`](../packages/agent-tools/README.md) documents the six
  stateless typed tools and guarded patch boundary.

## Engineering posture

Thermite Schematics treats an AI agent as an authoring and query interface, not as the
electrical authority. Deterministic software owns structural validation, type and
reference resolution, lock verification, topology, engineering diagnostics,
selection, layout, and SVG geometry. The project is standards-aware, including IEC
81346, IEC 61082, and IEC 60617, but does not claim standards compliance merely from
using related concepts.
