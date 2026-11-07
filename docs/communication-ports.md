# Communication ports and drawings

Thermite can document Ethernet and Carlo Gavazzi NRG bus links without treating
them as electrical wires. A device type declares named `ports` alongside its
electrical `terminals`. A project uses an `associated_with` relation with a
`connection` record. Device references in JSON use designations; the compiler
resolves stable device UIDs.

Minimal local type:

```json
{
  "kind": "device_type",
  "id": "example:node",
  "terminals": {},
  "functions": {},
  "ports": {
    "ETH1": { "medium": "ethernet", "connector": "RJ45" }
  }
}
```

Given devices `PLC1` and `RIO1` with that type, author a relation with a fresh UID:

```json
{
  "uid": "a742532a-4d49-4d8a-9a57-1c1ef0a38ced",
  "kind": "relation",
  "designation": "NET01",
  "relation": "associated_with",
  "from": { "device": "PLC1" },
  "to": { "device": "RIO1" },
  "connection": {
    "fromPort": "ETH1",
    "toPort": "ETH1",
    "medium": "ethernet",
    "protocol": "PROFINET",
    "status": "planned"
  }
}
```

E204 rejects missing ports, different media, double occupancy of a physical
port, a self-link, or a relation verb other than `associated_with`. Both endpoint
devices must resolve. `medium` is `ethernet` or `nrg-bus`. The connector and
protocol strings document authored intent; they do not validate pin assignment,
cable compatibility, GSDML, firmware, runtime capability, or network operation.
Optional status is `planned` or `verified`; omitting it means unspecified.
Verification is an author assertion, not a compiler test.

Links are point-to-point port reservations. Model a switch or a device's second
port for onward connections. A logical reservation for an incompletely selected
device must be labeled as such in its library and project notes. Link metadata
is retained by inspection and semantic change review. It never joins electrical
nets, infers PoE or shield bonds, or replaces individual conductor modeling.

## Generate output

`bun thermite.mjs report network --project <project> -o network.csv`

The schedule lists each link once, including endpoint locations and status, plus
every unconnected port. Unconnected does not mean spare or available for a given
protocol. The query API exposes the same source as `buildCommunicationInventory`.

Add a communication view to a regular packet request:

```json
{
  "format": "schematic-packet-request/0.1",
  "index": true,
  "views": [
    { "format": "communication-view-request/0.1", "medium": "ethernet" },
    { "format": "documentation-view-request/0.1", "kind": "network" }
  ]
}
```

Generate through the existing `packet` command to HTML, PDF or JSON. Paper and
title blocks come from the project or packet. Optional `devices` is an array of
1-40 unique device UID/designation selectors. A filtered view includes every
incident link and its adjacent device, marked "Boundary (schedule)" when
outside the selected set. Links beyond those boundary devices are intentionally
outside the view; the complete network schedule remains authoritative.

ELK places boxes and routes orthogonal links. Ports shown in boxes are connected
ports; the schedule also includes unconnected ports. Device index references
work across these sheets and the rest of the packet. Oversized valid drawings
automatically split into numbered parts in normal packets. Every selected link
stays whole with both named ports and appears once across the parts. Original
boundary devices and isolated selected bodies stay represented. A repeated
body shows different ports of the same physical device; captions identify
ports on other parts, and reciprocal references give P (view part) and S
(actual packet sheet). The additive `communicationContinuations` sheet metadata
records the authored packet view number, source/destination parts, destination
sheet and device UID. Independent repeated views keep separate references.

Unconnected ports remain in the schedule. Pagination does not expand the
original selector beyond its incident links or infer internal forwarding,
electrical continuity or protocol operation. Fitting views keep their output,
and `prepareCommunicationDrawing` remains a single-drawing API. Invalid
original or projected layouts fail explicitly; they cannot trigger retries.
A complete link/device and its reference text that cannot fit with at least
2.5 mm printed diagram text still return R006; use a smaller selection, shorter
labels or larger paper. Existing 80-device and 100-sheet packet limits remain.
See the [bounded network example](../examples/network-pagination/README.md).
These drawings have no electrical junction dots or net highlighting. The legacy
electrical renderer and its contracts are unchanged.

Compact packets place consecutive short diagrams of the same medium on one
sheet when they fit, retaining device references and a separate caption for
each section.
Paginated communication parts keep separate sheets so their reciprocal
references remain unambiguous in both standard and compact packets.
