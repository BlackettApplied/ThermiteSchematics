# Snapshot, review, watch and PDF

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

## Commands

Run these from an initialized starter project. `thermite` means
`bun <absolute-runtime-path>/thermite.mjs`, as in the project guide.

```sh
thermite snapshot --project . -o drawings/before.json
thermite review --project . --before drawings/before.json --json
thermite view PS1 --loads --project . -o drawings/control-power.pdf
```

The unchanged-source review has no semantic changes. After a guarded edit,
review again against the saved snapshot and inspect the generated drawing at
100% print scale. Validation and a clean review do not approve a machine design.

## Watch

`watch` waits one second after the previous load/rebuild finishes before polling
declared inputs and the request again. Work adds to that interval. It reloads
library references and source globs, and rebuilds only when loading results or the
request change. Failed rebuilds retain the last good file. Refresh the HTML to
see the new packet; there is no automatic browser reload.

`thermite watch --input packet.json -o drawings/packet.html` watches a saved
packet request. It uses polling without a platform gate and runs until
interrupted; [view requests](views.md) gives a starter packet to save.
