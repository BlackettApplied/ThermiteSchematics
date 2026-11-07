# Contributing to Thermite

Thermite can be used through a prebuilt runtime package or a source checkout.
Engine improvements belong in a separate source checkout. Human and
agent-authored pull requests are welcome: fix bugs you encounter, clarify
confusing instructions, improve rendering, or add carefully sourced components.
Small, focused contributions are useful; you do not need to wait for a large
feature to be finished.

The alpha is developed from source using Bun 1.4.2 (pinned in `.bun-version`)
on macOS, Windows, and Linux. Install Python 3.12 or later for the full development
checks (`python` on Windows, `python3` elsewhere, or set
`THERMITE_RESEARCH_PYTHON`). Runtime users do not need Python. See
[platform checks](docs/platforms.md). Clone this repository, run `bun install --frozen-lockfile`,
then `bun run build`. Use `bun thermite.mjs` from the checkout. For a quick
feedback loop, run `bun run test -- <affected test file>` (not `bun test`; the
suite runs on Vitest); run `bun run check` before submitting a change. Commit
`bun.lock` changes with any dependency change; `package-lock.json` is retained
only for the frozen historical private release tooling.

This project is licensed under the [Apache License 2.0](LICENSE). Before your
first pull request is merged, sign the [Contributor License Agreement](CLA.md)
by adding this line to the pull request description:

```text
I have read the CLA document and I hereby sign the CLA.
```

The human contributor must read and accept the CLA. Agents may prepare changes
and a PR description, but must not insert an acceptance statement or represent
that they have signed for someone else. Maintainers verify acceptance before
merging; the PR template alone is not a signature.

You keep the copyright in your contributions; the CLA is a licence, not an
assignment. Add a sign-off with `git commit -s` so each commit carries a
`Signed-off-by` trailer using your real name and email in your Git configuration.
This is a commit sign-off, not a cryptographic signature or a substitute for
CLA acceptance.
If you are contributing on behalf of a company that holds rights in the work,
contact the maintainers first so a corporate
agreement can be put in place. Start with an
[issue requesting contributor contact](https://github.com/BlackettApplied/ThermiteSchematics/issues/new)
to arrange that conversation; do not include confidential agreement details.

## From local fix to pull request

1. Fork [BlackettApplied/ThermiteSchematics](https://github.com/BlackettApplied/ThermiteSchematics)
   and create a focused branch in your engine checkout. The current upstream
   default branch is `dev`; target that branch when opening the PR.
2. Reproduce the issue with shareable input, make the change, and run focused
   tests. Run `bun run check` before submitting. Rebuild before using the changed
   engine to generate your project's drawings.
3. Review the diff, sign off your commits, and push your branch to your fork.
   Open a PR describing the problem, resulting behavior, validation, and any
   remaining limitations. Identify agent assistance and third-party sources.
4. Review and accept the CLA yourself when applicable, then respond to review.
   If your agent lacks GitHub access, it can leave the patch and PR description
   ready for you to submit.

Use a small synthetic example instead of customer drawings, credentials, or
proprietary machine data. Report reproducible issues even if you cannot fix them.
When an agent finds a related improvement, keep unrelated work in a separate PR.

## Make a reviewable change

Create a branch for one concrete problem. Include a minimal electrical JSON
example that reproduces it, the expected behavior, the implementation, and
focused verification. Generated SVG/HTML is evidence, never electrical source.
Keep source JSON and library documentation reviewable in the pull request.
Agents can use the same workflow; the human submitting a change remains
responsible for its engineering assumptions.

Avoid mixing engine changes with a machine project's electrical modifications.
A source checkout under `tools/thermite` can be its own Git repository or a pinned
submodule. Commit and submit engine changes there; keep machine design history
in the parent project. Do not automatically update that project's pinned engine.

## Electrical semantics

Preserve UUID identity, precise diagnostics, strict UTF-8/duplicate-key handling,
library byte locks, and deterministic net IDs. Only wires, jumpers, and cable
cores terminated at both ends join physical nets. A contact, coil, PLC channel,
or other device function does not automatically short its terminals. Internal
functions can describe behavior without asserting physical continuity.

Use the guarded patch workflow for existing project source and presentation:
validate, inspect, dry-run, apply, validate, render. The
[agent request reference](docs/agent-requests.md) contains executable examples.
Preserve diagnostics and separate result/report streams. Never infer an
electrical repair from a layout problem. Test negative cases whenever changing
connectivity or validation.

## Rendering

ELK owns placement and orthogonal routing; the catalog owns symbol primitives.
Sheet composition adds physical paper, title blocks, and continuation references.
Keep these concerns distinct. Preserve the original continuous SVG contract.

Inspect rendered output at its intended print size. Check cabinet names,
terminal numbers, wire labels, crossings/junctions, conductor continuations,
spare ends, and title blocks. Do not hide clipping with a smaller font or omit
conductors to make a test pass. A safe, explained R006 failure is preferable to
an incomplete drawing. Confirm both drawing flows for layout changes.

## Component library submissions

Libraries are ordinary JSON directories with `library.json` and declared type
source files. The included core library is generic, not manufacturer-certified.
A new manufacturer type should include:

- Manufacturer, exact part/order number, and hardware/document revision.
- Official source document URL, document title, and page references.
- Explicit terminal identifiers and ratings with their units.
- Function and symbol mappings with a minimal valid wiring example.
- Notes separating verified facts from unsupported or unmodeled features.
- A complete inventory of power, return, protective bonding, shield, signal and communication connections, including optional pins.
- Explicit `required: true` on universally required terminals/ports, and `connectionCoverage` with review notes. Mark incomplete models `partial`; do not claim complete coverage for a port-only device. Reviewed abstract interfaces without exact-part catalog facts may use `generic`; a model missing part of its own interface remains `partial`. See [connection completeness](docs/completeness.md).

Do not copy a manufacturer's complete manual into the repository without the
necessary permission. Do not extrapolate one part's pinout to a product family.
New component IDs need renderer mappings as well as electrical definitions;
a valid library schema alone does not establish render support.

After intentional library edits, regenerate the project lock and validate.
The Siemens pilot covers selected S7-1200, ET 200SP and Comfort Panel order
numbers, with separate wiring examples for the reference-machine candidates.
Extend this through individually sourced part reviews; support for other family
members is not implied by those definitions. See the library README for the
current inventory and the limits of each model.

## Checks and releases

The normal check is the cross-platform source-alpha development check.
Source engine instructions live in the compact [root guide](AGENTS.md).
Keep historical private release controls intact. The normal check excludes the
frozen `release-package.test.ts` inventory suite and does not assert protected
release-evidence audits.
Source archives are verified separately by extracting, installing, building, and
running the alpha CLI. Historical checks and former guide context are preserved
in the [source development archive](docs/legacy/source-development-context.md).

Run `bun run package:pack` from a clean committed tree to build and verify the
public runtime ZIP, or add `--preview` for an uncommitted local test build.
See the [runtime packaging guide](docs/runtime-package.md) and
[platform checks](docs/platforms.md) for packaging, acceptance, and verified
targets. Workspace packages
remain `private: true` to prevent accidental npm publication; that flag does not
restrict the source license.

Do not publish a package, change repository
visibility, select a license, or upload machine-project data as part of a routine
fix. Every release should identify the exact commit and supported runtime.

`bun scripts/check-worktree.mjs` reproduces the linked-worktree CI step locally.
It installs and checks committed `HEAD`; it does not copy uncommitted edits.

### Documentation index and checks

`bun run check:docs` checks the generated [documentation index](docs/README.md),
local links and fragments, guide topics, source-document navigation and legacy
instructions. It runs after `check:health` in `bun run check` and makes no edits.
After adding, removing or renaming a Markdown source, changing its H1, or editing
`docs/topics.json`, run `bun scripts/docs-index.mjs --write` and inspect the diff.
The default `bun scripts/docs-index.mjs` (or `--check`) only checks freshness.
After any Markdown change, run `bun scripts/docs-index.mjs --check` and regenerate
if stale. Rebased branches follow the same check, including changes to an H1.

The inventory includes unstaged source Markdown and works without Git in source
archives. `scripts/docs-policy.json` defines groups and narrow exclusions for
build output and process artifacts; it is not a document allowlist. Library,
research, evaluation, tooling, fixture and archive links are inside expandable
groups. Every source document must have an inbound link and be within two links
of the root README. Planning links cannot satisfy either rule. Code and unused
reference definitions are not navigation; external URLs are not fetched.
Non-Markdown assets need an existing local target.
Links into excluded paths fail even when the target exists. When Git is available,
Git-ignored targets also fail; tracked documents hidden by policy are findings.
`file://` URLs fail because they do not identify portable repository paths.
Findings are sorted as `file:line target reason`; exits are 0 (clean), 1
(findings), and 2 (tool failure). Both scripts accept `--root <directory>` for
checking a separate source tree.

Historical runtime and installation instructions belong in `docs/legacy/`.
The scan checks configured old-runtime phrases in live prose and code, joining
shell continuations before checking. `scripts/docs-policy.json` has an empty
legacy baseline. Only that archive and the SHA-protected frozen CLI
`assets/AGENTS.md` are exempt from legacy prose checks; both remain in the
inventory and link checks. Live
factual archive pointers and electrical uses of “legacy” remain valid.

### Focused tests and timings

Build after source edits: several suites execute `dist/`. Use Vitest through the
wrapper, with `VITEST_MAX_WORKERS=2` on shared machines. `bun run test:catalog`
lists files by package, typical file wall times and coverage, including the named
catalog and research suites. Set `THERMITE_TEST_TIMINGS=1` on `bun run test` or
`bun run check` to write Vitest's per-file start/end intervals and assertion
results to `coverage/test-timings.json` (ignored, overwritten on each run).
Intervals overlap across workers; they are not additive check wall time. Delete
that report after taking measurements.

| Package / suite           | Focused command (prefix with `VITEST_MAX_WORKERS=2`)                                                     | Covers                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| schema                    | `bun run test -- packages/schema/test`                                                                   | Strict JSON/UTF-8, schemas, diagnostics, generated type consumers                        |
| compiler                  | `bun run test -- packages/compiler/test`                                                                 | Loading, locks, resolution, expansion, nets, engineering rules                           |
| core-library              | `bun run test -- packages/core-library/test`                                                             | Shipped generic type versions and package inventory                                      |
| query                     | `bun run test -- packages/query/test`                                                                    | Read-only traversal, continuity, reports, ordering                                       |
| render                    | `bun run test -- packages/render/test`                                                                   | ELK, symbols, layout validation, conservation, print bounds, determinism                 |
| agent-tools               | `bun run test -- packages/agent-tools/test`                                                              | Requests, guarded patches, filesystem safety, recovery                                   |
| cli                       | `bun run test -- packages/cli/test`                                                                      | CLI streams/exits, init, guides, PDF, packaging, catalog/research                        |
| Catalog acceptance        | `bun run test -- packages/cli/test/promoted-component-libraries.test.ts`                                 | Accepted component bytes, net partitions, rendered coverage                              |
| Research tools            | `bun run test -- packages/cli/test/library-batch-tools.test.ts packages/cli/test/research-tools.test.ts` | Local fake workers, queues, limits, interruption, reviewed promotion                     |
| Engine eval checker tests | `bun run test -- evals/engine`                                                                           | Oracle, provenance, negative cases, contracts, checker unit tests                        |
| Agent eval tests          | `bun run test -- evals/agent`                                                                            | Fake-agent runners, A/B gates, dogfoods, artifacts and shim safety                       |
| Drawing eval tests        | `bun run test -- evals/draw`                                                                             | Drawing corpus, physical checks and expected-defect gates (when present on the checkout) |

A single file can replace any directory in these commands.

### Golden and generated-fixture map

Rebuild first. Update only the set you own, inspect every diff, and check it
again. Other sets have no automatic updater; never regenerate unrelated goldens
to silence a failure. Rendering changes also need print-size review in both flows.

| Set / location                                                                                                        | Covers                                                                                                 | Intentional update                                                                | Read-only check                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shipped-core: motor-starter lock, compiler IR, agent type-only patch report                                           | Core byte locks, deterministic IR and failed-patch diagnostics                                         | `bun scripts/update-shipped-core-goldens.mjs --write`                             | `bun scripts/update-shipped-core-goldens.mjs --check`                                          |
| Task4: CLI/renderer motor-starter and PNP, agent workflow, `m8-r005`                                                  | Frozen continuous SVG and split-stream/exit contracts; inventory in `scripts/m8-golden-migration.json` | `bun scripts/update-task4-goldens.mjs --write`                                    | `bun scripts/update-task4-goldens.mjs --check`                                                 |
| Starter fixtures: `packages/cli/templates/starter-default`                                                            | JSON and locks for both init paths                                                                     | `bun scripts/update-starter-fixtures.mjs --write`                                 | `bun scripts/update-starter-fixtures.mjs --check`                                              |
| Motor-starter manifest/presentation                                                                                   | Authored manifest and presentation fixture                                                             | `bun scripts/update-motor-starter-presentation.mjs --write`                       | `bun scripts/update-motor-starter-presentation.mjs --check`                                    |
| RB render snapshots: `packages/render/test/snapshots/`                                                                | Direct-pair SVG and expanded loads R004 bytes in both flows                                            | `bun run test -- packages/render/test/render-robustness.test.ts --update`         | Same command without `--update`                                                                |
| Tier2 R004: `packages/render/test/goldens/tier2/`                                                                     | Rejected bridge/right-deep layouts and diagnostic bytes                                                | No updater; review and edit expected JSON only for an intentional contract change | `bun run test -- packages/render/test/tier2-r004.test.ts packages/cli/test/render-cli.test.ts` |
| Render ordering: `packages/render/test/elk-options.golden.json` and `snapshots/semantic-ordering/layout-metrics.json` | ELK adapter option assignments, layouts, trace controls and side-branch ordering evidence              | `bun scripts/update-render-ordering-goldens.mjs --write`                          | `bun scripts/update-render-ordering-goldens.mjs --check`                                       |
| Schema/compiler `fixtures/**/expected.json`                                                                           | Exact invalid-input and engineering-rule diagnostic expectations                                       | No updater; edit the synthetic fixture and its expectation together               | `bun run test -- packages/schema/test/fixtures.test.ts packages/compiler/test/rules.test.ts`   |
| Engine eval corpus: `evals/corpus/`                                                                                   | Seeded oracle cases, mutations, provenance manifest                                                    | `bun evals/engine/reseed.mjs` (changes corpus intentionally)                      | `bun evals/engine/reseed.mjs --verify`                                                         |
| Text metrics generated source                                                                                         | Font-derived glyph widths used for physical text bounds                                                | `bun scripts/update-text-metrics.mjs --write`                                     | `bun scripts/update-text-metrics.mjs --check`                                                  |
| Schema generated types                                                                                                | TypeScript declarations derived from JSON Schemas                                                      | `bun run generate:types`                                                          | `bun run generate:types:check`                                                                 |

### Health budgets

`bun run check:health` runs the same deterministic AST ratchet as `bun run check`.
The committed `scripts/health-budget.json` caps only files over 850 lines and
functions over 70 lines: existing outliers cannot grow, and newly crossing an
outlier threshold fails; sizes at or below the thresholds need no entries.
Non-null assertions and test suppressions default to zero per file, with only
nonzero entries stored. Duplicates count at 50 or more normalized body tokens;
existing groups cannot grow, and new meaningful groups fail. Source coverage is
`packages/*/src` and `scripts` (including frozen scripts, without editing them).
Only git-tracked files are scanned; run from the checkout root. Add a new file to
the index (`git add -N <file>` is enough) before checking it. Untracked/ignored
scratch cannot fail the ratchet; untracked in-scope files are listed in a warning.
Generator-owned sources are excluded only at
`packages/schema/src/generated/` and `packages/render/src/text-metrics-data.ts`;
their generators' own check commands still guard them.
Shell/Python/PowerShell scripts have line budgets; TypeScript/JavaScript also
have AST metrics. Tests are excluded from size/assertion/duplicate metrics.
Tracked tests anywhere in the checkout are scanned for `.skip`, `.todo`, `.skipIf`,
`.runIf`, `.only`, Node skip/todo options (including shorthand), runtime
`ctx.skip()` and destructured `skip()` calls. Conditional forms count too.
Counts are declarations, not expanded parameterized test cases. Fixtures and
build outputs are excluded. CRLF/LF checkouts give identical measurements.

| Action                          | Command / rule                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check current values            | `bun run check:health`                                                                                                                                                                                                                |
| Keep an improvement permanently | `bun run health:lower`, then inspect the budget diff; it rejects every increase, removes sizes at/below their thresholds and zero counters, and writes only on success                                                                |
| Accept reviewed growth          | `bun run health:accept` raises only current regressions to measured values, prints each old -> new, and leaves every other entry alone. The PR must list every raise with a one-line reason; prefer a cheap extraction when practical |
| Understand a failure            | The message names the file or lexical function, metric, old budget and new value (or the threshold for a newly crossing size); assertion/skip defaults are zero and duplicate groups default to one body                              |

Named functions use lexical names. Anonymous callbacks also use their order of
occurrence: an earlier callback can shift `map callback~2` to `map callback~3`.
For an intentional rename/move or position shift, re-key the existing allowance
(e.g. replace `"file.ts#outer/map callback~2": 171` with
`"file.ts#outer/map callback~3": 171`), then run
`bun run health:lower` to remove stale allowances. Review the new identity before
accepting it. An identical edit to every member of a duplicate group changes its
hash and appears as a new group; it needs review too. Duplicate normalization drops trivia but preserves identifier,
string, template and regex contents. The ratchet caps growth; it does not certify
code quality or replace review. `bun run test -- packages/cli/test/health-ratchet.test.ts`
checks mutations, explicit acceptance and downward-only updates.
