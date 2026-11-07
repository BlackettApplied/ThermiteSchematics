# Drawing evaluations (E3)

The source-only kit invokes the built CLI and measures the resulting SVG, real
CLI HTML and direct PDF independently of the renderer's layout estimates.
It does not join `bun run check`: only the browser-free synthetic `*.test.mjs`
files run there. No engine source or electrical project is changed.

```sh
bun install --frozen-lockfile
bun run build
bun evals/draw/run.mjs --checkpoint C1-e3fu
bun evals/draw/run.mjs --checkpoint preview --quick
VITEST_MAX_WORKERS=2 bun run test -- evals/draw
```

Checkpoints are write-once directories under gitignored `evals/out/draw/`.
Open `summary.md`, `summary.json`, `gallery.html` and `reviewer-form.json`.
The JSON sorts keys and observations, rounds coordinates to 0.001 mm, and
contains no timestamps, absolute paths, checkpoint names or wall timings.
`timing.json` and `cost.json` are separate. Compare consecutive full summaries
with `cmp`; use identical checker/marker bytes, engine, corpus and browser.

## Prerequisites and costs

Bun 1.4.2 and R2's existing development dependencies are used:
`playwright-core ^1.64.1`, `pdfjs-dist ^6.5.438`, `@napi-rs/canvas ^1.1.0`.
No extra dependency or browser is installed by a checkpoint. Install Chromium
with `bunx playwright-core install chromium`, or set `THERMITE_DRAW_CHROMIUM`.
Discovery checks macOS `~/Library/Caches/ms-playwright` and Linux
`~/.cache/ms-playwright`; on Windows set the executable path explicitly.
Missing Chromium exits 2 with an installation/path instruction; no silent skips.
A run uses at most two browser pages/case workers.

Strict markers are calibrated on darwin-arm64. Other platforms use
`--report-only`; their font substitutions are not calibrated. Every E3 unit test
is portable and imports no browser, canvas, pdf.js or PDFKit. Seal tests create a
synthetic temporary git repository; check never reads the live corpus.

pdf.js supplies text positions, operators and raster parity. PDFKit is an
optional macOS cross-check (`--pdfkit`); `THERMITE_DRAW_PDFKIT=0` disables it.
The portable historical detector is a labelled construct audit, described below.

Default retained output has a hard **100,000,000-byte** limit, including
`cost.json`; excess is infrastructure failure. Every sheet SVG, direct PDF,
compact IR/query/packet metadata and actual CLI HTML are retained. HTML is measured
then gzipped as `packet.html.gz`; decompress to inspect it. Duplicate SVG/HTML
strings are omitted from packet metadata. Only failing observations with real
on-sheet regions receive 300 dpi crops. Sheet-level or wholly off-sheet findings
have no invented crop. `--artifacts` opts into full-sheet PNGs and uncompressed
HTML, waiving the aggregate budget.

Every SVG has a separate 61,440-byte embedded-font guard, enforced at CLI delivery
and independently for every sheet in this runner; tests cover all shipped
examples. No shaping features unmodelled by the shared cmap/hmtx metrics, or
TrueType hinting programs, are delivered in SVG subsets. A runner violation names
the export and byte count and fails as infrastructure; CLI overflow returns
`R007` (exit 1). For SVG overflow export `.html` or `.pdf`; for HTML overflow
export `.pdf`. Neither guard raises its limit automatically. Packet HTML permits
at most 500 KiB font growth. Math fallback is subset only from characters the
Regular face lacks.

The aggregate ceiling is a regression signal independent of the per-export font
budgets. Explicit acceptance samples live separately under
`evals/out/draw-samples/`. Delete raw checkpoints after retaining summaries and
cited review crops.

## Corpus, content seal and sweep

`corpus.mjs` and `corpus/requests.mjs` enumerate frozen cases, referencing shipped
projects and requests by path:

- Fixed-UUID shipped init starter `PS1 --loads`, both flows. It materializes the
  template's declared local core version and alpha-init presentation; this tests
  drawings, while initializer behavior remains in CLI tests.
- Machine-demo, conveyor-line, both motor-starter alpha packets,
  operator-console and functional-symbols, both flows where supported.
- Nine feature examples: circuit-pagination, network-pagination, cap-pagination,
  connector-io, self-loop-labels, topology-coverage, report-filtering,
  assembly-note-bounds and analog-output. Analog-output and an additional
  signal-loop reuse shipped CLI fixtures/requests. Field libraries are copied
  locally and byte-locked; field TTB sheets use the shipped portrait convention.
- EA F3: the starter's first wire gets a 120-ASCII-W display label; the requested
  output is the wire schedule. Electrical facts and UUIDs are preserved.
- D1/D2 packets have a documented deferred E2 slot, never substituted or scored.

The 36-cell sweep is three projects × tabloid/A3/letter × landscape/portrait ×
standard/compact, each executed in both flows (72 cases). Motor-starter covers
power/control; functional-symbols covers circuit/report sheets; report-filtering
covers filtered reports. Full corpus: 108 cases. Flow-neutral schemas are replayed
unchanged rather than receiving an unsupported flow field. Each successful case
runs the built CLI for JSON/SVG, HTML and direct PDF and compiles unchanged IR;
expected report identities/multiplicities come from the public query API.

The reference manifest covers only `git ls-files` drawing JSON inputs, excluding
package/tsconfig JSON and ignored output. A checkpoint explicitly invokes
`seal.mjs --output <checkpoint>/corpus-seal.json`; it never rewrites the reference.
The content hash covers `{format, casesSha256, files}`. `base` records the commit
beside that hash and is not part of it. `--compare <summary.json>` warns only when
content/inventory differs; legacy reports are compared through their adjacent
`corpus-seal.json`. Changed tracked files are listed, not a CI failure.
Run `bun evals/draw/seal.mjs` to update the committed reference only after reviewing
an actual content change. Other workstreams need not reseal.

## Status, strictness and policy

| Status               | Meaning                                                             |
| -------------------- | ------------------------------------------------------------------- |
| pass                 | The stated scoped predicate passed; not a category score.           |
| fail                 | New identity/scope, out-of-band measurement or missing observation. |
| xfail                | A pinned defect remains within its band; still a defect.            |
| xpass                | A pinned defect/scope disappeared; review and retire it.            |
| manual               | Reviewer form, including DQ-03 visual, DQ-04 and DQ-22.             |
| not-implemented      | Explicit missing export or unmeasured portion; no credit.           |
| infrastructure-error | Measurement failed; always exit 2.                                  |

Strict exits mirror E1: 0 has no unexpected failure/stale marker, 1 has fail/xpass,
2 has infrastructure failure. `--report-only` retains failures and xpasses while
permitting historical replay; infrastructure still exits 2. Missing observations
cannot turn green, and a missing PDF scope cannot borrow an SVG observation.

Geometry compares the declared em size with 2.5 mm for primary electrical/report
labels and the documented 2.3 mm for secondary circuit/boundary references, with
one combined advance/em-axis-ratio finding for distortion. The ISO 3098 reading of
2.5 mm as capital height is a separate `iso-cap-height-policy` gap, pinned once
per (font, medium), pending renderer/user adoption (DECISIONS-FOR-USER item 12).

Frame/zone/title furniture has no documented primary-label minimum. Header and
title regions come from the measured frame and full-width divider rules; the top
zone strip ends at the measured ink bottom of the complete 1–6 zone row. The A–D
border column is recognized separately. There is no fixed 35 mm body cutoff.
Owned drawing labels and off-page continuation links are never furniture; bounds,
overlap, distortion and ISO policy still apply to furniture. Secondary captions
come from direct circuit-node roles, exported related-function/boundary metadata
and the primary designation from the IR (or a function's semantic title). Primary
designations keep the primary minimum regardless of y; an unknown role does not
silently receive the lower minimum. Geometry counts exclude `classification: policy-gap`; `policySummary`
reports those observations separately. Full details remain in results and gallery.

SVG/HTML em geometry uses computed CSS size and the actual CTM, independent of
platform font substitution. Capital ratios use the font Chromium resolves from
the declared family, explicitly labelled `fontMeasured`; generic monospace's
concrete platform face is not exported. PDF em sizes and named embedded fonts
come from pdf.js; cap policy uses that font's PDF FontDescriptor CapHeight,
not a macOS substitute. Missing PDF cap metadata is not-implemented. PDF geometry/policy discards clipped duplicate text extractions unless a visible source label matches within two ems; raw extraction remains available to the existing parity checks. SVG/HTML advance and scaled font-cap ratios are not independent rendered-cap
measurements. All three media use one predicate: **max(s, 1/s) > 1.10 + ε**,
with **ε = 1e-9**, a dimensionless floating-point allowance. Here s is horizontal
glyph scale (`advanceRatio`, or PDF horizontal em / vertical em). When both are
available, the worse anisotropy decides. Exactly 1/1.10 and 1.10 pass; 0.907 and
1.105 fail, including PDF. The predicate uses unrounded measurements; report
coordinates/scalars retain their normal 0.001 rounding. One `distorted-glyphs`
finding retains all scales and pins **anisotropy**, rather than compression and
stretch in opposite directions under raw s. Its severity envelope allows ±0.030
dimensionless drift; that envelope never changes the 1.10 predicate or turns a
disappeared finding into an xfail. ISO policy still uses the declared
font's natural capital metric; it does not claim pixel-measured capital ink.

## Ink geometry and calibration

`getBBox()` em boxes are retained as evidence, never used as text-ink collision
boxes. Canvas `actualBoundingBox*` uses SVG-rendered whitespace (XML/CSS collapse
unless preserved). Chromium's real baseline displacement is measured with an
alphabetic clone in the same SVG context, covering middle/central and inherited
baseline semantics. `getStartPositionOfChar`, actual textLength and CTM place the
ink on the sheet. Semantic tiled copies reconcile by source key; non-semantic
copies use their individual source DOM path/local text identity, not undefined.
Lost text reports only its outermost violated container: sheet, frame, viewport,
cell, then clip.

`calibrate.mjs` reuses the reviewer's inkcheck method: isolate each text, keep
clipPath primitives visible, take an integer-aligned 300 dpi crop, and compare
pixel ink against the measured box. Selection is random (seed 4242), stratified
by label role/report/frame class. Require at least 40 labels of each font class:

```sh
INK_FONT=monospace INK_OUT=evals/out/mono-ink.json bun evals/draw/calibrate.mjs \
  evals/out/draw/C1-e3fu machine-demo-left-to-right/1 machine-demo-left-to-right/2 \
  machine-demo-top-to-bottom/1 conveyor-line-top-to-bottom/1 motor-starter-left-to-right/1
INK_FONT=Arial INK_OUT=evals/out/proportional-ink.json bun evals/draw/calibrate.mjs \
  evals/out/draw/C1-e3fu functional-symbols-top-to-bottom/1 \
  circuit-pagination-left-to-right/1 analog-output-left-to-right/1 \
  machine-demo-left-to-right/11 report-filtering-left-to-right/1
```

Round-4 validation: 60 monospace and 60 proportional labels, identical selections
before/after; zero no-ink cases. Worst corrected edge deviation is 0.117 mm.
The accuracy bound is **two raster pixels at 300 dpi**, 0.16934 mm, rounded
outward to **0.170 mm**. Bounds and wire-distance comparisons use this bound;
text/text overlap requires 0.340 mm intersection for two uncertain edges.
The measured report pitch is 3.600 mm (bounds 4.7%, overlap 9.4% of pitch).
The 2.043 mm J1 distance is within noise, not a defect. PR.md records the complete
before/after distributions, two whitespace outliers, and differing compressed/
natural controls. `INK_TEXT` and `INK_MIN_COUNT=2` support those targeted controls.

A wire-label line is inline only when its own measured ink fits inside a shared
block plate that crosses its own conductor (0.170 mm containment uncertainty).
Sharing the block alone grants no exemption: a displaced line is measured normally.
Only the matching own-wire identity is exempt. Distances are from ink
to stroke edge, accounting for half the measured conductor stroke. Foreign
conductors remain checked. The DQ-16 distance threshold is **2.000 + 0.170 =
2.170 mm**. The 32 rooted-label offset markers are distance-only threshold hits,
not evidence of ambiguity: 2.147 mm passes and 2.195 mm fails, so a roughly
0.05 mm glyph/font change can flip them as a group. Their calibrated bands and
strict xpasses are intentional; review grouped flips rather than blindly re-pin.
The historical `ambiguous-wire-label` kind covers both distance and nearer-wire
predicates; evidence names the actual reason. White device/background plates are tested against
foreign conductor ink and, in paint order, foreign text ink. Earlier plates
under later text are not occlusions. Mechanical borders, white conductor halos,
legitimate terminal entries and ordinary crossings have clean controls. Symbol
route penetration remains a geometric check even if an opaque body hides it.
Detour geometry/length is clipped to sheet and viewport before thresholding.

## Checklist coverage

| DQ  | Automated measurement or explicit boundary                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | SVG text-only raster regions versus pdf.js dark ink; ≥8 SVG pixels and <18% retained PDF ink fails. Optional PDFKit. Historical mask audit separate.                       |
| 02  | Real ink bounds/overlap in SVG/HTML, plates, conductor interference, declared-em minima in SVG/HTML/matched PDF, combined em-axis/advance distortion. ISO policy separate. |
| 03  | Independent source-port electrical primitives and foreign route/body/port penetration. Circuit primitive electrical roles need an export; symbol meaning/legend manual.    |
| 04  | Selected-standard glyph/qualifier reviewer form.                                                                                                                           |
| 05  | Default IR function keys/aggregate vocabulary, preserving authored terminal identifiers/descriptions.                                                                      |
| 06  | Designation, authored description and explicit part/rating fields; no inferred electrical rating.                                                                          |
| 07  | Needs printed mirror identities, coil associations and destination exports.                                                                                                |
| 08  | Reciprocal continuations and printed conductor/sheet.zone; destination from measured reciprocal anchor/grid. Ordered ports need an export.                                 |
| 09  | Four borders and independently derived grid zones versus unique printed target references. Ambiguous repeated/spanning appearance anchors are a gap.                       |
| 10  | Measured phase/terminal order in both flows and upright qualifiers.                                                                                                        |
| 11  | Both sweep arms and executed remedies. Refusals remain diagnostics, never unseen visual markers.                                                                           |
| 12  | Packet median content envelope utilisation. Optimal repacking needs block/clearance exports.                                                                               |
| 13  | Stroke hierarchy and filled terminal/junction dots with fewer than three rays.                                                                                             |
| 14  | Distinct conductor endpoints sharing one final landing stroke. Missing physical endpoint identities are a gap.                                                             |
| 15  | Straight-route jogs <3 mm and visible detour >2×Manhattan+20 mm. Curves need segment exports; routing intent still needs review.                                           |
| 16  | Inline own-wire blocks; ink-to-own/competing-conductor distance with calibrated tolerance. Semantic wire identities recovered from emitted source keys.                    |
| 17  | Duplicate/overlapping terminal text and terminal-marker collisions.                                                                                                        |
| 18  | Production title fields and revision history.                                                                                                                              |
| 19  | Report bounds, semantic null placeholders, wire schedule sheet.zone, complete index and public-query row inventory/multiplicity.                                           |
| 20  | Computed font and actual symbol-catalog families per packet.                                                                                                               |
| 21  | Matched PDF/SVG advances, max(0.15 mm,2%) predicate. Split/unmatched text needs an association export.                                                                     |
| 22  | Two independent blind drafter forms, fixed checklist, 100% print scale and material/minor sheet.zone red-lines. No fabricated sign-off.                                    |
| 23  | Graphical terminal-strip availability; actual tables are labelled table-only.                                                                                              |
| 24  | Needs configured numbering policy and number-to-conductor exports.                                                                                                         |

## Marker identity, drift and updates

Markers pin DQ, source family, stable locator, defect kind and check, with exact
case/sheet/medium scopes. Shared storage uses verified content IDs; brace/range
compression expands to exactly the observed scope set, never future cases.
Source identities are designations, terminal/conductor keys and report fields.
Without a stable export, scope is physical sheet plus element class, labelled
coarse. Those can merge indistinguishable same-class defects: inspect counts and
the whole changed area even when xfail. A green run is not drafter approval.

DQ-21 has one font-pair/report/column cause, retaining the existing BaseFont-palette
key and font-pair ratio envelope ±0.05. DQ-19 placeholders have one source-family/
report/column/literal-placeholder cause, with each cell/instance retained as evidence.
DQ-08 missing requirements stay per connector: individual source endpoints can be
fixed separately. DQ-13 dots stay per physical terminal: changing one dot is an
independent visual fix, unlike a report column's shared null-formatting policy.

Bands are `[allowed min, reference min, reference max, allowed max]` scalar
severity envelopes. No absolute coordinates or per-cell measurements enter
identity. Bounds/distance tolerance is 0.170 mm, overlap 0.340 mm, stroke 0.010 mm,
angle 0.5°, jog noise 0.050 mm and em noise 0.030 mm. ISO cap policy stays in its
failing interval (<2.470 mm), with per-font counts/ranges. An out-of-band value
fails with its delta; in-band envelope/count changes appear in drift. Partial
scope envelopes are labelled and are not full-run temporal comparisons. Drift comparison uses the exported
0.001 lattice: a difference of one exported quantum is noise; two or more
quanta are drift. Live and saved values are rounded before this comparison, so
reassessing a saved report cannot invent a binary-subtraction drift. Derived envelope values use that same precision.

An absent pinned scope is an xpass; review whether it was fixed, intentionally
removed, or not measured. Use the guarded `repin.mjs` workflow below.
`update-markers.mjs` is **deprecated legacy tooling**: it binds only the registry,
has no reviewed-cause receipt and must not be used for current checkpoints or the
consolidated re-pin. `pin.mjs` remains an initial-proposal tool, never an updater.

## Cases, samples and historical acceptance

Add a shared source path and shipped request (or documented selection) in
`corpus.mjs`; never customer data or invented electrical facts. Review content
changes and update the reference explicitly if necessary. Inspect each new
finding's source, geometry and both media. Before accepting a family, inspect ten
seeded random, kind-stratified 300 dpi samples, or all if fewer:

```sh
bun evals/draw/samples.mjs evals/out/draw/C1-e3fu review-r4
```

Seed defaults to 4242 (`DRAW_SAMPLE_SEED` overrides it). Red overlays show the
measured finding box (ink for SVG/HTML text); PDF-em geometry is labelled as such.
The isolated raster calibration tests the ink accuracy itself. Samples/forms are
ignored and explicit, never run by check. A family that cannot be confirmed has
zero markers and a documented gap. DQ-22 forms remain unfilled until blind review.

```sh
THERMITE_DRAW_PDFKIT=0 bun evals/draw/run.mjs --checkpoint pre-WS-B \
  --rev '865ca55^1' --case machine-demo-left-to-right --report-only
```

This explicitly selects the compatible historical case; the current core-0.2
starter is unsupported by that old compiler. A temporary detached worktree outside
the repo is installed/built and removed in finally, including SIGINT/SIGTERM.
The pre-WS-B PDF triggers `soft-mask-label-loss-risk`: pdf.js operators show
luminosity-masked glyph origins outside the untransformed page bounds, the
construct Quartz clips. pdf.js itself renders it correctly, so the audit never
fabricates missing raster ink. PDFKit can corroborate it but is not required.
`pdfwhite` separately proves actual ink loss with an intact extracted text layer.
EA F3's old report overflow is fixed by R2; the current wide-label cell must fit.

## Guarded mixed re-pins and consolidated C1

`repin.mjs` applies reviewed deltas to the **existing** registry. It never calls
`seed()`, and never infers approvals from a whole fail row or a cause label.
Unlisted marker fields remain unchanged. `pin.mjs` remains a read-only initial/
legacy proposal generator; it is not the mixed-update path. `update-markers.mjs` is deprecated: it lacks checker-bundle bindings and reviewed
receipts. Use re-pin for current checkpoints, including retire-only updates.

For the current handoff, land E3 first, then re-pin D1 on a fresh dev C1.
R4 replays afterwards and audits its delta against that re-pinned registry
(decision 34); do not combine its new population with the reviewed D1 draft.
For each re-pin, make one full strict report on dev, then
reconcile **one decisions file per merged PR** (decision 13). Use that same target
report/registry/checker-bundle/seal/version binding in every file. Individual lane audits remain
review evidence; old lane report hashes cannot be copied into the consolidated
binding. Re-review their deltas against the consolidated report. No release or C1
score follows a red report.

```sh
bun evals/draw/run.mjs --checkpoint C1-consolidated-before
bun evals/draw/repin.mjs \
  --report evals/out/draw/C1-consolidated-before/summary.json \
  --baseline evals/out/draw/C1-previous/summary.json \
  --inventory evals/out/repin-inventory.json
```

Inventory writes binding values, current instance tokens/facts, stale scopes and
full envelope drift, full measured envelope proposals and baseline instances. It writes no approval decisions.
Tokens address a marker/scope, report row, finding and instance within a hash-bound
report. They are not geometry-derived marker identities. Rename facts compare
kind, source locator, view, medium, case and **exact recorded text**. Changed
text/source locators/views require literal `{from,to}` mappings per pair; no regex or
wildcard matching. Each old/new token can be consumed once. Compact aggregates
without exported instances cannot be proved as renames.

A decisions file has these top-level fields. File hashes cover raw bytes; the
checker hash covers the canonical sorted module manifest described below:

```json
{
  "format": "thermite-draw-decisions/1.0",
  "pr": "#56",
  "summarySha256": "<from inventory>",
  "registrySha256": "<from inventory>",
  "checkerSha256": "<from inventory>",
  "corpusSha256": "<from inventory>",
  "evalsVersion": "4.2",
  "baselineSha256": "<hash of supplied previous summary>",
  "entries": []
}
```

The checker binding hashes a stable sorted list of every drawing-kit `.mjs`, `.js`, `.cjs`, `.ts` and
`.swift` file recursively, including subdirectories such as `corpus/`, including the registry. The target manifest must match the local
files exactly. A changed, removed or added module invalidates the target and its
decisions; run a fresh full 4.2 report. Apply rechecks the bundle inside its lock.
Every supplied `baselineSha256` is validated even if that file has no rename.
Historical full baselines may have older compatible checkers; their raw bytes,
registry and full report are validated, including their own bundle when present.
They are stored observations, not permission to run a stale target checker.

Draft candidates with the shipped helper:

```sh
bun evals/draw/repin.mjs draft --inventory evals/out/repin-inventory.json \
  --pr '#56' --output evals/out/D1-decisions.json
```

`superseded` is never inferred. After inspecting the default draft, a reviewer may
choose `--superseded <retirement-index>:<successor-index>` (repeatable) on a new
draft command. Indices are zero-based in the default draft's sorted entries.
This changes only the chosen action and successor reference; its cause, rationale
and sign-off remain empty. The reviewer must complete and sign them.
For a link to an observed existing identity, use repeatable
`--survivor <retirement-index>:<current-instance-token>` instead. The token comes
from `inventory.current`; the draft resolves its marker and scope, checks that
the identity already exists, and keeps the default entry order. A retirement
cannot be chosen twice or use both flags. Survivor causes and sign-offs stay empty.

It proposes only unique exact-fact instance pairs (allowing a literal view move),
leaves ambiguous and changed-text pairs for inspection, and calculates envelope
proposals from measured ranges and the documented tolerances. It fills **no
cause**: every entry has `reviewed: false`, empty `causeClass`/`note`, and an empty
retirement `cause`. The draft also leaves `signOff.kind` and `signOff.by` empty;
review records the applicable kind and reviewer. New defects have empty crop metadata and drawing hashes too. Inspect each delta,
complete the cause/rationale/mappings/crops. Each crop-bearing draft entry starts
with an empty root `drawingSha256`. After preparing the crops/index and review
rationale, compute pixel facts **before** the independent reviewer signs:

```sh
bun evals/draw/repin-bind-crops.mjs \
  --decisions evals/out/review/decisions.unsigned.json \
  --crop-index evals/out/review/crop-index.json \
  --output evals/out/review/decisions.bound-unsigned.json
```

The tool reads and validates every PNG, computes its drawing hash, and writes the
entry's root `drawingSha256` plus `crop.headerPixels` from the index (0 by default,
86 only for validated stamps). It also binds each `notMove.crops[]` object with
its own `drawingSha256`/`headerPixels`. Typed drawing-hash claims are overwritten
from pixels. Inputs are unchanged; output is exclusive under `evals/out`. It
refuses any already-reviewed entry, non-empty sign-off or countersign. All review
flags, causes and notes remain unchanged. The reviewer inspects the computed
hashes and crops, then signs the bound file; the tool does not approve them.
Preview re-reads the PNGs and checks those signed values. The writer independently
recomputes them again. Replacing a crop requires a new unsigned preparation and
review, never editing a signed file in place. **`reviewed: true` signs off those
crops and causes with provenance:** every entry requires
`signOff: {kind: "person" | "agent", by: "<name or agent and review round>"}`.
An agent sign-off must come from a reviewer independent of the change's author
(cross-model). Receipts label it **agent review**, never person's review. The tool
validates the kind and non-empty name, but cannot verify identity, independence,
attention or engineering judgment. A script flipping flags is not review;
automated fixtures mock sign-off solely to test the protocol.
A person may add `counterSignOffs: [{kind:"person",by:"<name>"}]` later, keeping
the original sign-off and all other decision fields unchanged. Receipts retain
both provenances. Unknown/missing kinds and empty names are refused.
After apply, every re-pin commits a durable record under `repins/<pr>/` as described
below; person countersigns extend that tracked record without changing the signed
content, historical receipt or registry.
The tool refuses an unreviewed entry. With several baselines, select
`--baseline-sha <raw-summary-hash>`. Draft creation is exclusive under `evals/out`.

Every entry with a crop also requires its tool-bound root `drawingSha256`;
`notMove` crop objects carry the same fact on the object.
Every reviewed entry requires `reviewed: true`, `signOff`, `causeClass`, `note` (the review rationale) and
`classification: "drawing"` or `"policy-gap"`. These align with D1's audit's
`markerId`, `causeClass`, exact scope tuples and envelope observations. D1's
`scopeDelta.absent`/`missing` and `renameLink` suggest decisions; they are not
approvals or instance-match evidence. Convert them into explicit entries using
both inventories. Retain `unexplainedItems` as a review checklist outside the
strict decisions schema; an unresolved item must stop the re-pin.

| Action           | Required decision data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retire`         | `markerId`, `scope: {case,sheet,medium}`, `cause: "fixed"`, `"removed"` (intentional content removal), or `"not-measured"`. A compatible check must be measured for fixed/removed, following a declared sheet rename when present. Intentional removal earns no repair credit; a missing observation cannot be booked as fixed/removed. Optional `instances` lists only the leftover baseline tokens of a partially paired old scope.                                                                                                                                                                                                                                                                                     |
| `superseded`     | `markerId`, `scope`, optional source `instances`, a non-empty explanatory `cause`, and exactly one of `successor` or `survivor`. `successor` is the zero-based index of a new-defect/scope-added entry in this file. `survivor: {markerId,scope}` names an existing registry marker observed at that scope; it cannot be retired, moved or superseded in this file. Requires the hash-bound baseline, a measured source and all review fields. Every source instance needs a target with the same case, medium, kind and DQ. No repair credit. Shared links require `sharedSuccessorReason` on every source, including mixed successor/survivor forms resolving to the same marker and scope; unused reasons are refused. |
| `rename`         | `from` and `to` each contain `markerId` and `scope`; `pairs` is an array of `{from: oldToken, to: newToken, view?: {from,to}, sourceLocator?: {from,to}, text?: {from,to}}`. Case/flow/medium, defect and locator kind, source row and logical view must match. Changed text or column label needs its literal mapping. A changed physical sheet needs a declared rename. Text-changing moves require their own crop. Every old instance and every target instance must be accounted for across the listed decisions.                                                                                                                                                                                                     |
| `scope-added`    | `to: {markerId,scope}` on an existing identity and all target tokens in `instances`. Keeps its definition; optional reviewed crop. Use this for an added sheet occurrence, with no repair credit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `new-defect`     | `to: {markerId,scope}` on a genuinely new identity, every target token in `instances`, and `crop: {path,sha256}`. Crop must be a retained PNG under `evals/out/draw-samples/`, inside this workspace after symlink resolution. The recorded review accepts the entire explicit instance set; every new-defect entry and every text-changing move must use a distinct non-empty crop file/hash; copying one PNG to different names is refused.                                                                                                                                                                                                                                                                             |
| `envelope-drift` | `markerId`, `metric`, exact `from`, `to`, `observed`, and `coverage: "full"`. Counts use metric `occurrences` and `[min,max]`; scalar bands use `[allowedMin,referenceMin,referenceMax,allowedMax]`. The new reference must equal the full observed range; allowed bounds must equal the measured range plus the documented tolerance; an undrifted metric is refused.                                                                                                                                                                                                                                                                                                                                                    |

For example, a count decision records `from: [2,8]`, `to: [4,8]`,
`observed: [4,8]`. Drift is assessed from the bound report **after the listed
scope changes**, using the complete resulting marker population. This matters
when a header moves while old literal body cells disappear, or a sheet is added:
the still-matched old-scope subset is not the full new reference. Every metric
must actually drift at exported precision; an allowed-bound-only edit is refused.
Scalar `to` must exactly equal `bands()` for that measured population, including
the documented tolerance/policy ceiling. DQ-21 `advanceRatio` keeps the marker's
own reference range but takes its **allowed bounds from the whole font pair's
range across the bound report, ±0.05**, exactly as `seed()` does. New identities
use the same function. A per-marker ±0.05 window is refused. Arbitrary widening (such as max 99) and
arbitrary narrowing are refused. Policy-gap count changes need `classification:
"policy-gap"`; they never enter geometry scoring. Partial-scope drift cannot
replace a full reference: quick/selected/report-only inputs are refused.

A `font-pair-drift` decision records `fontPair`, `from` (the sorted unique
old `[allowedMin,allowedMax]` ranges), `to: [allowedMin,allowedMax]`,
`observed: [min,max]`, `coverage: "full"`, and the usual review fields.
The inventory lists `advanceRatioBounds` drift for **every** member of a changed
pair, and the draft proposes one pair-level decision. It expands copy-on-write
to all surviving members, including new identities; its receipt lists every
marker touched. Local reference/count decisions remain separate. A result with
mixed or non-derived pair bounds is refused. This re-pin derivation uses the
whole target population after scope reconciliation; C1's historical measured
statuses and temporal-reference drift are not rewritten by the proposal layer.

A text/source column change also needs an entry-level literal
`columnMap: {from: "Manufacturer", to: "Mfr."}`. Every pair in the entry must
follow that same map. If the old column still has observations in the target
view, the move is refused. Lack of such observations does not prove the column
was removed; the declared column rename remains reviewer judgment.

Fixed, removed and superseded sources are checked against **all** fresh
new-defect and scope-added instances across every merged decisions file. A
structurally compatible pair is refused, naming both marker IDs and tokens.
Supply a hash-bound baseline for these retirements, including whole-scope
retirements, so their old instances can be reconciled.
Potential column renames are included conservatively, even before the reviewer
chooses a column map. Book the change as a move, or add an explicit top-level
`notMove` array. Each item is `{from: oldToken, to: newToken, reason, crops}`:
a one-line reason and **two distinct retained PNG crops**, each `{path,sha256}`.
Every candidate pair needs its own declaration; unknown, duplicate and unused
declarations fail. Crops are hash-checked through the same real IO as other
review evidence and cannot be reused elsewhere. The receipt lists these
exceptions under `reviewerJudged.notMove`, never as a tool-proved distinction.

A rename inherits the old definition; it does not silently refresh its bands or
count. A genuinely new identity gets only its reviewed scopes and measured
references with the existing documented tolerances. An existing identity's new
scope keeps its old definition. List any resulting envelope change separately.
Retained old scopes cannot be consumed as renames; if only part of an aggregate
changes while its old scope stays measured, review the newly exposed defect and
its exact count drift instead. Conflicting inherited definitions are refused.

```sh
bun evals/draw/repin.mjs \
  --report evals/out/draw/C1-consolidated-before/summary.json \
  --baseline evals/out/draw/C1-previous/summary.json \
  --decisions evals/out/D1-decisions.json \
  --preview evals/out/consolidated-expectations.mjs
# Review that exact file and the printed projected statuses, then repeat with:
bun evals/draw/repin.mjs \
  --report evals/out/draw/C1-consolidated-before/summary.json \
  --baseline evals/out/draw/C1-previous/summary.json \
  --decisions evals/out/D1-decisions.json \
  --preview evals/out/consolidated-expectations.mjs --apply
bun evals/draw/run.mjs --checkpoint C1-consolidated
```

Preview uses exclusive creation under `evals/out/`. Apply requires that existing
preview to be byte-identical to the freshly computed result, rechecks the current
registry hash under an exclusive cooperative lock, then replaces the registry
atomically. Concurrent command writers refuse the lock; external editors must
not edit the registry or checker files during apply. Stale inputs, changed crops/previews, duplicate
keys, malformed UTF-8, escaping paths, reused pairs, conflicting files, incomplete
instance coverage and any unlisted failure/drift all stop before replacement.
A process killed during apply may leave a lock; inspect it before removing it.

`sheetRenames` optionally declares exact `{case,medium,from,to}` mappings. For
example, `{case:"machine-demo-left-to-right",medium:"svg",from:"sheet:14",to:"sheet:15"}`
records a physical page shift. Literal `pairs[].view` mappings also declare view
scope renames, allowing an old I/O title to resolve to the measured new title.
Conflicting maps and a change of logical view kind are refused. Moves keep their
semantic row (cell row keys are parsed independently of the column label), not
merely an arbitrary pair of texts. An unprovable identity change uses a no-credit
`superseded` retirement naming its observed successor or survivor. Its source
must be measured (following declared renames); an unmeasured source must use
`retire` with `cause: "not-measured"`. Free-text superseded causes never bypass
the global move guard. Literal `"fixed"` is refused without a broader wording regex.
Class-only or aggregate font-pair locators cannot prove a text-changing move;
unchanged literal text may still follow an explicitly declared sheet rename.

Receipts separate `toolProved` structural/measurement/hash checks from
`reviewerJudged` causes, crop sign-offs and rationale. `outcomes` counts fixed
retirements, intentional removals, superseded retirements, not-measured retirements, moves (including
changed headers), scope additions, new defects and the explicit `notMove` count
separately. A nonzero `notMove` count makes the reviewer's exceptions visible. These are event
counts, not independently established repairs or category scores. The tool proves
structural correspondence, not intent. Moves, additions and intentional removals
receive no repair credit.

Superseded retirements have their own `outcomes.superseded` count, separate from
fixes and removals. `outcomes.supersededSurvivors` lists the survivor-form subset
separately. Each receipt, including partial-instance retirements, preserves
`action: "superseded"`, the link and source-instance count. The named successor or
survivor move check is unwaivable. Other all-fresh candidates may use explicit
reviewed `notMove` declarations with two crops. Link observations are tool-proved;
the causal link and sharing reason remain reviewer judgments.

### Durable applied records and countersigning

Every applied re-pin commits `evals/draw/repins/<pr>/`: original signed decisions,
a gzip of the exact receipt, the crop index, one PNG per distinct drawing group and `record.json`.
The key is the issue or re-pin number: D1 uses **92**, although it merged as PR 104. `record.json` binds the base commit, original uncompressed signed/receipt/index
hashes, registry before/after and each original payload file's hash. It excludes
itself. `pathMap` resolves original crop paths without rewriting signed bytes.

`repins/pins.json` pins each record's `record.json` hash and base commit, in
chronological order. Every directory needs a row and every row a directory.
Existing rows never change: a diff changing or removing one blocks review. The
first D1 row's metadata hash and base have literal anchors in the suite.
Verification checks predecessor registry continuity and requires the newest
record to end at the current `expectations.mjs` hash. Signed summary, registry and
checker hashes also match the receipt; entry causes, notes and primary sign-offs
match its reviewer judgments as a multiset. This prevents metadata rehashing from
silently relabelling agent review as person review. The chain proves that a
record claims the current registry, not that it produced it, because the C1
report is not retained; independent review covers that limit. An empty record
cannot claim a registry transition.

Citations form a bijection at each step: every signed entry/`notMove` crop has
an index row, every row maps to a retained PNG, and every retained PNG has at
least one row. The writer decodes every original crop and groups by the SHA-256
of RGBA pixels below its declared header, followed by the original
`<width>x<height>` dimensions (R4's drawing-ink definition). `headerPixels` in an
input crop-index row is either **0** (default, no header) or **86** (R4's provenance
header). An 86 px band must be non-blank, with opaque grey ink only and white rows 80–85;
this catches mistaken declarations, not forgery. Plain grey drawing ink can still
resemble a header. The header declaration must describe the actual crop.
The writer never trusts a supplied
drawing hash. Output index version 2 has each original `sha256`, derived
`drawingSha256`, `headerPixels` and `retained` file. The first crop in input-index
order is retained per group; signed decisions and crop hashes are unchanged.
The verifier decodes each retained PNG, recomputes its drawing hash and checks
all referring rows, including one original-file hash matching that PNG.
**A non-retained crop cannot be re-hashed from the record alone. Its drawing
hash is signed, so it cannot be regrouped without changing signed bytes; the
original signed hash or pinned record then fails.** Every grouped index row must
match the crop entry's signed `drawingSha256` and the retained PNG's recomputed
hash. This also covers `notMove` citations. A C1 run at `baseCommit` regenerates
the source crop and drawing if rendering is deterministic; rebuilding the
original stamped PNG additionally needs the stamping script, header text and same
fonts. Header provenance and crop/source correspondence remain reviewer judgments. R4 stamps use
[`scripts/stamp-drawing-crop.mjs`](../../scripts/stamp-drawing-crop.mjs), the bundled
Noto Sans face and four literal ASCII `headerLines` in each index row. Rebuild a
non-retained original from its representative PNG with `--strip-header` and the
row's header-lines JSON; omit that flag when starting with a raw C1 crop. The
writer still derives drawing hashes independently from pixels.
Only `thermite-draw-crop-index/2.0` and the legacy
`thermite-d1-real-crops/1.0` index formats are accepted. D1's original index/layout
continues to verify as the one-crop-per-file case without new fields: every
original PNG is retained and re-hashed. New grouped archives require signed
drawing hashes; a missing value is refused.

The dependency-free decoder supports the tool's eight-bit RGB/RGBA PNGs, filters
0–4 and adjacent IDAT chunks, without interlace. CRC, framing, full zlib-stream consumption and dimensions are
checked. Palette, grayscale, other bit depths, transparency/color-profile chunks
that require interpretation (including `gAMA`, `cHRM` and `eXIf`), and unsupported chunks are refused. It does not
guess pixels for unsupported input. Unknown manifest files (not just PNGs),
including `.DS_Store`, fail closed. Only signed text, receipt, index and retained
PNGs belong in the original manifest. No entry schema has a generic `crops` field.

Signed text or crop indexes **over 256 KiB** are stored gzipped, with their
uncompressed hashes bound separately. A gzipped signed file always uses sidecar
countersigns. The default record cap is **3,000,000 bytes**, including metadata and
countersigns. A larger cap requires a per-PR pin row with `maxBytes` and a non-empty
review reason. D1's byte-immutable record is grandfathered unchanged, including
its uncompressed signed file. Raw signed JSON uses `.signed` to prevent formatter
rewrites.

The fixed-header writer is reproducible on the pinned Bun/zlib build.
**Verification checks gzip metadata and the uncompressed hash; it never
recompresses.** Existing signed/receipt gzip inputs preserve their compressed bytes, as does
D1's frozen index. New crop indexes are rebuilt with derived drawing-group fields
before compression; their input gzip bytes are not retained. This permits
byte-exact D1 reproduction on other zlib builds without requiring recompression.

#### Writing and pinning an applied record

`recordFor()` and `writeRecord()` in `repin-record-write.mjs` build and validate an
archive, refuse an existing destination and clean up failed new writes. After
review/apply, supply the unchanged signed file, captured receipt, reviewed crop
index and precisely its indexed buffers. Set `headerPixels: 86` on the index
rows of R4-style header crops **before** calling the writer; plain crops use 0.
Original input hashes must match every on-disk file, including non-retained ones. For example, fill in the actual issue
number, pre-apply base and evidence paths:

```js
import { readFile } from "node:fs/promises";
import { recordFor, writeRecord } from "./evals/draw/repin-record-write.mjs";
import { hash } from "./evals/draw/support.mjs";

const pr = 123;
const baseCommit = "<40-hex pre-apply commit>";
const cropIndex = await readFile("evals/out/review/crop-index.json");
const index = JSON.parse(cropIndex);
const result = recordFor({
  pr,
  baseCommit,
  signed: await readFile("evals/out/review/decisions.signed"),
  receipt: await readFile("evals/out/review/apply-receipt.json"),
  cropIndex,
  crops: new Map(
    await Promise.all(
      index.crops.map(async (c) => [c.path, await readFile(c.path)]),
    ),
  ),
});
await writeRecord(`evals/draw/repins/${pr}`, result);
console.log({
  pr,
  baseCommit,
  recordSha256: hash(result.files.get("record.json")),
});
```

Append the printed row to `pins.json` in chain order, then run the record suite.
For an approved larger record, pass its `{pr,maxBytes,reason}` pin exception to
`recordFor` and retain those fields on the pin row. Retain existing payload names
with `signedName`, `receiptName` and `indexName` when reproducing an older record;
this reproduces D1's `record.json` exactly from its tracked inputs. The helpers do
not invent review fields or change the registry. The writer accepts raw or
already-gzipped signed/receipt/index buffers.

If the original signed bytes equal the tool's `json()` serialization,
`countersignMode: "canonical"` permits only adding person `counterSignOffs` to
entries in that tracked file. Save with `json()`. Verification strips only those
arrays, reserializes, and requires the original signed hash; all signed fields
remain immutable. Each added signature must have exactly `kind: "person"` and a
non-empty `by`, with no duplicates.

For non-canonical or gzipped signed bytes, `countersignMode: "sidecar"` keeps the signed file
byte-immutable. Add a sibling `countersignatures.json` instead, and change nothing
else in the record:

```json
{
  "format": "thermite-draw-countersignatures/1.0",
  "signedDecisionsSha256": "<original signed file hash from record.json>",
  "entries": [{ "entryIndex": 0, "kind": "person", "by": "Reviewer name" }]
}
```

`entryIndex` addresses the original decisions entry. Append person signatures;
agent countersigns, unknown entries, empty names and duplicate signatures are
refused, including repetition of the original person signer. This optional sidecar is an additive extension, not an original file in
the immutable manifest. Verification still checks the original signed content
and receipt; a changed registry binding does not require replaying apply.

The [D1 record](repins/92/record.json) is **non-canonical**: its signed SHA is
`b56690d4…`, while `json(JSON.parse(bytes))` yields `8ebd7e2c…`. It therefore uses
the sidecar rule. Its historical receipt remains `fa243c1a…` after decompression.
Run the browser-free record suites and `readRecordChain()` to verify every
tracked record, its pinned metadata and the current-registry chain.

If D1 blanks a bad DQ-19 placeholder, that predicate may be fixed. A DQ-21 advance
finding that disappears only because its text was intentionally blanked is
`removed`, not a typography fix. Under a declared sheet/view rename, fixed and
removed causes are measured on the destination rather than called not-measured.
Keep a changed header in its rename; retire only the removed body instances.
The acceptance requirement remains a **fresh full strict C1 with exit 0 and no
drift**, after review of the applicable decisions, with each sign-off's kind recorded.
