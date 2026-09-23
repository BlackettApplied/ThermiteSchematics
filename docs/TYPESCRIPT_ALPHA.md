# TypeScript alpha formats and compatibility

The alpha product entry point is Thermite 0.3.0-alpha.2. The workspace package
versions and original `thermite` interfaces retain their POC compatibility identities;
this is a source-distribution preview, not a new registry release.

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

`schematic-packet-request/0.1` contains `views` (1–40 existing schematic view
requests or documentation requests) and optional shared `page`, `layout`
(`standard` or `compact`), and boolean `index`. Individual views cannot change paper size.
The renderer caps a packet at 100 sheets. The result `schematic-packet/0.1`
contains normalized `page`, ordered `sheets`, and self-contained `html`.
Each sheet includes its SVG, normalized view, number, and continuation records
with the matching destination sheet, conductor label, and electrical net ID.

Circuit sheets use ELK's validated diagram, preserving its geometry. Cuts avoid
devices, rails, symbol/terminal labels, junctions, and routing bends. Circuit text
never scales below 2.5 mm. Repeated SVG IDs are namespaced per sheet without
changing electrical metadata. An unprintable arrangement returns R006 rather
than clipping a device, overlapping a continuation label, or silently omitting
content. Change flow, page size, or the selected view to resolve it.

`renderSchematicSheets` and `renderSchematicPacket` are exported by the render
package. `renderSchematic` and agent `create-view` retain continuous SVG for legacy
sources. Annotated cables return the complete core sheet, including spare cores.
An annotated cable that needs multiple sheets returns R006; use the Thermite
view/packet commands to retain its complete inventory. HTML is an SVG container, not a rasterization.

## Cable assignments

Cable JSON adds optional `fromLocation`, `toLocation`, and conductor `usage`
(`in-use` or `spare`). Endpoint slots are end A and end B for an annotated cable.
A null endpoint is permitted only for an explicit spare; this cross-field rule
is enforced by the schema package's structural validation (like duplicate core
IDs and identical endpoint checks).

- Two endpoints create the same physical connection regardless of usage.
- One endpoint occupies a terminal but does not invent another endpoint or net.
- Two null endpoints describe an unterminated spare.
- No assignment means unassigned, not spare.
- Legacy assignments without usage remain unspecified; their old canonical
  endpoint ordering and net IDs remain compatible.

The compiler preserves authored A/B order in optional cable `assignments`
metadata. Its connected-conductor topology tables remain reserved for complete
physical endpoint pairs. Invalid dangling core IDs still report E200; partial
terminations participate in E201 exclusive-terminal checks. The old engineering
rules and diagnostic suppression order remain in force.

`buildCableSchedule(ir, cableUid)` returns every physical type core and totals.
New annotated cable queries include that schedule alongside the old connected
conductor list. `netId` identifies a complete physical core connection; null
means there is no complete connection, not that an attached end is de-energized.
Shielded construction is independent of authored shield bonding.

## Libraries and deployment

`thermite init <new-directory>` creates and validates a staged project before
making it available. It copies the exact generic library JSON to `libraries/core`
and writes a relative path reference and fresh integrity lock. Existing projects
using shipped library identities continue to work. The `cabinets` template
provides two cabinets, two used cores, and two loose spare cores.

Generated output cannot overwrite project inputs, requests, libraries, or agent
configuration. Symlinked/hard-linked output paths are rejected. Output must use
SVG, HTML, JSON, PDF, or CSV extensions; a file matching an authored source glob is also
rejected. The CLI uses atomic file replacement for ordinary generated outputs.

Development/CI currently targets Apple Silicon macOS and Bun 1.4.2. No Windows,
Linux, or Intel Mac build is part of the alpha iteration loop. The former native
implementation is not included in this source release.


## Documentation and library metadata

A packet may include `{ "format": "documentation-view-request/0.1", "kind": "io" }`.
Kinds are `bom`, `wires`, `cables`, `terminals`, and `io`. Only terminal and I/O
requests accept `device`, resolving a unique UID or designation. CLI `report`
exports the same tables as CSV or printable packets. `--json` / `.json` returns
packet data, including SVGs; the query package's `buildDocumentation` API returns
structured rows and columns without drawing geometry.

Device types may declare `category`, `terminalOrder`, and `catalog` with
manufacturer, exact `orderNumber`, `document` (HTTPS URL, title, revision, pages),
and optional `modelingNotes`. E203 requires terminalOrder to include every key
exactly once. Instances may declare `io: { addressSpace, channels }`. Channel
keys must refer to channel functions; each assignment may contain address,
signal and usage (`in-use` or `spare`). E202 rejects unknown channels and exact
case-insensitive duplicate addresses within one authored address space. Address
spaces are case-sensitive identifiers. Addresses are opaque documentation
labels: byte/word overlap, PLC configuration and online state are not validated.

Circuit drawings also accept explicit per-function `circuitSymbols` in device
types. E206 rejects unknown function keys and marks incompatible with declared
function kind, terminal count or contact state. See the [closed mark catalog and
diagnostic contract](CIRCUIT_SYMBOLS.md).

Symbol profiles are explicit: `thermite:io-module`, `thermite:terminal-strip`,
and `thermite:dc-supply`. Supported shapes are single-terminal channels and bus
points, two-terminal DC loads, and two-terminal DC sources with explicit
positive/return roles. Other shapes remain explicit omissions. Neither a part
name nor a symbol profile creates electrical continuity.

Reports list physical facts. Terminal rows group immediate connections by known
location; missing locations stay unspecified. I/O rows list every declared
channel, external members of its physical net, and authored assignments. The BOM
counts instances by type/location and does not estimate accessories or cable
lengths. CSV quotes fields and prefixes formula-like cells with an apostrophe.
This spreadsheet protection does not mutate source values.

## Compact sheets and references

Compact mode tries standard, compact and dense spacing, stopping when one sheet
is achieved and selecting fewer sheets, then fewer continuations. All candidates
pass existing routing validation. A proven one-sheet candidate can reclaim
continuation gutters. Horizontal tiles may be cropped to their actual vertical
content bounds and stacked on a sheet with a gap; this changes only composition,
not routed geometry. If they cannot fit, retain separate pages. The selection
never changes flow or reduces the minimum circuit text size.

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
`watch` polls declared inputs and the request every second, reloads library
references and source globs, and rebuilds only when loading results or the
request change. Failed rebuilds retain the last good file. Refresh the HTML to
see the new packet; there is no automatic browser reload.

## PDF and semantic review

A `.pdf` output uses PDFKit and svg-to-pdfkit with bundled OFL Noto Sans fonts.
It preserves physical page sizes and vector geometry, embeds fonts, and fixes
metadata dates for repeatable bytes. Unsupported text glyphs and conversion
warnings fail before replacing the destination. No arbitrary SVG import or
external image/document loading is exposed. Viewer behavior and PDF pagination
are independent. Local Safari rendering and physical printer behavior still
need a user check.

`snapshot` produces `thermite-snapshot/0.1`: a digest and stable, semantic IR
entities. `review --before` produces `thermite-review/0.1`: added/removed/changed
identities, changed field paths, before/after values and directly affected
devices. Source locations and derived net IDs are excluded so formatting edits
do not create electrical changes. Type changes are visible even when no current
instance uses the type. Presentation settings and library-byte-only changes are
outside semantic review; retain normal Git and lock-file review for those.
Snapshots are change-review data, not backups or cryptographic approval records.
Affected devices are directly referenced objects, not a functional impact or
machine-safety analysis.
