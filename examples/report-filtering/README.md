# Report and reference filtering

This original synthetic project has two controllers, field interfaces, terminal strips and documentary network boundary nodes. It includes physical wires, a jumper, two partly terminated cables, an entirely loose cable and two connector assemblies with unresolved mapping. Seven deliberately partial device models produce W904 warnings; source topology and all warnings remain authoritative.

The packet draws the complete network, selects TB1's full terminal inventory, and filters the network and BOM reports to the Main location while excluding the documentary type. Complete peer details remain in retained report rows. A separate reference filter lists diagram appearances of operating interfaces while excluding documentary bodies from the reference table; those bodies and links still appear in the diagram. Selection metadata records omitted rows/groups and unscoped cable records.

From the repository root:

```sh
bun thermite.mjs validate examples/report-filtering
bun thermite.mjs packet --project examples/report-filtering --input examples/report-filtering/packet.json -o output/report-filtering.html
bun thermite.mjs packet --project examples/report-filtering --input examples/report-filtering/packet.json -o output/report-filtering.pdf
bun thermite.mjs report bom --project examples/report-filtering --filter examples/report-filtering/main.filter.json -o output/filtered-bom.csv
```

Preserve the CLI's stderr JSON to audit filtered CSV selection. Filtered BOM quantities count selected device instances, while retained cables remain whole. The entirely loose cable stays visible because no device endpoint can classify it. Unknown selectors fail, and an intentional empty selection does not expand to the full project.

These are generic original models, not installed-device specifications. JSON and the byte-locked local library are authoritative; SVG, HTML, PDF and CSV are generated output. See [selection rules and metadata](../../docs/report-filtering.md).
