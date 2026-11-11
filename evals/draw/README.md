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

| DQ  | Automated measurement or explicit boundary                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | SVG text-only raster regions versus pdf.js dark ink; ≥8 SVG pixels and <18% retained PDF ink fails. Optional PDFKit. Historical mask audit separate.                            |
| 02  | Real ink bounds/overlap in SVG/HTML, plates, conductor interference, declared-em minima in SVG/HTML/matched PDF, combined em-axis/advance distortion. ISO policy separate.      |
| 03  | Independent source-port electrical primitives and foreign route/body/port penetration. Circuit primitive electrical roles need an export; symbol meaning/legend manual.         |
| 04  | Selected-standard glyph/qualifier reviewer form.                                                                                                                                |
| 05  | Default IR function keys/aggregate vocabulary, preserving authored terminal identifiers/descriptions.                                                                           |
| 06  | Owned painted tag per UID/sheet; instance/type description, catalog part, qualified local references and explicit string rating/part only.                                      |
| 07  | Needs printed mirror identities, coil associations and destination exports.                                                                                                     |
| 08  | Reciprocal continuations, source-derived printed conductor and peer sheet.zone; associated rows across SVG/HTML/PDF. Ordered ports need an export.                              |
| 09  | Four borders and independently derived grid zones versus unique printed target references. Ambiguous repeated/spanning appearance anchors are a gap.                            |
| 10  | Measured phase/terminal order in both flows and upright qualifiers.                                                                                                             |
| 11  | Both sweep arms and executed remedies. Refusals remain diagnostics, never unseen visual markers.                                                                                |
| 12  | Packet median visible outline geometry envelope utilisation. Optimal repacking needs block/clearance exports.                                                                   |
| 13  | Stroke hierarchy and filled terminal/junction dots with fewer than three rays.                                                                                                  |
| 14  | Distinct conductor endpoints sharing one final landing stroke. Missing physical endpoint identities are a gap.                                                                  |
| 15  | Straight-route jogs <3 mm and visible detour >2×Manhattan+20 mm. Curves need segment exports; routing intent still needs review.                                                |
| 16  | Inline own-wire blocks; ink-to-own/competing-conductor distance with calibrated tolerance. Semantic wire identities recovered from emitted source keys.                         |
| 17  | Duplicate/overlapping terminal text and terminal-marker collisions.                                                                                                             |
| 18  | Production title fields and revision history.                                                                                                                                   |
| 19  | Report bounds, semantic null placeholders, wire schedule sheet.zone, complete index, public-query row inventory/multiplicity, and single-line identifier units in SVG/HTML/PDF. |
| 20  | Computed font and actual symbol-catalog families per packet.                                                                                                                    |
| 21  | Matched PDF/SVG advances, max(0.15 mm,2%) predicate. Split/unmatched text needs an association export.                                                                          |
| 22  | Two independent blind drafter forms, fixed checklist, 100% print scale and material/minor sheet.zone red-lines. No fabricated sign-off.                                         |
| 23  | Graphical terminal-strip availability; actual tables are labelled table-only.                                                                                                   |
| 24  | Needs configured numbering policy and number-to-conductor exports.                                                                                                              |

DQ-06 assesses rooted power/control (including cable conductors), circuit, wiring,
signal-loop, communication and connector-assembly drawings. Ordinary report tables
remain outside this device-tag obligation. Each visible device or explicit local
terminal reference is reconciled to IR, even if a packet reference export is lost.
Designation, nonempty instance description (otherwise nonempty type description),
and exact catalog order number are required only when authored. Blank optional
fields need no placeholder. Explicit string device part/rating fields remain
conditional; terminal capability never supplies an inferred device rating.

Only complete painted rows with `data-tag-owner-uid`, `data-tag-field`,
`data-tag-kind` (`body` or `reference`) and `data-tag-block` can satisfy fields.
Rows must have valid body ownership or reference semantics. Expected values come
independently from IR; sheet-wide text and SVG titles do not supply evidence.
Wrapped rows stay within their owned field/block. Parts retain every literal
character; a row boundary may consume exactly one authored space, or no space.
No Unicode normalisation is performed, so canonically equivalent spellings can
cause false failures. The device inventory still comes from renderer references
plus browser measurement, rather than an independent source-to-sheet inventory.
One complete block serves all appearances of a UID on that sheet, but cannot serve
another sheet. If a device has a drawn body appearance, that sheet requires one
complete body-owned block; no reference annotation can satisfy it. On sheets
where the device appears only through off-view or cross-sheet references, a
complete reference-owned block may satisfy the obligation. A designation-only
reference cannot satisfy an authored description or part. Tags use at least 2.7 mm designation em and 2.5 mm for other fields
when rolled out; ownership exports alone do not fix existing omitted fields.

Qualified identities resolve a structured `data-tag-terminal-id` against the
owner's actual IR terminal key: `TB1.2`, `JB1.X1.1`, or the fixed heading grammar
`Off-view at PS1.-`. Exact identity, including dot/space designations, is required;
a prefix or another device's caption is insufficient. `data-tag-ref` selects a
local tag block explicitly; a broken key is a finding. Reference blocks do not
create device appearances, coverage or electrical terminals. They retain the same
authored-description/part obligation. Native browser controls reject hidden,
partially clipped, title-only and wrong-owner evidence. Text inside `defs`,
`clipPath`, `mask`, `symbol`, `pattern` or `marker` is excluded. Instanced text
through `use` is unsupported; the 653-sheet C1 corpus contains no text in these
containers and no `use` elements.

DQ-06 accepts filled text only when its CSS colour alpha multiplied by
`fill-opacity` and every ancestor `opacity` is at least 0.2. Chromium parses
all supported CSS colour forms. The 0.2 cutoff excludes near-invisible evidence
(less than 20% ink contribution), without claiming a full contrast-ratio test.
White paint is excluded against the capture's white sheet background, using the
same white exclusion as conductor detection. The physical text size uses the
existing DQ-13 floor: 2.5 mm em, or 2.3 mm for secondary references, with its
0.03 mm measurement tolerance. No new physical size threshold is introduced.
Rows covered at more than half of 45 interior ink-box samples by later filled
shapes with effective alpha at least 0.95 are excluded. Native fill geometry,
transforms and rectangular clips determine coverage, including shapes with
`pointer-events:none`; strokes and small crossings do not count as occlusion.
Checker 4.4 hardens these rules and body/reference selection. Findings exposed
by the checker are not fixes of drawing defects.

DQ-08 resolves the other endpoint of a reciprocal continuation pair, excluding
the source even when both ends share a sheet. The expected destination zone is
recomputed from that peer's measured anchor and the printed grid; exported
zone metadata is never an answer. Visible rows must belong to the real
connector link, not merely repeat its text nearby. Separate text nodes and
positioned leaf tspans are measured individually; mixed direct/positioned span
content refuses only that connector’s DQ-08 measurement, without interrupting
other checks on the sheet. Font runs
are combined only to read a row's character stream; each run retains its own
size/ink checks and tspans retain their parent text defect locator.

One reference row `<Cnnn> / <sheet>.<zone>` may sit in any position.
Identity occupies the other owned rows in physical order, or follows a second `/`.
Prefer separate `<text>` rows.

The expected printed identity comes independently from IR: a wire's authored
`properties.label` when present, otherwise its designation; cable designation
plus full core ID; a jumper's designation, or `JUMPER`, whitespace/a row break, and its full authored UID.
Unknown/ambiguous/synthetic sources refuse identity; no net/display-detail
fallback supplies a name. Existing conductor strings can identify an IR element;
optional `sourceElement: {kind:"wire"|"jumper",uid}` or
`{kind:"core",cableUid,conductorId}` selects it explicitly. Those fields select
source only, never dictate printed text. Complete wrapped character streams
must match literally, including preserved spaces and Unicode.

The sheet.zone parser reads only the anchored reference header; inline identity
text cannot supply a missing zone. Reference candidates are unique per exact ID,
so a literal identity such as `C12/3` does not hide a different connector ID.

PDF text consumers use native PDF rectangular clip state (including nested clips
and save/restore) and embedded glyph outline bounds. Wholly clipped glyphs are
excluded; partially visible glyphs retain their measured characters and font size.
Unsupported clips or positioning refuse. No SVG visibility or string/prefix filter
supplies the PDF visibility answer. Extraction-only whitespace remains a separator.

HTML and PDF rows must match their SVG source rows in physical row order.
HTML occurrences match independently measured connector anchors and destinations;
DOM ordinals are local to each medium and are never shared as identity.
PDF fragments associate by
physical row geometry, then their actual text and font sizes are checked; no SVG
font size substitutes for an unmatched PDF row. Missing/invalid actual PDF font
sizes and missing/unassociated PDF rows
refuse measurement, so becoming unmatched cannot clear a small-text pin.
Extra PDF rows are checked inside the union of owned text rows plus the existing
0.17 mm geometry uncertainty; nearby text along the connector stroke is excluded.
Existing short Cnnn / NN labels keep their missing-field locators. Run the native
controls with `bun run test -- evals/draw/continuation-browser.test.mjs` and native
guard mutations with `bun evals/draw/continuation-mutations.check.mjs evals/out/continuation-mutations.json`.

Case failures retain every delivered sheet SVG and run the same lossless packet,
HTML and JSON compaction as successful cases. Output-budget error rewrites keep
all report source pins, and `cost.json` includes its own bytes and the final report.
The 100 MB ceiling is unchanged.

DQ-12 measures the SVG packet's **visible outline geometry**: the bounding envelope
of conductor/symbol/mark outlines in outer-sheet millimetres, using stroke centre
lines rather than stroke-width coverage. Clipped shapes use the
existing 0.2 mm outline samples plus exact path endpoints and native SVG
fill/stroke hit tests, so a path turning outside a strip cannot contribute a
phantom bounding-box corner; wholly contained bounds remain exact. Each shape is intersected with
the physical sheet, its strip and every nested viewport, then all ancestor clip
paths before the envelope calculation. The existing furniture/shape eligibility
filters (`x >= 20`, `y >= 25`, bottom `< height - 35`) apply to these visible bounds,
so a conductor starting off-sheet still counts where visible. Rectangle
clip paths (including transformed and object-bounding-box units) are measured
from the DOM; unsupported non-rectangular or rotated clip paths refuse rather
than contribute an unclipped estimate. An active mask on a shape or ancestor also
refuses. Unsupported clips/masks and invalid clipped paths refuse only DQ-12 for
that sheet; other checks retain their original geometry and still run. No partial
packet median is reported when any sheet refuses. Hidden shapes contribute no
geometry. The nominal denominator `(width - 56) * (height - 80)`, packet median, 40% threshold
and existing tolerances are unchanged; occupancy saturates at 100% of that
nominal area. Table/index sheets without eligible drawing shapes remain
excluded. Passing and failing packet medians and per-sheet boxes are retained
in `evidence.measurement`. SVG and HTML share the geometry extraction, tested
with `bun evals/draw/utilisation-browser.check.mjs`; DQ-12 does not introduce a
PDF or HTML utilisation score. No renderer layout helpers are used.
The browser-required clip mutations run with
`bun evals/draw/utilisation-mutations.check.mjs evals/out/dq12-native-mutations.json`.

DQ-19 also enforces the explicit source identifier fields in
[`identifier-policy.mjs`](identifier-policy.mjs). SVG and actual CLI HTML use
independently measured cell rectangles and character baselines, including
positioned `tspan` runs. Direct PDF uses raw pdf.js text positions, including
whitespace, rather than requiring a match to an SVG line. Fragments on one
baseline count as one line within the existing 0.170 mm geometry uncertainty;
separate complete list members can occupy separate lines. A single source
identifier spanning lines produces `identifier-line-break`. Lost, changed or
elided characters produce `identifier-text-mismatch`; missing cell geometry or
unmeasurable identity is an infrastructure error. Each medium is assessed
separately. DQ-21's font comparison remains independent.
Both registries' header positions are tested against the public query output and
packet-only wire reference columns. Terminal-plan connection columns protect
complete peer endpoint units from authored wires, jumpers and cable cores;
printed arrows and semicolons never determine their unit boundaries.
For packet reference cells, the oracle applies the effective `referenceSelection`
appearance scope and device selection to structured content-sheet references.
`drawings` excludes documentation-table appearances; omitted options retain
`all`. The drawing index still includes every content sheet. An explicit report
kind list is tested against actual renderer table drafts, including packet-owned
indexes; normalized documentation format alone does not distinguish drawings
from tables. Filtered reference cells retain the same independent line and
text-integrity checks in all three media.

These checker and test additions change the complete checker bundle hash.
Existing C1 targets and draft decisions need a fresh full target before a re-pin;
an eligible historical report can still serve as the baseline. Renderer and
checker lanes must finish before the shared target is captured. Do not re-pin
the new identifier predicate as an accepted defect.

Rows carrying `data-tag-field` are primary text even inside a circuit relation
or reference group: designation requires 2.7 mm em and every other tag field
2.5 mm. The circuit-only 2.3 mm secondary-reference allowance never applies to
a tag row. This classification correction changes the complete checker bundle
hash; capture a fresh target under the existing 4.4 report protocol.

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

For each re-pin, make one full strict report on dev. A consolidated re-pin may
use **one decisions file keyed to the dominant change**, with co-cause notes for
shared entries; merged PRs with no surviving delta need no file. Otherwise,
reconcile one decisions file per merged PR. Do not reuse another change's
previously reviewed population after its registry or checker binding changes. Use that same target
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
  "evalsVersion": "4.4",
  "baselineSha256": "<hash of supplied previous summary>",
  "entries": []
}
```

The checker binding hashes a stable sorted list of every drawing-kit `.mjs`, `.js`, `.cjs`, `.ts` and
`.swift` file recursively, including subdirectories such as `corpus/`, including the registry. The target manifest must match the local
files exactly. A changed, removed or added module invalidates the target and its
decisions; run a fresh full 4.4 report. Apply rechecks the bundle inside its lock.
Every supplied `baselineSha256` is validated even if that file has no rename.
Historical full baselines may have older compatible checkers; their raw bytes,
registry and full report are validated, including their own bundle when present.
They are stored observations, not permission to run a stale target checker.
After this hardening change merges, the checker bundle hash matches no existing
C1, so a re-pin needs a fresh C1 target. Existing C1s can still be compatible
baselines, but a baseline without source pins cannot supply `notMove` crops.

Draft candidates with the shipped helper:

```sh
bun evals/draw/repin.mjs draft --inventory evals/out/repin-inventory.json \
  --pr '#56' --output evals/out/D1-decisions.json
```

`superseded` is never inferred. After inspecting the default draft, a reviewer may
choose `--superseded <retirement-index>:<successor-index>` (repeatable) on a new
draft command. Indices are zero-based in the default draft's sorted entries.
This changes only the chosen action and successor reference; its cause, rationale
and sign-off remain empty. Sharing reasons are reviewer-authored rationale too;
proposal text must be cleared before independent review. The reviewer must complete and sign them.
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
with an empty root `drawingSha256`. Build the evidence and index with the tracked
helper before independent review. It uses the report's exact instance tokens,
boxes and text to stamp each crop. It reuses a containing pipeline crop's report-pinned **geometry**, never its PNG
pixels. Every unsigned crop is freshly rendered from pinned source through the
same isolated capture path used for independent bind verification; otherwise
its region is derived from the cited instance's own box. PDF crops derive the em-plus-glyph-ink union and fixed margin described below,
without borrowing pipeline padding.
It writes no causes or approvals. Paths below are repository-relative:

```sh
mkdir -p evals/out/review
bun evals/draw/repin-crop-index.mjs \
  --report evals/out/draw/C1-consolidated-before/summary.json \
  --baseline evals/out/draw/C1-previous/summary.json \
  --decisions evals/out/D1-decisions.json \
  --samples evals/out/draw-samples/review \
  --index evals/out/review/crop-index.json \
  --output evals/out/review/decisions.unsigned.json
bun evals/draw/repin-bind-crops.mjs \
  --report evals/out/draw/C1-consolidated-before/summary.json \
  --baseline evals/out/draw/C1-previous/summary.json \
  --decisions evals/out/review/decisions.unsigned.json \
  --crop-index evals/out/review/crop-index.json \
  --output evals/out/review/decisions.bound-unsigned.json
```

Binding cropped entries independently renders pinned source, separate from the
portable unit suite. SVG/HTML use Chromium, discovered exactly as for a checkpoint;
PDF uses fresh pdf.js documents. A missing required renderer or source refuses the
bind with an infrastructure message; no cropped entry is silently skipped and no
bound output is written. Crop-free files need neither renderer. There is no bypass flag.
Bind and the crop-index builder require `--report` and the hash-bound baseline
inventories for every file containing a rename, even if it contains no crops.
Source paths resolve from the report's directory (and each baseline's directory); `--source-root` overrides the
current report's directory when its sources are stored separately.

The builder writes index version 2 with the exact report SHA, token, marker,
scope, row, text, physical sheet, `instanceBbox`, `sourceBbox` and header lines.
`sourceRender` names `medium: "svg"` with `svg`/`svgSha256`, or `medium: "html"`
with `html`/`htmlSha256`. The paths must match the report case and physical sheet,
are relative to the source directory, and cannot traverse or escape through
symlinks. HTML uses the actual `#sheet-N>svg` in the CLI packet, not a standalone
substitute. Bind verifies the entry's marker/scope and token against the hash-bound
report inventory; preview checks the recorded source facts against that inventory
again, without Chromium. A text-changing rename may cite only `pairs[].to` tokens
whose literal text mapping changes; an unchanged-text pair is ineligible even if
its row already has a crop. At least one eligible changed instance must export a box.
The builder, bind and preview compare the baseline and current report's exact
`facts.text`, requiring literal `{from,to}` mappings only for changed text.
Missing, incorrect or unused mappings and reused pair tokens are refused before
crop creation or binding; a supplied map cannot make an unchanged pair eligible.
The stamped header pixels must match those report facts.

Each new C1 also records `sourceHashes` (`thermite-draw-sources/1.0`): exact
per-sheet SVG hashes and the raw or gzipped CLI HTML hash, with relative paths.
The builder checks actual bytes against these pins before using them; bind checks
index hashes against the report, then actual source bytes against the index.
Preview checks the signed source hash against the report without a browser.
A report without these pins cannot bind cropped entries: run a fresh C1. Changing
`--source-root` changes only the folder, never the trusted hashes.
A `notMove` crop may reference a baseline. If that baseline predates source pins,
the builder and bind name its role, supplied path and SHA-256 in the refusal.
A fresh target does not supply baseline pins: obtain a trustworthy pinned capture
at the baseline's original source revision or keep the evidence refused.
Diagnostic paths are not written into signed evidence.
PDF evidence supports boxed pdf.js `text-below-minimum-em` and
`iso-cap-height-policy` instances. A PDF scope requires the exact delivered
`case/packet.pdf` pin; SVG/HTML pixels cannot stand in for it. PDFKit raster
findings and other PDF finding kinds remain refused. Font-policy instances keep
`classification: "policy-gap"`; evidence binding does not adopt that policy.
**Sheet-level new defects without an exported instance box are also unsupported.**
The review census found 5,818 of 8,471 marker-scope groups, from 178 markers, had
no box; these are potential re-pin shapes, not additional C1 failures. This
increment provides no whole-sheet substitute or invented box. Planning reports
all unsupported entries by entry index, case, view, physical page and marker,
then refuses the batch before writing crops. Existing scope-addition rules remain
unchanged.

The cited instance must fit inside `sourceBbox` on every edge, allowing only
0.001 mm report rounding. Non-finite coordinates and invalid extents are refused.
SVG/HTML capture and verification use separate offline Chromium contexts, print
media, a fonts-ready barrier and the same screenshot operation, at 300 dpi.
Page scripts and service workers are disabled; offline mode also blocks beacon,
prefetch and WebSocket requests. Raster dimensions and alpha must match; only a
validated stamp may add white right padding. The comparison has no registration,
translation, resizing or user-supplied tolerance. All per-crop refusals are listed
before the bind exits; no bound file is written on failure.

### Boxed PDF source evidence

New reports add an optional `pdf` pin to each physical sheet in
`thermite-draw-sources/1.0`: exact delivered `case/packet.pdf` SHA-256,
`backend: "pdf.js"`, pdf.js version and page metadata (`number`, native point
`view`, `userUnit`, normalized `rotation`, `widthMm`, `heightMm`). The C1 runner
hashes the same single-read bytes it gives to pdf.js. Existing SVG/HTML pins and
older SVG/HTML-only reports remain compatible as baselines. Reports without PDF
pins stay refused for PDF, including baseline `notMove` crops; obtain a fresh
report at the original source revision. Calibration tools never upgrade those
reports into apply targets.

PDF capture reads and hashes one buffer, then gives that buffer to a fresh pdf.js
loader. It never reopens the path between hashing and rendering. System fonts and
eval are disabled; worker resource fetch is off and the binary-resource factory
denies every external font/CMap/Wasm request. Even a request whose error pdf.js
catches is a fatal capture refusal. The installed pdf.js version must match the
report pin. There is no PDFKit or SVG/HTML rendering fallback.

New PDF crops use **the union of the report's exported em rectangle and the
positioned glyph ink**, plus a fixed one-pixel margin at 300 dpi. Embedded font
programs exposed by pdf.js are parsed by pinned Fontkit 2.0.4. Glyphs use their
actual fontChar mappings and PDF placement, not a reshaped Unicode string or a
host font. An exact report text/em/page match must associate uniquely with the
painted text operations. Only the current producer's flat, horizontal filled
outline-text path is supported; unsupported positioning/forms, font data, glyph
mappings, accents, text modes and ambiguous associations refuse structurally.
There is no heuristic or ascent/descent fallback in this implementation.
The parser reads every text operator on the pinned page, so one unsupported
operator anywhere on that page refuses all PDF evidence on it. A producer change
elsewhere on a sheet can therefore disable PDF crops for that whole sheet.

The em rectangle remains instanceBbox. cropShape records pdf-em-ink/1.0, outward
rounded ink bounds, the fixed one-pixel margin, text-item/operator association and
embedded font-program hashes. sourceBbox is the derived union plus margin.
Left/top round down and right/bottom up to 0.001 mm. Em and ink must fit the page;
only margin may meet the page edge. Builder derives the shape and bind independently
recomputes it from the same hash-checked PDF bytes in a fresh document. Any altered
association, font hash, ink bounds or rectangle refuses before pixel comparison.
There is no caller-selected shape, margin or font.

The viewport remains 300/72, crop translation remains
[1, 0, 0, 1, -x*300/25.4, -y*300/25.4], and dimensions remain
ceil(extentMm*300/25.4). Rotation and user unit come from the pinned page viewport.
The four-line stamp labels new PDF evidence PDF em+ink and keeps the 86-pixel band,
14 px default, 10 px floor and original drawing scale.

New PDF evidence requires crop-index **3.0**, source attestation **3.0** and
pdfjs-source/2.0 capture. The attestation retains PDF hash/path, backend/version,
page metadata, em/ink shape and unchanged report classification. All ordered
attempts, numeric-only retries, retained references and the 3 MB cap carry forward.
SVG/HTML attestations remain 2.0. A v2 PDF archive can be read through the strict
em-only path only when its manifest matches an explicitly trusted record pin;
preview, bind and new record writers reject that downgrade. There are no committed
v2 PDF records: #61/#92 remain the only historical records and are unchanged.

Opt-in calibration independently matches delivered text/page/em associations and
writes non-applicable results; it never upgrades old reports into apply targets.
The swap check uses the CLI's PDF producer with shipped fonts, derives a shape
from the expected source and freezes a wrong raster at that exact rectangle.
Three independent references are measured even after a pass. Dimension refusal
cannot count as pixel sensitivity. The npm PDF producer is separate from the
unsupported Apple PDFKit raster backend. Distinct-ink controls, including both
O/Q directions, must refuse; the former O/Q acceptance allowance is removed.

```sh
bun evals/draw/pdf-evidence.check.mjs --report evals/out/draw/C1-current/summary.json \
  --output evals/out/pdf-evidence.json
bun evals/draw/pdf-repeat-capture.check.mjs --report evals/out/draw/C1-current/summary.json \
  --output evals/out/pdf-repeats.json
bun evals/draw/pdf-swaps.check.mjs --report evals/out/draw/C1-current/summary.json \
  --output evals/out/pdf-swaps.json
```

Calibration on pdf.js 6.5.438 / darwin-arm64 covered **238 rows: 141 small-text and
97 font-policy**, with **714 fresh-load comparisons, zero false refusals**.
Ten separate processes repeated all rows, **7,140 comparisons**, with zero
refusals and pixel-identical cross-process rasters. The padded controls produced
**351/351 refusals across 117 frozen swaps**. The minimum channel signal was
**175/255** (E→F at 1.667 mm), **111 above 64**. Formerly accepted O→Q and Q→O
now produce **231–232/255** at small, common 2.2 mm and large sizes, including
mid-string positions. These are measured controls for the shipped fonts and dark
palette, not a guarantee for arbitrary text, fonts or colours. No limit changed.

Identical-text instances and identical rendered glyphs cannot be distinguished by
pixels; instance identity still rests on the report-owned box. Signers inspect
full tails, descenders and overhangs against the pinned page, inspect the recorded
em/ink/page association and independently re-run bind or explicitly trust
spot-checks. The attempt history and reference-image origin still require that
trust; archive verification establishes retained consistency.

### Fresh-source binding and retained attempts

Bind writes `thermite-draw-source-crop/2.0` for SVG/HTML and `/3.0` for new PDF
evidence. In addition to report, token, source,
text and geometry facts it records the capture implementation and platform,
Chromium version/arguments for SVG/HTML or pdf.js version/page/environment for PDF,
fixed limits, selected attempt and ordered attempts.
Every attempt records its ordinal, previous-attempt hash, reference PNG SHA-256,
integer pixel/changed-pixel counts, maximum channel delta, integer accumulated
absolute RGB error, verdict and reason. Fractions are derived without rounding.
The limits remain **64/255**, **3% changed pixels** and **1.0 total RGB error per
pixel**, all required. There is no caller-set N, tolerance or bypass.

The policy is **three attempts total**, stopping at the first pass. Only numeric
pixel refusals retry. Each new SVG/HTML reference gets a fresh isolated context;
each PDF reference loads a fresh document from the hash-checked byte buffer and
destroys its loading task afterwards;
source, identity, geometry, header, alpha, dimensions and infrastructure failures
refuse immediately. Identical capture inputs may reuse immutable reference bytes,
but every cited crop is compared independently. Cache keys include source hash,
medium, physical page, canonical region, capture version and drawing hash, plus
PDF page/backend/version metadata.

New crop index rows must declare exactly `capture: "fresh-source"`. Bind, report
binding and archive verification refuse missing or different values. The exact
signed-hash exemptions preserve the immutable #61/#92 indexes.

Binding checks both the bound `--output` path and `<output>.audit.json` before
reading inputs or starting captures. An existing bound output requires a fresh
`--output`; no success audit is written for it. A stale audit is named with its
recovery choices. Use a fresh `--output`,
or preserve then remove the audit only after checking that no signed evidence
depends on it. Neither audits nor bound outputs are silently overwritten.

Binding writes `<output>.audit.json`, including exhausted attempts or structural
errors (with null stats if no comparison can be computed). Exhaustion writes no
bound draft. Successful output keeps every attempt and stays unreviewed. Reference
PNGs are stored by hash under `evals/out/draw-samples/verification/` and validated
when preview loads them; an existing hash-named file must have the expected bytes.

New records retain these PNGs in an explicit `verification/<sha256>.png` collection,
deduplicating identical reference bytes. They bind the hashes through signed
attestations and the original file manifest, recompute every comparison against
retained drawing pixels, and check attempt order, first-pass stopping and receipt
judgments, including `notMove`. References are not additional independently
reviewed drawings. Records with v2 or v3 source verification have a **3,000,000-byte cap including references**;
a larger per-PR pin cannot override it. Offline verification rejects discrepancies
between retained PNGs, declared hashes, statistics and receipt judgments, as well
as v1 downgrades. After signing, the signed payload and pinned record hash bind
the declared evidence and expose later changes. Exact historical signed-hash
exemptions keep #61 and #92 byte-immutable; they are never retrospectively rebound.

The signer trusts the binder's attempt history and reference images. Before
signing, a binder can drop refused attempts and renumber the rest, or substitute a
reference image and recompute matching statistics. Offline consistency checks
cannot detect those changes. The attempt chain proves the recorded order, not
where the images came from or whether the history is complete. Only re-running
bind through the recorded backend confirms the reference's claim to come from the
pinned source: Chromium for SVG/HTML, pdf.js for PDF.

A careful signer should independently re-run bind on the cited crops, or spot-check
a selection and explicitly trust the binder for the remainder. Use a fresh
`--output`. Inspect the cited drawing, literal report facts, recorded reference
rasters and comparison stats before approving causes. A later verifier can
recompute the comparisons without Chromium; that checks consistency, not source
origin. The report remains the trust root:
pixel binding does not authenticate a hand-edited report or establish engineering
meaning. Capture noise can still exhaust the unchanged limits; failure requires
new unsigned evidence, never looser limits. The calibration protects the tested
dark text palette; lighter ink or different fonts need new sensitivity checks.

The original full audit compared 1,067 retained pipeline PNGs with two fresh
renders: maxima 60/255, 2.698% changed pixels and 0.487 mean error, leaving margins
of 4 levels, 0.302 percentage points and 0.513 mean error. The fresh-evidence path
removes that retained-pipeline comparison from new binds; it does not make PNGs
bit-for-bit deterministic. `bind-audit.mjs` audits every retained pipeline region
using fresh unsigned evidence and independent bounded verification, reporting
pipeline-versus-fresh statistics separately. `crop-swaps.check.mjs` freezes each
of 90 wrong-character crops, then tries three independent references (270
comparisons). Both are opt-in browser checks with JSON evidence, not approvals:

```sh
bun evals/draw/bind-audit.mjs --report evals/out/draw/C1-current/summary.json \
  --output evals/out/fresh-bind-audit.json
bun evals/draw/crop-swaps.check.mjs --report evals/out/draw/C1-current/summary.json \
  --output evals/out/frozen-swaps.json
```

The runner captures the canonical 0.001 mm box it serializes. Rounding a previously
captured full-precision box can cross a raster boundary. Such historical evidence
needs a new unsigned crop, not a search for a nearby region.

### Repeat-capture check

`repeat-capture.mjs` is an opt-in browser check, separate from the portable E3
suite. It requires at least ten fresh Chromium launches and captures each region
twice per launch, including an unchanged-page screenshot. It compares every pair
of distinct PNG variants, rather than only comparing with the first capture.
The JSON retains each capture's SHA-256 and reports per-crop worst differing-pixel
count/fraction, maximum RGB channel delta, fraction of pixels exceeding 64/255,
mean absolute RGB error and remaining margin to all three fixed bind limits.
The **3% limit counts every changed pixel**, not only pixels exceeding 64/255.
Fractions retain full numeric precision, independently of report coordinate
rounding. No captures or signed records are replaced.

The repeat check compares **two fresh renders** using the same pixel metrics as
v2 bind. Earlier binding compared a retained pipeline PNG with a fresh render;
that pairing included a fixed component of up to 2.698% changed pixels, reproduced
in both full-corpus passes. `crop-audit.mjs` still measures that historical pairing.
`bind-audit.mjs` measures the new fresh-evidence path over all exported pipeline
regions. A repeat-only sample cannot establish a corpus-wide bind margin.

By default it samples every SVG/HTML pipeline crop from both init-starter flows
and the rendered motor-starter left-to-right case (power, control and reports),
both machine-demo flows, and the functional-symbol sweep cases
`sweep-functional-symbols-a3-portrait-compact-left-to-right` and
`sweep-functional-symbols-letter-landscape-compact-left-to-right`.
This includes the calibration's worst rows: machine-demo left-to-right sheet 3,
top-to-bottom sheets 5 and 7, the A3 sweep sheet 1 and the letter sweep sheet 5.
Repeat `--case <case-id>` to select other rendered cases. `--baseline` uses the
original launch arguments; repeated `--browser-arg=--flag` options test candidates.
`--fresh-page` also tests page isolation. All modes retain the same offline print
context, 300/96 device scale and fonts-ready barrier. The normal check fails if
any repeat pair exceeds a bind limit; `--require-identical` additionally requires
identical PNG bytes.

```sh
bun evals/draw/repeat-capture.mjs --report evals/out/draw/C1-current/summary.json \
  --output evals/out/repeat-capture.json
bun evals/draw/repeat-capture.mjs --report evals/out/draw/C1-current/summary.json \
  --output evals/out/repeat-candidate.json --baseline \
  --browser-arg=--disable-gpu-rasterization --require-identical
```

Issue #137 measurements on darwin-arm64, macOS 26.3 and Chromium 145.0.7632.6
used twenty captures per region across ten fresh launches. Each column below is
the worst per-crop pairwise result, so maxima need not come from the same pair.
These historical measurements compare fresh renders; the original bind still
compared pipeline PNGs with fresh renders.

| Sample / capture arguments                         | Varied crops |     Differing pixels | Channel delta /255 | Changed pixels | Pixels over 64/255 | Mean RGB error |
| -------------------------------------------------- | -----------: | -------------------: | -----------------: | -------------: | -----------------: | -------------: |
| 22 exploratory SVG text regions, original          |         3/22 |                  206 |                 16 |         1.031% |                 0% |         0.2372 |
| 34 selected SVG/HTML pipeline crops, original      |        14/34 |                1,105 |                 16 |        0.1921% |                 0% |         0.0268 |
| 24 signal/series-loop and DOL regions, original    |        11/24 |                  316 |                 22 |        0.8951% |                 0% |         0.2896 |
| 146 expanded default crop regions, original        |       49/146 |                1,917 |                 60 |        1.8676% |                 0% |         0.2308 |
| Same 34 pipeline crops, GPU rasterization disabled |         0/34 |                    0 |                  0 |             0% |                 0% |              0 |
| Bind limits                                        |            — | Depends on crop area |                 64 |             3% |                 0% |            1.0 |

The earlier 34- and 24-crop samples omit the calibration's known worst rows;
their smaller deltas do not bound corpus-wide noise or the binding comparison.
The expanded default rerun covers 146 crops and 2,920 captures across ten fresh
launches; every SVG/HTML source hash matches the dev baseline's pins. It confirms
the review's worst-row results: 60/255 in machine-demo left-to-right sheet 3 and
top-to-bottom sheets 5 and 7, 58/255 in the A3 sweep sheet 1, and **171/9,156
changed pixels (1.8676%)** in the letter sweep sheet 5. Forty-nine crops varied;
zero repeat pairs exceeded the numeric limits and no pixels exceeded 64/255.
That repeat channel margin is only four levels. It does not establish a generous
corpus-wide margin or guarantee that future captures will pass.

The wider sample covers both `requests.signal` flows, the maintained high-side
top-to-bottom series-loop SVG, and both physical pages of the complete DOL control
fixture. Its 24 regions include 19 conductor regions and five text regions, with
three millimetres of context padding. Ten fresh launches produce 480 captures.
Those measurements describe this focused sample; they are not a corpus-wide
margin claim. Counts, rather than rounded percentages, decide comparisons.

Prepare that focused sample without a full C1, then use the same repeat check:

```sh
bun evals/draw/repeat-capture-sample.mjs --output evals/out/repeat-loop-sample
bun evals/draw/repeat-capture.mjs --report evals/out/repeat-loop-sample/summary.json \
  --output evals/out/repeat-loops.json --runs 10 \
  --case signal-loop-left-to-right --case signal-loop-top-to-bottom \
  --case series-loop-high-top-to-bottom --case dol-control
```

The builder renders the shipped `requests.signal` fixtures and the complete DOL
control request with the built CLI, and embeds the same printable fonts in the
maintained series-loop golden. It records source hashes and canonical crop boxes
in a raster-only sample report; it assigns no evaluation scores or observations
and writes only beneath `evals/out`.

Disabling partial raster alone reproduced the exploratory variation. Disabling
GPU rasterization alone, disabling GPU alone, and the full proposed
software/colour/font flag set each produced zero differing PNGs. However,
`--disable-gpu-rasterization` changed all 1,067 SVG/HTML pipeline PNGs, and a full
two-pass audit refused **840/1,067** old crops under the unchanged bind limits.
The candidate strict C1 still exited 0 with all 17,948 observations and 1,231
non-PNG drawing artifacts identical to the dev baseline. CLI logs differ only in
checkpoint output paths; report provenance, headings, timing and cost metadata
are separate from those drawing artifacts.

The retained [record #61 crop](repins/61/crops/entry-0037.png) establishes a
compatibility failure, independently of the gate. Its recorded source SVG hash
(`e42556eff61296ab2b189a065b553489e31670d4385a5b6bc88621036df97f41`)
still matches the current source. The original capture reproduces the drawing
pixels exactly. With GPU rasterization disabled, **468/15,400 pixels change
(3.039%)**, with channel delta 10/255 and mean RGB error 0.0779. This exceeds the
3% fraction limit in a hypothetical source-pixel comparison. Record #61 is never
re-bound: both #61 and #92 are exempt from source verification by their exact
signed hashes. Their integrity and the immutable registry chain still verify.
This probe measures compatibility, not the current records' bind risk.

The deterministic candidate was rejected. The original default launch arguments,
calibrated font/colour settings, bind limits and signed records are preserved.
Those measurements informed #137. Fresh unsigned evidence with bounded verification
now implements the design described above; software rasterization remains rejected.

Passing `args: []` in `launch()` preserves the previous capture path:
[Playwright's `args` option](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-args)
adds arguments to its standard launch switches. The installed Playwright 1.64.1
Chromium implementation (`Chromium._innerDefaultArgs`) defaults omitted `args`
to `[]`, builds its default switches, then appends `...args`; neither launch
sets `ignoreDefaultArgs`. The default launch, renderer and C1 measurement predicates
remain unchanged. The new evidence checker bundle still needs a fresh strict C1
for a re-pin target.

For a full audit of actual pipeline PNGs (without replacing them), and the browser
protocol acceptance with an isolated synthetic registry:

```sh
bun evals/draw/crop-audit.mjs --report evals/out/draw/C1-consolidated-before/summary.json \
  --output evals/out/crop-audit.json --passes 2
bun evals/draw/crop-swaps.check.mjs --report evals/out/draw/C1-consolidated-before/summary.json \
  --output evals/out/crop-swaps.json
bun evals/draw/repin-pipeline.check.mjs --report evals/out/draw/C1-consolidated-before/summary.json \
  --output evals/out/pipeline-acceptance.json
bun evals/draw/repin-pipeline.check.mjs --capture \
  --report evals/out/draw/C1-consolidated-before/summary.json \
  --output evals/out/capture-acceptance.json
bun evals/draw/browser-network.check.mjs
bun evals/draw/mutate.mjs --output evals/out/crop-mutations.json
```

The protocol acceptance uses tracked tools from inventory through preview and an
explicit mock review in a temporary synthetic registry. It never signs a real
re-pin or applies a registry. The mutation command first requires its unmodified
control to pass; an intentional harmless comment must survive. Load errors are
reported separately, never counted as kills.

The tool reads and validates every PNG, computes its drawing hash, and writes the
entry's root `drawingSha256` plus `crop.headerPixels` from the index (0 by default,
86 only for validated stamps). It also binds each `notMove.crops[]` object with
its own `drawingSha256`/`headerPixels`. Typed drawing-hash claims are overwritten
from pixels. Inputs are unchanged; output is exclusive under `evals/out`. It
refuses any already-reviewed entry, non-empty sign-off or countersign. All review
flags, causes and notes remain unchanged. The reviewer inspects the computed
hashes and crops, then signs the bound file; the tool does not approve them.
It also writes tool-computed `sourceVerification` (source hash, medium, physical
sheet, region, instance box, DPI and protocol version) on each crop-bearing entry
and `notMove` citation. Typed source attestations are discarded before rendering.
New signed files must retain that fact through preview, receipts and archive
verification. Crop-less entries may carry neither drawing nor source facts.
The exact original signed SHA-256 values for records 92 and 61 identify the two
pre-source-verification records; a PR number, missing field or date alone grants
no exception. Their original bytes stay immutable, and record inspection reports
`historical signed hash` for that policy.
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
New provenance stamps fit each literal header line within the fixed width by
reducing its font size from 14 px when needed. Line 2 keeps the physical page
visible; the band remains 86 px with the same reserved white rows. Stamping
never shrinks below 10 px: an overflowing line is refused with its line number,
report-instance token, a quoted shortened preview of the offending line, required
width and available width; the stamped text is never truncated.
Re-stamping with the same script, font and header lines is byte-exact. Historical records
remain byte-immutable and use their original script when reconstructing stamps.
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
fonts. New bindings compare crop pixels against the recorded source region; that
ties the recorded source and instance metadata to the hash-bound report. It does
not establish the report's truth or the engineering meaning; those still require
review. Historical records have no retrospective source attestation. R4 stamps use
[`scripts/stamp-drawing-crop.mjs`](../../scripts/stamp-drawing-crop.mjs), the bundled
Noto Sans face and four literal ASCII `headerLines` in each index row. Rebuild a
non-retained original from its representative PNG with `--strip-header`, the
row's header-lines JSON, `--instance <instance.json>` and
`--source-bbox <source-bbox.json>`; those geometry files must describe the cited
instance and region. The instance JSON is `{ "bbox": { "x": ..., "y": ..., "w": ..., "h": ... } }`;
the source-box JSON is the plain `{ "x": ..., "y": ..., "w": ..., "h": ... }`.
Omit only `--strip-header` when starting with a raw C1 crop. The
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
including `.DS_Store`, fail closed. Only signed text, receipt, index, retained drawing PNGs and the referenced
verification PNG collection belong in the original manifest. No entry schema has a generic `crops` field.

Signed text or crop indexes **over 256 KiB** are stored gzipped, with their
uncompressed hashes bound separately. A gzipped signed file always uses sidecar
countersigns. The default record cap is **3,000,000 bytes**, including metadata and
countersigns. Historical records retain their reviewed size policy; a v2/v3 source-verification
record cannot exceed 3,000,000 bytes through a larger per-PR pin. D1's byte-immutable record is grandfathered unchanged, including
its uncompressed signed file. Raw signed JSON uses `.signed` to prevent formatter
rewrites.

The fixed-header writer is reproducible on the pinned Bun/zlib build.
**Verification checks gzip metadata and the uncompressed hash; it never
recompresses.** Existing signed/receipt gzip inputs preserve their compressed bytes, as does
D1's frozen index. New crop indexes are rebuilt with derived drawing-group fields
before compression; their input gzip bytes are not retained. This permits
byte-exact D1 reproduction on other zlib builds without requiring recompression.

#### Writing and pinning an applied record

`readVerification()` from `verification-io.mjs` loads the hash-bound reference
buffers for a newly bound signed file. Pass its returned map as `verification` to
`recordFor()`. `recordFor()` and `writeRecord()` in `repin-record-write.mjs` build and validate an
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
import { readVerification } from "./evals/draw/verification-io.mjs";

const pr = 123;
const baseCommit = "<40-hex pre-apply commit>";
const cropIndex = await readFile("evals/out/review/crop-index.json");
const index = JSON.parse(cropIndex);
const signed = await readFile("evals/out/review/decisions.signed");
const verification = await readVerification(process.cwd(), JSON.parse(signed));
const result = recordFor({
  verification,
  pr,
  baseCommit,
  signed,
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

The stamper's general API also requires `{instance, cropBbox}` as its fourth
argument, including when restamping. Its CLI requires `--instance <instance.json>`
and `--source-bbox <bbox.json>` in addition to drawing/header/output arguments.
`stampInstanceDrawingCrop` supplies the same containment guard. Stamping only
checks geometry; the bind step performs the independent source-pixel comparison.
