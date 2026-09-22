# Phoenix Contact terminal pilot

Four individually sourced terminal blocks provide ordinary wire-clamp inventories
and circuit symbols. They were selected from a representative industrial
materials list. Catalog identity does not establish purchase or installation.

| Type suffix (`phoenix-terminal-pilot:`) | Product           | Color | Ordinary clamps | Fixed common groups      |
| --------------------------------------- | ----------------- | ----- | --------------- | ------------------------ |
| `3031306`                               | ST 2,5-QUATTRO    | Gray  | A1, A2, B1, B2  | All four                 |
| `3031319`                               | ST 2,5-QUATTRO BU | Blue  | A1, A2, B1, B2  | All four                 |
| `3036356`                               | ST 2,5-TWIN-MT    | Gray  | A1, A2, B1      | A1 + A2; B1 across knife |
| `3036149`                               | ST 16             | Gray  | A1, B1          | Both                     |

A/B identifiers are neutral authoring labels, not printed Phoenix terminal
numbers or project terminal-strip positions. A is the left side of the cited
manufacturer circuit diagram, B its right side. Reversing a block on the rail
does not change the electrical identity of these points.

The ordinary clamps are passive and may be unused, so none is universally
required. A project may require a selected connection through `connectionReview`.
These are ordinary blocks, not PE blocks; no rail bond, shield terminal or power
supply connection is inferred. The blue variant does not establish intrinsic
safety of a circuit.

The source revision is the official 2011 CLIPLINE catalog. Its nominal IEC data
are 800 V / 24 A for QUATTRO, 400 V / 20 A for TWIN-MT and 1000 V / 76 A for ST16.
The [evidence notes](evidence/sources.md) preserve conductor conditions and the
older ST16 800 V data-sheet discrepancy. These values are capabilities, not
application voltage, fuse sizing or unconditional clamp ampacity. Aggregate
current, conductor preparation, bridge selection and approval-specific limits
need separate review.

## Continuity and coverage

The engine does not infer physical continuity from device functions. For each
instance, explicitly author the factory common groups as project `jumper`
objects. The [example](examples/terminal-wiring/README.md) demonstrates these
links and labels them `INTERNAL`. They document the busbar inside one terminal
block, not additional installation wires or purchased FBS bridge accessories.

For the TWIN-MT, only A1-A2 is permanently common. The `knife` function has an
open reference position, as drawn in the manufacturer diagram. It does not join
A1 to B1, even if a later model changes the depicted position. Do not replace
the switch with a permanent jumper. This version does not simulate switch state.

`connection_policy: shared` permits a modelled internal jumper and an external
lead to land on the same authored point. It does not certify multiple conductors
under one clamp. Likewise, an internal jumper can satisfy a terminal-presence
check without proving an external supply; completeness diagnostics are not a
source-tracing or busbar-completeness check.

All four models retain `connectionCoverage: partial`: ordinary wire clamps are
inventoried, but accessory bridge shafts, test interfaces, optional accessories
and physical clamp-occupancy limits are not modeled. Every new project must
carry the fixed common groups explicitly; missing internal jumpers are not
automatically diagnosed. The fixture verifies this limitation instead of hiding
it behind an implicit net join.

No manufacturer manuals or source-machine drawings are redistributed here.

## Validation

After the repository source build:

```sh
node thermite.mjs validate libraries/phoenix-terminal-pilot/examples/terminal-wiring
node libraries/phoenix-terminal-pilot/examples/terminal-wiring/verify.mjs
```

The checks exercise 13 catalog wire points, 13 synthetic external leads, eight
explicit internal-common jumpers, four complete circuit sheets, passive-clamp
requirements, knife net separation, missing internal links and byte-lock errors.
The normal result retains four W904 partial-coverage warnings.
