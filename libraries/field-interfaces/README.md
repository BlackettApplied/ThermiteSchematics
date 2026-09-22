# Generic field interfaces

These are proposed interface contracts, not manufacturer-certified parts or
universal M12 pinouts. Select and verify actual hardware before wiring.

- `pressure-4-20ma-m12-p1-p2`: two-wire pressure transmitter, proposed M12
  A-coded interface with pin 1 loop supply and pin 2 current return. Positions
  3/4 are unused. Pressure range, process fitting and actual populated contacts
  remain unselected. Its `signal` function does not join the two nets.
- `m12-a4-bulkhead`: four independent continuous contacts through the cabinet
  boundary, with rear wiring landings. Each numbered terminal denotes one
  physical continuous contact with front/rear access, like a feed-through
  terminal. Two wires sharing that terminal are connected; different pin numbers
  are never joined. It does not model a removable plug contact state.
- `terminal-strip-6`: six independent continuous terminals, each with two
  wiring access points represented by one logical terminal. No cross-jumpers.
- `m12-a4-cordset`: proposed female sensor end and male cabinet end, four cores
  A/B/C/D, with Brown/White/Blue/Black identification. Intended straight-through
  mapping is A=1, B=2, C=3, D=4, but actual endpoints are always authored in the
  project. Length, material, conductor size, shielding and exact part are open.

Use explicit `usage: "spare"` for unused cores. A spare core terminated at both
ends still forms a physical net. An unused sensor contact does not mean the
cordset's conductor is missing. No shield or shell bonding is inferred.

The pressure symbol is a functional pressure-to-current mark. Connector symbols
show contact numbers schematically, never a mating-face orientation. Symbol
profiles are consumed by `signal-loop-view-request/0.1`; continuous legacy trace
support is not claimed for these types. See the engine's `docs/signal-loops.md`.

The pin-1/pin-2 arrangement has a manufacturer example in the
[ifm PT5400 datasheet](https://media.ifm.com/dam/6f573516-aaea-4ad8-803a-575ac767d744/Original/PT5400-01_NL-NL.pdf),
electrical connection, revision 2023-04-13. The same document identifies a
different return pin for another product family. This library does not select
PT5400 or copy its pressure range, fitting or populated-contact drawing.
[Phoenix Contact 1501618](https://www.phoenixcontact.com/en-pc/products/flush-type-connector-sacc-e-m12fs-4con-m16-05-1501618)
is an example of an M12 cabinet receptacle with internal leads; this generic
rear-terminal model does not claim that exact connector's termination method.

## Proposed powered analog actuators

`pressure-regulator-m12-proposed` reserves a 4-20 mA pump pressure command;
`ram-valve-m12-proposed` reserves a +/-10 V directional valve with onboard
control electronics. Both use `thermite:analog-actuator` functional boxes.
These are interface proposals, with no selected manufacturer part or hydraulic
spool/port geometry. Proposed pins: 1 = +24 V operating power, 3 = 0 V power,
2 = command positive, 4 = command return. Power and command remain four distinct
nets; neither device function connects them. No PE, shield, enable input,
actual-position feedback or power/command commoning is inferred.

`m12-a4-actuator-cordset` records the proposed four-core command/power cable;
connector gender, coding, current rating, wire size, shielding and mating parts
must be selected. Do not apply this pin map to a purchased Rexroth valve.
For example, the [Rexroth 4WRZ(E) selector](https://www.boschrexroth.com/ics/Projects/GenericSelector/?ProductArea=4WRZ_E&c=gb&language=en)
lists onboard electronics, 24 V supply, +/-10 V or 4-20 mA interfaces, and
DIN EN connector options. It does not establish this proposed M12 pinout.
Exact product selection may require another connector, additional cores or
an explicitly documented interface adapter.

`terminal-strip-8-aux` has eight independent feed-through contacts. Its `aux1`
(3/4) and `aux2` (7/8) functions identify proposed power-feed pairs. The feed
labels explicitly say TBD: this is a marshalling reservation, not a power
supply. Use `auxiliary` in the loop request to include complete authored power
paths through the same bulkhead and cable. Omission of an active power core
fails the loop view instead of disguising it as a spare.
