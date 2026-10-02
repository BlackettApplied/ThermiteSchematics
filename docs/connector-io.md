# Connector I/O schedules

Remote I/O drawings sometimes identify module sockets, field devices and cordsets
without individual PLC channel or installed pin mappings. Use instance
`connectorIo` metadata to document this coverage alongside the existing terminal
channel `io` metadata. Neither creates electrical connections.

```json
{
  "connectorIo": {
    "ports": {
      "X1": { "direction": "input", "signal": "Pressure", "usage": "in-use" },
      "X3": { "usage": "spare" }
    }
  }
}
```

The type must declare real `connectorPorts`. Every port on a device with
`connectorIo` appears in the schedule, including keys omitted from `ports`.
`connectorIo: { "ports": {} }` explicitly identifies a module whose assignments
are unknown. Ordinary sensor, splitter and cap connectors do not become I/O
modules automatically. A device selector narrows this same scope; selecting a
device without `connectorIo` produces an empty connector I/O plan.

Each port assignment optionally accepts `direction` (`input`, `output` or
`bidirectional`), `signal`, `usage` (`in-use` or `spare`) and `address`.
Direction is relative to the module and authored explicitly. Omit unknown facts;
missing assignments, directions and addresses remain visible as unspecified or
unassigned. An unoccupied socket or a protective cap does not imply spare usage.
Use `connectionReview.connectorPorts` for an explicit disposition and reason.

Optional `connectorIo.addressSpace` is required when any port has an address.
E202 rejects undeclared port keys, a module with no connector ports, addresses
without an address space and case-insensitive exact address duplicates across
both channel and connector assignments in one address space. Address spaces are
case-sensitive. Addresses are opaque documentation labels; byte/word overlap,
PLC configuration and live state are not checked.

```sh
bun thermite.mjs report io-ports --project examples/connector-io -o output/io-ports.csv
bun thermite.mjs report io-ports --project examples/connector-io --device R1 -o output/io-ports.pdf
bun thermite.mjs packet --project examples/connector-io --input examples/connector-io/packet.json -o output/connector-io.html
```

CSV and printable packets share the same table. A packet request is
`{ "format": "documentation-view-request/0.1", "kind": "io-ports", "device": "R1" }`;
`device` is optional and accepts a unique designation or UID. The query API
`buildDocumentation` returns structured rows without geometry. Inspection and
semantic snapshots preserve `connectorIo` assignments.

Rows retain module/location, connector identity and description, direction,
address space/address, signal/usage, assembly identity/kind/lifecycle status,
immediate peer connector, pin mapping status/reason and connection review.
For a splitter, the peer is its trunk connector; separate branch assemblies
remain in the assembly schedule. No downstream signal assignment is inferred.
Cable and direct assemblies retain unresolved mapping; caps retain
not-applicable mapping. A library pin table never establishes the installed
cordset's wiring or joins physical nets.

These rows describe sockets, not individual pins or PLC channels. One socket may
carry multiple channels; an authored port address does not map them. Resolved
channel-to-socket and cable-to-conductor mappings are outside this format. The
existing `io` schedule continues to list terminal channels separately, with no
double counting or invented channel rows. Include both reports when a design
uses both scopes.

The [original synthetic example](../examples/connector-io/README.md) demonstrates
a port-only rack, cordset, cap, empty spare socket, splitter and separate CPU
terminal channel. It is documentation of source coverage, not a verified
electrical installation or manufacturer profile.
