# Synthetic assembly and network coverage

This original fixture combines a four-socket rack, pressure sensor, protective
cap, Y splitter and another field sensor with illustrative Ethernet/bus links.
N3 is a disconnected device with both connector and communication ports. These
are synthetic definitions and documentation states, not manufacturer or
installed-machine claims. Required sensor power terminals remain unconnected;
expected W903/W904 warnings are preserved.

The supplied packet selects every one of four assemblies and three
communication links. It individually draws ten of eleven connector ports and
six of fifteen communication ports. N3's body is drawn, but its ports are not:
the inventory reports them outside audited views. Assembly/network schedules
also appear, without contributing diagram coverage.

R1.X2 and R1.X4 appear outside the W1 projection, then their occupying
assemblies appear in later views. Y1.B is explicitly drawn unoccupied; no internal
splitter wiring is inferred. Cable mapping remains unresolved; cap mapping is
not applicable. Planned network links do not imply live protocol operation.

After building the source checkout:

```sh
bun thermite.mjs validate examples/topology-coverage
bun thermite.mjs packet --project examples/topology-coverage --input examples/topology-coverage/packet.json --json -o output/topology.json
bun thermite.mjs packet --project examples/topology-coverage --input examples/topology-coverage/packet.json -o output/topology.html
```

Inspect `coverage.topology` in the JSON for identities, exact endpoints, mapping
metadata and sheet appearances. The original circuit/wiring inventory stays
separate: this fixture has no modeled conductors. See the
[coverage contract](../../docs/topology-coverage.md).
