# Assembly and communication coverage

Every successful packet JSON includes `coverage.topology` with format
`schematic-topology-coverage/0.1` and scope
`connector-assemblies-and-communications`. It complements the existing
`coverage` circuit/wiring inventory; that inventory's format, scope, counts and
`unauditedSheets` keep their existing meaning.

The topology inventory lists every compiled connector assembly, communication
link, declared connector port, declared communication port and device with
either kind of port. Each collection has `total`, `represented` and
`outsideAuditedViews` counts. Repeated appearances count once as represented,
while all sheet/view appearances remain available. Devices without either port
namespace are outside this inventory's scope.

Assembly and link entries retain stable relation UID, designation, ordered
`endpoints: [{ deviceUid, portKey }, ...]` and the complete authored `assembly`
or `connection` metadata. This preserves protective caps, unresolved mapping
reasons, specifications, protocol and lifecycle status without inferring wiring
or live network state.

Ports have stable `id: JSON.stringify([deviceUid, portKey])`, device/port identity,
designation, connector description and the occupying `relationUid` (or null).
The connector and communication collections remain separate namespaces. Port
appearances additionally distinguish:

- `represented-link`: the occupying relation is drawn in that projection.
- `outside-view`: the port is individually drawn, but its assembly/link is
  outside that projection.
- `unoccupied`: no authored relation occupies the port.

Only individually drawn ports count as represented. Assembly captions such as
“3 other ports: schedule” do not represent those individual ports. Current
communication drawings show link endpoint ports; unconnected communication
ports remain outside audited views even when their device body is drawn.
Disconnected selected device bodies count as device appearances, without
claiming coverage of their invisible ports.

`topology.unauditedSheets` identifies sheets with no assembly/communication
drawing projection, independently of `coverage.unauditedSheets`. Schedules,
indexes, references and circuit/wiring diagrams never count as topology
appearances. An entry outside audited views may appear elsewhere; it is not
proof of omission from the whole packet or source drawing.

## Conservation and output inspection

Before a topology packet succeeds, the renderer verifies that ELK conserved
the selected device, port and relation IDs exactly once. Output order may change;
IDs determine source association. Fixed node dimensions and local port positions
must match the renderer's declared geometry. Named source/target ports and continuous route
endpoints must agree with the selected source. A missing, duplicate, reassigned
or detached layout element fails with R006 rather than reporting successful
coverage. These checks are about source conservation, not engineering validity.

Assembly SVG already carries `data-connector-assembly`,
`data-assembly-endpoints`, `data-pin-mapping`, `data-device-uid` and
`data-connector-port`. Communication SVG additionally carries
`data-communication-link`, `data-communication-endpoints`, `data-device-uid`
and `data-communication-port`. Endpoint attributes use the same ordered port
identities as the JSON inventory. SVG remains generated evidence, not electrical
source.

The [original synthetic example](../examples/topology-coverage/README.md)
demonstrates mixed assembly/network selection, caps, splitters, outside-view
ports and a disconnected device. From the built source checkout:

```sh
bun thermite.mjs packet --project examples/topology-coverage --input examples/topology-coverage/packet.json --json -o output/topology.json
```

Coverage inventories source-selected drawings. Visual readability, upstream
electrical supply, installed pin wiring, port compatibility, protocol operation
and approved network configuration require separate review. No physical nets,
terminal channels or conductor assignments are created by this inventory.
