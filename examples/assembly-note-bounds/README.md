# Assembly notes and readable sheet bounds

This original synthetic fixture selects a nine-socket rack and one field cordset. All ten endpoint/socket ports are visible. The library deliberately omits terminal pinouts and produces two W904 review warnings; cable pin mapping remains unresolved.

On Tabloid landscape paper, the diagram fits before its notes are added. The previous packet composer rejected the combined content with `Diagram notes exceed the sheet bounds.` The composer now reserves note space and uses the existing limited diagram scaling, retaining the complete drawing and both generated and authored notes. Diagram text remains at least 2.5 mm tall; notes print at 2.5 mm.

From the repository root:

```sh
bun thermite.mjs validate examples/assembly-note-bounds
bun thermite.mjs packet --project examples/assembly-note-bounds --input examples/assembly-note-bounds/packet.json -o output/assembly-note-bounds.html
bun thermite.mjs packet --project examples/assembly-note-bounds --input examples/assembly-note-bounds/packet.json -o output/assembly-note-bounds.pdf
```

The tests also exercise wide letters, repeated digits, unbroken tokens and ordinary note text on Tabloid, A3, A4 and Letter. They check the resulting line widths against the bundled PDF font. Notes that would force the diagram below its readable minimum still fail explicitly; there is no incomplete successful packet or automatic note-only sheet.

These are generic models and original source data, not installed-device specifications. Connector assemblies do not create electrical conductors or nets. JSON source and the byte-locked local library remain authoritative; SVG, HTML and PDF are generated output. See [connector assemblies](../../docs/connector-assemblies.md).
