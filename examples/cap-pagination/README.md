# Protective cap pagination

This synthetic example shows a rack with eight protective caps, three unoccupied sockets, one socket connected to an assembly outside the selected view, and a disconnected device with two ports. The cap drawing is too large for one readable sheet, so packet rendering splits it into numbered parts. The layout may use more parts on smaller paper.

From the repository root:

```sh
bun thermite.mjs validate examples/cap-pagination
bun thermite.mjs packet --input examples/cap-pagination/packet.json --project examples/cap-pagination -o output/cap-pagination.html
bun thermite.mjs packet --input examples/cap-pagination/packet.json --project examples/cap-pagination -o output/cap-pagination.pdf
```

The packet also contains an assembly schedule and an index. Its diagram parts collectively represent all eight selected caps and all 22 originally visible ports. Both endpoints of each cap remain together. Rack bodies repeat with distinct ports; continuation captions point to other parts. The authored review note prints once. The ninth assembly and its remote device are outside the selected drawing but remain in the schedule and topology inventory.

Protective caps have no electrical pin mapping. These connector reservations create no electrical conductors or physical nets. The deliberately partial component types produce W904 review warnings; the example does not claim electrical suitability or complete component models.

The example's source and library are generic, authored fixtures. Generated SVG and PDF are output artifacts. See [connector assembly behavior](../../docs/connector-assemblies.md) and [topology coverage](../../docs/topology-coverage.md).
