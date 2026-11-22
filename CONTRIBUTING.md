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
`bun.lock` changes with any dependency change. Releases ship through the
runtime package described below.

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

## Browser for tests

After installing dependencies, install the lockfile-pinned Chromium exactly as
CI does: `bun node_modules/playwright-core/cli.js install --with-deps --no-shell chromium`.
On Linux, `--with-deps` needs sudo or root privileges to install system libraries;
omit it if those libraries are already installed.
Print its executable with
`bun -e "import { chromium } from 'playwright-core'; console.log(chromium.executablePath())"`
and set both browser overrides to that path. Without `THERMITE_TEST_BROWSER`,
system Chrome/Chromium is chosen before the pinned cached build. CI exports
both overrides from `chromium.executablePath()`.

- `THERMITE_TEST_BROWSER` selects the PDF/browser test harness executable.
  A defined override, even an invalid or empty one, disables the helper's
  discovery fallback. Without
  it, discovery tries macOS Google Chrome, `/usr/bin/chromium`,
  `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`, then Chrome under
  `%PROGRAMFILES%`. It next searches `~/Library/Caches/ms-playwright`,
  `~/.cache/ms-playwright`, then `%LOCALAPPDATA%/ms-playwright`.
- `THERMITE_DRAW_CHROMIUM` selects the draw checker executable. A nonempty
  inaccessible override fails without fallback. Otherwise discovery searches
  `~/Library/Caches/ms-playwright` on macOS or `~/.cache/ms-playwright` on
  other OSes; it does not search system Chrome or `%LOCALAPPDATA%`.

Both cache searches try `chromium-*` directories in reverse lexical order;
[platform checks](docs/platforms.md#browser-for-tests) lists their executable
suffix orders. Neither helper reads `PLAYWRIGHT_BROWSERS_PATH` directly.
Only guarded optional browser crops skip locally without a browser. Some browser
suites call the PDF harness without a skip guard and fail rather than skip if
no browser is available. When no path was found, Playwright tries its own registry.
Draw suites also fail when Chromium is missing. The full check needs a browser
for both harnesses even without `THERMITE_REQUIRE_BROWSER=1`; that flag makes
the PDF harness fail at discovery. CI sets it and selects pinned Chromium in
both jobs on every OS.

With pinned Chromium, default Canvas ascent and left glyph bounds are whole-unit
rounded on Linux and Windows; right bounds and text-box widths are not uniformly
integer-rounded. macOS defaults are precise. Captured differences reach about
0.5 mm vertically, 1.2 mm at the Windows right edge and 1.5 mm in Windows
glyph-box width; these are observations, not universal bounds. Calibration tests opt into precise bounds;
see the [platform evidence and measurement code](docs/platforms.md#browser-for-tests).

Use `bun run test -- <files>` after rebuilding, with `VITEST_MAX_WORKERS=2` on
shared machines. The wrapper canonicalizes macOS temp paths; `bunx vitest`
bypasses it and is unsupported. With shared dependencies, add
`--no-cache --configLoader=native`. Git paths follow `-C`:
`git -C engine worktree add -b fix ../worktree HEAD` creates a sibling checkout.

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

Every render-lane PR must also pass `bun run check:perf`. It rebuilds the head and
base before timing. This
separate [performance gate](evals/README.md#required-performance-gate-for-render-changes)
compares compile and packet medians against the PR parent: by default the
merge-base of HEAD with `origin/dev`, or an explicit `--base-rev <revision>`.
It takes 21 compile and five packet samples per engine, confirms a failing row
once, and fails when both exceed +20%. The dated dev baseline anchors category 7
and supplies historical context for the live gate. Keep both measurements and
load evidence with the review.

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
Releases ship through the runtime package. The former private npm tarball
pipeline has been retired.
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
Keep implementation notes such as the [selection boundary](docs/render-selection.md)
in `docs/`, outside package `src/` trees, so implementation documentation stays
separate from TypeScript compilation inputs.
Non-Markdown assets need an existing local target.
Links into excluded paths fail even when the target exists. When Git is available,
Git-ignored targets also fail; tracked documents hidden by policy are findings.
`file://` URLs fail because they do not identify portable repository paths.
Findings are sorted as `file:line target reason`; exits are 0 (clean), 1
(findings), and 2 (tool failure). Both scripts accept `--root <directory>` for
checking a separate source tree.

`check:docs` also checks the [runnable-example inventory](scripts/docs-examples.json).
It covers every code block in indexed READMEs, live `docs/` and the generated
project guide source. It also covers shell fences in the library component
examples and the CLA. The archive and planning are excluded. Entries use the
file path and a SHA-256 of language, metadata and body. Moving a fence down
the page does not invalidate it. Each entry is executed, illustrative with a
reason, or limited to a named setup with a reason.
Freshness checks run no examples. The test suite executes current Markdown bodies
in temporary projects. Bound examples name their exact test, pin its
source bytes, and require evidence that the test parser consumed the selected
fence hash. A passing test that omitted that fence cannot approve it.

After changing a fence, use `bun scripts/docs-examples.mjs --help` to choose its
classification. For example, `bun scripts/docs-examples.mjs --classify README.md#4 --as executed --recipe repo-shell`
runs that recipe before recording the current hash; a failed run leaves the
inventory untouched. Use the recipe already named by the reviewed entry when
updating it. Illustrative entries require `--reason`; platform entries also need
`--setup`. Inspect the inventory diff. `bun scripts/docs-examples.mjs --measure`
prints counts by file and language. No bulk updater silently approves examples.
Child commands close unused stdin and have deadlines (30 seconds for recipe
commands, 120 seconds for bound tests; `docs/machine-demo.md` repo-shell
commands also allow 120 seconds). Teardown kills and awaits owned children
before removing their temporary files; bound-test scratch files also live under
the owned temporary directory.

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
| Series-loop: `packages/render/test/goldens/series-loop/`                                                              | Opt-in three-net loop sheets in both flows and source positions                                        | `bun scripts/update-series-loop-goldens.mjs --write`                              | `bun scripts/update-series-loop-goldens.mjs --check`                                           |
| DOL control: `packages/render/test/goldens/dol-control/`                                                              | Saved K1 and R1 rooted control views in both flows, including terminal-context references              | `bun scripts/update-dol-control-goldens.mjs --write`                              | `bun scripts/update-dol-control-goldens.mjs --check`                                           |
| RB render snapshots: `packages/render/test/snapshots/`                                                                | Direct-pair SVG and expanded loads R004 bytes in both flows                                            | `bun run test -- packages/render/test/render-robustness.test.ts --update`         | Same command without `--update`                                                                |
| Tier2 R004: `packages/render/test/goldens/tier2/`                                                                     | Rejected bridge/right-deep layouts and diagnostic bytes                                                | No updater; review and edit expected JSON only for an intentional contract change | `bun run test -- packages/render/test/tier2-r004.test.ts packages/cli/test/render-cli.test.ts` |
| Render ordering: `packages/render/test/elk-options.golden.json` and `snapshots/semantic-ordering/layout-metrics.json` | ELK adapter option assignments, layouts, trace controls and side-branch ordering evidence              | `bun scripts/update-render-ordering-goldens.mjs --write`                          | `bun scripts/update-render-ordering-goldens.mjs --check`                                       |
| Schema/compiler `fixtures/**/expected.json`                                                                           | Exact invalid-input and engineering-rule diagnostic expectations                                       | No updater; edit the synthetic fixture and its expectation together               | `bun run test -- packages/schema/test/fixtures.test.ts packages/compiler/test/rules.test.ts`   |
| Engine eval corpus: `evals/corpus/`                                                                                   | Seeded oracle cases, mutations, provenance manifest                                                    | `bun evals/engine/reseed.mjs` (changes corpus intentionally)                      | `bun evals/engine/reseed.mjs --verify`                                                         |
| Text metrics generated source                                                                                         | Font-derived glyph widths used for physical text bounds                                                | `bun scripts/update-text-metrics.mjs --write`                                     | `bun scripts/update-text-metrics.mjs --check`                                                  |
| Schema generated types                                                                                                | TypeScript declarations derived from JSON Schemas                                                      | `bun run generate:types`                                                          | `bun run generate:types:check`                                                                 |

### Health budgets

`bun run check:health` runs the deterministic AST ratchet in `bun run check`.
Global ceilings are 3,000 physical lines per file and 300 per function. They,
and the total non-null assertion and test suppression ceilings, never rise.
The outlier thresholds remain 850 file lines and 70 function lines. Against dev,
crossing a threshold or growing an entry requires an exact reviewed reason.
Release targets enforce the hard invariants without recomposing per-item reasons
from earlier dev PRs. Active grandfathered over-cap entries only fall. Dev checks
content continuity per PR; release compares the admitted entries by value without
re-deriving cumulative continuity. `health:accept` cannot waive hard invariants.

Renderer layout uses `packages/render/src/text-metrics.ts` for pinned text
advances and ink bounds. The health check flags local width estimates in
renderer and CLI source. The drawing checker measures issued output
independently in Chromium and PDF.js.

Coverage defaults to **all tracked code** (`js/mjs/cjs/jsx`, `ts/mts/cts/tsx`,
Python, shell and PowerShell), including package fixtures, generators, examples
and new directories. The explicit generated-code exclusions are
`packages/schema/src/generated/**` and `packages/render/src/text-metrics-data.ts`.
JSON/data and signed evidence are not code; pure literal-data modules in
fixtures/goldens/snapshots are excluded by AST inspection. Directory names alone
do not exclude code helpers. `evals/agent` is frozen to E2's harness: its existing
tracked-test suppression scan stays, but its sizes are excluded pending a separate
versioned harness-equivalence change. Test sizes count; only direct
`describe`/`suite` grouping callbacks in test files are excluded (including
`.only`, `.each(...)` and other suite modifiers, not arbitrary chained calls).
Their nested `it`/`test` bodies, hooks and helpers count. Non-null/duplicate counts
cover production/scripts; tests and fixture code count suppressions, not assertions
or duplicate bodies. Duplicate bodies count at 50 normalized AST tokens.

Only Git-tracked files are scanned; run at the checkout root. Use `git add -N`
for new files; omitted untracked code produces a warning. Lines split on CRLF,
CR, LF, U+2028 and U+2029. Source spans include signatures and internal
comments/blanks, excluding preceding trivia. Named functions use lexical names;
anonymous callbacks also use occurrence order. Shell/Python/PowerShell have file
line budgets; JavaScript/TypeScript also have function/AST metrics.

The checker compares against the merge-base with the fetched PR target
(`GITHUB_BASE_REF`, restricted to `dev` or `release`) first, otherwise the newer of `origin/dev` and local `dev`
(whichever contains the other). Missing or divergent baseline refs fail closed;
fetch full history and reconcile them. CI uses `fetch-depth: 0` and verifies the
base ref. Only synthetic test repositories may explicitly opt in with
`THERMITE_HEALTH_ALLOW_NO_BASE=1`; it is ignored whenever `CI` or `GITHUB_ACTIONS`
is set, including empty/false values. With no baseline ref the local opt-in
compares against HEAD if it exists. If the PR base has no committed budget, the
one-time migration uses the budget committed at `merge-base(HEAD, origin/dev)`.
That budget must exist and validate in the current format; there is no upgrade,
source re-seed, local-dev fallback or PR-head fallback for this authority. The PR
base source is still measured and printed as information only. All hard invariants
use the committed dev bootstrap; per-identity monotonicity applies to both targets.
Once release has a committed budget, comparison uses that release base normally.
Existing committed v2/v3 budgets on the normal path retain their migration rules.
Version 4 retires old sub-cap records and ignores legacy string reasons.

A grandfathered allowance on dev follows content within its file, not a name or callback
position. The matcher hashes substantive AST-token lines without trivia and
counts **added lines = current lines minus common lines**, consuming repeated
base lines once per occurrence. At most 70 added lines are allowed, even with a
reason; pure shrinks qualify. Matches are one-to-one: most common lines first,
then fewest added lines, exact hashes, unchanged identities and lexical IDs as
deterministic tie-breakers. A candidate nested inside another available candidate
for the same base body is excluded; consumed bodies no longer compete. AST source
ranges establish nesting, including same-line bodies. Over-cap files use the same 70-line bound
with trimmed nonempty file lines. Matching cannot waive the decreasing size limit.
Base fingerprints authenticate stored locators; current fingerprints are refreshed
by `health:lower`. Unmatched bodies are new and face the global cap. A record
retires when its matched value reaches the cap or below, or its content is deleted;
`health:lower` removes it without a tombstone. Subsequent growth follows ordinary
per-item policy. A recreated body must also stay under the global cap. On release,
each over-cap body/file still needs an active entry whose value does not exceed
the base entry. Its current fingerprint and location must be valid, and cross-file
moves still need proof; reviewed dev swaps are not cumulatively limited to 70.
`health:accept` banks stale allowances downward, including reductions inherited
from a rebase. It cannot raise an existing identity. Lowering needs no reason.

| Action                | Command / rule                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Check                 | `bun run check:health`                                                                                                                                                                                                                           |
| Bank reductions       | `bun run health:lower`; refuses regressions, lowers counters/entries, refreshes content fingerprints and retires deleted/sub-cap allowances                                                                                                      |
| Record a new identity | `bun run health:accept --reason "specific reason"`; only for a new identity within policy (files ≤3,000, functions ≤300; other counters default to zero, duplicates to one). Existing numeric allowances cannot rise, even with an exact reason. |
| Move an allowance     | Record `moves[newIdentity] = {section, from, sha256}` (or use `section:newIdentity` to disambiguate counters sharing a file). New bytes/normalized body must match the base, and the source identity must be absent.                             |

Every numeric section is monotone against the authenticated base, on both dev
and release: files, functions, non-null expressions, casts, definite-assignment
declarations, skipped tests and duplicate groups. A move must also remove at least
the destination allowance's value from its recorded source allowance in this
change. Retaining a stale source record or reusing a source reduction fails.

An ordinary size allowance also follows a substantial continuation when its
budgeted base identity loses content to new identities, including across files.
Every budgeted source is considered, even if it stays above 850/70 lines;
keeping a decoy or compatibility wrapper cannot reset the cap. A source keeping
at least 80% of its old normalized lines is intact and is not a continuation
origin. Otherwise its retained lines contribute to the split, and its remaining
numeric allowance is charged against the shared cap. Each candidate part must retain
at least 20% of the old normalized lines; the parts together must retain at least
80%. Line intersections consume occurrences, so repeated lines do not create
extra retained content. File lines are trimmed nonempty text (including comments);
function lines are trivia-free AST tokens grouped by line, excluding brace-only
lines. Metadata covers small bodies too, so a stale allowance cannot evade this
rule after its source shrinks below the ordinary threshold.
Eligibility is established before ownership is assigned, so a weak ancestor
cannot steal a matching inner body. Retention uses disjoint current body views
(most shared lines, then fewest added lines), avoiding nested double counting.

All numeric allowances in a matching group share the source allowance, including
any stale record retained at the old key. A new part above 850/70 needs an allowance;
an ordinary unbudgeted helper at or below that threshold consumes no numeric grant.
The shared cap includes a fixed **3 physical lines per new above-threshold
continuation part**, for both functions and files. The named constant
`SPLIT_PART_OVERHEAD_LINES` covers a header, closing brace and call site, or the
import/export lines of a file split. It is not configurable and is not stored in
the budget. Small unbudgeted parts earn no overhead credit. For example, a
200-line function may split into 103 + 100 under a shared cap of 203; adding one
more physical line exceeds that cap. This credit needs no separate reason and
does not waive the normal reason requirements for a new allowance. All parts
must also meet the normal 3,000/300 ceilings; anything beyond the shared cap plus
this fixed overhead is ordinary growth.
Content-ranked ownership reserves separately budgeted nested functions; a parent
and child do not consume the same group's credit twice. Remaining ambiguous
origins each impose their own constraint, without pooling extra allowances.
An authenticated verbatim move selects its recorded source instead of an
overlapping candidate; the existing funding ledger still checks its reduction.
Sorting and multiset comparisons make the result independent of object or line
order. This is a static similarity policy, not semantic identity: content below
the 80% collective threshold is new. The history measurements and positive
extraction/boilerplate controls are recorded with the HEALTH-8 review receipts.

For a counted construct extracted while its source file remains, the
section-qualified proof additionally names `sourceBody` and `targetBody`.
Their normalized body hashes must equal `sha256`; the old body must be absent.
Its hash must also be absent throughout the source file, preventing a renamed
copy from being credited as a move.
All of the destination file's counted constructs must belong to that body,
and the source file's measured count must fall accordingly. A shared credit
ledger prevents double spending. Retain an exact fresh reason such as
`moved verbatim from <file> by HEALTH-8 extraction` for every transferred counter;
the reason alone grants no allowance. Whole-file moves retain the original
file-hash proof. Verbatim duplicate bodies keep the same content identity.

Historical reasons remain readable and append-only; they never authorize an
existing allowance to grow. Normalized body hashes retain identifiers, strings,
templates and regex contents while dropping trivia. Same-file grandfathered
callback shifts still use the content matcher and its 70-added-line dev limit.
Release grandfather entries compare by value without composing dev edits, but
all ordinary numeric allowances obey the same monotonicity rule. Ratchet tests
are in `packages/cli/test/health-*.test.ts`.

Casts already had a measured implicit per-file allowance. Version 4 now stores
it explicitly in `typeAssertions`, seeded only from authenticated baseline source
when an older budget lacks the section. Removing the section cannot reseed it
from PR-head counts.

Definite-assignment declarations (`let value!: T` and class fields `value!: T`)
have a separate `definiteAssignments` counter, including tests. Its initial
per-file baseline and global ceiling are measured from authenticated base source
when reading an older v4 budget. The committed migration records that baseline
with a reason; the ceiling can only fall. It follows the same monotone per-item and lowering rules. Expression non-null counts retain their old scope.
Only a fully absent counter section migrates; partial sections fail validation.
The counters do not detect empty type-predicate/assertion functions or `any`-typed
bindings that drop optionality; those remain review responsibilities.

The separate test-helper audit follows actual test imports only within
`packages/*/test/` (also `tests/`); it does not claim coverage outside that scope.
Legacy bypass admissions authenticate the full enclosing function chain and
consume one matching base function per current function. Identical copies do
not acquire another admission. Guard detection covers `if`, conditional
expressions, `&&`, `||`, `??`, their logical-assignment forms (`&&=`, `||=`,
`??=`), and optional calls. It does not detect `switch`/`case`, loop bodies or
assertions wrapped in callbacks; this is not a proof that every assertion executes.

The ELK wrapper audit is static, not a sandbox. Outside its hash-pinned loader,
denied imported member names are reserved at property access, constant-key element
access and object destructuring. Assignment targets are followed through nested
object/array patterns, defaults, spread/rest targets and for-of/for-in heads. The
checker must resolve such a member entirely to its allowlisted external
declarations; local, merged or unresolved symbols are rejected. This use-site
rule does not depend on the spelling of an alias or generic type. The syntactic
slot check remains for earlier diagnostics, without claiming resolved type-flow
analysis. The reservation deliberately also rejects harmless local uses of names
such as `run` or `exit`. The audit does not analyze the implementations of closed
imported dependencies or provide a runtime sandbox; the loader is admitted by
its exact hash. Nonconstant computed keys remain rejected by the existing key
audit. Closed imported implementations remain trusted.
Runtime-only members absent from the Node type declarations (such as Bun's
AsyncLocalStorage `withScope`, `_enable` and `_propagate`) are not reserved:
local interfaces declaring them pass; module augmentation is rejected.
Cast-reason replay comparison ignores whitespace, Unicode format characters and
default-ignorable code points. Other changed text (including a trailing period
or a braille blank) still counts as fresh, subject to exact from/to authorization.
