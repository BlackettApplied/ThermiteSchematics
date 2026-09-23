# Thermite Schematics

Electrical schematics as code, built for agentic workflows. Author electrical systems in
JSON; validate, inspect, and render deterministic printable drawings on the fly.

Define your electrical project in a connected source model: the code is the
schematic, and deterministic drawings are generated from it on demand. The
compiler checks that model for errors, inconsistencies, and missing connections
within its supported rules, reducing the need to hunt for problems page by page.

You can ask your agent what a sensor is connected to, which conductors are unused, or to draw
the part of the system you need to understand. Explore your project through
questions and focused views without first assembling a fixed drawing set.

## How to use

You can choose a **runtime package** to start designing, or a **source checkout** to
work on the engine too. Both initialize the same electrical project in its own
folder. Thermite is Apache-2.0, and agent-authored improvements are welcome. See instructions
below for each workflow.

### Using a runtime package

Download a versioned runtime ZIP and its SHA-256 sidecar from
[GitHub Releases](https://github.com/BlackettApplied/ThermiteSchematics/releases).
Choose the archive for your operating system and CPU architecture. It contains
the built engine and dependencies; you only need Bun 1.4.2. No dependency
installation or build is required.

Copy this prompt to your agent:

```text
Let's start an electrical project with the Thermite Schematics runtime package.

1. Identify my operating system and CPU architecture. Find the matching
   published runtime ZIP and its .sha256 sidecar at
   https://github.com/BlackettApplied/ThermiteSchematics/releases. Use a versioned
   release, not a preview or the automatic source archive. If my platform isn't
   listed, offer the source workflow in the repository README.
2. Download both, verify the SHA-256, and extract into a new runtime folder
   separate from my electrical project. Use Bun 1.4.2. Read the package README;
   no dependency installation or build is needed.
3. Using bun /absolute/path/to/runtime/thermite.mjs, initialize a new project
   folder with init <project-folder> --name "My project". Do not overwrite an
   existing directory. Read the generated AGENTS.md, validate the project, and
   render view PS1 --loads --project <project-folder>
   -o <project-folder>/drawings/control-power.html as one command.
4. Tell me where to open the drawing, then help me model my electrical system.
   Use that same runtime for each command. Keep JSON authoritative, preserve
   diagnostics, and use the guarded agent workflow for existing source edits.
5. If you find an engine bug or missing capability, check existing issues and
   submit a clear issue at https://github.com/BlackettApplied/ThermiteSchematics/issues.
   Explain the use case and expected behavior, and include Thermite/Bun versions
   and my operating system. For bugs, include actual behavior, a minimal
   reproduction, and relevant diagnostics. Keep private machine data and
   credentials out of the issue. If GitHub access is unavailable, give me a
   ready-to-submit issue title and body.

Do not invent electrical ratings, pinouts, or engineering repairs. Explain
unresolved assumptions; generated drawings need qualified engineering review.
```

### Develop and contribute from source

Clone the engine to inspect and improve it as you work. Bug fixes, clearer docs,
rendering improvements, and carefully sourced component libraries are welcome.

Copy this prompt into your coding agent. It's written in your voice, addressed
to your agent:

```text
Help me start using Thermite Schematics from source.

1. Clone https://github.com/BlackettApplied/ThermiteSchematics.git into a
   dedicated checkout (or use my existing checkout without overwriting work).
   Read its AGENTS.md and CONTRIBUTING.md before making changes.
2. Use Bun 1.4.2 and Python 3.12 or later for the development checks.
   From the checkout, run bun install --frozen-lockfile,
   bun run build, and bun run check. Report failures and preserve compiler
   diagnostics.
3. Run bun thermite.mjs --help. Initialize a new project outside the engine
   checkout with bun thermite.mjs init ../electrical-project --name "My project"
   (choose a new directory if that one exists). Read its generated AGENTS.md.
4. Validate it with bun thermite.mjs validate ../electrical-project and render
   bun thermite.mjs view PS1 --loads --project ../electrical-project
   -o ../electrical-project/drawings/control-power.html
   as one command. Tell me where to open the drawing, then help me describe
   and model the electrical system I want to build. Keep electrical JSON
   authoritative and use the guarded agent workflow for existing source edits.
5. Run Thermite from this checkout as we work. If you find a bug, missing
   capability, or unclear documentation, fix it on a focused engine branch,
   add appropriate verification, and run bun run check. Open a pull request
   upstream from my fork when GitHub access is available; otherwise leave a
   reviewable patch and PR description. Keep my machine data out of the PR.
   Follow CONTRIBUTING.md, and leave CLA acceptance to me.

Do not invent electrical ratings, pinouts, or engineering repairs. Explain
unresolved assumptions; generated drawings need qualified engineering review.
```

**0.3.0-alpha.2 · Cross-platform development preview.** Runs locally with
Bun 1.4.2 (pinned in `.bun-version`) on macOS, Windows, and Linux. See the
[platform checks](docs/PLATFORMS.md) for tested systems and limitations.

> **Generated drawings are not a substitute for engineering review.** Thermite
> validates the model you give it; it does not certify that a design is safe,
> code-compliant, or fit for installation. Every generated schematic must be
> reviewed and approved by a qualified electrical engineer before it is used to
> build, modify, or maintain equipment. The software is provided without
> warranty, as set out in the [Apache License 2.0](LICENSE).

## Run from a source checkout

A checkout lets your agent inspect and improve the engine that generates your
drawings. No global install is needed. Keep it separate from the electrical
project, just as you would a downloaded runtime.

```sh
git clone https://github.com/BlackettApplied/ThermiteSchematics.git
cd ThermiteSchematics
bun install --frozen-lockfile
bun run build
bun thermite.mjs --help
bun thermite.mjs init ../electrical-project --name "Machine 01"
bun thermite.mjs validate ../electrical-project
bun thermite.mjs view PS1 --loads --project ../electrical-project -o ../electrical-project/drawings/control-power.html
```

`bun.lock` is the authoritative dependency lock. The build compiles with `tsc`,
and `thermite.mjs` runs the built workspace JavaScript.

Open the generated HTML in your browser. For a larger example, follow the
[Machine demo runbook](docs/MACHINE_DEMO.md), including its guarded wiring change.

You can also keep the checkout in a project's `tools/thermite` directory and
invoke `bun /path/to/tools/thermite/thermite.mjs` from anywhere. Keep engine
changes in their own repository or submodule, separate from machine design data.
Record the checkout commit or pin the submodule for repeatable drawings, and
rebuild after changing or intentionally upgrading the engine. `bun run thermite
-- ...` is a checkout-local shortcut.

Thermite includes printable Letter/Tabloid/A4/A3 sheets, multi-view packets,
cable and terminal views, PLC I/O schedules, BOM and wire/cable CSV reports,
local component libraries, connection completeness checks, semantic change
reviews, and direct PDF export. The sections below cover those workflows.

## Print a packet

The starter's `presentation.json` uses Tabloid landscape with a 10 mm margin.
Override it with `--paper letter --orientation landscape`, or edit the referenced
presentation using the guarded agent workflow. Page orientation and drawing flow
are independent: `--flow top-to-bottom` changes the circuit layout.

```sh
bun thermite.mjs view M1 --power --project examples/motor-starter -o alpha-out/motor-power.html
bun thermite.mjs packet --project examples/motor-starter --input examples/alpha/motor-starter.packet.json -o alpha-out/motor-starter.html
```

HTML is a self-contained packet of vector SVG sheets. It fits the browser window;
printing keeps the physical paper dimensions. Use matching paper, 100% scale,
and disable browser headers and footers. Export a PDF directly by choosing a `.pdf` output filename; no browser or
external converter is needed. The PDF embeds its fonts and physical page sizes. A `.svg` output is available for single-sheet views. A `.json` output
contains all sheet SVGs, page settings, and continuation metadata. The CLI refuses
to silently truncate a multi-sheet drawing to one SVG.

Use `--layout compact` to try up to three validated ELK spacing arrangements and
fit horizontal circuit sections on the same sheet where possible. The default
`standard` preserves the initial layout. Search the HTML by device designation
and follow clickable conductor continuations.

Pagination keeps devices and labels intact, with a minimum circuit text size of
2.5 mm. If a view cannot be split safely at that size, Thermite returns R006 with
an actionable explanation; use a larger sheet, another flow, or a narrower view.

## Cables and component libraries

```sh
bun thermite.mjs init ../cable-example --template cabinets
bun thermite.mjs cable CBL1 --project ../cable-example --json
bun thermite.mjs view CBL1 --conductors --project ../cable-example -o ../cable-example/cable.svg
```

Cable cores may be terminated at both ends, at one end, or left explicitly spare.
Only real endpoint pairs create connectivity, and a single terminated end still
occupies its terminal. Omitted assignments are **unassigned**; legacy assignments
with no usage field are **unspecified**. Shield construction does not imply a
shield termination or a ground connection.

Component libraries live in [`libraries/`](libraries/): a generic core plus
manufacturer libraries, each with its own README, source research, documented
connection limits and a reproducible [wiring example](libraries/COMPONENT_EXAMPLES.md).
`init` writes a generic `libraries/core` into the new project, referenced by
relative path from `system.json`. The lock file pins the library's actual bytes,
so after an intentional library change run `thermite lock <project>` and validate
again. Partial connection models keep their compiler warnings, and a catalog
identity is not an installed-machine selection. [CONTRIBUTING.md](CONTRIBUTING.md)
states the library review requirements.

Runnable projects live in [`examples/`](examples/).

Beyond the standard circuit drawing, each view type has its own reference:

- [Circuit views](docs/circuit-views.md) separate a device's contacts, coil and
  I/O functions into source-selected drawing groups, with validated
  [function-level symbols](docs/CIRCUIT_SYMBOLS.md) for devices that have several
  kinds of contact.
- [Terminal wiring](docs/terminal-wiring.md) shows selected physical conductors,
  with explicit references to connections outside the view.
- [Communication ports](docs/communication-ports.md) show Ethernet and NRG links
  with port-occupancy validation and unconnected-port schedules. These links do
  not join electrical nets or establish protocol compatibility.
- [Connector assemblies](docs/connector-assemblies.md) show cordsets, caps and
  splitter branches where the source identifies the connectors but leaves
  individual conductor mappings unresolved.
- [Signal loops](docs/signal-loops.md) follow a field device through cordset,
  bulkhead, terminal strip and input channel, using the opt-in
  [field interfaces](libraries/field-interfaces/README.md) library. Generic
  connector pin maps are proposals until the actual hardware is selected.

The [reference comparison protocol](docs/REFERENCE_PARITY.md) describes how
synthetic electrical projects exercise rendering, conductor coverage and
manufacturer-model boundaries.

## Work with an agent

Initialization writes a project-specific `AGENTS.md`. The existing six stateless
agent tools preserve JSON requests, separate result/diagnostic streams, current
source hashes, dry-run patches, and validation before applying changes. They do
not invent electrical repairs. See the [alpha agent guide](packages/cli/assets/THERMITE_AGENTS.md)
and [format notes](docs/TYPESCRIPT_ALPHA.md).

## Improve Thermite with your agent

Contributing is part of the source workflow. When something breaks, a workflow
is awkward, or a component is missing, have your agent make a focused fix and
submit a pull request. Documentation corrections and small improvements are
welcome too. Include the problem, expected behavior, a minimal reproducible
example when relevant, and the checks you ran.

```sh
bun run test -- packages/cli/test/alpha.test.ts
bun run check
```

Use `bun run test`, not `bun test`: the suite runs on Vitest.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the branch/fork workflow, engineering
review expectations, commit sign-off, and [CLA](CLA.md). The person contributing
reviews and accepts the CLA; an agent cannot accept it on their behalf. Keep
customer drawings, credentials, and machine-specific data out of contributions.

The normal check covers the source alpha. Historical private 0.2.0 packaging and
release-evidence checks are separate; their legacy Node/npm commands and
`package-lock.json` apply only in their original release context. They are not
prerequisites for using or contributing to the public alpha.
Build and verify runtime downloads with `bun run package:pack`; see the
[runtime packaging guide](docs/RUNTIME_PACKAGE.md).
See the [original POC guide](docs/PROOF_OF_CONCEPT.md) for history.

The [component batch workflow](scripts/library-batch/README.md) coordinates exact
part research and review before promotion into the visible libraries.

## License

Thermite's original code, documentation, examples, and component definitions are
licensed under [Apache-2.0](LICENSE), with attribution in [NOTICE](NOTICE).
Bundled fonts and installed dependencies retain their own licenses; see
[third-party notices](THIRD_PARTY_NOTICES.md). Manufacturer names and source
references do not imply certification or endorsement.
