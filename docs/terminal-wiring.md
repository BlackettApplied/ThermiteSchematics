# Terminal wiring views

A packet can include `wiring-view-request/0.1` to draw a selected set of actual
wires, jumpers and fully terminated cable cores, including branching power
and relay wiring. ELK places terminal blocks and routes orthogonal paths.
The original symbol renderer and six guarded agent commands remain unchanged.

```json
{
  "format": "wiring-view-request/0.1",
  "title": "Console feeder",
  "conductors": ["W-C01", "W-C02", "W-C03", "W-C04", "W-C05"],
  "deviceOrder": ["PS24", "F-CON", "XT-MC", "XT-HMI"],
  "notes": ["Wire sizes and protection are proposed; construction review remains open."]
}
```

Select wires/jumpers by designation or UID; select cable cores as `CBL1/A`.
Duplicate identities, unresolved or ambiguous selectors and unterminated cores
are rejected. `deviceOrder` is optional and must resolve each included device
exactly once; it orients the layout, without changing electrical endpoint order.
The drawing currently supports horizontal flow. Unknown fields are rejected.

Every selected conductor is shown once. Its tag, size and color come from the
compiled source. An endpoint marked `[ +N ]` has N additional physical
connections outside this view. Other device terminals are counted and explicitly
referred to the terminal schedule. Request that schedule alongside wiring views.
A dot on a shared route represents wires meeting at their common authored
terminal, not an additional field splice. Device internals are not drawn;
contact, fuse and load functions never short their terminals in physical nets.
These are terminal wiring diagrams, not full functional symbol schematics.

Requests are bounded to 60 conductors and 30 devices. Invalid paths, bodies
crossed by routes and unreadable sheet sizes fail with R006 rather than dropping
wires or shrinking the text below the existing print threshold. Use smaller
selections or larger paper. `examples/operator-console` is a complete renderable
example with deliberately provisional engineering hardware.

Communication connections may record physical cable information separately from
wire/core nets:

```json
"cable": {
  "specification": "Industrial Cat5e RJ45",
  "lengthM": 2.4384,
  "route": "8 ft cabinet-console conduit route; service slack additional"
}
```

This optional object belongs under the relation's `connection`. Length is in metres and must be at least 0.001 m. It survives compilation, inspection, semantic review
and the network schedule. It does not create eight electrical wire cores, assert
shield bonding, certify route suitability or add an electrical cable to the
wire/core inventory. The communication schedule is the Ethernet cable inventory.
