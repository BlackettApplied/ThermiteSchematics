# Durable DOL control probes

Synthetic source: [saved DOL](../../../../core-library/test/fixtures/dol-starter/),
shipped core 0.2.0 and its existing byte lock. These are selection/coverage probes,
not electrical designs or compatibility recommendations. No library, rating or
pinout is added here.

Provenance: issue #62, design section 7 (62e), measured on `1ebbfb1`; replayed
after #186. P4/P5 moved here unchanged from `dol-control-junctions`. P6 was
`off-view-fixtures.ts:p6Fixture`; P7 was the patch in core's transformer test.
Each recipe starts from saved DOL, never from another recipe:

| Recipe | Authored change                                                           |
| ------ | ------------------------------------------------------------------------- |
| P4     | W30 PS1.+ → S0.11; remove W31.                                            |
| P5     | P4 changes, plus W36 S2.14 → K1.A1, W37 R1.14 → K1.A1, W38 K1.A1 → R1.A1. |
| P6     | P5 changes, except W37 R1.14 → S2.14; preserves the longer holding path.  |
| P7     | Saved W30 starts at T1.X1; W40/W41/W42 start at T1.X2. Validation only.   |

`dol-control-probes-fixture.ts` applies these exact replacements in external
temporary projects. It preserves all retained UUIDs, unchanged endpoints, device
facts and library locks. Core tests check those invariants and deterministic net
identities; existing junction tests retain endpoint/net and erased-edge/same-port
negative gates. Net IDs are compiler results, never rewritten to help a drawing.

`packet.json` is the saved combined K1/R1/explicit-control request: Tabloid,
landscape, 10 mm, standard spacing, no index. `dolPackets` replays its four
projections (K1, R1, circuit, combined) in both flows; P4–P6 omit nonexistent W31
from the explicit request. `inventory.json` names the complete control target;
tests independently derive it from authored wires and device-type functions:
saved **17 wires / 14 functions**, bypass **16 / 14**, including disconnected F1.
`expected.json` names exact rooted omissions and off-view disclosures. They were
measured on `1ebbfb1` and reviewed against the 62e plan, not derived; never
regenerate them from renderer output without a fresh review. P6 K1
remains six selected wires and six functions, with four cards/six rows.

The replay contract checks every rooted sheet's selected-path notice, zero
rooted audited counts, unaudited sheet numbers, and actual circuit ink for each
audited appearance. Combined packets count each source identity once. Neither
marker text nor a terminal-only context counts as a function. The terminal gate
also uses the shared renamed AUX7 probe, where no selected contact masks W906.
Both mutation suites mutate test inputs and expectations, so they show the
assertions are sensitive; they reject invented selection/coil appearances and
suppressed terminal-only W906. They do not require one sheet or a short holding loop.

P7 has no drawing replay or rendering golden. Its exact I305 pin remains owned
by [core's diagnostic fixture](../../../../core-library/test/fixtures/transformer-control/p7-diagnostics.json)
and `transformer-control.test.ts`. It establishes no secondary/coil compatibility;
printable R006 is tracked separately in #184 and is not an expected defect here.
Positive transformer rendering stays in the existing unrated transformer tests.

Run with `bun run test -- packages/render/test/dol-control-probes.test.ts
packages/render/test/dol-control-probes-terminal.test.ts` (one command).
