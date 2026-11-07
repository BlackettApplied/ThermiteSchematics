# Functional symbol demonstration

This original synthetic project exercises circuit-only symbols without customer
or manufacturer drawing data. It includes a dual-primary transformer with an
explicit series jumper, an AC/DC supply, pressure and float contacts, level and
conductivity interfaces, a level output with its channel meaning, a receptacle with a separate PE terminal, and a complete
twelve-pin generic interface. No manufacturer identity, ratings, trip behavior,
GFCI protection or additional internal connections are claimed.

```sh
bun thermite.mjs validate examples/functional-symbols
bun thermite.mjs packet --project examples/functional-symbols --input examples/functional-symbols/packet-left-to-right.request.json -o examples/functional-symbols/out/horizontal.pdf
bun thermite.mjs packet --project examples/functional-symbols --input examples/functional-symbols/packet-top-to-bottom.request.json -o examples/functional-symbols/out/vertical.pdf
bun thermite.mjs packet --project examples/functional-symbols --input examples/functional-symbols/packet-left-to-right.request.json -o examples/functional-symbols/out/coverage.json
```

The saved requests are repeatable views of authoritative `source.json`. Packet
JSON reports all 15 conductors and 15 functions in audited circuit views, with
sheet/group appearances and the exact conductor endpoint identities. Terminal
schedules and indexes are separately listed as unaudited sheets. Selecting fewer
groups produces an explicit outside-audited-views inventory.

The local teaching types are deliberately partial and preserve ten W904 model
coverage warnings. Their optional interfaces and physical equipment details are
unspecified. The twelve-pin interface shows all pins, including the eight
unconnected pins; unconnected does not imply spare. No protective bond is
invented for the receptacle's unconnected PE terminal. This is a drawing and
coverage fixture, not a usable electrical design or a reviewed purchasing list.

The original continuous renderer is unchanged. These additional profiles are
supported by source-selected circuit views, with terminal wiring and schedules
available for other documentation purposes.
