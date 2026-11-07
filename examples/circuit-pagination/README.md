# Complete-wire circuit pagination

This original synthetic example has a long chain of 18 normally closed contacts, a wire outside the selected group, one unselected contact function represented by its real terminal boundaries, and an unconnected selected lamp. The drawing selects 19 physical conductors (17 wires, one jumper and one cable core) and 20 functions. Its complete group is too wide for Tabloid landscape paper.

From the repository root:

```sh
bun thermite.mjs validate examples/circuit-pagination
bun thermite.mjs packet --project examples/circuit-pagination --input examples/circuit-pagination/packet.json -o output/circuit-pagination.html
bun thermite.mjs packet --project examples/circuit-pagination --input examples/circuit-pagination/packet.json -o output/circuit-pagination.pdf
```

The normal packet renderer splits the group into numbered parts while preserving each conductor and both endpoints together. Repeated symbols describe the same physical device. Reference rows such as `C8.1 -> P2/S01` identify other appearances of that exact physical terminal; `P` means group part and `S` means packet sheet. Parts can share a sheet. Both diagram sheets and the generated index can be used to trace the original chain. The authored review note appears once.

The default packet uses Tabloid landscape. Smaller paper may need more parts. For vertical flow, use portrait paper; a complete wire and its endpoint symbols must fit with their references. The test suite exercises both flows, four paper sizes, one/two columns and preceding views that change sheet numbering.

All models are generic fixtures. Neither contact symbols nor continuation references join physical nets. No electrical suitability or installed-device certification is implied. Generated geometry remains output, while the JSON source and byte-locked library remain authoritative. See [circuit views](../../docs/circuit-views.md).
