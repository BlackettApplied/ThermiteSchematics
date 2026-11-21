# View requests and printable packets

This reference extracts the printable format contract and the render package's
semantic-selection rules. `thermite` means the launcher from the project guide.

To issue multiple formats from a shared compile and verify them at handoff, see
[export a delivery](project-workflows.md#export-a-delivery).

## Intents and roots

| CLI intent | Required root and behavior |
| --- | --- |
| `--power` | A mapped load with a path to a mapped power source; each phase is separate. The motor-starter fixture uses M1. A DC supply's AC input load can root when its authored feed reaches a power source. |
| `--actuation` | One mapped two-terminal coil; searches through mapped control contacts to an output/positive source and return, or a compatible pair of transformer-secondary terminals. The motor-starter fixture uses K1. |
| `--loads` | One mapped DC control source and its source/return pair; shows complete mapped loads on those nets. The starter uses PS1. |
| `--conductors` | An exact cable; the cabinets template uses CBL1. Retains all physical type cores and spare assignments. |
| `--to <device>` | A mapped two-wire contact sensor or three-wire sensor root and a distinct target with a reachable mapped input. `--include-power` adds only the declared supply arms. |

Bindings use the [profile catalog](circuit-views.md#library-symbols) and authored
function shapes. A function never joins nets. A profile alone cannot make an
invalid or disconnected root acceptable. Loads views support multiple direct loads
and looped supplies; placement and routing use a bounded, validated ELK search.
Trace and loads traverse conductors;
control/power may select supported function steps for presentation only.

Rooted three-phase power drawings read L1, L2, L3, PE from top to bottom in
`left-to-right` flow and from left to right in `top-to-bottom` flow. The same
lane order applies at both ends of breaker, contactor and overload poles and at
the motor's U, V, W, PE terminals. Unbonded symbols retain only their authored
terminals. This convention moves symbol geometry and conductor landings together;
terminal identities, physical connections and electrical net IDs do not change.
Single-pole and asymmetric control symbols keep their clockwise orientation.

Rooted drawings print one owned terminal caption per physical terminal per
drawn symbol appearance. When several ports land on that terminal, the caption
uses the existing slot nearest the device body; ties use catalog port order,
then port ID. All conductor landings, ports, label reservations and ELK routes
remain intact. Only redundant caption ink is suppressed. Separate drawn
appearances, including splits and continuations, each keep their own caption.
Semantic net labels keep their different meaning even when their spelling equals
a terminal identity; they must still clear other text and terminal markers.

Rooted power and control drawings in both flows carry a thin-framed **Devices on
this sheet** legend, including continuous SVG. Each local body keeps its exact
owned designation as a key to one complete legend entry per device UID per sheet:
bold designation at 2.7 mm em, instance description (otherwise type description),
and exact authored catalog part at 2.5 mm em. Absent optional fields add no row;
no rating is inferred. Measured tags wrap without shrinking or truncating text. Columns have a 50 mm cap; a second column is allowed.

After trimming, folding and stacking, placement prefers top-right, then bottom-right
above the title block, then other free space in deterministic sheet order. The
frame stays at least 3 mm from all drawing ink, including location borders, notices,
captions, cards and gangs, and never crosses a location border. If no free region
fits, legal strip repacking or recutting protected gaps can reserve a band at the
unchanged print scale and within the existing page-cost and recovery limits.
This reuses the selected drawing without new ELK or routing attempts. An impossible
complete legend returns R006 with the constraining entry/field, the required
dimensions versus the largest tried free rectangle (or the column capacity),
and a remedy. A single entry larger than the drawing area names that device and
field with its size versus the whole drawing area; a fully blocked sheet reports
zero free capacity. The maximal-rectangle search retains at most 64 pockets and
uses a linear conservative pass above 512 obstacles, so reported capacity never
overstates free space. Bound exhaustion names the final sheet's required devices,
the packet page limit and a remedy. Compound geometry, routes, electrical identity, recovery budgets and
utilisation accounting do not change.

Rail-only devices appear under **Referenced devices** in that same frame, once
per UID without a local body. Their keys are exact, owned, painted terminal
identities such as `Off-view at PS1.-`; a reference never substitutes for a body.
Cable core pages keep exact endpoint captions such as `TB1.2` and `JB1.X1.1`,
with complete **Referenced devices** blocks under the end-A/end-B headings. Each
UID appears once per sheet, in the first referencing end block (A, then B); the
other end resolves to that entry, and empty end blocks are omitted.
Each page repeats its local blocks. Pagination reserves the prospective endpoint
set before accepting a core row, so the row and its blocks fit together. These
annotations add no device symbols, inferred connector faces, coverage or terminals.

Rooted actuation views retain equal-shortest paths to the chosen boundary; longer
parallel branches can remain outside the view. Success does not promise complete
rungs. At each drawn terminal with authored conductors
outside the selected view, a nearby light, unfilled card reads **Off-view at D.T**
and lists each conductor identity and opposite endpoint, for example `W5 → H1.X1`.
The arrow identifies the authored opposite endpoint; it makes no current-direction,
logic, potential or function claim. A card has no conductor stub or reference leader.
It does not add the omitted device or function to the drawing.

Every rooted sheet, including continuations and views with no cards, carries a
**SELECTED PATH VIEW** notice above the drawing. Cable inventories use
**SELECTED CABLE VIEW**. Both say: “Other authored connections may be outside this
view. See circuit views or packet coverage.” Success proves neither complete rung
coverage nor operation. Use explicit circuit/wiring selections and packet coverage
within its documented scope.

Cards use direct authored wire, jumper and cable-core endpoints, not other terminals
on the same net. Conductors drawn elsewhere in the same logical view are not
reported again; a conductor drawn in another packet view still needs local
disclosure. Terminal-context references do not count as conductors. Assigned spare
cores count at their terminated ends; a loose far end reads `unterminated (spare)`.
Both-loose and unassigned cores add no terminal incidence. Jumpers without a
designation use `jumper:<uuid>`.

A same-terminal context association prints its explicit “reference, no wire”
caption and two short leaders. These are local reference ink reserved before
layout, not an invisible full-length routed edge or an authored conductor. The
leaders attach to the real terminal/common point and clear unrelated ink by at
least 1 mm. This does not disclose a complete rung or promise a one-sheet view.

Card space is reserved before layout, and cuts keep each terminal with its card.
The full text wraps at 3 mm em and 4 mm line pitch without truncation, clipping
or shrinking. Nearby card placements and safe sheet cuts are evaluated before a
refusal. Cards can add pages; a packet exceeding twice the sheet count of the same
geometry without disclosures also refuses with R006. The message names the
terminal, conductor IDs and binding constraint. Use a larger sheet or landscape.
Empty enclosure-only cells are removed before output, with continuation destinations
renumbered. A remaining drawing page without a device, terminal or card is refused;
conductors are never dropped to remove a tail. The original placement is retained
when its print guards and route-quality checks pass and it uses no more sheets
than the same view without cards. The 2× packet bound is a refusal limit.
Stacked cards follow displayed terminal order, with the nearest valid positions
preferred.

In rooted **power** views, authored gangs of at least two independently drawn
power-switching poles must paint every link between those poles. The closed
breaker, disconnector and overload pole marks identify those roles. Mapped
`power-contact` functions also require gang ink, including NO/NC contact and
switch marks; an unsupported anchor refuses rather than exempting the group.
No shared vocabulary for power terminal roles is required: libraries use
`power_input`/`power_output`, `line`/`load`, `power` and `passive`.
A contact is exempt only when **every**
terminal explicitly has a control role (`aux`, `auxiliary` or `control`). Generic
`common`/`no_contact`/`nc_contact` roles describe topology and do not exempt a power
mapping; changeover halves with control mappings remain optional. Missing,
unknown or mixed roles on a mapped power contact remain mandatory: refusing an
ambiguous drawing is safer than silently
losing an authored mechanical association. Classification uses no designation or
caption text. This policy checks admitted mappings; it does not grant unsupported
profiles new power-family bindings. Cards reserve a finite band inside their
prospective owner box, contained in the device group, before ELK runs; final
checks use actual member
spans. A missing anchor, misalignment or collision refuses with R006 naming the
device and group. Other gangs, including aux/control contacts, pushbutton blocks
and changeover halves, paint only supported, aligned, unobstructed links. They
otherwise render without a link or R006; their shared designation retains the
relationship. A lone drawn member establishes no link to an omitted member,
and no gang is inferred for unassociated poles.

The [synthetic connection inventory](../examples/off-view-connections/source.json)
and its [packet request](../examples/off-view-connections/packet.json) exercise an
in-use cable core, a terminated spare and an undesignated jumper. Its omitted
connections are checked independently against the authored JSON in the render tests.

Invalid authored text retains R005. Off-view cards and notices do not change W906,
coverage accounting or `packet --strict` behavior.

### Bounded DOL selection

The [synthetic P6 probe](../packages/render/test/off-view-fixtures.ts) puts its
seal-in branch on a longer path. In both flows, K1 selects only `W30`, `W32`,
`W33`, `W34`, `W36` and `W41`; `R1.contact14`, `R1.coil` and `H1.lamp` remain
outside the view. Four off-view cards list six omitted direct connections at
drawn terminals. The cards disclose omissions without completing the rung.

In the [saved DOL fixture](../packages/core-library/test/fixtures/dol-starter/source.json),
K1's view shows `R1.A1` as `coil outside view`; `R1.contact14` is selected and `R1.coil`
is not. A terminal-only context has empty function references and gives no
audited function appearance.

Use [explicit circuit selections](circuit-views.md#request) and
[packet coverage](circuit-views.md#packet-coverage-inventory) to audit a broader
inventory; multiple rooted views remain outside the circuit/wiring audit.

### Rooted request formats

`schematic-view-request/0.1` uses `root`, `family` (`power` or `control`) and
`flow`. On the motor-starter fixture:

```json
{
  "format": "schematic-view-request/0.1",
  "root": { "by": "designation", "value": "K1" },
  "family": "control",
  "flow": "left-to-right"
}
```

`schematic-view-request/0.2` uses `intent` with kind `loads`, `conductors` or
`trace`; trace also has `to` and optional `includePower`. Root and target selectors
use exact `uid` or `designation`. Flow is `left-to-right` or `top-to-bottom`.
For the starter:

```json
{
  "format": "schematic-packet-request/0.1",
  "views": [{
    "format": "schematic-view-request/0.2",
    "root": { "by": "designation", "value": "PS1" },
    "intent": { "kind": "loads" },
    "flow": "left-to-right"
  }],
  "index": true
}
```

Save that packet as `packet.json` and run:

```sh
thermite packet --project . --input packet.json -o drawings/packet.html
thermite view PS1 --loads --project . --paper a3 --orientation landscape --margin 10 --layout compact -o drawings/loads.pdf
```

R001 reports invalid view requests or unsupported roots. An unresolved valid
selector is Q001; incomplete selected paths can produce R002. R006 means the
requested printable projection cannot be produced safely, including unsupported
circuit mappings or an unsafe fit. Read the diagnostic; change selection, flow,
paper or correct unsupported presentation metadata from known facts. Never add
or remove electrical connections to obtain a drawing. [Function circuits](circuit-views.md)
select actual functions and conductors explicitly.

## Paper and packets

`project-presentation/0.2` adds an optional `page` object. The loader also accepts
0.1 and [0.3 for compact frames](drawing-frames.md). Omitted page settings resolve
to Tabloid landscape with a 10 mm margin.

```json
{
  "format": "project-presentation/0.2",
  "revision": "A",
  "backgroundColor": "#ffffff",
  "page": { "size": "tabloid", "orientation": "landscape", "marginMm": 10 },
  "titleBlock": { "lines": ["Machine 01"] }
}
```

Sizes are `letter`, `tabloid`, `a4`, and `a3`; orientation is `landscape` or
`portrait`; margins range from 5 to 25 mm. Physical SVG dimensions use mm.
Printable output uses a white drawing sheet for print legibility. The continuous
POC SVG renderer retains its presentation background behavior.

`schematic-packet-request/0.1` contains `views` (1–40 requests). Version 0.2
also accepts [packet title data](drawing-frames.md#packet-metadata). The accepted
request formats are `schematic-view-request/0.1`, `schematic-view-request/0.2`,
`documentation-view-request/0.1`, `communication-view-request/0.1`,
`connector-assembly-view-request/0.1`, `signal-loop-view-request/0.1`,
`wiring-view-request/0.1` and `circuit-view-request/0.1`.
Shared options are `page`, `layout` (`standard` or `compact`), boolean `index`,
and `references`: either `false` or an object with optional `filter` and
`appearances` (`all` or `drawings`). Reference options require `index: true`;
see [reference selection](report-filtering.md#packet-reference-options).
Individual views cannot change paper size.
The renderer caps a packet at 100 sheets. The result `schematic-packet/0.1`
contains normalized `page`, ordered `sheets`, and self-contained `html`.
The `html` field includes the embedded print fonts and is byte-for-byte the
same document as the standalone `.html` export for the same request.
Each sheet includes its SVG, normalized view, number, and continuation records
with the matching destination sheet, conductor label, and electrical net ID.
Rooted continuation labels print a generated connector reference and the peer's
final `sheet.zone`, followed by the complete printed conductor identity, for
example `C017 / 03.C1` and `PE-SRC-M1`. Both ends name the other connector,
including when folded sections share one physical sheet. Sheet numbers and zones
are resolved after folding, empty-cell omission and packet composition.

A wire uses its authored `properties.label` when present, otherwise its
`designation`; cable cores use `cable.core`, and designated jumpers use their
designation. An undesignated jumper prints `JUMPER` beside its reciprocal
continuation reference. Its UID remains in source-element provenance.
Continuation metadata retains `conductor` as that printed identity and adds
`designation` when authored, `toZone`, source-element `provenance` and reciprocal
`end` (0 or 1). Existing request and packet format versions are unchanged.

Every continuation row and cable usage label prints at least 2.5 mm em.
A conductor identity is one indivisible line: separators, combining characters
and Unicode text are retained without clipping, abbreviation, compression or
shrinking. A bank uses one form throughout: inline (`C017 / 03.C1 / PE-SRC-M1`)
or a header followed by the complete identity. Descriptors may occupy separate
semantic lines. Each crossed block reserves its own natural identity width;
uncut identities do not enlarge unrelated banks. The planner tries measured
banks and existing legal cuts/folds before adding pages or returning R006.
Label banks retain 3.5 mm row pitch, a 2.5 mm inter-block gap, and checks
against fixed captions and the actual zone glyph reservations.
Within a bank, bounded text placement preserves connector order and leaves
conductor routes and anchors intact. Only conductors crossed by a candidate cut
need a printable continuation identity. If no candidate grid succeeds, R006 can
name a crossed conductor and its identity problem, with advice to avoid cutting
that conductor. Presentation-only boundary segments must stay whole. If a retry
that protects them is rejected for an authored conductor's identity or for
continuation label spacing, R006 leads with the retry's failure and also explains
the original boundary cut. `details.continuationIdentity` retains the original
boundary segment ID. `details.boundaryCutRetry` carries the retry's
`continuationIdentity` or its `conductorIds` and `continuationSpacing`
(`actualMm` and `minimumMm`). A protected width/height shortfall is carried in
the message and `details.pageConstraint` only when every continuation bank in
every tested layout falls short. The alternative with the smallest maximum width/height shortfall
supplies the measurements; any span-fitting bank or layout clears that claim.
If the ordinary top-to-bottom search has no printable annotated or no-card
grid and measures a top/bottom continuation clash or an oversized protected
span, the renderer can try one tighter ELK placement. For a continuation
clash, the affected routes and cut locate the compound whose layers can
move closer. Both layouts must pass pagination at the original scale. The
packet must also pass its final ink and navigation checks. A rejected placement
keeps the original R006. Each view that used the tighter placement produces an
informational I906. The note appears in drawing JSON and on stderr. For
`export bundle`, stderr and the manifest attach it to the producing job.
The ordinary no-candidate message uses the same
all-bank measurement. This diagnosis never rejects an
uncut identity before grid search. Other R006
messages explain a label or paging constraint;
use larger paper, landscape/another flow or a narrower selection. The labels
add no electrical connections or completeness claims. W906 and strict packet
behavior remain unchanged.

Packet failures add `details.views` with the zero-based authored `viewIndex` and
view title. A single-view failure also has `details.viewIndex` and
`details.viewTitle`; a compact sheet shared by multiple views retains them all.
Request-wide failures such as invalid shared page settings have no view index.
R002/R003 identify devices and functions. In rooted control, power, trace and
loads views, R003 `unrepresented-terminal` identifies an otherwise supported
intermediate terminal
without a selected display owner and its incident conductors. Its
`details.alternative` is a source-selected circuit view: place it in the `views`
array of a `schematic-packet-request/0.1` file and run
`thermite packet --input <file>`. R004 identifies conductors and endpoints;
failed multi-load routing, including exhausted bounded searches, names the loads
in `details.loads`. Build a circuit view from their `functionIds`, the source
function and authored connecting conductors, and wrap it in a packet as above.
Trace advice names only loads accepted as trace roots (such as B1), with a
connected input target supplied through `--to` and `--include-power`; PLC/RIO
supply loads receive only circuit advice. Stable
identity fields remain present; no connection change is implied.

A supported unselected two-terminal coil can contribute an intermediate input-path
terminal as context only. The mark says “coil outside view”; it does not select
that coil, its other terminal, return wire or parallel loads. Return paths, loads,
power and trace do not acquire this projection. See the
[bounded DOL example](#bounded-dol-selection).

Unsupported rooted or circuit profile/function shapes retain the existing R001–R006
classification and fields, with `details.reason: "unsupported-symbol-profile"`
(and `error.reason` only when it has no existing value), plus
profile, type, designation, family and function context in `unsupported`
(and compatibility companions in `details`). This object always names one device;
top-level identity fields retain their dev values. Mixed traversal stops keep the
incomplete-path message and stopped-terminal text, with an encountered profile
reported as `details.profileNote` rather than the sole cause. Trace connectivity
failures likewise retain their path message because physical leaves cannot prove
that a profile caused the disconnection. A real missing path still reports R002. Profile diagnosis runs only on actual failures.
Wrong-family/role roots use R001 `root-not-accepted`, with accepted profiles/shapes
and this device's root families. Choose another root or an offered family; when
none is offered, choose a different root device. Profile metadata never changes
connectivity.
Absent symbol metadata is an R001 eligibility failure for roots (`root-not-accepted`)
and input targets (`target-not-accepted`); choose another eligible device. A declared
unknown symbol or a shape that mismatches its own profile is instead an unsupported
profile. Missing bindings on a traversed path remain profile context for that path.
`acceptedRoots` always contains `{profile, aliases, shapes}` records, for every family.
R006 circuit failures name the involved source keys. In `details.circuitGroups`,
`functionKeys` retains each original selector value and function key (`<uid>/key`
for UID selectors). The parallel `functionDisplayKeys` resolves known device UIDs
to designations and otherwise retains the selector value, even with a custom view
title. Top-to-bottom rooted layout refusals suggest
`--layout compact` only after the complete compact export succeeds on the same
page, including sheet assembly and the packet page-cost bound.

`coverage.diagnostics`, when present, contains W906 for placed devices that have
no schematic appearance anywhere in a successful packet containing a drawing.
Reports-only packets are exempt; there is no opt-out field. Circuit, rooted and
other drawing families count, so topology-only drawings also establish scope.
Its `devices` inventory names each UID and designation, distinguishes `reports-only` from `absent`, and
lists report/index sheets. Every drawing family counts device-function and
device-symbol appearances, including ordinary endpoint symbols. Terminal-only
contexts, reports and indexes do not provide device coverage. Existing conductor
and function coverage retains its narrower scope. W906 is advisory and does not
certify complete wiring or readability. The `packet` CLI emits it on stderr with
compiler diagnostics and exits 0 for warnings, or 1 with `--strict`; info does not
fail strict mode. Individual `view` commands intentionally select partial views
and carry no W906 on stdout or stderr. `--strict` is a packet option: warning
failures report diagnostics with `error: null` and write no output. Such
warnings-only strict failures are outside the six agent tools' non-zero-explanation
invariant; pre-dispatch CLI usage errors with plain-text stderr are outside it too.


Circuit sheets use ELK's validated diagram, preserving its geometry. Cuts avoid
devices, rails, symbol/terminal labels, junctions, and routing bends. All printed
text uses at least 2.5 mm vertical physical em in SVG, HTML and PDF, including
symbol legends, secondary references, boundary/contact/relation captions, frame
furniture, zones, notes, footers and the version stamp. Device designation tags
retain their 2.7 mm floor. The separate ISO cap-height policy is unchanged. Repeated SVG IDs are namespaced
per sheet without changing electrical metadata. An unprintable arrangement returns R006 rather
than clipping a device, overlapping a continuation label, or silently omitting
content. Change flow, page size, or the selected view to resolve it.

Circuit, wiring, signal-loop (ordinary and series), communication and connector
assembly drawings print source-backed device tags in this order: bold designation,
instance description (otherwise nonblank type description), then catalog order
number. Absent optional fields and location rows are omitted. Description and part
are independent; neither replaces the other. Tags use dark ink on a light
background, with at least 2.7 mm designation em and 2.5 mm other-field em after
packet scaling. Descriptions wrap at words, then after retained separators, then
graphemes; parts prefer retained separators. Wrapping preserves every character
without inserting punctuation or spaces. Headers and terminal origins are reserved before
ELK; split parts repeat complete tags for their local devices. A tag and its owner
that cannot fit at readable size produce R006; use larger paper or a narrower
selection. No device rating is inferred.

Signal-loop selected-channel captions use the authored I/O address, or the shared
AI/AO/DI/DO vocabulary only when explicit terminal roles establish the class.
Otherwise `IN`/`OUT` states only the authored direction. The current schema has no
separate channel signal/interface-class field; free-text signal labels, type names,
keys, addresses and ratings do not establish a class. Conflicting class/direction
roles also use `IN`/`OUT`. Internal keys remain in metadata and never supply an
address, range or rating.

`renderSchematicSheets` and `renderSchematicPacket` are exported by the render
package. `renderSchematic` and agent `create-view` retain continuous SVG for legacy
sources. Annotated cables return the complete core sheet, including spare cores.
An annotated cable that needs multiple sheets returns R006; use the Thermite
view/packet commands to retain its complete inventory. HTML is an SVG container, not a rasterization.

## Compact sheets and references

Standard selects standard spacing; it may fold validated strips onto fewer
sheets. After layout selection, a top-to-bottom view may also place its existing
vertical strips side by side, in order, using one deterministic alternative.
The renderer compares this with the original using the same route, page,
locality and utilisation order. It adds no ELK runs, cuts or placement choices.
Every constituent must contain a device, terminal or card; merging cannot hide
a blank or conductor-only strip. Failed final ink, peer or page-cost checks
retain the original. Empty grid rows may already have been omitted; composition
uses the retained viewports and their remapped peer references.
References use final physical sheet numbers and zones.
A top-to-bottom power view with a printed short interior jog may spend one remaining placement
attempt on extra turn space beside captioned poles or a source phase port.
Ordinary recovery runs first, holding one of the existing attempts for this
retry when its selected composition has a printed or clipped jog. Printed
fragments use the checker's >0.05 and <3 mm definition, with its 0.00001 mm
numerical conversion tolerance at the 3 mm boundary. The original stays
selected unless the retry passes page fit, gang and ink checks, reduces printed
jogs, preserves each conductor's raw and clipped defect budgets and card
locality, and uses no additional pages. Both economies preserve utilisation of
at least min(0.40, the original printed composition). There is no separate raw
wire-length-growth allowance; the existing per-conductor detour criterion is
2×Manhattan span +20 mm.
Source turns reserve an additional half layout unit (0.125 mm at the minimum
0.25 mm/unit print scale), rather than a serialization quantum. The complete
page guard also applies to this margin; failed retries retain the original.

After a complete printable packet exists, a left-to-right power view with a
jog in its final printed groups may try one recursive ELK network-simplex
placement. It retains the selected hierarchy, reservations, fixed ports, phase
order and labels. Ordinary recovery has priority: the alternative consumes a
remaining logical ELK request in the same 48-placement pool and a remaining
attempt in the four-attempt standard economy, with no additional recovery
search. Exact-input cache hits consume a request; the cache only saves execution
time. The cap applies only to left-to-right power searches. At any search
boundary, exhaustion discards the capped result and keeps the unchanged legacy
search result, without a power alternative. Top-to-bottom search and adapter
recovery are uncharged. The compact frame receipt separately bounds 52 candidate
layouts (three initial profiles, 48 placement proposals and one reference seed);
that is not a count of ELK requests or dispatches.
Exact ELK inputs share the circuit alternative's packet cache; recomposition
does not spend another routing pool. A view without a printed jog is unchanged.
Unchanged view drafts may be reused before assembly, keyed by their exact inputs
and routing selection. Each assembly receives a private copy; final sheet
measurement, navigation finalization and the whole-packet guard still run.
Identical legend-fitting and index previews may also reuse privately copied
measurements within the same search. Final notice/document finalization runs
fresh; every routing candidate still receives the whole-packet guard.
Compact-frame legacy and modern probes belong to one logical power view.
Reuse keys include the frame profile and authored title inputs; planning receipts are privately
replayed with their new view ordinals. Power alternatives keep the original
legacy field reference and its per-sheet scale, page and field-loss constraints.

The candidate must reduce jog-bearing conductors without increasing any
conductor's bends, raw or clipped defects, or unrepaired clipped length beyond
max(10 mm, 25%). Cable cores are compared individually. The final packet uses
the circuit alternative's original-reference guard: no packet or view growth,
lost annotation or card, local-to-self-located change, or increase in NAV's final
printed-ink locality distance. The existing 0.1 mm card comparison remains.
Top-to-bottom placement and source turns are unchanged; the existing retry and
its reservation share the printed trigger above.

The packet guard matches off-view cards by native terminal and conductor
identities within their issued view, independently of sheet numbering or titles.
Two self-located labels may retain absent distances as unchanged evidence;
absence never counts as closer. Local labels and return-owner comparisons still
require finite distance evidence. Originally aligned ports of one physical
device must stay aligned, with the other axis retaining its original order.

Compact additionally tries compact and dense spacing. Both modes
preserve flow, ELK routes and minimum text sizes. Complete ink bounds determine
strip extents; any partly painted location heading stays whole, while wholly
hidden headings follow the continued-location caption rule. Post-trim captions,
wrapped notices and final continuation ink are validated before acceptance;
unprintable compositions retain the conservative separate-page alternative.

Candidates prefer no new raw or physically clipped route defects per authored
conductor, then fewer physical sheets. For equal sheets, the first route-safe
printable reference guards each owner/terminal card against growth over 0.1 mm;
a card absent from that reference conservatively counts as a regression.
Physical sheet savings always take priority over that reference. The soft 15 mm
card-distance excess precedes utilisation and the deterministic tie key in
ranking; it never causes R006. Early exit shares the route/locality guards and
native-page limit, and uses neither soft excess nor utilisation.
The useful-utilisation boundary
remains exactly 0.40, without rounding across it.
Distance ordering uses 0.001 mm and utilisation 0.000001 precision with an exact
placement/grid/composition tie key. Standard economy search has four additional
placement attempts only after an emitter/ink/page-cost validated candidate
exists; ordinary recovery retains its existing budget. Exhaustion keeps the
validated candidate and does not declare the search settled.

Report cells describe absent native facts explicitly: terminal columns print
`No same-location connections` or `No other / unspecified location connections`,
and absent statuses print `Status not specified`. Known connections, protocols,
statuses and authored pin-map reasons keep their source text. I/O net endpoint
columns use `No connections`; missing usage uses `Not specified`.
Wire schedules always include endpoint `From sheet.zone` and `To sheet.zone`
columns. Locations resolve from the final native terminal landings; `not drawn`
means that endpoint has no drawn landing on any issued sheet. Narrow schedules
may place each location beneath its endpoint. See the
[navigation export contract](navigation-export-contract.md#wire-schedule-endpoint-locations).

Each sheet includes references identifying the visible device/function and its
A-D / 1-6 zone. Cable endpoints and schedule rows also contribute references.
`index: true` appends a final-sheet index and a device/function reference
section. The index includes its own pages and the reference pages; its device
column describes content sheets only. Graphical terminal strips list their
painted devices in the index. Device references list those locations under
`Terminal strip`, including in drawings-only references. Repeated titles are qualified by their
final sheet number, which is a destination rather than an authored-view identity.
Index capacity is reserved within the 100-sheet packet limit; a packet that
cannot close within that bound refuses. `references: false` omits the reference
section while keeping every issued sheet, including the index itself, indexed.
Reference locations belong to that generated packet, and can change
when the request, paper, source or renderer changes. Object UIDs persist; sheet
numbers and continuation labels are not permanent identifiers. Manual placement,
pinned page breaks and incremental layout stability are not implemented.

The HTML viewer searches sheet labels/device designations. The sheet selector
and conductor links reveal destinations even after filtering. Printing always
includes every sheet. The viewer has no server and makes no network requests.

## Diagnostic lookup

`thermite guide diagnostics <code>` serves the full E/W/I/R/Q/A/T/INIT catalog offline,
including lowercase input. The failing command's message gives instance details.
A/Q request and query errors are explained in [agent requests](agent-requests.md).

`R005` means render text failed preflight. Its owner, field and reason identify
an unpaired surrogate, an XML-illegal code point, a character forbidden in a
single-line field, or an empty or over-160-code-point project name. Device-owned
text includes its known designation and terminal, function or aggregate key in
`details`; conductor-owned text includes its designation and known endpoint
devices. Project, page and font failures identify their own scope without an
invented device designation. A `designation` field is absent when no designation
is known; a UID is never substituted for it. Correct the
identified authored text; do not bypass the check or edit generated SVG.

`T001` reports a caught CLI exception on stderr, normally with exit 2. In
`watch`, regeneration or polling failures report T001 and keep watching; the
message may embed E-code diagnostics. Commander usage failures can instead
print plain error/help text with exit 2. Expected renderer failures retain
R codes and exit 1. Initialization messages may include INIT000–INIT012
prefixes, also available through `thermite guide diagnostics <code>`.

The existing conductor-root distinction is intentional: `thermite view PS1
--conductors` returns Q002 because cable lookup found a device. Other rooted
mode/mapping mismatches use R001. Resolve an actual cable before selecting its
conductors.

A standalone SVG whose embedded font subset exceeds 60 KiB returns `R007`
(exit 1), including the required and allowed bytes; export `.html` or `.pdf`
instead. A packet HTML font block over 500 KiB returns `R007` for both `.html`
and `.json` exports. Export `.pdf` instead. The CLI writes no file on a refusal.
The individual sheet SVGs in packet JSON and the agent `create-view` SVG carry
font family names only.

Packet navigation resolves function locations after sheet composition. Locations
use the rounded centroid of each function's own visible terminals (0.01 mm,
then half-open zone classification). The device/function report uses the same
locations. A boundary context or a report row is not a full-function destination.

When selected views repeat a full function, the earliest authored view is the
canonical appearance; ties use final sheet and zone reading order. Local
`Repeat of ss.zone` and `Also shown ss.zone` labels retain every appearance's
connections and off-view disclosures. Repeated conductor drawings refer to one
source conductor; they do not add wires or join nets.

Navigation labels occupy measured vacant sheet space after legends and real
continuation blocks. Each slot reserves the larger of both possible roles and
the complete 1–100 sheet-token domain before canonical selection. Labels cannot
grow electrical leaves, change routing or shrink type. If bounded composition
cannot provide a clear slot, the packet returns R006.

Packet JSON adds `navigation` (`issued-navigation/0.1`): native selection seeds,
source UID/function occurrence identities, final anchors and transform/clip
provenance, repeat targets, fixed reservations, primitive locators and millimetre
page regions for SVG, HTML and PDF review. Canonical status and sheet numbers are
not occurrence identity. Circuit pagination's source-endpoint-owned boundary
copies remain separate from full repeats selected in independent views. A
logical circuit placement keeps its full occurrence with its first native
endpoint unit; other conductor-unit copies carry boundary provenance. This
ownership follows source endpoints when pages are repacked. These
locators support independent source/geometry checking; they do not establish
visible ink or electrical completeness by themselves. Contact mirrors and
companion inventory resolution are separate additions.

A device appearance gets one repeat label even when its functions use separate
glyphs (for example, gang poles). Group by device UID, selected view and sheet;
glyph identity is only a locator.
Its label lists each distinct target sheet.zone once, in reading order, using
exactly the per-function destinations in the reference report. Multiple repeated
functions use `(same functions)`; one contact uses `(same contact)`. The local
prefix is `TAG:`. Local slots are preferred: on the owner's sheet, at most 60 mm
from the distinct-terminal centroid of the whole device appearance, with its own
device frame strictly nearer than another device frame. Distances use the printed label ink box against the centroid/frame. The larger all-role envelope still protects fit and clearances; its blank capacity cannot establish locality. Otherwise the prefix is `TAG (ss.zone):`, where the
location is the whole appearance's distinct-terminal centroid, including drawn
functions that are not repeated and visible terminals of boundary fragments.
This self-location is measured from the final sheet; it is not one arbitrarily
chosen member function's zone.
Each mode reserves both roles; the self-located mode also reserves the prefix.
Frame ownership uses source UID, selected view and measured centroid, including
drawings whose device frames and function glyphs occupy sibling SVG layers. Device frames are resolved through nested SVG groups and intersected with the visible section clip. If an owner has no visible frame, its measured body box is the fallback.

For lane E, `snapshotDigest` is SHA-256 of the UTF-8 bytes of
`JSON.stringify(serializeIr(ir))`, including the JSON string quoting/escaping;
`serializeIr` is the compiler's canonical IR serialization, including its final
newline. This is a digest of a JSON-encoded string, not of the raw IR object or
unquoted serialization. `quantumMm: 0.01` uses `decimal-half-up/1`: decimal ties
round away from zero (`1.005` → `1.01`, `-1.005` → `-1.01`), using the shortest
decimal representation of the input number; round before zone classification.

Occurrence `pageRegions` are locator boxes, not ink evidence. Rooted regions
have `basis: catalog-box`, from the catalog `symbolSize`; circuit adapters expose
`adapter-box` bounds. Annotation regions are fixed `reservation-box` envelopes.
The appearance/logical keys are renderer layout locators. Establish completeness
independently from native IR selection and actual visible symbol/terminal ink
carrying `data-function-key` / `data-device-uid`, including transforms, clips and
occlusion; exported seeds, regions and roles cannot establish completeness.

Every reservation ID is unique packet-wide and names one full owner occurrence;
fragments claim no reservation. A grouped annotation lists its full
`ownerOccurrences`, while `ownerOccurrence` identifies the representative full
owner used for allocation. Its targets remain individual function occurrences.
`locality` records measured geometry and the prefix mode as locators for an
independent check; it does not confer a locality pass. An invariant refusal is
R006 with a `Navigation invariant:` message and `navigationInvariant` detail,
which does not enter layout-repartition retries.

The navigation incidence census retains endpoint ordinals, including both ends
of a same-terminal loop in defensive IR-level checks. The compiler rejects such
project loops with E024; the shared off-view producer retains one disclosure per
physical conductor at that terminal rather than printing a duplicate row.

Repeat envelopes are mode dependent. Allocation tries every local shape before
any self-located shape. Within each mode the order is the unwrapped maximum,
then 84, 70, 56, 42 and 28 mm text widths where narrower than that maximum and
wide enough for an indivisible word. Greedy word wrapping preserves sheet.zone
tokens and role breaks. Each shape reserves the widest 1–100 sheet/zone token,
pre-selection multiplicity, and both canonical and secondary roles (including
mixed groups). These dimensions never depend on the actual destination tokens.
Only post-pagination vacancy and locality select the mode and shape; selected
`shapeId`, envelope and maximum forms are exported with the reservation. If no
shape fits, normal fit refusal applies. This cannot create a token sizing cycle.
Whether a label exists, and its final membership, can depend on pagination and
full/fragment status. Its envelope uses
the native pre-pagination function candidates and multiplicities for that device
and selected view, including candidates that later become fragments. Pagination
never changes that capacity profile.

Repeat-label locality intentionally has no zone adjacency condition: same sheet,
≤60 mm from the appearance's terminal centroid and the owning device as nearest
frame suffice. The "in or next to the zone" condition belongs to NAV2 mirror
tables. Each Repeat heading's qualifier follows that heading's distinct source
functions, not the total group size.

Navigation text envelopes keep at least 4 mm horizontal clearance from other
text when their line bands overlap vertically, including continuation/location
headers and other navigation labels. Non-text ink retains 1.5 mm clearance.
Obstacles are intersected with their section's visible clip, including frames, cards and report cells; empty intersections reserve no space. Exhaustion evidence must independently scan rendered visible ink and count distinct geometries, not identical retries.
The allocator uses the protected maximum text envelopes; it never shrinks a
reservation to the current destination text.

Packet contact mirrors use only direct internal `actuates` relations from a coil
function to a contact on that same device UID. Tags, gangs, terminal numbers,
descriptions, transitive paths and device-level relations never create rows.
Each full coil gets every eligible authored contact, with its NO/NC state,
M1's shared terminal-set formatting and all full issued destinations. Exactly two terminals use an en dash unless their bare keys form a range-like pair: the same case-sensitive letter prefix (possibly empty) followed by integers differing by more than one. Thus `9 / 13`, `AI3 / AI7`, `L1 / L3` and `X2 / X5` are lists, while `13–14`, `A1–A2`, `H1–H2`, `X1–X2` and `L–N` retain the en dash. Prefixes are Unicode letters and integer suffixes are decimal digits; no element identity is inferred. A shared designation does not affect this parse. The strings actually printed, including any designation, must contain none of `-`, `–`, `−` or `+` for an en dash. Other sets use ` / `; if a printed name contains `/`, that list separator becomes `, `. Authored order is retained. A report
row, terminal context or boundary fragment is not a full destination: an absent
full target prints `not drawn`. Changeover contacts retain their separate NC/NO
functions and shared common. A coil-only device gets no mirror table. When its own device has contact functions but no eligible rows, the coil prints `Contact associations unspecified`, never a guessed count. A contact without a targeting
actuator gets `Actuating coil not specified in device data` only if its own
device contains a coil; non-coil actuation/tripping suppresses that note.
Drawings never print `not assessed`.

Each related contact returns every required coil destination as `K1 /02.C2`;
an undrawn coil is marked `not drawn`. Only an explicit native gang with equal
coil target sets and a visible mechanical association shares a caption. Its
owners are the visible native members on that issued sheet and selected view;
every split fragment has its own caption. Mirror rows remain individual. The renderer checks each return against all contact owners on the same sheet and records their measured centroid-to-caption distances in `returnLocality`; no distance threshold is adopted for returns.

The compact table is 55 mm wide, 25 mm high for four single-destination rows,
with 4.5 mm row pitch, 3.502 mm row em and 3.782 mm heading em (physical capital
heights at least 2.5/2.7 mm). Whole eight-row tables measure 55 × 43 mm; if tall
space is blocked, the same immutable candidate can try premeasured four-row
fragments, each repeating its heading, on the coil's sheet. All rows survive.
Long terminal identities enlarge a measured profile; multiple destinations wrap
only between whole tokens. Text never shrinks to fit.

Mirrors and returns use NAV1's fixed sheet-mm slot allocator after native scale,
continuations and legend measurement. Prefer the nearest legal beside, below or
below-right region around the actual coil frame, then vacant zone-column or
margin-band space inside the drawing field. Failed allocation enters the same
bounded composition search with unchanged envelopes, native routes and page
budgets; it never grows electrical leaves or feeds scale back into measurement.
The one packet notice, `Contact tables list device data; contacts not drawn in
this packet are marked.`, uses 2.7 mm note text and premeasured wrap profiles.
It is allocated after electrical composition and other navigation, across existing
packet sheets: first mirror sheets, then sheets with an off-view notice, other
drawings, and finally existing documentation pages. It cannot enter pagination
or scale selection. If no measured vacancy exists, the packet is refused rather
than adding a page. NAV owns this text alongside the existing off-view notice.
It protects every other annotation's full measured reservation and every report
cell, including blank space, rather than reusing unused text capacity.
Its reservation's source owner can be on another sheet; its printed location is
`allocatedMm.sheet`, including documentation-page fallback.

Mirror locality is measured from final geometry, independently of the chosen
placement family. Search, candidate ranking and the final self-check use the printed
heading glyphs, table rows and rule, including the actual destination tokens. The
maximum reservation still protects fit and clearances; its blank padding cannot
establish locality. A local table shares the coil's sheet, lies within 60 mm of
its own function-terminal centroid, intersects that zone or one of its eight
neighbours, and has the coil as its strictly nearest device frame (more than 0.02 mm nearer: the checker's 0.01 mm ambiguity band plus a 0.01 mm renderer/browser measurement budget). Circuit comparisons use
the measured per-function adapter frames, excluding bodies of the coil's own device; an absent enclosing rectangle never exempts foreign visible frames. Otherwise
its heading prints the coil's own `/ss.zone`; the renderer verifies that token
against the measured coil location. Same-sheet ownership remains mandatory.
Repeat labels keep NAV1's device-appearance anchor and have no zone-adjacency
condition.

The additive issued-navigation annotations now include `mirror`, `return`,
`association-unspecified` and `contact-notice` roles. Mirrors expose their coil,
row source/state/terminal sets, relation origins, individual full target IDs,
destinations and row primitive IDs. Returns expose every covered owner and
required coil target, native relation origins and optional authored `gangId`.
Reservations and page regions cover their fixed ink in SVG, HTML and PDF.
Mirror reservations also expose `allocatedMm.family` and
`familyRule: approach-or-outer-zone-row/1`. A legal local approach is classified
as `beside`, `below` or `below-right` from the measured coil frame and printed ink. The beside/below search preference uses that same ink, while fit and clearance retain the reservation.
Other placements wholly inside the top or bottom zone row are `margin-band`;
remaining vacant-column positions are `zone-column`. This family is independent
of local/self-located mode and never decides the heading. A failed slot reports
measured clear widths at the required height and clear heights at the required
width for all five families, using the same ink and text clearances.
These are DQ-07 locators: native source, byte-locked definitions and actual final
geometry remain the independent checker's oracle. One mirror-block observation
belongs to each full coil; one reciprocal observation belongs to each full
contact, including members of a shared caption. NAV2 does not implement the
evaluation predicate or add companion inventories.

### Hidden-detail companion inventories

A packet resolves its concrete hidden-detail notes against visible issued report
rows, with the same compiled-source snapshot and presentation revision. A report's
kind or title alone cannot satisfy a promise. Unknown revision remains
`UNSPECIFIED`. A sufficient requested document is reused first; otherwise the
resolver uses a sufficient union, preferring exact scope, smaller supersets and
authored order. Captions name the exact final row regions, for example
`[+2] other physical connections: wire inventory 12.B2 (PB1.12; W7, W8)`.
Each short inventory label is defined in that document's printed header.

Missing facts are unioned into the smallest native row selection, keeping both
endpoints and authored statuses. Non-strip terminal inventories use explicit
device identities. Automatic documents follow requested content and precede
indexes and function references. They have a separate origin; they do not rewrite
requested filters or consume fictitious positions in the 1–40 authored-view
request. Every issued page still counts toward the 100-sheet limit. A generated
inventory creates no further promises. Unprintable or insufficient closure,
unsupported facts, a cycle, caption capacity or the final page cap refuse the
whole packet with contextual R006. No source is repaired automatically.

Hidden physical-connection counts are endpoint incidences at each selected
appearance, including explicit jumpers and singly terminated cable cores.
Omitted-terminal counts instead subtract drawn terminal identities from the
native device terminal set. These units differ. Network inventories include the
scoped links and omitted/unconnected ports. Direct-loop companions retain native
core details and any incident relation-backed assembly pin-map status; unresolved
mapping stays unresolved. Tables describe source facts, not safety, suitability or
completeness of manufacturer data.

`renderSchematicSheets` accepts the same individual view discriminants as a packet.
A standalone view remains partial: its captions explicitly say that no companion
inventory is included. A generic selected-path warning promises no document.
The established notice reservation is retained so rewording does not change native
drawing transforms. Caption wrapping keeps sheet.zone, terminal, conductor and
port identity tokens indivisible, including authored spaces inside an identity.
Port captions use the same shared reader-facing formatter as their network row,
with its identity projection, for example `N01: B1`. Descriptions stay in the row
and never enter captions. The internal dotted port selector never prints.
Terminals retain `DEV.TERM`.

The allocator tries per-identity captions first. If none fits, a compact form
groups scoped native facts by destination row region and printed device, for
example `network inventory 13.A4 (N01: 5 ports)`. Counts exclude unrelated peer
facts and repeated resolution rows. Every named device is printed in the target
rows. Exact group row locators remain in the additive export. Only failure of
both forms causes caption-capacity R006; neither form changes native geometry.

The [navigation export contract](navigation-export-contract.md) defines the
M3 locators and row-region anchor. E3 uses them to locate ink and checks the
printed result against native source facts.

Opt-in presentation 0.3 uses the compact 6×4 frame. See [drawing frames](drawing-frames.md) for title fields, sheet keys, capacity and packet request 0.2.
