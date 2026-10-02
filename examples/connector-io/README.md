# Synthetic connector I/O example

This original fixture demonstrates the [connector I/O schedule](../../docs/connector-io.md)
without manufacturer or installed-machine claims. All addresses are illustrative.

- R1 has four connector-only sockets: X1 feeds a pressure sensor through W1;
  X2 is capped; X3 is explicitly spare and unoccupied; X4 reaches splitter Y1.
- Y1's branch A reaches S2 through W3; branch B is unoccupied. The rack row
  identifies Y1.IN as its immediate endpoint, leaving branch detail to the
  assembly schedule.
- PLC1 has one separate terminal channel and an authored address. Its terminal
  channel appears only in `io`; R1's four socket positions appear only in
  `io-ports`. Unknown socket directions, addresses and assignments stay visible.
- Cordset pin mapping is unresolved; cap mapping is not applicable. Sensor
  power terminals remain required and unconnected. W903/W904 diagnostics are
  expected: this partial documentation is not an electrically complete design.

From the source checkout, after `bun run build`:

```sh
bun thermite.mjs validate examples/connector-io
bun thermite.mjs report io-ports --project examples/connector-io -o output/io-ports.csv
bun thermite.mjs packet --project examples/connector-io --input examples/connector-io/packet.json -o output/connector-io.pdf
```

The packet includes socket, terminal-channel and assembly schedules. Generated
drawings are review evidence; the authoritative source is `source.json` and
the explicit local `library/`, bound by `electrical-system.lock.json`.
