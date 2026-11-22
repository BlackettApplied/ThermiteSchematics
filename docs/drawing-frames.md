# Drawing frames and supplied title data

Select `project-presentation/0.3` explicitly in the project's presentation file
for the compact frame. Existing 0.1, 0.2 and unconfigured projects keep their
rendering and PDF metadata. Init still creates presentation 0.2. Continuous SVG
keeps its existing rendering; the frame and packet title data apply to paginated
SVG, HTML, PDF and JSON exports. Issued documents and their dependencies bind to
the compiled authored presentation, including its compact title fields. See the
[navigation export contract](navigation-export-contract.md#native-identity-and-source-binding).

Presentation validation can take two passes. If `format` is missing or unknown,
the first pass returns one E014 naming the accepted versions. Set a supported
`format`, then validate again to see that version's field errors. Known 0.1/0.2
formats retain their legacy diagnostics; known 0.3 validates only compact fields.

```json
{
  "format": "project-presentation/0.3",
  "frame": {
    "zones": { "default": { "columns": 6, "rows": 4 } },
    "generatorStamp": "border"
  },
  "titleBlock": {
    "profile": "compact",
    "fields": {
      "drawingNumber": {
        "slot": "drawingNumber",
        "label": "DWG NO",
        "pattern": "{drawingBase}-{sheetNumber:03}"
      }
    }
  }
}
```

The defaults are tabloid landscape, 10 mm margins, white background and revision
`UNSPECIFIED`. Page settings support letter, tabloid, A4 and A3, either
orientation, and margins from 5 to 25 mm. A packet's shared page setting overrides
presentation page settings. Individual views cannot set their own page.

Only compact and exactly 6 columns × 4 rows are released. Counts in both
`frame.zones.default` and `frame.zones.byPaper` must be 6×4. Extended profiles,
null headers, extra slots, logos, authored geometry, static-text blocks and
revision tables are rejected. There is no staging or environment switch for
these capabilities. The engine draws labels and ticks on all four sides. Service
bands have destinations in the outer cells; they do not create extra zones.

## Fields and unknowns

The ten slots are `project`, `sheetTitle`, `drawingNumber`, `customer`, `drawnBy`,
`date`, `checkedBy`, `approvedBy`, `revision` and `sheetNumber`. The `fields` object is closed: its optional keys are exactly these ten slots,
with at most one field per slot and no user-chosen keys. Each value is a closed
field object; its key must match its `slot`. Specify a label
and at most one of `value`, `bind` or `pattern`. Project, sheet title, revision and
sheet number require their respective bindings `project.name`, `sheet.title`,
`sheet.revision` and `sheet.numberOfTotal` when explicitly configured. Other
slots accept supplied literal values. Patterns are allowed only for drawing
numbers. Labels, positions, type sizes and ordering remain engine controlled.

Unknown business fields print as labelled blanks. An unknown current revision
prints `UNSPECIFIED`; it remains unknown at issue review. The engine does not
infer a person, company, date, drawing number or revision from the operating
system, Git, filenames or history. Supply only facts you have. Project and sheet
identity and final numbering come from the native project and selected views.

`titleBlock.lines` retains up to four plain note lines. Text is plain and bounded:
labels up to 40 code points, ordinary values and short titles up to 160, personnel
and customer values up to 80, drawing numbers and revisions up to 128. Dates must
be valid Gregorian `YYYY-MM-DD`. Presentation 0.3 JSON is limited to 64 KiB of
UTF-8, including whitespace. Unsupported glyphs, format characters, markup and
unprintable values refuse rather than being substituted.

## Packet metadata

Packet request 0.1 continues to work and can use presentation-only fields. Use
`schematic-packet-request/0.2` for optional `titleData`. Its views use the same
strict validators and selections as 0.1; wrapping a view in a new packet version
does not relax it. Title data requires presentation 0.3. A 0.2 request without
title data can also use the legacy presentation path.

This example supplies an example drawing identifier and leaves personnel and
organisation facts unknown:

```json
{
  "format": "schematic-packet-request/0.2",
  "views": [{ "format": "documentation-view-request/0.1", "kind": "bom" }],
  "titleData": {
    "defaults": {
      "drawingBase": "EXAMPLE",
      "values": {
        "drawnBy": null,
        "checkedBy": null,
        "approvedBy": null,
        "customer": null,
        "date": null
      }
    }
  }
}
```

Precedence is presentation fields → request defaults → authored view → exact
sheet. An absent value inherits; null clears it to unknown. Put ordinary values
in `values`, and use the separate `sheetTitle`, `revision` and `revisionRows`
properties for those fields. Project and sheet-number bindings cannot be
replaced by request values. `byView` records have a one-based `viewIndex` in the
requested views array. Duplicate, out-of-range and unused selectors refuse.

A companion with one native owner inherits that owner's view metadata, while
keeping its own sheet title. A companion serving several views uses defaults.
Exact-sheet metadata can target either through its own sheet key. Ownership
comes from native document dependencies, never from a matching title. Indexes,
references and independent reports retain their own identities and titles.

Each rendered JSON sheet exposes an opaque `sheetKey`. Preview the packet, copy
the exact key into a `bySheet` record, then preview again. A key binds native
identity, part index **and part total**. It does not depend on global packet
numbering or title text. Repartitioning invalidates the old keys for that native
document, even when a particular part still exists. A stale key refuses; it is
not an everlasting drawing identifier. Reserve heading capacity before
pagination, and validate selectors against the final sheets.

Drawing-number patterns support only `{drawingBase}`, `{sheetNumber}` and
`{sheetTotal}`, optional `:02` or `:03` padding on numbers, and escaped braces.
There are no expressions, environment lookups or inferred bases. A missing base
makes the whole patterned number unknown. Final header and title sheet counts
include companions and index/reference pages.

Revision history is supplied as up to six rows, each with a required `version`
and optional `date`, `comment` and `drawnBy`. Arrays replace earlier arrays; they
do not concatenate. Current revision is supplied separately and is never
inferred from a history row. Compact prints all supplied rows in source order in
its fixed history slot, using `version / date / comment / drawn by`; omitted
cells stay blank. An empty history shows `Revision history: UNSPECIFIED`. That
status and headings alone are not supplied history or grounds for retiring a
review obligation.

## Capacity, stamps and export

The frame measures glyph ink and reserves zone and continuation lanes. It never
truncates supplied facts, shrinks type, hides a history row or moves a wire end to
make text fit. The fixed compact slots can refuse even schema-valid long values
or history. R006 names the field and required/available capacity; use larger
paper, another orientation or a shorter supplied value. Do not bypass the error
or silently change the packet preset. Review the whole packet after frame or
metadata changes, including formerly near-boundary destinations.

`generatorStamp` is `border` by default and prints the software stamp alongside
revision history in the footer band inside the frame. Sheet notes use the row
above. `title` places the software stamp inside the measured title panel. `metadata` retains the software identity in SVG
metadata without the visible stamp. HTML carries the sheet metadata; PDF keeps
software Creator/Producer and deterministic epoch dates. Every 0.3 PDF omits
Author, including when Drawn by is supplied, because a packet can have different
sheet authors. Legacy PDF Author stays unchanged.

Export with `thermite packet --project . --input packet.json --output drawing.html`
(or `.pdf` / `.json`). Use the same runtime that initialized the project; source
checkouts invoke it through their built `thermite.mjs` launcher. The six agent
tool contracts in [agent requests](agent-requests.md) stay unchanged. Read the
[view and packet reference](views.md) for selection, page settings and R006.
