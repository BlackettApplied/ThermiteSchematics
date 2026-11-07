# Report and reference selection

Reports and packet reference indexes can use an explicit source-device filter.
Existing requests retain their output when no filter or reference options are
authored. Filters affect documentation; they do not edit electrical source,
redraw circuits, suppress compiler diagnostics or change continuity.

```json
{
  "locations": ["Main cabinet"],
  "excludeTypes": ["example:documentary-node"]
}
```

The optional fields are `devices`, `types`, `locations`, `excludeDevices`,
`excludeTypes` and `excludeLocations`. Each supplied field is a nonempty array
of unique strings, up to 1,000 entries. Device selectors resolve exact UIDs or
designations; types use exact library-qualified type IDs; locations use exact
authored device locations. Unknown selectors fail explicitly, including
exclusions. Two aliases for the same device in one list also fail. Names are
case-sensitive; there are no patterns or automatic classification rules.

Include dimensions intersect: a device must satisfy each supplied include
list. Exclusions take precedence. Omitted include fields impose no restriction.
Devices without a location remain eligible unless a location include list is
supplied. A valid filter can intentionally select no devices; it never falls
back to the complete project.

The query package's `resolveDeviceFilter(ir, filter)` API validates the same
criteria and returns selected/outside device UIDs with a copy of the filter.
Reports and packet references share this resolver; private path helpers remain
outside the public query API.

## Report columns and authored meaning

Reports list physical facts. Terminal rows group immediate connections by known
location; missing locations stay blank. I/O rows list every declared
channel (including sensor outputs), its owning device, external members of its
physical net, and authored assignments. The BOM groups instances by type,
location, authored description and explicit non-procurement reason. Each row has
one description shared by all listed designations; distinct requirements get
separate rows and identical descriptions still aggregate with their authored
quantity. Multi-line descriptions remain one cell. Missing, empty and
whitespace-only descriptions group together and print blank; nonblank descriptions
retain their authored whitespace. Within each type and location, rows and their
members follow natural designation order (M1, M2, M10), starting with the lowest
designation in each row. The type description remains in its own column.
In printed BOMs and cable schedules, a single-line type description of at most
160 Unicode code points stays whole. Longer or multi-line text uses the first nonblank line
if it fits, otherwise the longest prefix of complete sentences, then whole words.
An overlong unbroken word or symbol sequence cuts only between grapheme clusters
using `Intl.Segmenter`. The cap includes the omission ellipsis. Line boundaries
are LF, U+2028 and U+2029. An ellipsis and a full-text note appear only when text
was cut. Missing or whitespace-only type descriptions use the exact type ID and
an applicable fallback note. Blank instance descriptions remain blank.
Instance descriptions and purchasing reasons are never abbreviated.
Printed columns reserve the measured width of indivisible name segments and
whole header words at the fixed report type size. Locations wrap at their own
spaces and after separators, keeping each word whole (`CONTROL` / `CABINET`,
`FIELD-` / `JB1`). A designation is structured only when it begins with `=`,
`+` or `-` followed by a letter or digit. Those names may wrap before another
aspect prefix followed by a letter or digit; each aspect stays whole. Every other
designation, including `W-CTL-005-M2`, `PE-HMI` and `W-RIO1-L+`, stays whole.
Terminal suffixes may move at their separator. Other authored text wraps first
at whitespace, then after `-`, `/`, `.`, `:` or `_`, and inside other runs only
as a last resort. Separators stay with the preceding run in order numbers and
URLs. A URL containing `/M1/` does not reserve the whole URL's width.

Columns use compact 1 mm insets and restore 2 mm independently when every cell
keeps its line count and its header still fits. If all whole header words cannot
fit together, release one column's header minimum at a time, largest width saving
first, stopping as soon as the table fits. Only words that still cannot fit
hyphenate visibly. Words shorter than five characters stay whole; a split keeps
at least two characters before its hyphen and three after. Every affected sheet
prints a note naming the largest supported margin that fits all header words
whole, or recommending larger paper or landscape when that margin is below 5 mm.
An indivisible designation never hyphenates. A width refusal names its driving column and whole authored designation,
including when its longest aspect drives the required width.
No refusal promises a smaller margin based on width alone: row height must fit
too. Rows or headers that are too tall recommend larger paper or shorter authored
text, and recommend landscape only when the current page is portrait. Instance descriptions remain exact even when they cannot fit a sheet.

Use `thermite inspect <designation> --type-description --project <project>` for
full device or cable type text. The flag does not change `inspect --json`;
`cable --json` and compiled IR keep authored text. CSV has no print limit: it
carries full type descriptions and full headers (`Manufacturer`), with the report
control normalization and spreadsheet protection below. `Mfr.` is print-only.
Cable and connector-assembly instance descriptions also remain visible.
`Not purchased: <reason>` marks explicitly flagged rows in the instance column.
Quantities include those instances and are not purchasable totals; no purchasable
total is printed. The BOM does not estimate accessories or cable lengths.
Blank order numbers require selection before procurement. Cable BOM and schedule
rows use the cable type description, falling back to its ID only when absent
(including a whitespace-only type description).

Missing descriptive cells are blank in `bom`, `wires`, `cables`, `terminals`,
`io`, `io-ports`, `network` and `assemblies`. Explicit text such as
`Unspecified` is retained. Semantic states such as usage, link/review status,
unconnected and unterminated remain visible; a blank is not an unused or spare
disposition. CSV quotes fields and prefixes formula-like cells with an apostrophe.
This spreadsheet protection does not mutate source values.

Report cells replace each C0/C1 control character and DEL with one space, except
for tab and LF (newline), which remain. This normalization applies only to
printed/CSV report text; source, IR and query JSON preserve the authored text.

`cable --json` and `buildCableSchedule` expose optional `description` only when
the cable type authored it, including an explicit empty string. They never
substitute a type ID into that field. ID fallback belongs to report tables (including CSV),
whose notes explain it.

The query builders accept optional packet-owned endpoint references without
changing request JSON: `buildDocumentation(ir, request, references)` accepts
`ScheduleReferences`, with `conductors` mapping a wire/jumper UID to a from/to
`EndpointSheetZones` pair and `cableCores` mapping cable UID then core ID to a
pair. `buildCableSchedule(ir, cableUid, sheetZones)` accepts the core map and adds
`sheetZone` to an existing endpoint only when supplied. Pairs follow the IR
wire/jumper endpoint order or the cable schedule's authored/canonical end order;
they assert no electrical direction. The wire/core table appends `From sheet.zone`
and `To sheet.zone` only when at least one retained endpoint has a nonempty value.
Absent entries are blank. No reference is assigned to an unterminated end. These
APIs reserve support for X2; the renderer does not yet supply packet locations.

## Report requests and CLI

Every `documentation-view-request/0.1` kind accepts `filter`:

```json
{
  "format": "documentation-view-request/0.1",
  "kind": "network",
  "filter": { "devices": ["PLC1"] }
}
```

The legacy `device` selector keeps its terminal/I/O-only behavior. Use either
`device` or `filter`, not both. In the CLI, save the filter object itself as
`main.filter.json` and use:

```sh
bun thermite.mjs report network --project <project> --filter main.filter.json -o network.csv
bun thermite.mjs report bom --project <project> --filter main.filter.json -o bom.pdf
```

`--filter -` reads the same JSON object from standard input. The same selection
is used for CSV, HTML, PDF and JSON packet output.

- Terminal, terminal-channel I/O and connector I/O rows select their owning
  device. Peer mentions do not select somebody else's rows. All terminals,
  channels or sockets of an eligible owner remain present. Explicit `devices`
  in a terminal filter supports any device, like the legacy single-device
  selector; other terminal filters retain automatic terminal-strip eligibility.
- Wire/jumper, assembly and network rows retain any connection incident to a
  selected device, with both complete endpoints and their original metadata.
  Unoccupied/unconnected ports select their owning device. An excluded device
  may still appear as the peer of a retained connection.
- Physical cables are retained when any terminated core touches a selected
  device. Their complete core inventory and counts remain intact in wire/core,
  cable and BOM reports; loose cores are not removed from a retained cable.
- BOM device groups and quantities are rebuilt from selected instances. Cable
  assembly records follow incident endpoints and remain whole.
- Records with no device endpoints remain included, because a device filter
  cannot reliably assign them. Selection metadata identifies these unscoped
  rows; location strings on a loose cable do not assign it to a device.

Filtered tables visibly say `(filtered)` and print the selected-device and
retained-row counts. Their `selection` metadata includes the original filter,
selected/outside device UIDs, total/retained row counts, omitted source row
keys, boundary peer UIDs and unscoped row keys. A partially retained BOM group
keeps its group key while changing its instance list and quantity; row counts
are counts of table records, not device quantities.

Packets collect one `documentationSelections` entry per filtered authored
report view, with its one-based input `view` number. CSV columns/rows retain the
existing format; the CLI's JSON report on stderr carries `selection` alongside
the unchanged diagnostics. Preserve that report to audit a CSV export. A
filtered schedule is a scoped projection; it does not replace the full source
or certify that excluded equipment is irrelevant to the design.

## Packet reference options

With `index: true`, optional `references` selects device/function reference
rows independently of reports and drawing sheets:

```json
{
  "format": "schematic-packet-request/0.1",
  "index": true,
  "references": {
    "appearances": "drawings",
    "filter": { "excludeTypes": ["example:documentary-node"] }
  },
  "views": [
    { "format": "communication-view-request/0.1", "medium": "ethernet" }
  ]
}
```

`appearances: "drawings"` lists diagram appearances only, including circuit,
topology, signal-loop, wiring and cable conductor views. Report-row appearances
are excluded. The default `"all"` retains schedule appearances. The filter
selects exact source devices before grouping their function references. Sheet
numbers and zones remain actual packet destinations. A valid empty selection
prints a reference sheet with `No matching records`.

Use `references: false` to retain the complete sheet index while omitting the
device/function reference pages. The sheet index notes the omission.
Reference options require `index: true`; unknown options fail. Without these
options, the existing index and references remain unchanged.

Explicit options produce `referenceSelection` metadata with the filter,
appearance scope, enabled state, selected/outside device UIDs, total/retained
device/function group counts and omitted group keys. Printed reference pages
also identify their scope and counts. Filtering reference rows does not remove
device bodies, conductor/link coverage or reciprocal continuation references
from diagrams. Packet length changes can change the printed total sheet count.

See the [original synthetic example](../examples/report-filtering/README.md).
