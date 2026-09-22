# Thermite Schematics

Thermite turns electrical project JSON into consistent, printable schematic
sheets. People and agents author equipment, terminals, connections, potentials,
and presentation settings; the compiler checks them and the renderer generates
vector drawings with TypeScript and ELK.

> **Generated drawings are not a substitute for engineering review.** Thermite
> validates the model you give it; it does not certify that a design is safe,
> code-compliant, or fit for installation. Every generated schematic must be
> reviewed and approved by a qualified electrical engineer before it is used to
> build, modify, or maintain equipment. The software is provided without
> warranty, as set out in the [Apache License 2.0](LICENSE).

**0.3.0-alpha.2 · Apple Silicon Mac development preview**

This alpha carries the original symbol catalog, ELK routing, electrical
validation, deterministic output, and guarded agent tools forward. It adds:

- Letter, Tabloid, A4 and A3 sheets, landscape or portrait.
- Readable pagination with paired conductor continuation references.
- Numbered multi-view packets, responsive browser viewing, and print styling.
- Cable jackets, core inventories, explicitly spare cores, and loose ends.
- Visible project-local component libraries with integrity locks.
- Terminal plans, all-channel PLC I/O schedules, BOM and wire/cable CSV exports.
- A drawing index and device/function references with sheet/zone locations.
- Compact layout selection and folded sections on one sheet where they fit.
- Required connection checks and an [electrical completeness inventory](docs/COMPLETENESS.md).
- Semantic snapshots and readable change reviews using stable object identities.
- Direct, repeatable PDF export with bundled fonts, plus local regeneration.
- Visible manufacturer libraries with exact part research and wiring examples.
- A source checkout workflow with a short `thermite` entry point.

Start with the [Machine demo runbook](docs/MACHINE_DEMO.md). It includes a two-cabinet
example and a guarded wiring-change demonstration.

The Rust experiment is preserved on `codex/thermite-alpha`. Active alpha work
continues here in TypeScript. The original private POC guide is retained in
[docs/PROOF_OF_CONCEPT.md](docs/PROOF_OF_CONCEPT.md).

## Run from a source checkout

Use Node.js `^22.12.0 || >=24` (Node 23 is excluded). Development and verification
currently target Node 24 on Apple Silicon macOS. No global install is required.

```sh
npm ci
npm run build
node thermite.mjs --help
node thermite.mjs init ../electrical-project --name "Machine 01"
node thermite.mjs validate ../electrical-project
node thermite.mjs view PS1 --loads --project ../electrical-project -o ../electrical-project/drawings/control-power.html
```

You can place this checkout in a project's `tools/thermite` directory. Invoke it
from anywhere with `node /path/to/tools/thermite/thermite.mjs`. Pin the checkout
commit or use a Git submodule so drawing generation doesn't change unexpectedly.
Rebuild after pulling an intentional upgrade. Use `npm run thermite -- ...` as
a checkout-local shortcut. The `thermite` interface retains the original POC commands
and SVG contract.

## Print a packet

The starter's `presentation.json` uses Tabloid landscape with a 10 mm margin.
Override it with `--paper letter --orientation landscape`, or edit the referenced
presentation using the guarded agent workflow. Page orientation and drawing flow
are independent: `--flow top-to-bottom` changes the circuit layout.

```sh
node thermite.mjs view M1 --power --project examples/motor-starter -o alpha-out/motor-power.html
node thermite.mjs packet --project examples/motor-starter --input examples/alpha/motor-starter.packet.json -o alpha-out/motor-starter.html
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
node thermite.mjs init ../cable-example --template cabinets
node thermite.mjs cable CBL1 --project ../cable-example --json
node thermite.mjs view CBL1 --conductors --project ../cable-example -o ../cable-example/cable.svg
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

## Develop and contribute

```sh
npm run check
npm run test -- packages/cli/test/alpha.test.ts
```

The normal check runs locally on macOS. Historical private release-evidence
checks are separate under `npm run test:release-evidence`; the frozen private
0.2.0 tarball inventory suite is under `npm run test:legacy-package` and requires
its historical source revision. Those are not the Mac source-alpha readiness
check. The alpha source archive is verified independently. CI currently runs only on an Apple Silicon Mac.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing electrical semantics,
layout, or library definitions. Thermite Schematics is released under the
[Apache License 2.0](LICENSE).

The [component batch workflow](scripts/library-batch/README.md) coordinates one
exact part per CLI worker, then checks and promotes reviewed results into the
visible libraries, with adjustable concurrency, resumable queues and explicit
evidence holds.
