# Bounded communication networks

This original synthetic project has a ten-device Ethernet chain with three branches, an isolated Ethernet body and an eight-device heater bus chain. Its generic local library deliberately leaves electrical supplies and physical pinouts unspecified, producing 22 W904 review warnings, one per device. Planned links document authored topology; they do not establish electrical continuity or verify protocol operation.

The full Ethernet and heater bus drawings are too wide for readable Tabloid paper. Normal packets now partition their complete links into numbered parts. Each source link and both named endpoint ports appear once across those parts. Devices may repeat with different ports; captions identify ports on other parts and reciprocal references give the other part and actual packet sheet. Unconnected ports remain in the schedule, and the isolated device body stays visible without implying individual port coverage.

From the repository root:

```sh
bun thermite.mjs validate examples/network-pagination
bun thermite.mjs packet --project examples/network-pagination --input examples/network-pagination/packet.json -o output/network-pagination.html
bun thermite.mjs packet --project examples/network-pagination --input examples/network-pagination/packet.json -o output/network-pagination.pdf
```

The first view is a fitting device selection with its adjacent boundary device; its output stays unchanged. The following full Ethernet and heater bus views paginate, followed by the complete network schedule and indexes. Tests also cover A3, A4 and Letter, filtered boundaries, independent repeated views, compact packets, isolated bodies, minimum printed text size and invalid original/projected ELK layouts.

Pagination does not expand a selector through boundary devices, infer switch forwarding or cut a physical link between sheets. A whole link/device and its references must fit at readable size; otherwise the packet fails with R006. The 80-device drawing and 100-sheet packet limits remain. The single-drawing API remains unpaginated.

These are original generic models, not installed-device specifications. JSON and the byte-locked local library are authoritative; SVG, HTML and PDF are generated output. See [communication ports](../../docs/communication-ports.md).
