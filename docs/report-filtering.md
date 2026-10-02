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
