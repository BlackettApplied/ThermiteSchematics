# View requests and printable packets

This reference extracts the printable format contract and the render package's
semantic-selection rules. `thermite` means the launcher from the project guide.

## Intents and roots

| CLI intent | Required root and behavior |
| --- | --- |
| `--power` | A mapped load with a path to a mapped power source; each phase is separate. The motor-starter fixture uses M1. A DC supply's AC input load can root when its authored feed reaches a power source. |
| `--actuation` | One mapped two-terminal coil; searches through mapped control contacts to an output/positive source and a return. The motor-starter fixture uses K1. |
| `--loads` | One mapped DC control source and its source/return pair; shows complete mapped loads on those nets. The starter uses PS1. |
| `--conductors` | An exact cable; the cabinets template uses CBL1. Retains all physical type cores and spare assignments. |
| `--to <device>` | A mapped two-wire contact sensor or three-wire sensor root and a distinct target with a reachable mapped input. `--include-power` adds only the declared supply arms. |

Bindings use the [profile catalog](circuit-views.md#library-symbols) and authored
function shapes. A function never joins nets. A profile alone cannot make an
invalid or disconnected root acceptable. Loads views support multiple direct loads
and looped supplies; placement and routing use a bounded, validated ELK search.
Trace and loads traverse conductors;
control/power may select supported function steps for presentation only.

Rooted views use bounded selection: unequal parallel paths and authored conductors at drawn terminals can be omitted without markers. Use explicit circuit/wiring selections and packet coverage within its documented scope. Success proves neither complete rung coverage nor operation.

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
lists report/index sheets. Every drawing family counts, including endpoint
appearances; reports and indexes do not count as schematics. Existing conductor
and function coverage retains its narrower scope. W906 is advisory and does not
certify complete wiring or readability. The `packet` CLI emits it on stderr with
compiler diagnostics and exits 0 for warnings, or 1 with `--strict`; info does not
fail strict mode. Individual `view` commands intentionally select partial views
and carry no W906 on stdout or stderr. `--strict` is a packet option: warning
failures report diagnostics with `error: null` and write no output. Such
warnings-only strict failures are outside the six agent tools' non-zero-explanation
invariant; pre-dispatch CLI usage errors with plain-text stderr are outside it too.


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
