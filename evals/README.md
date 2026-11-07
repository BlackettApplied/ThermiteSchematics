# Fixed engine evaluations (unpublished v1.0)

This source-only kit measures P-contract, P-diag, P-validation, determinism and
P-perf. Fixtures are synthetic test inputs, not certified equipment or electrical
designs. **`evals/` is excluded from runtime packages.** Runtime allowlist tests
reject evaluation documentation, fixtures and output even when an archive
manifest lists their hashes.

```sh
bun install --frozen-lockfile
bun run build
VITEST_MAX_WORKERS=2 bun run test -- evals/engine/oracle.test.mjs packages/cli/test/runtime-package.test.ts
bun evals/run.mjs --checkpoint C0-r5
```

Each checkpoint writes ignored `evals/out/<name>/summary.json` and `summary.md`.
Names are write-once. Default runs use 100 conflict pairs and five warm timing
samples; a development preview can use `--conflicts 2 --samples 3` with a fresh
checkpoint name. Checkpoint metadata records **engine and evals revisions and
dirty states separately**, corpus digest, checker hashes, runtime/platform,
release paths for every conflict, actionability percentage and per-case evidence.
Only `.mjs` files are hashed as checkers; `BASELINE.md` is an observation document.
Dirty runs are previews. Scoring still requires a pinned commit and green check.

| Evaluation    | Assertions and scope                                                                                                                                                                                                                                                                                         | Scorecard                          | Run location                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------- |
| oracle        | Independent authored-document union-find versus compiler terminal partitions and potential attachment. All 13 examples, valid fixed fixture, generated 300/1,500 graph and all 12 clean baseline variants. Unknown object kinds fail loudly. Example diagnostics must match a reviewed classification table. | 4 Validation                       | `check` and checkpoint runner |
| P-validation  | 60 mutations across 31 classes with exact code, severity, file and pointer, including declared secondary diagnostics. Eleven baselines require zero diagnostics; without-potentials pins one I304 and its nets. Rating-only mutation requires W303 naming both declared-rated terminals.                     | 4 Validation                       | Checkpoint runner             |
| P-diag        | 72 scenarios, each with an explicit actionability predicate and provenance. Hard location, stream, exit, code, pointer, loading and relock assertions precede gap assessment. Reports actionable/total and percentage.                                                                                       | 2 Tool contract; 1/9 recovery      | Checkpoint runner             |
| P-contract    | Six-tool success/authored-error/infrastructure-error matrix; serial guards, no-op/dry-run/stale/presentation; staged rejection; rollback outside sentinel; held/abandoned reservations and owner state; separate-process conflicts. All WS-C probes are required ordinary passes.                            | 2 Tool contract; 7 defect evidence | Checkpoint runner             |
| P-determinism | Two sets of eight fresh processes: authored error diagnostics and machine-demo compile plus authored 12-view packet. Compares exact diagnostic/IR/packet hashes across 2 cwds × 2 TZs × 2 effective JS locales.                                                                                              | 4 G4.5 and determinism anchors     | Checkpoint runner             |
| P-perf        | Separate compile and render loops: one warmup plus median of N. Synthetic complete inventory, machine-demo authored 12-view packet and conveyor four-view packet. Compile and packet byte determinism are required; elapsed time is informational.                                                           | 7 Code health, EA 400 ms gate      | Checkpoint runner             |

Vitest's normal include set is preserved, plus `evals/**/*.test.mjs`; output and
local project directories are excluded. **Every evaluation test included in `check` must pass
normally: no `test.fails`, skip or expected-fail annotations.** Oracle probes
have no gap registry entries. Ordinary unit assertions exercise the classifier's
failure states without exempting any check test. Only the oracle, integrity and
small checker self-tests run in `check`; process grids, conflict repetitions and
performance stay outside it.

## Open gaps and strict policy

[engine/expectations.mjs](engine/expectations.mjs) is the only marker registry.
Each single-line entry names its workstream, reason and pinned bad signature.
Retire a marker by deleting that one line. Corpus and seed recipes contain no
markers, so retirement cannot change fixture bytes or require re-sealing.

All assertions are hard failures by default. `xfail` is possible only at the
explicit assessment boundary when the desired predicate is absent **and** the
observed signature matches the registry: diagnostic code, severity, file,
pointer, exact old message shape and exit, or the pinned absent-diagnostic state.
Changed locations, extra diagnostics, failed `loaded.ok`, dry-run preconditions,
relocking, malformed streams and infrastructure errors never become `xfail`.
V1 is integrated: the intact rating-only fixture must emit W303 naming N1.a
(24 VDC), N1.b (48 VAC), and their shared derived net without any potential.
Hard fixture checks and exact diagnostic assertions precede the positive
assessment. The owner-V1 absence marker is retired. Location policies accept
`info`; `validation-gate-expectations.mjs` pins complete I208 reports for each of
51 specific mutation cases, including gate, rules, objects and locations.
Unlisted cases admit no I208. The `without-potentials` baseline pins one I304
with its exact net membership and ID; all other baselines remain diagnostic-free.
Machine-demo's example inventory likewise accepts its reviewed I304. P1's
unsupported-profile probe still requires W111 at its original exact site.

A repaired predicate with an existing marker is `xpass`: **strict checkpoints
exit 1 and say `stale expectation: retire marker`**. Unexpected failures and
`not-overlapped` rounds also exit 1. Infrastructure errors exit 2, are recorded
per row, and do not erase earlier contract results. `--report-only` records
`mode: "replay"`, preserves every status and exits 0 for ordinary failures or
stale markers; infrastructure errors still exit 2. It is for historical evidence,
not a way to make a scored checkpoint pass.

Initial and dated WS-C/T2/P1 integration results are in
[engine/BASELINE.md](engine/BASELINE.md). WS-C, T2 and P1 have landed: their probes
have **no open gap markers**. V1 now also has no open marker.

E103 alternatives are checked against the true catalog of the authored instance's
kind. At 50 or fewer IDs, structured `allowed` must be the complete set and
`allowedCount` must match, even when the message quotes only ten entries.
Above 50, `allowedCount` and `allowedLookup` must identify the full set: each
quoted manifest (including both shipped runtime/source aliases) must exist,
and its admitted type-source files must exist and collectively contain exactly
the expected kind-scoped IDs. A partial list or file path alone is insufficient.
This follows Helm G2.3 without requiring a type-list command while resolution
fails. Corpus catalog IDs and mutation expectations are unchanged.

## Corpus and oracle

`corpus/manifest.json` records source, purpose and SHA-256 of every fixture file;
the manifest does not hash itself. `topology/` includes a jumper, shared landings,
a terminated cable pair, single-ended/loose spares, isolated contact terminals,
a generic three-terminal `other` function with an explicit `interface` drawing
mark, and a potential declaration. The isolated function grants no continuity.
P1 correctly warned that its former three-terminal `bus` shape could not draw;
E206 permits no mark for that shape. Real circuit renders in both flows now
represent all three terminals, without changing terminals, ratings, potentials
or net partitions. The generated fixture and oracle negative control retain
multi-terminal bus coverage.
`ratings-pair/` deliberately joins conflicting terminal ratings and belongs to
assessment mutation probes rather than the clean oracle set.

The large project is generated deterministically in scratch: 300 eight-terminal
devices of three types, 1,500 authored wires, a branching binary-tree backbone,
seeded cross-pin connections and hub landings. One type has an eight-terminal bus
function, which must not join its terminals. Exactly one aggregated W111 at
`library/types.json` `/types/0/symbol` is expected because its 30 bus/8 devices
deliberately keep an unrenderable multi-terminal bus for continuity coverage.
Wires, jumpers and cable cores
terminated at both ends are the only physical edges. Functions and relations do
not join nets; potentials attach to the authored terminal's component. The
oracle shares loading/schema admission but no compiler expansion, resolved
edges, graph indexes or union-find implementation.

[engine/example-diagnostics.mjs](engine/example-diagnostics.mjs) classifies each
example as clean or as carrying authored model obligations. W903 records an
omitted required connection, W904 an explicitly partial model, and W905 deferred
review work. Exact reviewed warning inventories are preserved, not suppressed;
any other diagnostic, changed message, or missing expected warning fails. The
12 separate baseline variants must emit no diagnostics and also pass the oracle.

For intentional fixture edits, the **complete committed regeneration command**
formats library bytes before relocking and re-seals the reviewed manifest:

```sh
bun evals/engine/reseed.mjs
bun evals/engine/reseed.mjs --verify
```

`--verify` regenerates into disposable scratch and compares every fixture and
manifest byte. `seed-corpus.mjs` and `seed-mutations.mjs` are the recipes;
`baselines.json` is an authored input. The check-included recipe drift test
compares formatted `mutationRecipe()` bytes with `mutations.json`. Expectations
are never learned from compiler output. The version remains unpublished v1.0
through review; after publication, change the task/checker version and replay
the previous checkpoint before collecting new scoring evidence.

## Replay a different engine

`--engine <checkout>` resolves the selected checkout's public package exports
and CLI. Examples come from that engine; fixed corpus inputs and all checkers
come from this kit. Only the guarded-write fault and reservation seams require
internal paths, isolated in `engine.mjs`. The adapter supports both pre-WS-C and
current WS-C engines; an incompatible seam is an infrastructure error.

This exact local-only replay recipe writes entirely under ignored output:

```sh
git clone --no-hardlinks --no-checkout . evals/out/engine-b3e24c6
git -C evals/out/engine-b3e24c6 checkout --detach b3e24c6
bun install --cwd evals/out/engine-b3e24c6 --frozen-lockfile
bun run --cwd evals/out/engine-b3e24c6 build
bun evals/run.mjs --checkpoint C0-r4-b3e24c6 --engine evals/out/engine-b3e24c6 --report-only
```

Use an existing checkout for repeat runs; do not clone over it. No eval files
need to be copied into the engine. Each checkout must have its own Git identity;
an archive extracted under another checkout is rejected rather than mislabeled.
Engine dirty state covers engine/package/library/script inputs; evals dirty
state covers `evals/` and the Vitest config. The evals manifest and checker hashes
also identify uncommitted kit bytes.

## Process evidence and limits

The conflict owner pauses at its real precommit snapshot **before** the peer
starts. The peer must reach its own snapshot barrier or actually observe
reservation contention while the owner is held. There is no timed fallback.
Each round records `releasedBy`, `overlapped`, both exits and the loser's error
code. A peer finishing without either overlap event is `not-overlapped`, never
a pass. Releases are sent once per barrier with disconnect-safe callbacks;
10/30-second bounds classify stalled workers as infrastructure errors. Held
versus abandoned probes assert `ownerState: alive` versus `not-running`.

The determinism grid varies environment locale and TZ before startup. Bun on
macOS ignores `LC_ALL` for default Intl locale, so disposable workers also set
explicit JavaScript default locales **before engine imports**, preserving
engine-authored explicit locales. `locale.mjs` covers Intl constructors and
locale-sensitive String/Number/Date operations. Both effective locales and
both effective timezones are asserted and recorded; production engine files
are unchanged.

Shareable bundles scrub project/engine/kit paths, hostnames, usernames and PID
text, and omit `pid`, `createdAt` and `ageMs` metadata. Tests cover structured
owners and embedded stderr JSON. Semantic owner state remains intact. Raw
pre-round-2 local bundles predate this scrubbing and are not the shareable
round-2 evidence.

P-perf measures the machine-demo **12-view schematic packet** for the 400 ms
reference gate; conveyor compile/packet medians are also included. The synthetic
packet is a complete 1,500-row wire inventory, not a 1,500-wire schematic.
All rows must reconcile exactly once to source wire identities. Timing never
fails `check` and is not a machine-independent performance claim.

Reserved slot: **T1 source metadata used verbatim in a successful guarded
dry-run**. T1 is merged on base 629a563; the E1 probe remains deferred, with
its acceptance and negative cases described in `PR.md` under Follow-ups. E2 owns agent runs;
E3 owns visual/PDF checks; K1 owns source statistics, check-time budgets and the
10× flake audit. Full obligation/suppression reporting, help-request execution
and the release OS conflict matrix remain separate anchors; this kit does not
award them automatically.

P2 render diagnostic scenarios are authored in
`engine/seed-render-diagnostics.mjs`, sealed as `corpus/render-diagnostics.json`
by `bun evals/engine/reseed.mjs`, and checked by `engine/render-diagnostics.mjs`
in P-diag. They cover unsupported profiles and shapes, disconnected control,
accepted trace roots, named layout conductors/endpoints, packet view context,
circuit source keys, verified compact hints and W906 device coverage. Each R
scenario must be actionable; no P2 expected-failure markers are admitted. Use
`bun evals/engine/reseed.mjs --verify` to verify byte-exact reproduction.

V2 adds two partial-potential mutations (#37) and two deferred-required mutations
(#78, unconnected/dangling). Partial potentials leave W303 active for undeclared
fields; the existing `ratings-voltage` mutation now also expects W303 for missing
`voltage_type`, alongside its unchanged E302. Deferred required gaps carry W905
only, preserving the requirement, state and reason. Baseline recipes, fixture
bytes and I304 membership are unchanged. Regenerate and verify with the existing
`reseed.mjs` commands; the manifest records the added provenance.
