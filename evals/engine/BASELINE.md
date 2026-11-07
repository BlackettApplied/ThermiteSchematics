# Engine observations (unpublished evals v1.0)

## Current baseline: 2026-11-04, final review on 629a563 (Round 5)

Engine and evals base: `629a563b9a58a8a281def9f76f4aa27c68d80887`,
including merged T1. The sealed corpus is unchanged (manifest digest
`12177014dd87c9f7a899a7ac1b75ae40f29b3c9868f37dd919678117648a7aca`).

The V1 pin now includes the actual unassessed conflict: N1.a (24 VDC) and
N1.b (48 VAC) share a derived net with no covering potential. Preconditions
are hard assertions, and evidence includes net ID, terminal names, ratings
and potential UIDs. Removing the conflict fails as a broken fixture; a
future W303 warning on the intact fixture xpasses and forces retirement.
The marker prescribes no future diagnostic code or pointer.

The generated oracle requires exactly one aggregated W111 warning at
`library/types.json` `/types/0/symbol`. Its 30 bus/8 devices deliberately
retain multi-terminal bus continuity coverage. Extra or missing diagnostics
fail. `isolatedBus` is unchanged; no corpus or engine bytes were edited.

Strict checkpoint `C0-r5`: exit **0**, engine and evals revision 629a563,
engine dirty true; evals dirty true (separately recorded).

| Suite         | Pass | Pinned expected fail | Xpass | Unexpected fail |
| ------------- | ---: | -------------------: | ----: | --------------: |
| oracle        |   27 |                    0 |     0 |               0 |
| P-validation  |   67 |                    1 |     0 |               0 |
| P-diag        |   57 |                    0 |     0 |               0 |
| P-contract    |  138 |                    0 |     0 |               0 |
| P-determinism |    2 |                    0 |     0 |               0 |
| P-perf        |    3 |                    0 |     0 |               0 |

P-diag is 57/57 actionable (100%). Zero xpass, unexpected fail,
missing-overlap or infrastructure errors. All 100 conflicts observed real
reservation contention. The sole xfail carries the precise V1 condition.
Focused verification: 2 files, 29 tests passed (2.32 s). The first full check
(`VITEST_MAX_WORKERS=2 bun run check`) exited 0: **129 files passed, 2,302
tests passed, 6 skipped**, 121.69 s. Schema generation, build, formatting and
committed-JSON checks passed. Sanitized log: `evals/out/C0-r5/check.log`.
Historical rounds follow.

## Round-4 baseline: 2026-11-04, P1 integrated

Strict checkpoint `C0-r4` on engine and evals revision
`866aeb0d1d95d36350102789e1bf5e4c8ff2284e`; engine dirty: true;
evals dirty: true (tracked separately). Exit **0**, with zero xpass,
unexpected failures, missing overlap or infrastructure errors.

| Suite         | Pass | Pinned expected fail | Xpass | Unexpected fail |
| ------------- | ---: | -------------------: | ----: | --------------: |
| oracle        |   27 |                    0 |     0 |               0 |
| P-validation  |   67 |                    1 |     0 |               0 |
| P-diag        |   57 |                    0 |     0 |               0 |
| P-contract    |  138 |                    0 |     0 |               0 |
| P-determinism |    2 |                    0 |     0 |               0 |
| P-perf        |    3 |                    0 |     0 |               0 |

**P-diag: 57/57 actionable (100%).** P1's unsupported-profile marker is
retired; its required W111 check asserts the exact code, severity, file and
pointer. Only `mutation/ratings-without-potential` remains pinned, now owned
by V1 (formerly T3), with its unchanged zero-diagnostic signature.

Real render calls established that W111 on the original `eval:node`
`isolatedBus` was a true positive. Circuit rejects `bus/3` under
`thermite:switch`, rooted views cannot draw it, and signal-loop requires a
two-terminal function. A positive-control circuit draws the contact only.
No E206 mark accepts bus/3, so the fixture now uses the least-specific
`other/3` with an explicit `interface` mark. Actual circuit renders depict
c/e/f in both flows, while they remain three separate nets. Multi-terminal
bus coverage remains in the generated fixture and oracle negative control.

The complete reseed/relock/seal recipe changed only the two type files,
their two locks and the manifest. The 56 mutation recipes and every expected
code/file/pointer are unchanged; all 12 baseline net/potential/terminal IRs
are identical before and after. New manifest digest:
`12177014dd87c9f7a899a7ac1b75ae40f29b3c9868f37dd919678117648a7aca`.
No production engine changes. PR.md records per-mutation comparisons, render
evidence and exact verification results.

`C0-r4-b3e24c6` replay: exit 0 with `--report-only`, clean engine
`b3e24c658f80dc3d8036b12b1e718138595e3bd9`, dirty evals revision 866aeb0.
Oracle 27 pass; validation 66 pass / 1 V1 xfail / 1 fail; P-diag 37 pass /
20 fail (64.91% actionable); contracts 35 pass / 103 fail; determinism 2 pass;
perf 3 pass. No xpass, missing overlap or infrastructure error. Relative to
the round-2 replay, P1's one absence and T2's 20 diagnostic gaps now fail
because their markers are retired. The corpus edit changes no replay count;
b3e24c6 accepts the explicit mark and retains the same mutation diagnostics.

Focused verification: 2 files, 26 tests passed (2.21 s). The first capped full
check (`VITEST_MAX_WORKERS=2 bun run check`) exited 0: 128 files passed,
2,271 tests passed, 6 skipped, 131.25 s. Generated types, build, formatting
and committed-JSON checks passed. Sanitized log: `evals/out/C0-r4/check.log`.

## Round-3 baseline: 2026-11-04, T2 integrated

Strict checkpoint `C0-r3` on engine `dd43ecca4691d939654ab6be0c9186888cf73bcd`
and evals revision `dd43ecca4691d939654ab6be0c9186888cf73bcd`; both dirty states are recorded separately.
Exit **0**, with zero xpass, unexpected failures, missing overlap or
infrastructure errors. No production engine behavior or corpus bytes changed.

| Suite         | Pass | Pinned expected fail | Xpass | Unexpected fail |
| ------------- | ---: | -------------------: | ----: | --------------: |
| oracle        |   27 |                    0 |     0 |               0 |
| P-validation  |   66 |                    2 |     0 |               0 |
| P-diag        |   57 |                    0 |     0 |               0 |
| P-contract    |  138 |                    0 |     0 |               0 |
| P-determinism |    2 |                    0 |     0 |               0 |
| P-perf        |    3 |                    0 |     0 |               0 |

**P-diag: 57/57 actionable (100%).** The 17 T2 markers already reporting
xpass were retired. The three E103 markers were also retired after the
predicate was updated for Helm G2.3: complete kind-scoped structured `allowed`
plus the correct `allowedCount` at 50 or fewer; above 50, the correct count
and an `allowedLookup` whose named manifest aliases and admitted sources
exist and jointly provide the full set of IDs of the expected kind.
The compact ten-entry human message does not limit the structured set.

Only T3 ratings without a declared potential and P1 unsupported-profile
warnings remain pinned. Both still produce `ok: true`, exit 0, and no
diagnostics, exactly matching their registered absence signatures. Neither
marker is stale; T1 and G1 remain unmerged and no probe was added for them.

All 138 contract checks pass, including 100 actual contention rounds. The
27 oracle cases, 12 clean baselines, 56 mutations and 16-process determinism
grid are unchanged. The corpus manifest digest remains
`875bc19bd44442fde32fd08c46965f7f40268a248c5e748fa0104ca060a83134`.
Round-3 JSON and Markdown are in ignored `evals/out/C0-r3/`.
Focused verification: 2 files, 25 tests passed in 2.13 s. The two-worker full
check passed on retry: 126 files, 2,215 tests passed, 6 skipped (124.62 s).
The first run hit an unrelated library-batch process-start timeout; its
isolated retry and the final full check both passed without code changes.
Exact commands and both attempts are recorded in `PR.md`.

## Round-2 baseline: 2026-11-04, WS-C merged

Strict checkpoint `C0-r2` on engine `7a7c1fbb27f1943df6cf6399d3c8990ea9233bf4`.
Evals revision `7a7c1fbb27f1943df6cf6399d3c8990ea9233bf4`; engine dirty: true; evals dirty: true.
Only evaluation/configuration/runtime-test files were edited; production engine
behavior is unchanged. This dirty-tree bundle is implementation evidence, not
an awarded score. Engine and evals identities and checker hashes are separate.

| Suite         | Pass | Pinned expected fail | Xpass | Unexpected fail |
| ------------- | ---: | -------------------: | ----: | --------------: |
| oracle        |   27 |                    0 |     0 |               0 |
| P-validation  |   66 |                    2 |     0 |               0 |
| P-diag        |   37 |                   20 |     0 |               0 |
| P-contract    |  138 |                    0 |     0 |               0 |
| P-determinism |    2 |                    0 |     0 |               0 |
| P-perf        |    3 |                    0 |     0 |               0 |

**Exit 0; zero xpass, unexpected failures, missing-overlap rounds or infrastructure
errors.** P-contract is 138/138: all 100 conflicts released after actual
`reservation-contention`, reported loser `A005`, and retained the accepted edit.
Held versus abandoned reservations reported `alive` versus `not-running`.
The rollback outside sentinels remained unchanged. There are no WS-C markers.

The 27 oracle cases include all 13 examples, the valid fixed fixture, the
non-uniform 300-device/1,500-wire graph and all 12 baseline variants. The large
graph has 2,400 terminals and 1,142 nets. Multi-terminal bus functions do not
short terminals; authored potential attachment agrees with compiler nets.
Example warnings match the reviewed model-obligation inventory exactly; no
unexpected diagnostic is classified away as an accepted false positive.

All 12 clean baselines have zero diagnostics. Of 56 mutations in 29 classes,
54 pass their exact diagnostic assertions and two record precisely pinned
absent-diagnostic states: T3 ratings without a potential and P1 unsupported
profile warning. T3 no longer guesses a future code or pointer.

P-diag reports **37/57 actionable (64.91%)**. Twenty T2 gaps remained in round 2, including
the new over-50-type case and a mixed-fault case that also requires terminal
alternatives. The lower percentage than round 1 reflects stricter predicates,
not an engine regression. Every row has an explicit predicate. Hard location,
loading, relock, stream, exit, code and pointer assertions are never gap misses.

Determinism passed in 16 fresh processes: two cwds × two TZs × two effective
JS locales for diagnostics and compile/12-view packet output. Bun ignores
`LC_ALL` for default Intl locale on this host, so workers configure default
JS locales before engine imports and record `en-US` versus `fr-FR` explicitly.

| Warm median of five | Compile ms | Packet ms | Sheets |
| ------------------- | ---------: | --------: | -----: |
| synthetic-inventory |     385.29 |     20.00 |     72 |
| machine-demo        |      29.58 |    252.28 |     20 |
| conveyor-line       |      25.22 |    131.68 |      7 |

The machine-demo row is its authored **12-view schematic packet**, the relevant
400 ms reference gate. All compile/packet repeats are byte-identical. Timings
are informational, separate warm loops; the synthetic packet is a reconciled
1,500-row inventory, not a whole-project schematic.

## Historical replay

`bun evals/run.mjs --checkpoint C0-r2-b3e24c6 --engine evals/out/engine-b3e24c6 --report-only`
exited **0** in `mode: replay`. Engine revision `b3e24c658f80dc3d8036b12b1e718138595e3bd9`
is clean; the evals revision remains `7a7c1fb` with separate dirty state and
exact checker hashes. No eval files were copied into the old engine.

P-contract preserves **35 pass / 103 fail**, with no xfail/xpass, missing overlap
or infrastructure errors. All 100 historical conflicts reached both real
precommit barriers and returned two successful writers; reservation and
rollback controls exposed the three other old failures. Report-only preserves
these failures rather than relabeling them as accepted gaps. The other suites
matched the round-2 run: oracle 27 pass; validation 66 pass / 2 pinned xfail;
diagnostics 37 pass / 20 pinned xfail; determinism 2 pass; performance 3 pass.
The full bundle is in ignored `evals/out/C0-r2-b3e24c6/`.

## Pre-WS-C history: 2026-11-04

The round-1 `C0` preview on `865ca55e849b21e069ff0d076d1e051dcdaf8c44`
reported oracle 15 pass; P-validation 65 pass / 2 xfail; P-diag 38 pass /
18 xfail (67.9%); P-contract 35 pass / 103 xfail. All 100 old conflicts
returned two successful writers, and rollback overwrote the outside synthetic
wire sentinel. The round-1 classifier was too broad; those counts are retained
as dated observations, not accepted by the round-2 strict gap policy.

That older synthetic generator used uniform rings (1,050 nets); its compile
median was 392.09 ms and inventory packet median 22.16 ms. Round 2 deliberately
changes the generator to branches, cross-pin joins and three device types, so
the synthetic timings and net counts are not an unchanged-input comparison.
The kit remains unpublished v1.0 through review.

See [README](../README.md) for exact commands, scope and replay procedure,
[expectations](expectations.mjs) for the only live marker registry,
[corpus manifest](../corpus/manifest.json) for input digests, and the worktree
handoff `PR.md` for full-check results. Shareable round-2 bundles are under
ignored `evals/out/C0-r2/` and `evals/out/C0-r2-b3e24c6/`.
