# View requests and printable packets

This reference extracts the printable format contract and the render package's
semantic-selection rules. `thermite` means the launcher from the project guide.

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
the original presentation format. Page settings are a backward-compatible
extension; omitted settings resolve to Tabloid landscape with a 10 mm margin.

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

`schematic-packet-request/0.1` contains `views` (1–40 requests). The accepted
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
Each sheet includes its SVG, normalized view, number, and continuation records
with the matching destination sheet, conductor label, and electrical net ID.
Rooted continuation labels print a generated connector reference and the peer's
final `sheet.zone`, followed by the complete printed conductor identity, for
example `C017 / 03.C1` and `PE-SRC-M1`. Both ends name the other connector,
including when folded sections share one physical sheet. Sheet numbers and zones
are resolved after folding, empty-cell omission and packet composition.

A wire uses its authored `properties.label` when present, otherwise its
`designation`; cable cores use `cable.core`, and designated jumpers use their
designation. An undesignated jumper is explicitly identified by its full authored
UID, preceded only by `JUMPER` and a space or row break. Net names, hashes, color
and size never substitute for these identities.
Continuation metadata retains `conductor` as that printed identity and adds
`designation` when authored, `toZone`, source-element `provenance` and reciprocal
`end` (0 or 1). Existing request and packet format versions are unchanged.

Every continuation row and cable usage label prints at least 2.5 mm em.
Measured label banks reserve natural text with 3.5 mm row pitch and 1 mm clear
ink. Complete IDs may wrap; they never clip, abbreviate, compress or shrink.
Wrapping prefers authored hyphens, dots, slashes and spaces, including UUID group
boundaries. Every separator and space is retained. An oversized segment splits
only between grapheme clusters, balancing the rows to avoid one- or two-character
orphans where a legal alternative fits. A measured longest-token bank is also
considered; a wider bank is accepted only through the existing sheet-fit checks.
Within a bank, bounded text placement preserves connector order and leaves
conductor routes and anchors intact. Only conductors crossed by a candidate cut
need a printable continuation identity. If no candidate grid succeeds, R006 names
the crossed conductor and its identity problem, with advice to avoid cutting that
conductor. A protected width/height shortfall is carried in the message and
`details.pageConstraint` only when every continuation bank in every tested layout
falls short. The alternative with the smallest maximum width/height shortfall
supplies the measurements; any span-fitting bank or layout clears that claim.
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
R006 circuit failures name the involved source keys. A top-to-bottom R006
suggests `--layout compact` only after a successful compact composition and
sheet assembly on the same page.

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
devices, rails, symbol/terminal labels, junctions, and routing bends. Primary circuit
text, including symbol legends, uses at least 2.5 mm em at printed scale; secondary
cross-reference and boundary captions use 2.3 mm em. Repeated SVG IDs are namespaced
per sheet without changing electrical metadata. An unprintable arrangement returns R006 rather
than clipping a device, overlapping a continuation label, or silently omitting
content. Change flow, page size, or the selected view to resolve it.

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
retain the original. Composition is also skipped when earlier pagination omitted
a strip: surviving drafts no longer map one-to-one to the original grid rows.
References use final physical sheet numbers and zones.
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

Each sheet includes references identifying the visible device/function and its
A-D / 1-6 zone. Cable endpoints and schedule rows also contribute references.
`index: true` appends an index of content sheets and a device/function reference
section. Reference locations belong to that generated packet, and can change
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
single-line field, or an empty or over-160-code-point project name. Correct the
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
instead. Packet HTML whose font block exceeds 500 KiB returns `R007`; export
`.pdf` instead. The CLI writes no file on either refusal. JSON and agent results
remain font-free.
