# Drawing evaluations (E3)

The source-only kit invokes the built CLI and measures the resulting SVG, real
CLI HTML and direct PDF independently of the renderer's layout estimates.
Run full checkpoints separately from `bun run check`. The check runs the
drawing `*.test.mjs` suites, including Chromium-backed tests. No engine source
or electrical project is changed.

```sh
bun install --frozen-lockfile
bun run build
bun evals/draw/run.mjs --checkpoint C1-e3fu
bun evals/draw/run.mjs --checkpoint preview --quick
VITEST_MAX_WORKERS=2 bun run test -- evals/draw
```

Checkpoints are write-once directories under gitignored `evals/out/draw/`.
Open `summary.md`, `summary.json.gz`, `gallery.html` and `reviewer-form.json`.
The JSON sorts keys and observations, rounds coordinates to 0.001 mm, and
contains no timestamps, absolute paths, checkpoint names or wall timings.
`timing.json` and `cost.json` are separate. Compare consecutive full summaries
with `cmp`; use identical checker/marker bytes, engine, corpus and browser.

Capture format **`thermite-draw-eval/1.1`** packs case JSON and CLI logs in a
lossless Zstandard archive. The checkpoint's last line prints stored bytes,
the budget and the remaining headroom. Checker protocol **5.36** applies.

Version **5.36** fixes **DQ-19** for PDF report cells (#461). Native glyph bounds
locate character-bearing runs in the measured cell. Extraction padding at line
edges and whitespace-only runs outside same-line gaps do not create printed
characters or baselines. Same-line separators remain checked. Complete 5.35
summaries remain readable.

Version **5.35 (TEXTM1)** extends **DQ-02** to require 0.50 mm from terminal
label ink to painted strokes in its own symbol. Chromium samples the glyphs and
native SVG strokes, including caps, joins and dashes, on a 0.005 mm grid. The
finer grid resolves near-threshold gaps that the original 0.04 mm grid could
miss. Browser fixtures cover both sides of the threshold and the original T1
secondary-winding geometry. Mechanical frames and terminal markers are outside
this check.

Version **5.34 (IDENT1)** extends **DQ-05** (#469). It measures raw UUIDs
in painted text, including wrapped circuit captions and device tags, and
circuit group keys in headings and related-function
destinations, using the request's authored labels and references to resolve
the latter. Complete 5.33 summaries remain readable.

Version **5.33 (STUB1)** extends **DQ-03** (#463) and **DQ-02** (#470).
DQ-03 fails when measured continuous symbol strokes connect same-side stubs
from distinct native nets on a device face. DQ-02 requires 0.34 mm of clearance
from an open cable-end caption's glyph bounds to the stroke bounds of its own
mark, using twice the existing 0.17 mm ink measurement allowance. Complete
5.32 summaries remain readable.

Version **5.32 (P03-CORPUS)** fixes **DQ-18** on presentation 0.3 (#459).
The checker measures the compact frame's revision cell and requires its
painted label and exact authored value on the same baseline. A missing cell,
missing paint or incorrect value fails with the measured cell or panel bounds.
Earlier presentation formats keep their existing checks and row bytes.
Complete 5.31 summaries remain readable.
The [#454 re-pin record](repins/454/record.json) records the independent review
of the new compact-frame scopes and the measured reference updates.

Version **5.31 (C2-RENDER)** fixes **DQ-05** for the I/O schedule (#453).
The Direction cell is checked against the native channel direction for its
own row. An authored direction such as `output` remains valid when a
function key has the same spelling. The other columns retain their existing
function-key checks.

Version **5.30 (TEXT-NAV9)** extends **DQ-19** to reconcile direct peer and
connector-inventory pointers, strip inventory sheet addresses, and circuit
footer references against native identities and measured issued ink
(#397, #429, #431, #434). The checker compares the ink of each peer
note with the source's painted card or terminal. Text without a source name
must be directly adjacent (2.1 mm). Named text can sit within 6.1 mm of the
owner, its conductor stroke, or its continuation caption. Chromium comparisons
allow 0.15 mm for measurement. A conductor which already reaches both native
endpoints on a sheet needs no peer note.

Run the manual pre-merge fit sweep after both strict captures.

```sh
bun scripts/check-peer-note-fit.mjs --base-engine <built-base-checkout> \
  --base-checkpoint <base-summary.json.gz> --head-checkpoint <head-summary.json.gz>
```

The script checks issuance across all 124 standing cases (746 sheets) and
renders 458 additional A4, Letter and compact variants of the corpus and the
narrow browser wire-field fixtures. The full check runs a 16-row representative
guard that checks issuance, exact sheet counts and peer-note proximity for
conveyor-line and machine-demo on Letter and A4, in both flows.

Version **5.29** adds independent **DQ-16** paint-mask checks for wire
label plates and **DQ-17** corroboration for a shared source-rail caption
(LABEL1, #338 and #350). The mask check measures painted fills in any colour
and rejects missing paint or clip measurements. It requires 0.35 mm of ink
before a bend and the greater of 2 mm or the plate height outside a terminal
marker. The distance rule accepts offset plates with a painted leader whose
attachment and conductor landing are measured independently. The 5.28
terminal-strip and schedule rules remain in force.

Version **5.28** extends **DQ-19** and **DQ-23** for native terminal strips
(CHECK8, #428 and #427). SVG schedule endpoint cells reconcile with the
union of qualified schematic and strip appearances. A strip location has
a painted native strip heading, terminal label and body, and a visible path
of the same wire, core or jumper ending at that body with its native
incidence caption. The printed grid gives the destination at the center
of the measured terminal body on the final issued sheet. An inventory
entry or another conductor's landing on the same terminal grants no
location. `not drawn` is valid when neither population supplies a landing.
Named destinations must resolve to one of the measured sheet.zone values.

DQ-23 compares visible straight path segments of stubs and bridges at
their common native terminal. An intersection or shared run outside that
body fails for a stub and bridge. Distinct bridges fail for coincident
outside-body runs within 0.01 mm measurement precision. Ordinary contact
within the common body is valid. Separate physical sheets are never
compared. The measured failure records carry native endpoints, a local
intersection or overlap witness, and the audit counts on the affected
sheet. Unsupported or clipped straight-path evidence grants no landing;
DQ-23 reports a geometry gap when a candidate approach cannot be measured.
This extension is SVG-scoped. The existing strict rows are used and
complete 5.27 summary files remain readable.

DQ-05 accepts `Terminal strip` in a device-reference representation cell
when the same printed row names the native device and every final sheet /
zone points to a visible, labeled native terminal body on a graphical strip
sheet. The checker reads the printed row and the destination independently.
An issued inventory row or an exported reference alone supplies no body.

Version **5.27** fixes #414's two latent navigation-oracle holes (CHECK7b).
The checker change preserved corpus rows and pins. The later
[REP5 record for #421](repins/421/record.json) records the reviewed pin updates
at 5.27. Rooted power requests now have
independent native topology coverage: conductor incidences and two-terminal
power/protection functions connect the selected native load terminals to native
sources. These are symbolic traversal edges, never electrical net joins.
Declared supply terminals and native potential sources end the traversal, so a
rooted view does not acquire obligations from another load on a shared supply.
An eligible protection function lies on a simple path from a load terminal to
one of these boundaries. A dead-end branch or a loop attached at one bus
junction cannot contribute a protection obligation. A connected load with no
reachable supply or protection candidate is outside this check when a supply is
declared elsewhere. This covers unmodeled transformer or drive stages without
inferring connectivity. A disconnected root or an unresolved reachable
protection candidate still reports infrastructure.
An unavoidable protection function with a detached native contact must have a
full measured appearance in that authored view, even if its ink and all its
locators disappear together. A known omission fails with the native UID/function,
request-view and issued-sheet locator; no missing box is invented. Ambiguous
branch selection or unavailable source/topology/view measurement is explicit
infrastructure. Another authored view cannot discharge the missing appearance.

The #398 population forwards only shared native-part `*-unavailable` findings as
infrastructure. Real drawing defects remain failures of the existing native-part
DQ-08 rows, while per-port navigation is still judged independently, as pass or
fail. Completely missing parts still diagnose unavailable selected port ink.
Complete historical 5.25 and 5.26 summaries remain readable. This is checker maintenance,
not a new navigation convention or permission to re-pin. Positive, missing-ink,
ambiguous-path, missing-data and cross-view controls supplement the existing
navigation mutants; the compiled packing fixture is checked in both flows.

Version **5.24** adopts the repaired #396 and #398 oracles in strict **DQ-08**
(CHECK6, #406.1). This explicitly extends DQ-08 from terminal/part references to
same-device detached protection/contact function navigation and individually
named selected communication-port destinations. It does not change DQ-07's
coil/repeat rules, the predicates, locality tolerances, or any existing row/pin.
New `check6-element-navigation` and `check6-port-navigation` rows are appended
through the existing packet assessment path, using native IR/request selections
and independently measured SVG ink. Renderer correctness flags confer no credit.

Applicability is determined separately for each owner and physical source sheet.
#396 requires full selected native protection/contact appearances of one device
on distinct issued sheets, outside the existing coil-actuation population.
#398 requires a selected native communication endpoint absent on a local part
and painted on another part. Unoccupied/unselected ports create no link need.
A valid audit with **zero obligations, zero findings and zero measurement gaps**
is not applicable: strict emits no row, while the exposure command retains its
explicit `not-applicable` row. Missing native data, selected ink, or zone geometry
is infrastructure, never n/a or pass. Infrastructure gets a separate row and
cannot mask an independently observed drawing failure on that sheet.
The four existing R006 cases have no issued sheets and remain not measured for
these oracles (the runner retains its existing refusal rows):

- `sweep-report-filtering-letter-portrait-standard-left-to-right`
- `sweep-report-filtering-letter-portrait-standard-top-to-bottom`
- `sweep-report-filtering-letter-portrait-compact-left-to-right`
- `sweep-report-filtering-letter-portrait-compact-top-to-bottom`

SVG-only scope remains explicit; HTML/PDF navigation is not independently certified.

`check6-navigation.test.mjs` compiles a strict fixture from the unchanged
motor-starter and network-pagination sources and their byte-locked libraries.
It reuses existing request shapes: two native command-circuit parts pack on one
TTB page, shifting the later power and communication sheets. Both flows must
satisfy native element and per-port obligations at their **final** measured
positions. Stale sheet/zone pointers and the named negative classes fail strict
assessment after real SVG remeasurement. No corpus case or pin is added.
The 5.23 full checkpoint is replayed before adoption, per scorecard §2; 5.23
summaries remain readable with their complete counters.

Version **5.25** adds independent strip-only sheet classification and measured
strip text/geometry exposure. At 5.25 this was **non-strict**; 5.26 adopts it below.
Report sheets retain their complete
header, shaping and no-report-text guards. Strip-only sheets instead need
visible terminal bodies and text at least 2.5 mm, and retain the same shaping
bounds; missing/hidden ink fails explicitly. Native terminal/jumper coverage and
reciprocal continuation destinations are checked in the separate exposure.
Complete 5.23, 5.24 and 5.25 summaries remain readable.

Version **5.26** adopts native strip geometry in strict **DQ-23** (CHECK7, #336).
The unit is a nonempty requested terminal-plan **view**, including every sibling
inventory and strip sheet. A table page passes only if the complete view has
measured native terminal order, explicit jumper paths, wire/cable-core incidences,
exact inventory incidence equality, reciprocal continuations and visible Tn/Rn
references. Attributes and native registry identities locate candidate ink only;
actual Chromium rectangles, sampled paths and painted text discharge obligations.
Missing or incorrect ink fails with a native view/terminal/jumper locator. Missing
measurement is explicit infrastructure. SVG-root/ancestor opacity is included in
paint visibility. This does not certify HTML/PDF strip geometry.

Not applicable means no requested terminal plan (including automatic inventories)
or an empty native terminal selection. `terminalPlanAudits` reports that state
explicitly. Legacy empty conditional per-sheet DQ-23 rows, IDs and scope text are
preserved outside this obligation population; they assert no strip coverage.
View assessment is mirrored onto its sibling sheet rows, preserving the existing
pin protocol. A nonempty request cannot lose its obligations when strips vanish:
even a wholly absent view fails on the first issued sheet. Refused packets retain
their structured R004/R006 refusal and non-pass DQ-23 rows; no issued ink is never
a strip pass. The 5.26 checker change exposed five historical table-only defect
families as xpasses for REP5 review.

The #336 terminal-strip oracle is a separate **non-strict exposure** check:

```sh
nice -n 19 bun evals/draw/terminal-strip-exposure.mjs --capture evals/out/draw/CHECKPOINT --out evals/out/terminal-strip-exposure.json
```

It reconstructs requested terminal selection, authored order, explicit jumper
endpoints and conductor incidences from native IR, including the union of physical
cable conductors and authored assignments. Every measured strip terminal is also
compared with its linked native inventory row for exact incidence equality. Chromium measures terminal
rectangles, jumper/stub paths and visible text; identity attributes locate ink
but do not establish coverage. Missing/extra bridges, wrong order, invented
shapes, wrong peers and missing reciprocal row references fail the exposure.
The receipt binds input artifacts, strict report, checker and Chromium, with
`strict: false` and `repinNow: false`. The replay receipt remains non-strict;
5.26 strict assessment uses the shared predicates through `terminal-plan-strict.mjs`.
This SVG oracle does not certify HTML/PDF; those
require separate print review. Existing refusals remain not measured.

Version **5.23** fixes #395: a missing identifier table keeps table-dependent
report-placeholder pins as infrastructure, shared sheet furniture is checked
once against the complete nonempty sheet, and PDF painted measurement guards
raise the typed identifier error only at the identifier-call boundary. Shared
PDF metrics failures retain their own classification; programming errors
propagate. Empty wires reports retain 5.22's lack of a zone-header obligation.
Healthy corpus observations are unchanged;
complete 5.22 reports remain readable. No expected markers are changed.

The same pre-merge **5.23** adds two **non-strict exposure** oracles for #396
(DQ-07) and #398 (DQ-08). The standalone replay does not enter strict assessment or move
pins. Version 5.24 separately adopts the same predicates after T6/T7 repairs.
Strict adoption is now authorized by CHECK6; the original exposure workflow
remains available for independent replay against unchanged output:

```sh
nice -n 19 bun evals/draw/navigation-exposure.mjs --capture evals/out/draw/CHECKPOINT --out evals/out/navigation-exposure.json
```

The receipt binds the strict report, Chromium build, checker modules and every
read native artifact. It lists each sheet's pass/fail/not-applicable assessment,
native obligations and explicit measurement failures, with `strict: false` and
`repinNow: false`. Existing R006 refusals are **not measured**. Infrastructure
exits 2; drawing exposure does not alter the strict exit. SVG is independently
measured; these receipts do not certify HTML/PDF navigation.

- #396 groups full native protection elements and auxiliary contacts by device UID,
  selected view and measured
  terminal membership, then requires local reciprocal pointers to distinct
  functions on other issued sheets. Same-function repeats, terminal interfaces,
  and the existing direct coil/contact actuation population remain separate.
  A shared UID means a location relationship; it invents no actuation or
  construction. A pointer names the device and native function key or its full
  terminal set, plus the destination sheet.zone. Printed contact/protection/coil
  roles and contact states must be truthful. Any spanned destination-body zone
  is accepted. The existing DQ-07 nearest-owner and 60 mm locality convention is
  reused. Selected missing bodies, incomplete geometry and dangling printed
  destinations cannot silently discharge an obligation.
  PLC channels and source/PE functions have no adopted obligation in this scope;
  their shared UID alone does not make them protection/auxiliary pairs.
- #398 reconstructs selected communication-link endpoints from native IR and
  the request, then binds each device/port to its painted circle and printed
  port label. Every omitted, elsewhere drawn port needs its own named final
  sheet.zone pointer (with an optional, validated physical part prefix), checked
  at that port's ink rather than the enclosing
  device body. Each part is checked independently, so reverse omissions fail.
  Unoccupied/unselected ports drawn nowhere create no fictitious link need.
  A selected endpoint with missing ink is explicit infrastructure.
- The exposure parser accepts `DEVICE.function → 02.A1` (or the native terminal
  set), `DEVICE.PORT → P2/S02.A1`, and `DEVICE port PORT → 02.A1`.
  Complete measured text rows, newlines and semicolons delimit clauses. Visual
  wraps within an annotation join only until their printed pointer completes;
  a fresh subject starts another clause even if the preceding pointer is missing.
  A printed
  `DEVICE:` header scopes later rows in the same measured annotation; per-row
  element identities and destinations are never flattened. A grouped port
  list such as `DEVICE port B1/B2/B3 → 02.D2` is allowed only when every named
  native port has painted ink spanning that destination. A final sheet number
  already identifies its physical part; an explicit part prefix must agree.
  Multiple destinations for one identity are accepted. Several named
  identities with several anonymous pointers are ambiguous and fail. IDs on
  measured containers locate ink; exported target arrays, success flags and
  registry facts never authorize it. Broader compact caption grammars need a
  reviewed native binding before strict adoption; no indirect-alias convention
  or D02 coverage is introduced here.

Version **5.22** fixes the four robustness gaps from #376 without adding an
oracle, changing criteria or moving expected markers. Complete 5.21 reports
remain readable.

- Requested-terminal-plan lookup is caught on its own sheet. An ambiguous native
  table binding cannot discard the sheet's later observations or other sheets.
- Identifier infrastructure gets a separate SVG DQ-19 observation. Wire-locator,
  text-outside-cell, report and successfully measured identifier findings retain
  their own failure verdict. An identifier measurement failure cannot mask an
  unrelated retired/absent defect's pin verdict.
- Only `IdentifierMeasurementError` is caught as identifier infrastructure.
  Browser measurement preserves that type through an explicit error envelope;
  PDF extraction wraps recognized PDF data failures at its API boundary.
  Programming errors propagate, even with measurement-looking message text.
- Several measured document identities on one sheet are checked independently,
  with their native tables, row keys, cells and SVG/HTML/PDF runs. Shared row and
  column keys cannot borrow another document's geometry. Failure in one document
  does not erase findings measured in another.

Version **5.21** fixes two implementation defects exposed by N17 delivery;
it adds no new oracle predicate and changes no criteria or expected markers.
Historical complete 5.20 reports remain readable.

- Inline source tables bind by the measured document ID and document kind,
  independently of the outer graphical sheet kind. Native row values, headers
  and source bindings still validate delivery. Conflicting or ambiguous table
  locators cannot select an arbitrary source table.
- Automatic-document lineage compares each physical per-part dependency with
  its native sheet/view/note obligation. Several physical parts may share one
  logical dependency ID. Missing, duplicate or foreign part records refuse;
  unique logical ID counts do not establish physical completeness.
- Identifier lookup, character geometry and PDF extraction failures are explicit
  infrastructure errors on their sheet and medium. Remaining sheet observations
  and independent media survive identifier-check exceptions. A browser failure
  that prevents geometry measurement retains sheet/medium context in the case
  infrastructure receipt. Its unmeasured pins remain infrastructure, with no
  repair credit or false unmet-pin drawing failures. Other missing-instrumentation
  behavior is unchanged. Strict and report-only modes both retain exit 2 for
  infrastructure errors.

Version **5.20** completes the N17 native **issued-documents/1** contract.
This is an observation change on unchanged output; 5.19 remains a readable
historical complete-summary schema. No expectations, renderer or corpus change.

- A source-selected connector assembly produces an **assembly-pin-map** need
  with `noteId: "assembly-reasons"` on the part drawing the native relation.
  That existing family denotes the native mapping **disposition and reason**.
  A cap whose native state is `not-applicable` needs its explanation printed;
  it does **not** need, supply or authorize pin tuples. Made-up maps fail native
  row sufficiency. Missing selected ink leaves the source obligation on the
  view anchor rather than erasing it.
- The new closed fact is `{kind: "connector-port-status", deviceUid, portKey}`.
  Its semantic columns are **identity / endpoints / status**: no protocol,
  cable ID or pin-map. Occupied assembly rows supply their two native endpoint
  status facts alongside their relation fact. Unoccupied rows supply only their
  real connector-port fact, preserving `--`, `Unoccupied` and `No assembly declared`.
  Their row keys remain JSON `[device UID, port key]`; their semantic columns no
  longer pretend to be pin-map columns. The physical assembly inventory table
  remains the place where these rows are printed.
- A connector-port-status **need** exists only for a selected native device's
  port drawn nowhere in the packet. Any painted native-matched port on another
  issued assembly part satisfies S1's drawn population. Repeated device parts
  each retain their own omitted-port navigation need. Each need has one port fact
  and stable `noteId: "connector-port-status/" + JSON.stringify([uid, portKey])`.
  Mapping/reason and connector-status need fact sets stay separate, including
  legacy loop mapping needs. Source scope and missing data fail closed.
- Every production need caller passes the complete packet/geometry context as
  nativeNeeds' sixth argument `{packet, geometries, request}`. Exported facts,
  dependency seeds and renderer success flags never produce the native needs.
  Authored selection plus independently measured native-bound appearances
  partition the source obligations by part.

A future renderer can reuse sufficient requested rows or declare genuine missing
companions under the existing three-set/binding contract. Row facts must be the
**whole native row fact set**, while each dependency's requiredFacts contains
only its need's homogeneous kind. Assembly rows retain the four mapping-family
semantic columns; unoccupied rows use the three connector-status columns.

Print a precise reason caption such as `Assembly inventory 02.A3 (CAP-X2)`.
For an omitted port, a per-port caption such as
`R1.X3 → connector port status: assembly inventory 02.A3 (R1 / X3)` works with
both M3 and the 5.19 N17 printed-delivery oracle. Compact native-device counts
are also supported (`R1: 1 port` with a verified partition); a connector is never
assigned a cable owner. The printed row still has to contain its full native
reason/status and measured geometry. No page-growth or renderer repair credit
is claimed by contract fixtures.

An auto inventory can share the existing graphical sheet. Its SVG document
container supplies `data-document-id`, `data-document-origin="auto"` and
`data-document-kind="assemblies"`; the last field locates the native document
kind independently of the outer sheet kind. It is measured on every row text
and cell rectangle and must agree across them. An absent field preserves the
legacy report-sheet contract; a blank or inconsistent field refuses delivery.
The field is a locator, never proof: native row values, actual printed headers,
the complete visible/issued/dependency sets and bindings still have to agree.
Hiding the registry cannot hide visible inline rows. Same-sheet captions use
that sheet's real number and measured row zone, for example `01.B5`.

Pre-merge C5 review fixes retain **5.20**. A graphical sheet with an inline
auto inventory keeps its authored navigation view when scoping every sheet in
the packet. Only a standalone auto-document sheet without navigation views is
excluded. Its legacy metadata fallback is retained; an authored inline sheet
still receives the native producer-kind mismatch guard.

Missing native assembly mapping disposition/reason produces an explicit source
gap and cannot satisfy a row, even if fabricated `undefined` text is printed.
Registry row diagnostics name failed conditions and expose expected/actual facts.
When the same row also has wrong semantic columns, that evidence is folded into
the row finding; a columns-only defect still has its own finding. Thus each
unoccupied row's old facts/columns export is reported once. Those old 5.19 exports
are **export migration**, not evidence that the truthful printed `Unoccupied` /
`No assembly declared` cells became wrong.

Two limits remain follow-ups. Without a valid dependency declaration, M3's
fallback caption matcher can consume an N17 `other ports` footer; attribution
needs a shared caption grammar before narrowing legacy recognition. Correct
versioned declarations use an explicit primitive locator. Drawn-port pointers
should use their plain sheet.zone destination rather than `assembly inventory`
wording. Standalone auto-text sheets without authored navigation views still
fall back to the exported sheet kind; replacing that fallback requires native
companion-origin reconstruction and separate adversarial controls. Neither limit
is treated as permission to accept missing native needs or invalid delivery.

`c5-contract.test.mjs` uses real compiled topology-coverage/CAP-X2 source with an
independent future-client declaration fixture. Correct declarations pass both
oracles; missing needs, invented maps/cables, wrong real ports, hidden dependency
footprints, wrong subjects and communication-kind substitution fail.

Version **5.19** implements CHECK3 C4's reviewed N17 omission semantics and
N14 direction refinement. Pre-merge review fixes retain 5.19: per-port pointer
ownership, repeated-caption sheet qualifiers and strict single-member report gzip.
These are observation changes, so 5.18 is retained as
a historical complete-summary schema rather than silently reinterpreted.

- **N17 / DQ-19:** omission is packet-wide, not local-sheet absence. A native
  port drawn on another issued assembly part is a drawn-port destination, not
  an omitted/unoccupied status row. An owned, precise `port → sheet.zone` pointer
  to that measured destination satisfies the need; any spanned destination zone
  is accepted. Ports drawn nowhere still require their native assembly/status
  row. Multi-port and other-parts notes must pair each named port with its own
  `subject → sheet.zone` segment, separated by semicolons. A port cannot borrow
  another port's pointer. A single subject retains all its destinations, including
  semicolon-separated lists. Bare port names require the owning device context;
  unbound footer subjects use the native `device.port` or `device:port`. A row
  destination may still serve several sufficient schedule rows. Generic prose
  without a destination fails when a native need exists; generic notes with no
  native need remain outside this bounded predicate. An unoccupied port never becomes an invented cable. A drawn link does not
  itself supply its native mapping reason: notes requesting reasons still bind
  to sufficient issued reason rows. Each selected link is conserved once per
  authored view, and every selected device must appear, even for a selection
  consisting entirely of unoccupied ports. Missing ink, grid or ownership fails.
- **N14 / DQ-13:** findings retain the matched native device/terminal identity.
  Incident directions within the existing 10-degree uncertainty are merged
  without a fixed bucket boundary, including the 0/360-degree wrap. Each merged
  group's angular span is at most 10 degrees, with the boundary inclusive.
  Evidence labels are distinct, rounded circular means of the groups. Only native-attributed ink counts;
  unattributed painted rays can make the recorded count smaller than the visible
  ray count. This count is not a census of all paint; the separate N3 ownership
  check remains responsible for identity disagreement.
- **N8:** peer selection assumes exactly two native conductor ends. The source
  reader rejects any other arity before the peer lookup; the opposite-end lookup
  preserves the real peer terminal of self-loops.
- **N15:** expected-caption comparison is packet/print consistency, not a native
  IR oracle. The final issued caption population determines repetition: repeated
  titles require `title (sheet NN)` with the row's own issued number padded to at least two digits;
  unique titles require the bare title. Printed cells never determine whether a
  qualifier is required. `references:false` remains fixture-only until a corpus request uses
  it; current corpus requests all leave references enabled.

**Representation and review:** the unchanged 100,000,000-byte default cap counts
stored bytes. The default writer now retains the complete canonical report as
`summary.json.gz` (deterministic gzip, level 6); `--artifacts` retains raw
`summary.json`. Decompression reproduces the exact canonical JSON bytes, with
all observations, findings and ordering intact. Report readers accept either
container, enforce strict UTF-8/duplicate-key parsing after decoding, and reject
corrupt gzip (decoded size limit 256 MiB). Multiple gzip members and all
trailing bytes, including zero padding, are refused. All source/report hashes bind the
**stored file bytes**; changing containers requires a new report binding and
never rebinds historical signed inputs. Decision JSON remains strict raw JSON.
Native SVG/IR/packet/HTML/PDF/query artifacts are not repacked by this change.
The gallery distinguishes boxed, sheet-level and unboxed findings, links each
failed C3 row's source SVG, prints its measured box, and restores its per-row
SVG-only scope. N14/N17 summaries are human review aids; their findings and
statuses are not rewritten by the representation change.

Version **5.18** adds CHECK3 C3's independent tranche-2 predicates. Separate
`check3c3-*` rows are appended after all earlier packet observations, preserving
all 5.17 observation bytes and relative order. No pins are changed. These new
rows measure **painted SVG**; the existing HTML/PDF parity and text/geometry
controls remain separate, and do not constitute an independent C3 medium audit.

- **N8 / DQ-08 and DQ-24 extension:** native wires, jumpers and cable cores bind
  actual card, stroke, continuation and inventory identities. DQ-08 covers cards
  and continuations; DQ-24 covers strokes and inventories. An authored primary
  label, an explicit native alias or an intact designation/primary pair is
  accepted; designation alone cannot silently replace a different primary label.
  Cable `.` and `/` print aliases are equivalent. UID, native endpoints and the
  complete protected identity are checked, including same-net wrong owners.
  This extension does not claim a configured automatic wire-numbering policy.
  Cards require a real native terminal; an empty terminal identity cannot turn
  an unassigned core into a spare. Self-loops retain their real peer terminal.
  Card rows must also name the correct native peer; clipped duplicate candidates
  are excluded by measured visibility, while a visible card with erased text fails.
- **N11 / DQ-08 extension:** independently reconstruct authored circuit and
  communication selections, conserve each whole conductor/link once per view,
  and measure terminal/port appearances per part. Repeated symbols retain their
  native physical UID; they are not duplicate equipment. Every repeated subject
  requires reciprocal P/part and sheet.zone references to every other appearance.
  Destination zones are reconstructed from painted grid anchors; any zone
  spanned by its measured body is accepted. Multiple parts may share one sheet.
  Candidate view locators are bound to canonical native selection plus duplicate
  ordinal, not caption equality or the `view/1` schema version. Missing source,
  ink, peer, reference or grid data fails closed. **DQ-12 feasibility stays
  manual**: a lower page count is not proof of a valid same-paper alternative.
- **N14 / DQ-13 refinement:** ordinary terminal endpoints may be hollow. A filled
  marker requires a native node and at least three distinct painted incident
  rays, including source-owned conductor and terminal-attachment/symbol leads.
  Both circuit and wiring marker classes are measured privately; legacy DQ-13
  shape classification is unchanged. White knockouts, hidden/erased approaches,
  foreign owners and coincident duplicate rays cannot authorize a dot. Numerical
  coincidence is 0.01 mm; the measured marker radius plus half stroke width
  defines contact; 5.19 merges directions within the existing 10-degree uncertainty.
- **N15 / DQ-19 refinement:** the final issued sheet list, including every index
  and reference page, must occur exactly once as visible index rows with correct
  printed numbers/captions. Multiple index pages and duplicate view titles are
  allowed; title equality never merges physical sheets. `references:false`
  permits intentionally absent reference pages but does not exempt the index
  itself. The existing 100-sheet limit remains. Stable authored view/part naming
  beyond this bounded final-index check (#302) stays manual.
- **N17 / DQ-19 extension:** assembly pointers and omitted-port notes bind to
  source-selected assembly reasons or native connector-port occupancy, then to
  sufficient actual issued assembly rows and their measured sheet.zone. An
  unoccupied port needs its native unoccupied/no-assembly row, not an invented
  cable assembly. Generic schedule prose, a foreign port/assembly, absent cells,
  wrong reasons or stale target zones fail. Native selected links are conserved
  independently of printed success/state flags. Actual transformed path endpoints
  must reach the measured native port circles, with nonempty painted ink. Dashed
  cap/link endings are allowed; no new maximum dash-gap threshold is invented.
  Free drafting prose beyond this
  bounded dependency grammar remains manual.

`tranche4-*.test.mjs` contains positive/adversarial controls and output mutations.
Missing private measurement bundles are failures, never successful empty audits.
Port ownership still uses native-valid UID/key identity from DOM nesting plus painted geometry;
independent owner-body containment is deferred because port circles can straddle the body and no
containment convention is approved. Raw and gzip forms of the same logical baseline retain distinct
stored-byte identities; content-level duplicate detection is deferred to a future protocol change.
Compare decoded report hashes for content equality across runtimes: zlib may change container bytes.

New exposure remains unpinned for the later REP3 batch (`repinNow: false`).
C3 rows retain every finding's measured box and native source reference. They use
source-bound full SVG sheets instead of another automatic first-finding PNG crop
per failed row. Positive ray traces are reproducible from those sources; failure
rays remain in the findings. This avoids duplicating evidence beyond the unchanged
100 MB default output cap. Earlier findings, statuses and crops are untouched by the representation changes.

Version **5.17** adds the CHECK3 C1 independent review-2 predicates (N3–N6,
N12). They consume native IR and measured painted geometry, not renderer success
flags. New `check3-*` observation IDs keep earlier observations separate. No
expectations or applied records change; newly exposed old-output defects remain
unpinned for REP3. Selected-standard interpretation beyond these predicates
remains manual.

- **DQ-14 / N3:** distinct native conductor identities incident on the same
  physical terminal may not share parallel painted approach ink outside its
  measured marker. Native endpoint sets are checked independently of route IDs.
  A free-air junction dot needs a coincident measured native terminal node with
  at least three native conductor incidences. Removing a dot cannot hide shared
  ink. The existing 0.01 mm endpoint/coincidence guards remain. Net-level edges
  without physical conductor identities are explicitly unimplemented, not proof
  of separate physical landings; unknown declared wire IDs or missing ink fail.
  Circuit `data-circuit-junction` circles are measured in N3's private bundle,
  including actual filled ink, clipping and transforms; their attribute grants
  no native-node authorization. Legacy shape classes and DQ-13 stay unchanged.
  N3's population is painted routes; existing coverage/endpoint guards retain
  responsibility for native conductors with no painted route.
- **DQ-16 / N4 remains manual beyond the existing rule:** retain the <=2 mm
  ink-box proximity test and 0.17 mm uncertainty unchanged. Native wire/core IDs,
  endpoint sets, source-backed printed identities and painted route data now
  reconcile independently; absent or contradictory data fails closed. A proposed
  block-centre nearest-support rule detects the reviewed long-label problem but
  also flags the legitimate short `103` vertical-branch label. Therefore its
  measurements are **manual review witnesses**, never automatic failures or
  passes. No approved attachment convention distinguishes every such case; no
  new width/clearance/2x ratio or parallel-text style requirement is invented.
  Inline plates and vertical labels remain permitted. Broader segment ownership
  needs visual review or a separately approved attachment convention.
  Semantic net/potential names are not physical wire identity captions.
  Explicit nonconductive `data-wire-label-leader` paths locate candidates only:
  its continuous painted path must actually reach the label and its own conductor.
  Checker 5.29 measures all caption fills with positive opacity in paint
  order, including paths and nested groups. An inline interruption can pass
  when exactly one native owned straight stroke crosses the fill. In the
  visible viewport there must be 0.35 mm of conductor before a bend and at
  least the full plate height or 2 mm, whichever is greater, outside each
  painted terminal marker. The 0.01 mm coordinate coincidence tolerance
  identifies route ends. Covered junctions, foreign strokes and missing
  paint or clip measurements fail independently of label-distance findings.
  The manual block-centre review rule remains.
- **DQ-17 rail substitution:** an empty source net reservation can be supplied
  by the painted rail caption at the same measured source terminal when it
  names the IR potential for that terminal and net. A remote, clipped, wrong
  potential or absent caption cannot supply the omission. The existing
  terminal-caption repetition test keeps its scope.
- **DQ-04 / N5 extension:** owned function/report NC/NO contact captions must
  agree with native contact state or explicit circuit-symbol class. Native
  power-input/output roles on breaker/overload/fuse profiles identify protection
  elements; closed auxiliary contacts retain NC. Keys, tags and descriptions
  never establish construction. Missing ownership/role facts cannot justify a
  state claim. SVG, independently measured HTML, and spatially reconstructed PDF
  cells are checked. PDF owner recovery never requires text equality. DQ-05's
  vocabulary adapter also accepts independently source-backed protection-class
  captions; its old generic projection remains unchanged on old output, while
  DQ-04 exposes that projection's role contradiction.
  The helm's protection-role wording is `Breaker pole`, `Overload element` or
  `Fuse element` followed by native terminals, with no parenthesized NO/NC state.
  Genuine auxiliaries retain their source-backed contact state.
- **DQ-10 / N6:** native AC-input/DC-output circuit qualifiers require actual
  upright waveform or solid-over-dashed strokes, contained in their own measured
  symbol/body boundary with owned native ports. Parent rotation, an upright text
  node or a correctness attribute grants no exemption. Missing/erased glyphs,
  unknown native owners, sideways strokes, inverted DC bars and displaced ink fail.
  Stroke traversal order is immaterial. A half-turn of the point-symmetric AC
  tilde is painted-equivalent and is not a failure; DC bar order is observable.
  This bounded circuit-conversion oracle does not certify arbitrary AC/DC prose
  or every selected-standard qualifier.
- **DQ-19 / N12 extension:** issued wire inventories reconcile visible native
  row facts and the complete paginated document, against native wires, jumpers
  and cable-core rows. An unqualified title requires the full native inventory.
  A partial inventory must explicitly say supplementary/partial/subset/filtered
  or cable-core scope in its own heading or scope note. The generic safety or
  completeness disclaimer is insufficient. Scope cannot be borrowed from an
  unrelated same-title document. Minimal companions remain permitted. SVG,
  HTML and PDF are checked; missing cells/title/native data fail closed. Free
  prose and drafting adequacy beyond this bounded scope grammar remain manual.
  Declared numeric conductor/row/wire/jumper/core/endpoint counts and source
  denominators reconcile by native class: a mixed 17-jumper/2-wire inventory is
  19 conductors, not 19 wires. Cable-core scope cannot hide native wire rows.
  Wrapped scope notes are reconstructed before measuring counts. HTML uses its
  own measured cells; PDF uses painted native extraction, without requiring a
  text match to SVG.
  A companion containing every native row states `all n ... rows` (or the native
  conductor unit) and cannot call itself partial/subset; the count is checked.

New semantic rows use separate crop filenames so their presence cannot rename
earlier evidence on the same DQ/sheet.

`tranche3-oracles.test.mjs` and `tranche3-browser.test.mjs` contain positive,
negative and output-mutation controls, including same-net wrong owners, erased
ink, arbitrary key renames, duplicate titles, real >=3-way nodes, valid inline
plates and explicit leaders. Actual browser ink is sampled at 0.2 mm and adjacent
collinear painted pieces are joined without bridging occlusion gaps; the 0.01 mm
coincidence allowance is numerical, not an accepted physical gap.

Version **5.16** measures DQ-21 PDF widths from native content-stream glyph
advances. PDF.js-inferred whitespace contributes no width; actual space glyphs
and their spacing still contribute, including extraction-omitted end spaces.
Multiple show-text runs on a line retain their native placement span. The
`fontMetrics` predicate and max(0.15 mm, 2%) tolerance are unchanged; the other
checks retain their existing PDF extraction geometry. DQ-07 absence evidence
now records native coil/contact/actuation counts and issued view kinds, and
explains native relays without measured full function bodies. Explicit source
selections with an unresolved device/function or missing issued view title emit
packet-level reconciliation findings rather than silently permitting absence.

Version **5.15** adds explicit packet-level DQ-07 `not-applicable` coverage when
the native repeat and mirror/return audits find no obligation, measurement or
unmatched annotation. It is emitted once on the first sheet; an empty sheet in
an otherwise applicable packet does not establish absence. Existing navigation
observations and pass/fail criteria are unchanged. Full-report validation still
requires coverage for every DQ and case, including the DQ-11 sweep pairing.
Expectation rows cannot supply that native check coverage.

DQ-17 resolves terminal captions from owned terminal metadata and the exported
semantic port/node/marker identities, never from proximity. Its duplicate rule
is per physical terminal **per drawn appearance**; separate split/continuation
appearances retain their captions. A semantic net label remains a net label even
when its text exactly equals a terminal key or qualified identity (`L1` or
`SRC1.L1`). Disjoint net/terminal labels keep separate semantic roles; actual overlaps still fail
DQ-17 and the general DQ-02 text-overlap check. Version 4.8 corrects that role
distinction; older checker reports must be replayed before attributing renderer
changes. Version 4.9 fails DQ-17 on missing/malformed terminal-caption owner keys,
unresolved device/terminal/appearance identity, inconsistent marker declarations,
and port/net or edge/terminal role mismatches. Matching nearby text never repairs
ownership. A valid edge-owned net label keeps its semantic role even when its
text equals a terminal identity. The legacy 15 mm duplicate fallback applies only without exported
appearance identity, never to infer an owner.

Version 5.0 exempts authored type-description fallback text from DQ-05 on the
same terms as instance descriptions; function/aggregate captions still fail.
DQ-15 compares internal jog lengths against 3 mm with a **0.00001 mm numerical
tolerance**, solely for SVG-to-mm floating-point conversion. An exact 3 mm jog
passes even if measured as 2.99999998 mm (or 2.99999016 mm on A3); 2.99 mm and
2.25 mm still fail. The tolerance bounds the observed A3 conversion error of
0.000009844 mm and remains 1,000 times smaller than a 0.01 mm drafting change. This
does not change the drafting minimum or the route-detour bound.

V5.1 reports `net-label-repeats-terminal-caption` under DQ-17 only when an
edge-owned net label equals a printed caption at its **route source** landing,
in that same body appearance. Net labels use ELK `TAIL`, so the far/target end
cannot replace the name at the label's anchor. Exported route-port owner keys,
resolved marker identities and nested drawing scope establish this relationship;
neither distance nor net membership does. Historical SVGs without route-port
keys cannot establish which electrical endpoint is the anchor and provide no
same-end repetition evidence.

Empty semantic net-label reservations are audited separately from painted text.
An omitted name without a printed matching source-landing caption reports
`net-label-suppressed-without-source-caption`, using the edge's exported potential
name. This catches suppression justified only by a far-end caption. Clip-hidden
reservations contribute no missing-name finding or text/font measurement.
The renderer retains reservations, routes and semantic names. A distinct name
stays printed; all phases use the same source-end rule. Split bodies keep their
own captions and names.

V5.2 adds fail-closed DQ-14 endpoint coherence. A visible conductor endpoint
must coincide with its owned terminal, junction or attachment anchor within
**0.01 mm**, a numerical allowance for three-decimal SVG output and browser
coordinate conversion. Missing, malformed or ambiguous ownership is a finding.
Drawing-local layout-port keys resolve circuit, wiring, signal-loop,
communication and connector anchors; rooted views use their semantic port and
marker keys. Deliberate terminal attachment extensions own their outer landing.
Clipped off-sheet endpoints are assessed on their visible appearance. Merged
landing detection groups by the owned terminal appearance and reads its declared
source/target route end, regardless of any endpoint gap. An offset cannot hide
a shared final stroke. Historical wiring exports retain their ordered physical
endpoint contract; proximity never establishes ownership.

V5.3 removes the DQ-14 `not-implemented` fallback for conductor shapes without
physical endpoint exports. Such a shape produces
`endpoint-landing-ownership-unavailable` with reason
`missing-physical-endpoint-exports`, and existing gap/ownership findings remain
failures. Empty conductor-free documentation pages are still eligible for a
clean observation. Relation landings retain the V5.2 drawing-local port check;
adding an electrical identity cross-check for those relations remains separate
work.

DQ-16 retains `not-implemented` for an ineligible distance measurement and gives
separate reason codes: `no-visible-conductor-labels` when there is nothing to
measure, and `label-identity-unavailable` for declared visible conductor/net
labels without identity. Neither case becomes a pass.

Version 5.4 measures every occurrence of a qualified function selector embedded
in generated text, including ordinary-word keys such as `signal`. Each finding
records the key and its offset in that text. Authored terminal identifiers with
the same spelling remain visible facts. Existing instance/type-description
exemptions remain unchanged. Request-authored `notes` are exempt only on text
nodes explicitly marked `data-authored-text="request-note"` by the renderer;
wrapping retains that provenance. Generated engine notes stay measured even when
a request note contains identical text. Marking a containing group does not
exempt generated children. Report rows retain their existing separate policy.

Version 5.5 resolves DQ-05 report cells and communication captions to their
source owners and independently projects function kind/state and bound terminals,
authored I/O addresses or terminals, and authored port markings with optional
descriptions (`KEY` or `KEY — description`). Owned bare port keys, like terminal
keys, are reader-facing identities; qualified selectors remain findings. Caption
ownership is also recovered from routed native relations when a caption marker
is missing; unresolved ownership fails.
The report-row exemption is removed. A complete cell is reconciled across wrapped
lines and font runs; ordinary words such as `coil` are allowed only as authored
prose or facts derived from the owned function kind. Reference row keys, channel
selectors, qualified port selectors, type IDs and CSV lookups remain machine identities.

A sibling DQ-05 observation, `internal-vocabulary`, measures schema/type identifiers
separately: cable type headings, missing-description type-ID fallbacks and the
terminal-plan `terminalOrder` note. That generated note has required source-index
provenance and is reconciled in full; substituting any internal field token or
removing its provenance fails the independent expected-note check. Neither predicate guesses ratings, products,
connector names, main/auxiliary status or polarity. Provenance is resolved against
IR, packet references and request source; a missing owner or forged authored-text
marker does not exempt generated text. Authored descriptions, addresses, signals,
request notes and circuit group headings retain their source meaning, including
literal `coil` or `core:` text. Source report fields are selected by kind/column directly from native IR,
never certified by matching query output. Generated Assignment, Connection review
and Status columns receive no blanket exemption; an authored reason alone may be
matched to its source. Circuit heading contents and reference-row packet membership
must also match their owners. DQ-19 selects historical endpoint/channel identity
policy through an explicit replay-engine export capability, never by inspecting
the measured cell's punctuation or value. Source fields are selected
never by a regex over all text. SVG/HTML geometry and PDF extraction/parity retain
the same media obligations. Historical replay uses the new checker against the
old engine before measuring the projection change. No defect pins are learned.

Version 5.6 adds the drawing-review E1 measurements in dedicated modules:

- DQ-10 measures native DC polarity primitive orientation, its nearest owned port
  and lead-ink overlap. Adjacency also requires the mark centre within half the
  measured positive/return port separation. Missing or foreign native port owners
  are explicit findings. Native DC port pairs stay in the population even when
  both qualifier and glyph-id locators disappear; missing glyph ink then fails.
  The bounded radius prevents a distant mark from passing
  solely because its own port is still nearest. DQ-04 separately measures upright earth bars, disjoint
  pressure/level operating-link ink after collinear union, and a closed-state
  slash crossing both contact bars. Native roles/state/profile select obligations;
  renderer orientation flags do not prove geometry. Standard selection remains manual.
- DQ-15 includes electrical signal-loop routes with the existing 3 mm numerical
  tolerance and detour limit. Terminal-end exports recover a stripped loop marker;
  unresolved/forged native ownership fails. Assembly bars stay excluded.
- DQ-13 counts terminal attachment paths, including tag-lane extensions, in dot
  incidence and compares their weight to actual incident native conductors with
  a 0.01 mm measurement epsilon. Helm's E1 review decision requires attachment
  and tag-lane rays to equal their incident conductor weight; the checker reports
  rays exceeding that weight by more than the epsilon. The 0.35 mm versus 0.32 mm
  instances are minor consistency findings, retained as honest fails until lane RT
  fixes the renderer, not permanent pins. Rays with no selected incident conductor
  are explicitly unassessed. This adopts no global symbol-weight convention.
- DQ-08 requires one intact native conductor identity line, allowing adjacent font
  fragments. Reciprocal same-sheet folds remain valid. Actual inter-block and
  zone-ink gaps are recorded as **measured, threshold pending**; 3.5 mm has not
  been adopted. No alignment or extra-bend aesthetic failure is invented without
  a proven feasible alternative.
- DQ-19 reconciles visible concrete pointer notes, source-derived dependency
  facts, and actual issued painted rows and columns. Wrong-device, filtered,
  missing, hidden and forged rows fail. DQ-09 separately reports missing exact
  issued target locations. Legacy notes bootstrap their typed native scopes;
  document kind/title, JSON coverage and hyperlinks alone cannot satisfy them.
  A circuit-coverage promise requires actual issued function ink matched to an
  authored `circuit-view-request/0.1` group and its native function selections.
  Planner `view.kind` is not an oracle; rooted power/control sheets cannot count,
  even if they draw every promised function or claim a circuit kind. The reason
  `no-sufficient-issued-circuit-view` names that exact check. No printed coverage
  document kind is currently issuable: `schematic-coverage/0.1` is packet JSON,
  so the checker makes no claim to validate a printed coverage table.
  Generic honest partial-view wording creates no companion promise. New inventory
  locators, when supplied, must agree with native scope and source snapshot.
- DQ-16 measures formerly label-free sheet fragments against a verified visible
  native conductor identity on their continuation or another fragment of the
  **same logical view**. A continuation must have a native source, visible owned
  rows, a reciprocal peer, and a measured anchor at its own route endpoint.
  Missing/foreign/cross-view names fail. Unowned legacy labels retain an explicit
  measurement gap.

Browser exports are additive: primitive ownership, port IDs, exact route vertices
and transforms, and actual visible stroke intervals at 0.025 mm resolution. A
0.05 mm ink-interval uncertainty is used only for dash union; orientation uses
0.01 mm numerical axis tolerance. Native stroke hit tests, clipping, alpha and
later opaque fills establish painted ink. The new primitive measurements concern
SVG geometry; existing HTML/PDF label parity continues independently, and these
predicates do not certify PDF primitive visibility. Version 5.7 adds M5 below; version 5.8 adds the mirror/return checks.
No expectations or re-pin records change with these versions.

Version 5.7 adds E2a's independent repeat and hardening predicates:

- DQ-07 M5 reconstructs native full-function membership from painted body and
  complete terminal sets, including multi-function aggregates. It groups by
  device UID, selected view and issued sheet, never glyph. Distinct visible view
  wrappers locate authored selections in issued order; unique rooted/title
  matches support old captures. Navigation occurrence/annotation exports locate
  printed labels only. Claimed roles, targets, zones, canonical groups, label
  strings and locality flags never supply expected facts. Missing or forged
  locators cannot remove native/geometry obligations. One label covers each
  repeated appearance. Printed destinations equal the other measured function
  anchors, quantized to 0.01 mm before half-open zone classification; canonical
  is the first authored selection, then sheet. Each semantic Repeat line uses
  `same function`, native single-contact `same contact`, or `same functions`
  for the functions on that line, including mixed canonical/repeat blocks.
- Repeat locality requires the same sheet, distance at most 60 mm from the
  distinct-terminal centroid to the label ink, and the nearest device frame
  belonging to its owner, comparing the gap between actual label-ink and frame
  boxes (not their centres or reservation envelopes). A nonlocal label needs its correct measured
  `(ss.zone)` prefix. Repeat labels have no mirror zone-adjacency rule.
  Measured text line bands require 4 mm horizontal clearance (0.01 mm numerical
  epsilon); non-text ink requires 1.5 mm (0.05 mm sampling epsilon). Actual
  clipped, unoccluded painted path segments are sampled at 0.2 mm for these
  clearances; bent routes never become endpoint chords. Existing SVG/HTML/PDF
  visible label parity remains separate; this predicate measures SVG geometry.
- DQ-08 continuation blocks require at least **2.5 mm minus the established
  0.17 mm measurement epsilon**, per CT's adopted gap. Zone-ink clearance remains
  **measured, threshold pending**. Per-character measured baseline runs, including
  positioned `<tspan>`, make native conductor identities indivisible. Adjacent
  font spans remain legal; PDF rows keep their independent PDF measurements.
- DQ-18 accepts painted labelled fields only inside the measured title panel:
  `Drawn:` / `Drawn by:`, `Checked:`, `Approved:`, drawing number and customer/site
  labels. A NAV table's `not drawn` above the title rule cannot credit a field.
- #238 L1/L2 pin rooted-sheet rejection with genuine matching circuit ink, and
  ambiguous native designation rejection. L3 remains documented: no general
  authored view index exists on `RenderedSheet`; occurrence provenance is not a
  complete index for every circuit sheet, so duplicate-title pooling remains.
  The DQ-13 lightest-incident comparison is unchanged and matches RT1 policy.

These modules import no renderer navigation planner. Native IR supplies identity,
terminal membership and function kind; authored requests supply selections;
browser measurements supply painted text, baselines, frames, clips and locations.
Version 5.14 review follow-ups attach DQ-19 coverage and explicit native absence
only to the `sheet-NNN` locator observation, never the dependency observation.
A lost cable-end appearance also marks the affected wire-report sheet as not
measured. Strict mode rejects every `not-measured` observation, states the reason,
and includes the status in the Markdown and policy summaries. Net-label findings
retain the original locator, medium, box and em-box metadata used by identities
and crop routing. Source-half checks require a measured source anchor and join
route pieces geometrically in source order before projecting the label once.
Unavailable or ambiguous direction remains not measured.

Cable orientation is intentionally unconstrained: a complete coherent mirror of
captions, circles and locators remains valid. Bare circles bind only through a
unique nearby native caption; indistinguishable or reused circles and missing
captions do not receive measured credit. No left/right electrical fact is inferred.

Version **5.14** hardens checker coverage (#262, #256, #222). Cable end
circles bind to native cable/core and device/terminal identities through verified
printed endpoint ink; neither DOM slots nor exported locator values establish
ownership. Modern caption owner, terminal and end-role claims must agree with
native source. Historical captions require a unique printed native identity;
unavailable or ambiguous ownership is recorded as `not-measured`.

DQ-17 records historical keyless net-label ownership as `not-measured` rather
than pass. It normalizes native names and printed captions (NFC, collapsed
whitespace, trim), checks source anchors against the painted path start and checks
painted TAIL labels against the source half of that path. Empty reservations
remain omission evidence, not painted label positions. Missing/malformed native
conductor endpoints and wire locator columns on a mislabelled documentation kind
fail closed. Literal controls cover null horizontal factors, absent-body reference
entries, historical document fallback and both sides of the glyph majority
boundary. The transitive oracle import guard covers all new modules. General
authored-view attribution (#262.5) remains deferred pending an exported identity;
titles supply no source identity.

Explicit authored null cable ends and unassigned native cores record end-level
`not-applicable` with a native absence reason; these are not unknown identities or
measured landings. Missing or malformed endpoint fields produce findings.

Version **5.13** updates the independent DQ-05 terminal-set oracle (#283, #244).
Range-like pairs (equal letter prefixes and integer suffixes differing by more
than one) use a list separator; other pairs retain the en dash. Parse bare
terminal keys, then check punctuation on the printed qualified names. The oracle
keeps its own implementation and import-graph test; it imports no renderer/query
formatter. This version includes ENDPOINT's 5.12 checks from dev `1a93e71`.

Version **5.11** hardens the checker only (#256, #250, #206, #238):

- M3 headers require a matching native source table. Requested documents use
  their authored request identity (`authoredOrder`), never issued page order;
  that locator receives credit only after headers and native row ink agree.
  Multiple automatic documents share one complete native inventory census,
  including duplicate and missing rows across the union.
- Caption notes are excluded only when their measured content matches the
  scoped native request's notes. A `request-note` flag alone cannot suppress a
  generated caption. Resolution source/fact/zone claims have direct controls.
- Mirror ownership uses a frame enclosing this symbol's body, with a body
  fallback for each frameless symbol. Other copies of the same device cannot
  establish ownership. Browser-clipped frame segments already define the visible
  frame bounds; the duplicate viewport clipping step is removed.
- Fully checked mirror/return absences report `not-applicable`, counted separately
  from `manual`; any finding still fails. Reference tag rows use the existing
  2.3 mm reference vertical floor. Horizontal transforms and `textLength`
  adjustments have a separate compression-only factor check.
- Wire locators measure actual endpoint ink even on a sheet labelled as a report.
  Cable circles use nearby painted native endpoint identities, independent of
  circle order. Explicitly absent cable ends retain truthful `not drawn`; missing
  wire/jumper endpoint data still fails closed. Wrong described pin rows do not
  establish an appearance.
- #238's rooted and ambiguous-designation controls remain enforced. Inspection of
  `RenderedSheet` at dev 4e8c997 confirms that no stable general authored view index
  is exported. Internal draft `views[].viewIndex` and occurrence provenance do
  not supply one for every issued circuit sheet; title matching remains documented.

The historical #256 R2-L3 classification is **six automatic terminal exemptions**
(operator-console 013–015 in both flows), plus **eight not-applicable pages**
(six wire pages and two network pages, including operator-console 016).
DQ-19's explicit-state criterion and source-line/assembly-reason agreement tests
were already corrected in 5.10 (#256 R2-L1/L4). Prefer the column-scoped long forms
`No same-location connections`, `No other / unspecified location connections`,
`Status not specified` and `Protocol / medium not specified` when authoring empty
states; the shorter truthful forms remain backward compatible. No engine wording
or historical evidence is rewritten by this checker change.

Version **5.10** compares DQ-19 null placeholders by semantic source line, so an
assembly's authored pin-map reason cannot impersonate its absent status. The
DQ-19/M3 agreement tests include assembly status and preserve the exact reason.
Native assembly reason lines are authored text even when exactly `None`,
`Unspecified` or `null`; the native status line retains its null-policy check.
The DQ-19 criterion now says explicit native empty states, rather than blank nulls.

Checker **5.10** also measures stacked wire-location fields from their painted
partitions and visible native headers, independently of column flags or rectangle
order. Seven fields, complete header sub-cells, contained locator ink and the
ordinary one-rectangle-per-column contract have negative browser controls.

Checker **5.10** independently compares every printed wire From/To locator
with native endpoint appearances measured across issued drawing sheets. Native
marker/core identities and painted pin-list text supply appearances; pin rows
are reconciled with native keys and descriptions, including in old unkeyed output.
Zones use painted label anchors and accept any spanned zone. Wrong sheets/zones,
missing values, and `not drawn` for a drawn endpoint fail in ordinary and stacked
tables. Report pages, hidden/clipped ink and native peers supply no landing.
The locator audit reconstructs endpoints only when measured issued wire rows
exist. Missing or incomplete native endpoint sources for an issued inventory
produce a `wire-locator-measurement-gap` failure rather than an exception or pass.

Version **5.9** adds M3 companion delivery against `issued-documents/1`:

- Native IR supplies typed endpoint incidences (including endpoint ordinals),
  terminal, port, core and assembly identities, persistent note ids and states.
  Exports locate ink and are reconciled against that independent reconstruction.
  Native empty states accept the explicit `native-empty-state/1` vocabulary shared
  with DQ-19 null policy; legacy placeholders still deliver facts and still fail
  that separate report policy.
  Missing versioned exports remain a failing measurement gap, even when native
  ink appears complete.
- Automatic inventory identifier sources come from native report universes and
  unresolved native needs. Requested filters and the 1–40 authored views retain
  their own scope; automatic documents have a separate origin.
- DQ-19 checks each issued document independently, visible rows, semantic headers,
  native source/presentation bindings, dependency resolutions and caption delivery.
  Missing, extra, foreign, stale, hidden, clipped or JSON-only content fails.
- DQ-09 measures the final center of the complete row region from all measured
  cell rectangles, rounds to 0.01 mm, and checks every captioned sheet.zone.
  Per NAV3 review L4, any zone spanned by that region is valid; the center is
  canonical when choosing among valid locations.
  Identity and compact-count captions are checked against the native fact
  partition, including the leading omission count on identity captions.
  Dotted port selectors fail. Standalone partial-view wording does
  not erase a concrete native need; generic partial warnings promise none.
- The existing four-side-grid and title predicates continue to check automatic
  pages. Automatic terminal inventories do not become requested graphical
  terminal plans (DQ-23). Authored notes belong only to authored pages; generated inventory ink
  receives no authored-note exemption. No expectation or re-pin changes.

Version **5.8** adds E2b's independent NAV2 checks and E2a follow-ups:

- M5 collects whole canonical/repeat/mixed ink blocks by their printed repeat
  wording. M2 mirrors, returns and notices never enter the M5 population;
  forged role flags confer no exemption. Wrapped qualifier rows stay in the block.
- DQ-07 reconstructs direct same-device coil → contact `actuates` relations from
  compiled, byte-locked IR. One observation is emitted per full coil and contact
  appearance. Painted complete native bodies and terminal membership establish
  full appearances, including circuit interfaces outside the glyph group. Whole-wire
  circuit boundary copies are reconstructed from the authored conductor selection,
  the stable native endpoint unit and actual landed native route geometry; an
  export's boundary flag alone never removes an obligation. Primitive locators
  distinguish separate placements of the same function on the same sheet. Native
  authored circuit selections, visible appearances and exported occurrences/seeds
  are reconciled; missing/forged locators fail rather than remove obligations.
  Every row must match the authored NO/NC state, terminal set and all independently
  measured full target destinations, or explicit `not drawn`. Reports and boundary
  contexts never count as full destinations. Exported strings/state/targets are
  never the oracle. The checker imports no renderer planner or query formatter.
- `Contact associations unspecified` is valid only when the coil's own device has
  contacts and no eligible direct relation. Coil-only devices get no mirror.
  Reciprocal captions name every related coil destination (or `not drawn`);
  shared gang captions need native group membership, painted mechanical links,
  the same coil set and the same issued sheet/view fragment. Unspecified and
  out-of-scope associations disclose their machine assessment without automatic
  pass credit. Drawings must never print `not assessed`.
- Mirror locality uses the coil's terminal centroid rounded to 0.01 mm, measured
  printed table ink, the same sheet, ≤60 mm, intersection with its own or an
  adjacent printed zone, and nearest-owner box-to-box distance against visible,
  clipped, nested frames. Frameless owners use their native body box. A foreign
  frame tie within 0.01 mm is ambiguous. A nonlocal table needs a verified
  `K1 /ss.zone` heading. Repeat locality shares the body fallback and tolerance;
  it has no zone-adjacency clause. Returns report distance without any threshold.
  SVG semantics and locality are measured here; independent SVG/HTML/PDF text
  visibility, clipping and type checks continue separately.
- DQ-05 independently implements the approved S2 terminal separator: exactly two
  names use en dash unless either contains `-`, `–`, `−` or `+`; otherwise use
  `/`, falling back to `, ` when a name contains `/`. No renderer formatter is
  imported. Sign/dash and comma branches have separate controls.
- E2a controls pin single-contact `same contact`, intact continuation rows whose
  ink/em boxes straddle the gap, frameless ownership, frame ties, title-panel
  right/bottom edges and half-stroke clearance. The gap epsilon imports
  `INK_ACCURACY_MM`. Title-panel detection currently assumes a **single row**:
  the last full-width rule is its top. Full-width internal rules in a future
  multi-row title block are unsupported, explicitly tested, and require a native
  panel boundary before they can receive title-field credit.
- Capture displays already measured sheets without measuring their geometry a
  second time. The same source bytes/fonts and frozen measured geometry remain
  in use for observations and crops.

Q5 supplies a separate **report-only** per-conductor reference comparison:

```sh
bun evals/draw/route-report.mjs --current evals/out/draw/CURRENT --reference evals/out/draw/REFERENCE --output route-lengths.json
```

It reports each native wire/jumper/core by authored view: clipped route-centerline
length in mm, bend count, reference length/bends and both deltas. Tiled copies of
one path are unioned; unsupported paths/clips and unresolved owners are disclosed
as measurement gaps. Plate occlusion is excluded. Added and removed conductors
are explicit. No length or bend change sets a fail status or changes expectations.
The reference and current captures must be retained checkpoints. RT2 consumes
this report; it does not implement the renderer's candidate rejection policy.

Expectations and repins are unchanged.

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
`--report-only`; their font substitutions are not calibrated. The
[test browser setup](../../CONTRIBUTING.md#browser-for-tests) covers
Chromium-backed suites. Seal tests create a synthetic temporary Git repository.

pdf.js supplies text positions, operators and raster parity. PDFKit is an
optional macOS cross-check (`--pdfkit`); `THERMITE_DRAW_PDFKIT=0` disables it.
The portable historical detector is a labelled construct audit, described below.

Default retained output has a hard **100,000,000-byte** limit, including
`cost.json`; excess is infrastructure failure. Sheet SVGs, direct PDFs and
300 dpi crops remain directly accessible. Actual CLI HTML is measured then
gzipped as `packet.html.gz`; decompress to inspect it. Only failing observations
with real on-sheet regions receive crops. Sheet-level or wholly off-sheet findings
have no invented crop.

`case-files.json.zst` stores the compact packet metadata, compiled IR, query
reports, requests and CLI logs. Its decoded JSON object maps `case/filename`
to the exact UTF-8 file contents. Packet metadata omits duplicate SVG/HTML
strings. The runner verifies the compressed bytes in memory and on disk before
removing the loose copies. An archive failure retains the loose evidence and
records `harness/case-archive` in the report. To read a member using the same
reader as the checkpoint tools:

```sh
bun -e 'import { readCheckpointCaseFiles } from "./evals/draw/case-files.mjs";
const [checkpoint, id, file] = process.argv.slice(1);
const read = await readCheckpointCaseFiles(checkpoint);
process.stdout.write(await read(id, file));' \
  evals/out/draw/CHECKPOINT machine-demo-left-to-right ir.json
```

`--artifacts` opts into loose case JSON and logs, full-sheet PNGs and
uncompressed HTML, waiving the aggregate budget.

Default compact-frame cases discard the temporary project copies after capture.
The sealed source, case recipe, request and compiled IR preserve replay inputs.

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
- The presentation 0.3 cases (#454) run machine-demo and conveyor-line in both
  flows, on Tabloid landscape (10 mm margins) and Letter portrait (5 mm margins),
  in standard and compact layouts. The recipe upgrades the copied presentation
  and retains the authored title fields and electrical sources. The Letter
  margins let the narrow layouts exercise the frame on issued sheets. Each
  packet selects one existing power view (machine-demo M2 or conveyor-line M1)
  so the standing capture fits its output budget. The
  [compact-frame ledger](corpus/compact-frame-ledger.json) records the
  full-packet exploration and the new strict cases' scope.
- The [load symbol coverage](corpus/load-symbols-ledger.json) extends two
  existing cases. The motor-starter documentation adds the M1 motor load in
  circuit view. The conveyor-line compact-frame case adds the rooted PS1 AC
  input and uses wire designations on four branches in the copied fixture.
- D1/D2 packets have a documented deferred E2 slot, never substituted or scored.

The 36-cell sweep is three projects × tabloid/A3/letter × landscape/portrait ×
standard/compact, each executed in both flows (72 cases). Motor-starter covers
power/control; functional-symbols covers circuit/report sheets; report-filtering
covers filtered reports. Full corpus: 124 cases. Flow-neutral schemas are replayed
unchanged rather than receiving an unsupported flow field. Each successful case
runs the built CLI for JSON/SVG, HTML and direct PDF and compiles unchanged IR;
expected report identities/multiplicities come from the public query API.

The reference manifest covers only `git ls-files` drawing JSON inputs, excluding
package/tsconfig JSON and ignored output. A checkpoint explicitly invokes
`seal.mjs --output <checkpoint>/corpus-seal.json`; it never rewrites the reference.
The content hash covers `{format, casesSha256, files}`. `base` records the commit
beside that hash and is not part of it. `--compare <summary.json.gz>` warns only when
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
| not-applicable       | Fully determined absence checked; no human assessment remains.      |
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
zone strip ends at the measured ink bottom of a complete sequential numeric zone
row starting at 1, including multi-digit columns. The sequential alphabetic border
column is recognized separately, continuing beyond D and Z (AA, AB, ...).
Both strips require measured alignment and unowned sheet text; there is no fixed
35 mm body cutoff or fixed count of zones.
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
A measured annotation leader can also connect a plate to its own visible
conducting stroke. The path must start by the plate, end on the owned stroke
and clear other conductors. Distances are from ink
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
| 07  | Native full repeats, direct coil/contact mirrors and reciprocal returns; measured destinations/locality and occurrence/seed reconciliation.                                     |
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
`data-tag-kind` (`body`, `reference` or `legend`) and `data-tag-block` can satisfy fields.
Rows must have valid body ownership or reference semantics. Expected values come
independently from IR; sheet-wide text and SVG titles do not supply evidence.
Wrapped rows stay within their owned field/block. Parts retain every literal
character. Source-span rows must cover the independent IR value contiguously;
only trailing whitespace in each span may be unpainted. Legacy rows without spans
may consume exactly one authored space at a boundary, or no space.
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

Checker 4.7 retains the 4.5 exception for rooted power/control views only: exactly one
complete `data-tag-kind="legend"` entry with an explicit `data-tag-key` equal to the
IR designation may satisfy a body appearance when that same sheet paints the
exact owned body designation key. The local key is `body` metadata with
`data-tag-key`, not a second multiline tag, and retains the ordinary 2.5 mm primary floor. A missing, hidden, wrong-owner or wrong
key, a key on another sheet, or a duplicate legend entry is rejected. Reference
annotations still cannot satisfy a body, and other drawing families retain in-place
tags. Every row carrying `data-tag-field` uses the primary floor: 2.7 mm for a
designation and 2.5 mm otherwise, regardless of circuit relations or tag kind.

Checker 4.7 accepts a complete reference entry only with an exact same-sheet
owned qualified annotation key, resolved against IR. `data-device-legend-entry` (also exported on reference entries)
declares the entry and `data-tag-key` carries that qualified identity; the entry's
designation row still prints the authored designation. Missing, foreign, hidden,
other-sheet and duplicate keys fail. Complete entries are counted per UID per sheet
across every frame and end block, including hidden declared duplicates and entries
with different qualified keys. Dual markers on one physical entry count once.
Rooted references share the body legend frame under “Referenced devices”; cable
pages repeat blocks under their end headings. Each UID goes in the first end block
(A, then B) that references it; the other end resolves to that entry. Empty end
blocks are omitted. A UID with a local body cannot use
a reference entry. Reference metadata never exports `data-device-uid`.

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

DQ-06 accepts plain filled text only when its effective colour alpha, including
`fill-opacity` and all ancestor opacities, is at least 0.2. Checker 5.11 also
requires a **3:1 sRGB luminance contrast** at a majority of sampled actual glyph
ink points against the paint stack beneath it (white sheet by default). White
lettering on a dark band can pass; pale lettering and black on black cannot.
Native fill/stroke hit tests honour geometry, transforms and rectangular clips.
Glyph masks distinguish overprinted text from empty parts of its bounding box;
wide strokes, later text, images and foreignObjects can cover a row. Images and
foreignObjects use their full bounding boxes conservatively. Non-plain fills,
unknown backgrounds and any filter on a row or ancestor fail closed. This is a
conservative lettering predicate, not a general SVG compositor or accessibility
certification. The size floor is vertical: it retains the 0.03 mm tolerance and
existing 2.5/2.7 mm primary and 2.3 mm reference thresholds. Per the E4 helm ruling,
the effective horizontal factor must be in **[1/1.10, 1.0]**: compression within
standing policy is allowed; stretching is not. The factor multiplies the x/y
screen-CTM transform ratio (isotropic CSS pixels, without viewport rounding)
by the adjusted SVG advance divided by a native SVG advance
measured in the same resolved face with `textLength` removed. Embedded faces and
host fallbacks both use the actual face in use. A **1e-6** dimensionless allowance
covers the browser's float projections; 0.909 still fails, while 0.9091 and the
renderer's 0.91 pass. This does not apply a 2.5 mm floor to horizontal width. DQ-06 changes do not alter the separate
legacy review-paint or conductor predicates.

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
plus full core ID; a jumper's designation, or `JUMPER` with the reciprocal continuation reference.
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
positioned `tspan` runs. Direct PDF uses PDF.js extraction with native painted
glyph bounds to locate runs by cell. PDF line edges ignore extraction whitespace.
A whitespace-only fragment can supply a separator between painted runs on the
same baseline. Fragments on one baseline count as one line within the existing
0.170 mm geometry uncertainty. Separate complete list members can occupy
separate lines. A single source identifier spanning lines produces
`identifier-line-break`. Lost, changed or elided characters produce
`identifier-text-mismatch`. Missing cell geometry or unmeasurable identity is
an infrastructure error. Each medium is assessed separately. DQ-21's font
comparison remains independent.
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
  --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --baseline evals/out/draw/C1-previous/summary.json.gz \
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
Historical full baselines accept capture formats `thermite-draw-eval/1.0` and
`thermite-draw-eval/1.1` and may have older compatible checkers. Their raw bytes,
registry and full report are validated, including their own bundle when present.
The active report requires capture format `thermite-draw-eval/1.1`.
They are stored observations, not permission to run a stale target checker.
After this hardening change merges, the checker bundle hash matches no existing
C1, so a re-pin needs a fresh C1 target. Existing C1s can still be compatible
baselines, but a baseline without source pins cannot supply `notMove` crops.

The summary reader supports the historical **5.3** schema by reading only absent
`not-applicable` and `not-measured` counters as zero in memory. Reassessment must
still agree: an omitted nonzero counter refuses. Supported 4.1–5.2 and 5.4–5.16
summaries require every counter exactly; unknown versions refuse. Historical report bytes,
hashes and source pins are never rewritten or supplied by the target report.
Run the real-report acceptance and in-memory negative controls with:

```sh
bun evals/draw/report-preparation.check.mjs \
  --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --baseline evals/out/draw/C1-repin202/summary.json
```

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
  --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --baseline evals/out/draw/C1-previous/summary.json.gz \
  --decisions evals/out/D1-decisions.json \
  --samples evals/out/draw-samples/review \
  --index evals/out/review/crop-index.json \
  --output evals/out/review/decisions.unsigned.json
bun evals/draw/repin-bind-crops.mjs \
  --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --baseline evals/out/draw/C1-previous/summary.json.gz \
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
bun evals/draw/pdf-evidence.check.mjs --report evals/out/draw/C1-current/summary.json.gz \
  --output evals/out/pdf-evidence.json
bun evals/draw/pdf-repeat-capture.check.mjs --report evals/out/draw/C1-current/summary.json.gz \
  --output evals/out/pdf-repeats.json
bun evals/draw/pdf-swaps.check.mjs --report evals/out/draw/C1-current/summary.json.gz \
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
bun evals/draw/bind-audit.mjs --report evals/out/draw/C1-current/summary.json.gz \
  --output evals/out/fresh-bind-audit.json
bun evals/draw/crop-swaps.check.mjs --report evals/out/draw/C1-current/summary.json.gz \
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
bun evals/draw/repeat-capture.mjs --report evals/out/draw/C1-current/summary.json.gz \
  --output evals/out/repeat-capture.json
bun evals/draw/repeat-capture.mjs --report evals/out/draw/C1-current/summary.json.gz \
  --output evals/out/repeat-candidate.json --baseline \
  --browser-arg=--disable-gpu-rasterization --require-identical
```

### Paired raster gate without GPU rasterization

For a move-only checker change, compare each report's own pinned source artifacts
with [paired-raster.mjs](paired-raster.mjs). Both inputs must be strict reports.
Every declared PNG crop and reference crop must have the same path, physical
sheet, medium and exact crop box on both sides; missing, extra and empty region
inventories fail. Each side of each region uses a fresh browser launch and print
context, device scale 300/96 and the fonts-ready barrier. SVG/HTML use the explicit
`--disable-gpu-rasterization` argument. PDF regions use the pinned PDF with the
existing pdf.js 300 dpi renderer, recorded separately as `backend: "pdf.js"`.

```sh
bun evals/draw/paired-raster.mjs --base evals/out/draw/base/summary.json.gz \
  --head evals/out/draw/head/summary.json.gz --output evals/out/paired-raster.json
```

The paired GPU-disabled run passes a region immediately when its PNG bytes are
identical. Every differing region receives **N fresh-launch base self-samples**,
default **10**, configurable with `--samples N`; values below 10 are refused.
The head passes if its bytes match a sampled base variant, or if **both** its
changed-pixel count and maximum RGBA channel delta from the original paired base
reference are no greater than the corresponding **maximum pairwise distances
among the N base self-samples**. The two maxima may come from different pairs.
There is no global tolerance, percentile or cross-region pooling. Identical base
samples give a zero envelope; a differing head outside it fails.

Byte identity alone is insufficient: the [RASTER-GATE r1 probe](paired-raster-probe.json)
recorded **350 fresh-launch samples** (five regions × ten launches × seven
configurations) from the unchanged base source. Residual variants remained with
GPU raster disabled, software compositing, one raster thread and baseline Skia.
The adaptive self-envelope follows the RASTER-GATE r1 helm ruling for #307.

The separate `thermite-draw-paired-raster/1.1` result keeps literal `byteIdentical`
and adds `pass`; the CLI succeeds only when every region passes. Each region
records mode, browser, arguments, actual self-sample **N**, base variant count,
pairwise envelope, head distance and verdict, plus source/PNG hashes and the
sample/pair distance matrix. On the immediate identity path, N is 0 and the one
paired base variant is reported; otherwise the variant count describes the N
self-samples. A mode, browser, context, dimensions or base-source mismatch fails.
The initial paired base remains the head-distance reference. Input evidence PNGs
are never replaced.

```sh
bun evals/draw/paired-raster.mjs --base evals/out/draw/base/summary.json.gz \
  --head evals/out/draw/head/summary.json.gz --output evals/out/paired-raster.json \
  --samples 10
```

Use this with identical observations, crop inventories/boxes and renderer
artifacts for move-only checker changes. For changes to the raster path itself
it is one control alongside the per-file default-mode repeat envelope. It does
not establish default-mode pixel identity.

Default capture arguments, evidence, bind limits and signed records remain
unchanged. This additional gate protocol leaves `EVALS_VERSION` at **5.14**:
existing measurements, statuses and report fields do not change; added checker
module hashes are checker provenance. GPU-disabled capture remains unsuitable
as the published default, for the record #61 compatibility reason below.

`measureSheet` uses browser-only [measurement helpers](measurement/prepare.mjs).
`sheetMeasurementSource()` serializes their declared dependencies explicitly;
`evaluateSheetGeometry(page, options)` runs that callable in the page. Initialization,
mutable row state and DOM measurement order are retained. Screenshot functions and
crop arithmetic are unchanged; this extraction also leaves checker 5.14 unchanged.

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
bun evals/draw/crop-audit.mjs --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --output evals/out/crop-audit.json --passes 2
bun evals/draw/crop-swaps.check.mjs --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --output evals/out/crop-swaps.json
bun evals/draw/repin-pipeline.check.mjs --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --output evals/out/pipeline-acceptance.json
bun evals/draw/repin-pipeline.check.mjs --capture \
  --report evals/out/draw/C1-consolidated-before/summary.json.gz \
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
  --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --baseline evals/out/draw/C1-previous/summary.json.gz \
  --decisions evals/out/D1-decisions.json \
  --preview evals/out/consolidated-expectations.mjs
# Review that exact file and the printed projected statuses, then repeat with:
bun evals/draw/repin.mjs \
  --report evals/out/draw/C1-consolidated-before/summary.json.gz \
  --baseline evals/out/draw/C1-previous/summary.json.gz \
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
The applied chain is **92 → 61 → 84 → 154 → 202 → 334 → 381 → 408 → 421 → 454 → TEXTM1**.
The [TEXTM1 record](repins/TEXTM1/record.json) retains seven agent-reviewed
envelope updates for measured drawing utilisation and short jogs.
Numeric records use the issue or re-pin number. D1 uses **92** and merged as
PR 104. A named lane uses the same uppercase identifier in its directory,
record, pin and signed decisions. `record.json` binds the base commit, original uncompressed signed/receipt/index
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
Original input hashes must match every on-disk file, including non-retained ones.
Fill in the issue number or signed lane identifier, pre-apply base and evidence
paths:

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
