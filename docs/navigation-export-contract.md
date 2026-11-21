# Issued document navigation export, version 1

This is the M3 extension of optional `packet.navigation` (`issued-navigation/0.1`).
The extension is identified by `navigation.documentFormat: "issued-documents/1"`.
It is additive: packet/request discriminants and source/geometry identities remain
unchanged. An absent extension is a measurement gap, never an exemption from a
native-source obligation. [Rendering behavior](views.md#hidden-detail-companion-inventories)
is documented separately.

## Native identity and source binding

Every dependency and issued document carries `snapshotDigest`,
`presentationDigest` and `revision`. The snapshot digest uses the existing NAV1
convention: SHA-256 over `JSON.stringify(serializeIr(ir))`, with the compiler's
canonical serialized IR string. The presentation digest is SHA-256 over
`JSON.stringify(compiledPresentation ?? null)`. For compact frames, this is the
original compiled `project-presentation/0.3`, including its authored title
fields. Revision is the compiled authored revision, or exactly `UNSPECIFIED`
when absent. A checker independently loads and verifies the native snapshot and
presentation.

`dependencies[].id` is `dependency/1/` plus SHA-256 over
`JSON.stringify([owner.viewKey, owner.noteId])`. The view key uses NAV1's
UID-resolved selection and duplicate-request ordinal. Sheet numbers, zones,
caption text and tag spelling do not enter dependency identity. `owner.sheet`
is the final one-based sheet location. `owner.noteId` is a persistent adapter
source-note identity, not a browser-generated DOM ordinal:

- Wiring incidence: `wiring-incidence/` plus JSON `[deviceUid, terminalKey]`.
- Omitted terminals: `wiring-terminals/` plus device UID.
- Communication: `communication-status/` plus the navigation hash of the
  ordered source-device UIDs and selected native relation UIDs in that logical
  part. A changed partition may change the logical part's source scope.
- Direct loop: `loop-core-details` and, when applicable,
  `loop-assembly-pin-maps` within the resolved selected view.
- Connector assemblies: `assembly-reasons` on each native relation part, and
  `connector-port-status/` plus JSON `[deviceUid, portKey]` for ports drawn
  nowhere in the issued packet. A drawn port on another part has its own named
  sheet.zone pointer.

A duplicate source-note identity within one selected view refuses; it cannot
silently erase an obligation. Native assembly reason/status notes may recur on
different parts of that view. Their source-note id is shared and `owner.sheet`
distinguishes the occurrences; every occurrence retains its own required facts
and printed caption. Duplicates within one source part still refuse. Repeated independent requests retain separate view
keys. Inserting earlier content changes locations without changing a note's id.

## Export freshness receipts

The CLI's `export-input/1` fingerprint hashes raw bytes by logical path and
role. It covers the project manifest, resolved source and glob membership,
presentation, the lock, and resolved local and shipped library manifests and
sources. It records presentation and lock absence. Absolute filesystem paths
and timestamps are excluded. The separate producer binding identifies the
Thermite version and compiled build with its bundled assets. Existing issued
document snapshot and presentation digests retain their meanings.

An `export-manifest/1` binds the exact delivery request bytes and the list of
requested artifacts to one source and producer. An opted-in `export-receipt/1`
sidecar binds the effective options, artifact filename and exact file bytes to
its source and producer. Its name is the artifact filename plus `.receipt.json`. Both record named packet requests, report filters and
review baselines by project-relative path and byte hash. A report can include
its filter selection. A review binds its historical baseline as well as the
current source.

The checker reads the inventory from the delivery request. By default it
requires the bundle manifest. With `--receipts` it requires a sidecar beside
each planned file. Findings use `missing_manifest`, `missing_receipt`,
`missing_file`, `source_changed`, `request_changed`, `byte_mismatch`,
`producer_mismatch` and `unverifiable_input`.

These local hashes establish freshness against the declared inputs. Validate
the electrical project independently, inspect the issued drawings, and keep
approval with the responsible human reviewer. Screenshot evidence requires a
separate binding to the exact captured HTML and PNG bytes. See the
[delivery workflow](project-workflows.md#export-a-delivery).

## Typed facts and semantic columns

Each dependency has `need`, `requiredFacts`, `requiredColumns`, human-facing
`subject`, and a `count` for incidence/terminal omissions. Facts are objects with
exact fields; unknown kinds, extra fields, duplicated identities, foreign source
facts, incomplete semantic columns and inconsistent counts refuse. No producer
may insert an electrical fact absent from the compiled source.

| Need / fact kind | Typed fields besides `kind` | Required semantic columns |
| --- | --- | --- |
| `conductor-incidence` | `element`, `end`, `terminal` | identity, endpoints, status |
| `terminal-inventory` | `terminal` | identity, connections, status |
| `port-link-status` | `deviceUid`, `portKey` | identity, endpoints, protocol, status |
| `connector-port-status` | `deviceUid`, `portKey` | identity, endpoints, status |
| `core-inventory` | `cableUid`, `conductorId` | identity, endpoints, status |
| `assembly-pin-map` | `relationUid` | identity, endpoints, status, pin-map |

`terminal` is exactly `{deviceUid, terminalKey}`. `element` is native
`{kind: "wire" | "jumper", uid}` or
`{kind: "cable_conductor", cableUid, conductorId}`. `end` is the native zero-based
endpoint slot; it is not a drawn left/right orientation. Singly terminated cores
keep their authored slot. Endpoint incidences are distinct even when they have the
same terminal. This does not relax compiler rejection of invalid same-terminal
source conductors. Terminal inventory uses the native terminal identity, not a
function key. Ports and assembly relations never imply net continuity.

Canonical in-memory fact keys are JSON arrays with these entries, in order:

- incidence: `[kind, element.kind, elementUidOrCableCorePair, end, deviceUid, terminalKey]`;
  the cable/core pair is `[cableUid, conductorId]`;
- terminal: `[kind, deviceUid, terminalKey]`;
- port: `[kind, deviceUid, portKey]`;
- core: `[kind, cableUid, conductorId]`;
- assembly: `[kind, relationUid]`.

Occupied assembly rows supply the relation fact and the two real endpoint
connector-port-status facts. Unoccupied connector rows supply only their native
port-status fact and three semantic columns; their printed cells keep `--`,
`Unoccupied` and `No assembly declared`. Caps retain their not-applicable
mapping disposition and authored reason, with no electrical pin tuples.

Object property insertion order cannot change these keys. The actual exported
facts remain typed objects. Unconnected, unterminated, unassigned, unspecified,
spare and unresolved states remain in native report cells; none is promoted to
resolved, safe or complete.

## Explicit native empty states (native-empty-state/1)

M3 verifies an absent native connection or value, rather than requiring a null
placeholder spelling. The shared checker vocabulary is
`evals/draw/native-empty-state.mjs`, used by M3 delivery and DQ-19 report null
policy. The accepted explicit forms are:

- No same-location connections: `No connections` or `No same-location connections`.
- No other/unspecified-location connections: `No connections` or
  `No other / unspecified location connections`.
- Unspecified status: `Not specified` or `Status not specified`.
- Unspecified protocol/medium: `Not specified` or `Protocol / medium not specified`.

Comparison normalizes NFC, case and whitespace/line wrapping for these state
phrases. The native column establishes the scope of `No connections` and
`Not specified`. An assembly status may precede its independently required pin-map
status and source reason; those remaining facts must still match exactly.
These forms are accepted by both rules. For compatibility, M3 additionally
accepts the existing `None` for no connections and `Unspecified` for an absent
status/medium. DQ-19 continues to reject those literal placeholders under its
existing report policy; this change does not repair or waive that defect.
A blank, missing field, dash, invented peer, asserted value or wrong state does
not establish the required explicit native empty state. Known source connections,
protocols, statuses and unresolved pin maps retain their existing requirements.
No connection or value may be inferred from an empty state.

## Issued documents, resolutions and row anchor

`documents[]` contains `id`, `kind`, short printed `label`, source binding,
`rows[]`, and either zero-based `authoredOrder` or `autoOrigin`. Requested document
ids use `document/1/<hash>/<viewKey>`; the hash covers kind, ordered native row
keys and requested selection metadata. Automatic document ids use
`auto-document/1/<hash>` of kind and sorted missing fact keys. They do not acquire
an authored view index.

A dependency's `resolution[]` has `{documentId, rows: [rowId, ...]}`. Resolution
uses one sufficient document first, then a sufficient union. Exact scope has no unrelated native rows; a smaller sufficient superset has fewer native rows, with authored order breaking ties. Multiple typed facts on one row do not inflate its scope cost. A row id is
`<documentId>/row/<hash(nativeKey)>`. Each issued row retains `nativeKey`, native
human `displayName`, typed `facts`, semantic `columns`, `primitiveId`, final
`sheet`, `zone`, `rectMm`, `anchorMm` and
`anchorRule: "row-region-center/1"`. Wires/jumpers use native UIDs as row keys;
cores and terminals use native JSON `[ownerUid, coreOrTerminalKey]`. These machine
keys do not print in captions. Native, readable endpoint identities supply
anonymous-conductor labels.

Port row names in captions use the identity projection of the network inventory's
shared `printedPortEndpoint` formatter, for example `N01: B1`. The default row
projection still includes authored descriptions; the caption never includes them.
The internal `device.port` selector never prints in these captions. Terminal names
retain `DEV.TERM`, such as `XT-HMI.18`. Each identity stays one indivisible token.

`caption.form` is `identities` or `compact`. The identity form is preferred through
every existing allocator profile. Only when those attempts fail does the compact
form partition the resolved native facts by document, row region and printed
owner, for example `network inventory 13.A4 (N01: 5 ports)`. Each region is named
separately. `caption.groups[]` then contains `documentId`, exact `rows` ids, final
`sheet` and `zone`, `owner: {kind: "device" | "cable", uid}`, `count`, `unit` and
canonical `factKeys`. The SVG caption group also has `data-document-caption-form`.
These are locators and claims to verify, not an independent source oracle.

Each scoped fact is counted once at its first resolved native row; unrelated peer
facts in a shared row do not count. Incidences, terminals and ports use their
native device. An assembly uses its source-end device. A core uses its first
printed endpoint device, or its native cable if no endpoint exists. Every named
device must belong to that native row and its identity must actually print there;
cable-only groups similarly require the printed native cable identity. E3 must
reconstruct this partition from native source, verify the row ink, and compare
each count. If both caption forms fail, the packet returns contextual R006.

The row region is the union of the full table row's cell rectangles, in final
outer-sheet millimetres. Its anchor is the center of that region, rounded to
0.01 mm with NAV1 decimal half-up rounding. The field is quantized before the same
half-open zone classification; the final outer edge is closed. Thus the location
belongs to the complete row region, not whichever text cell a browser enumerates
first. Multiple rows may share a zone; captions retain their individual readable
identities, and list each distinct sheet.zone with the corresponding rows.
E3 accepts any named zone spanned by the row region; the half-open centre rule
is only the canonical tie-break, not a requirement to name one particular cell.

The registry admits actual printed native headers, column names, body cell text
and row regions. Source-mismatched, stale, hidden, clipped, occluded, masked,
transparent, unreadable, empty and JSON-only records supply no facts. A sufficient
kind/title alone supplies nothing. A source checker must independently verify
that the rows actually contain the required source facts and statuses.

## Visible locators and automatic origin

SVG report headers have `id="sheet-N-document-header"`; row groups have
`data-report-row`, `data-row-designation` and a namespaced
`id="sheet-N-document-row-I"`. Cell groups have `data-report-column`,
`data-column-name` and native cell rectangle attributes. Document ancestry has
`data-document-id`; automatic ancestry also has `data-document-origin="auto"`.
Standalone internal table drafts need not have a selected-view ancestry. Inline
assembly inventories carry `data-document-kind="assemblies"` on their document
container while their enclosing sheet remains a connector-assembly view.

Native assembly closure reuses sufficient issued rows first, then tries a bounded
inline inventory on existing graphical source sheets. If the complete required
rows and notes cannot fit there, a same-paper generated assembly schedule follows
the source sheets. `autoOrigin.overflow` records the inline profile, required row
keys, source sheets and failed measured attempts. The 100-sheet limit applies.
Omitted-port captions retain each port's precise row destination; a packed block
keeps their individual declarations and locators. Drawn-port pointers pair every
named port with its own measured landing and use no inventory wording.
Their compact form is `Port R1.X01 → 02.B3; Port R1.X02 → 03.C4.`:
each port retains its own qualified identity and destination, with 2.5 mm text
measured before bounded slot placement. A pointer never adds a graphical page.

A dependency's `caption` has visible `text`, `primitiveId` and `rectMm` on
`owner.sheet`. The corresponding SVG group carries `data-document-dependency`
and its unique `id`. Native identities and sheet.zone tokens are indivisible
caption atoms, including spaces inside an authored identity. Short labels such
as `wire inventory` and `terminal inventory` are defined at document headers.
Standalone captions have no resolution and explicitly state that no companion is
included. Generic partial-view warnings create no dependency.

Companion captions try clear local slots around their source terminal or device
frame before using a remote slot. When that owner is unambiguous, optional
`caption.locality` exports its source UID/key, physical anchor, sheet/zone,
placement mode and distance. A remote caption retains its native subject; a
straight nonconductive drafting leader is added only when its complete approach
is clear. Its visible gap beyond the painted terminal-marker edge is at least
2 mm, including the transformed marker radius and stroke in the reservation.
Its endpoints and reserved region are exported as `locality.leader`.
This finalization never moves electrical routes, shrinks text or adds pages.

`autoDocuments[]` separately exports `{documentId, dependencyIds, sheets}`.
`documents[].autoOrigin.dependencyIds` identifies the missing source needs that
caused generation. Every appended native row must trace to at least one of those
needs not already supplied by requested issued documents. Compatible needs share
one deduplicated native inventory scope. Generated inventories cannot create more
promises. `documentationSelections[].view` remains restricted to authored
requests; no auto document bypasses the 1–40 request validation. All pages,
including inventories, indexes and references, count toward 100.

HTML embeds the same sheet SVGs with the same ids. PDF renders the same finalized
sheet content; the packet's outer-mm document and caption regions form the
additive page/region sidecar. A PDF text extractor alone does not prove visible
ink. SVG, HTML print and PDF must be reconciled against actual transforms, clips,
paint, occlusion and print size.

## Independent checker obligations

E3 must reconstruct expected hidden facts from native source and request selection,
check native visible geometry and incidence, then reconcile these exported
locators. It must not import the NAV planner or treat flags, hashes or claimed
fact sets as truth. Check headers, exact native rows/columns, statuses, source
snapshot/presentation, every location and actual visible caption. A missing seed,
stripped ownership, forged row, wrong scope or stale locator must fail.

The [E3 checker](../evals/draw/README.md) has measured the M3 export since version
5.9. DQ-19 checks issued documents, native facts and caption delivery. DQ-09
checks destination sheet zones against measured row regions.

The authored-note browser test population excludes automatic inventory pages:
generated inventories do not inherit requested view notes. Only that test's page
population changes; the vocabulary predicate stays unchanged. E3 must continue
checking generated inventory captions and rows using their native origins.

Circuit recomposition conserves this M3 output against the original printable
packet: dependency and resolved-document metadata, resolutions and automatic origins;
painted captions and native rows; complete companion pages; and fixed caption
geometry plus owning-view placement. Paint includes inherited styles, transforms
and clips, independently of exported rectangles. Both directions are compared
after one consistent, order-preserving old-to-new page map. All companion pages
share one uniform offset; captions, row locations, generated sheet ids and frame
page numbers follow that same map. Native cells, identities, zones, resolutions
and all other content stay exact. Unchanged companions therefore do not block a
circuit-page reduction before them. This
renderer guard conserves an already printable result; it does not replace E3's
independent source reconstruction or establish electrical completeness.

## Wire schedule endpoint locations

Wire and core schedules always reserve `From sheet.zone` and `To sheet.zone`,
including requested, filtered and automatic inventories. Each cell locates that
native endpoint's actual terminal landing in the finalized packet, using the
same decimal half-up quantization, half-open zone grid and zero-padded
`sheet.zone` formatter as navigation. An established schematic landing takes
precedence over a strip. Within the preferred drawing kind, the first issued
sheet and first painted appearance in SVG document order win.
The native endpoint slot determines the column, even when the path is reversed.

The explicit unresolved form is `not drawn`: it may print only when that native
endpoint has no drawn landing on any issued sheet. A drawn endpoint whose locator
cannot be resolved is a renderer error, never an empty state. The exact native
terminal marker or painted native pin-list row supplies the landing, including when a selected view omits this
wire but draws the same physical terminal through another conductor. A pin-list row is a drawn terminal even if no circle is painted; its anchor is
the measured ink center of its first printed line. A nearby
device, a different same-net terminal, an inventory row, hidden ink or a clipped
marker supplies no location. This does not imply an absent electrical connection.
On a strip sheet the conductor's own painted stub or jumper path must reach
the native terminal rectangle. The rectangle center supplies the zone.
Singly terminated, spare and unassigned cores retain their native endpoint slots.
Location columns reserve the widest printed locator, including `not drawn`, with
2 mm cell insets. Allocation first tries seven real columns with the native line-count capacity.
If they cannot fit, seven real columns may add native wraps only when measured
pagination stays at the native packet capacity. Tier (b) enumerates the existing
weighted vector and a bounded grid: after native protected-token minima and the
two measured locator widths, distribute the remaining width in twelve shares
across the five native columns. The complete grid has 1,820 vectors, for at most
1,821 attempts including the weighted probe. Each uses the renderer's exact
wrapping and the same row-placement paginator as painted report emission, at
the retained em and 2 mm insets. Among capacity-preserving candidates, choose
the fewest pages, then the fewest printed wrap lines (including repeated
headers), then numeric lexicographic width order. This is a bounded enumeration,
not a claim of continuous global optimality.

Every vector keeps its original enumeration index. Pagination stops only when
its monotonically increasing page count strictly exceeds the smaller of the
native reference and the best completed count. Equal-page candidates remain
eligible. Only candidates tied at the final minimum page count receive a wrap
total; numeric lexicographic width order still breaks those ties. Candidates
inherit the weighted vector's header-hyphenation flags and policy note rather
than recomputing them: a wider candidate can retain the note without printing
hyphens, and a candidate requiring new header hyphenation is unmeasurable. This
intentionally narrows the enumerated grid; it does not alter candidate order.
Per-candidate hyphenation recomputation is deferred (#268.3); the inherited
policy and its note remain explicit rather than implying a fresh decision.

Search cell profiles are measured once per exact physical column width and
source text/identifier tuple. Floating-point residue variants of a nominal
grid level remain distinct keys. Profiles retain line count, maximum ascent
and maximum descent from the actual wrapped lines, including inserted glyphs.
Candidate row heights use the emission formula with the same operation order;
the row-height array then visits the existing paginator one row at a time at
absolute coordinates. Prefix sums and rounded thresholds are not equivalent.
The chosen vector receives the ordinary full measurement and pagination, with
an active page-count and wrap-total agreement assertion before emission. This
assertion runs in production and tests: disagreement refuses the packet, never
accepts a cached score or silently falls back.

Search work counters are separate from the unchanged receipt: `logicalCells`
counts row/header-column-width slots; `cellMeasurements` counts actual profile
attempts after sharing identical text and protected identifiers; `wrapCalls`
counts uncached header/body wrapping calls, including chosen-vector checking;
`lineMeasurements` counts uncached wrapped-line metric measurements for the
profiles. Wrapping's internal fit checks are not separate profile measurements.
`heightRows` counts arithmetic row reconstructions, and `widthLevels` counts
the exact width keys per column. Paginator row steps count visits to the
paginator, regardless of whether their heights came from geometry or arrays.

The internal `paginatedReportCells` result records `allocationReceipt` in
`wire-column-search/1` form: physical field, retained em, native page reference,
grid bounds and minima, fixed locator widths, every candidate's widths/page
count/wrap count, paginator row steps, and the selected index/tier. A candidate
pruned at page N records `prunedAtPage: N` and `pageLimit`; its null `pages` is
not a completed count. Dominated candidates have null `wrapLines`. An
unmeasurable candidate has a null page count and an explicit failure; it is
never a zero-page success. Row steps are null if pagination throws before
returning a measurement.
A single candidate's measurement error is recorded as a candidate failure;
other candidates continue. Within the search, only setup, bound and tie-scoring
errors (including emission agreement failures) refuse the packet. A typed
layout/measurement error during native-reference or initial probe setup can
retain the already measured stacked layout: `allocationFallback` records its
stage/reason for diagnostics. The printed note says that sheet/zone references
are shown below endpoints and identifies the alternative arrangement, issued
table title and affected column by name when that column maps exactly to the
issued table. It never presents a hidden sizing row/column as a printed cell or
prints an internal stage name. Unmapped columns are explicitly unidentified.
The note uses the normal note reservation. Unexpected setup Error objects retain their
original type and identity, with known row/column context; unresolved setup
context explicitly says that the row or column was not identified. An initial stacked-layout measurement
error still refuses, and a stacked layout that cannot paginate still receives
the normal refusal. Setup failures never create an enumeration success receipt.
Only when no enumerated tier-(b) candidate preserves capacity do the two
location fields stack beneath their respective endpoints. Stacked fields
retain separate painted rectangles and painted header sub-cells, with explicit
`From sheet.zone` / `To sheet.zone` labels. Native text and location ink each stay
inside their own sub-cell; ordinary tables retain one rectangle per column.
No tier shrinks the font or drops text. Final location filling cannot move rows or add pages. CSV reports have no packet geometry and
print `not drawn` unless the caller supplies endpoint references. Raw native query
tables retain their optional location projection; renderers reserve it before
layout.

## Issued peer and inventory references

A conductor peer names both native terminals and the drawn peer's final
sheet.zone when space allows. Relay interface pointers in terminal wiring views identify painted
counterpart terminals. They carry no claim about the presence of a function
symbol. Connector attachment pointers use the occupied native port on the
sheet with the painted attachment. When the attachment has no drawing, an
inventory pointer names the exact assembly and locates its issued row. Pin
mapping and occupancy retain their authored status.

Peer notes first try the full text, then keep only the peer and its address.
A bare address requires a unique peer obligation at that address on the sheet.
Where these forms cannot fit, two measured lines retain the full text. Each
form uses the same 2.5 mm type floor and the existing navigation clearance.

Strip terminals print their existing Tn/Rn key with an inventory sheet
number. The matching key on the inventory has its own space beside the table.
Circuit footers name the first issued device and function reference sheet
when the packet includes that report.

## Report proof maintenance

Wire-search work-counter pins describe the particular native fixture, font metrics,
exact floating-point widths and cache policy. Refresh them only after explaining
which of those inputs changed: independently count actual profile calls, wrapping
and paginator row visits, then re-run allocation/receipt and packet equivalence.
Do not lower a counter by moving work outside its measured boundary or replacing
a counted operation with an uncounted equivalent.

A moved-label audit's sampled clipped ink boxes are not every native contour.
Use `minimumMeasuredClippedInkBoxGapMm` for that supplementary bounding-box
measurement and state which primitives it samples; exclude the audited annotation
explicitly. State separately whether paths and their stroke widths are covered.
A raster nearest-dark-pixel measurement includes rendered strokes but has pixel
quantization, and must report its resolution. Neither partial metric may be named
`minimumNativeContourGapMm` or presented as exact nearest-ink clearance.
