# Cable assignments

Cable JSON adds optional `fromLocation`, `toLocation`, and conductor `usage`
(`in-use` or `spare`). Endpoint slots are end A and end B for an annotated cable.
A null endpoint is permitted only for an explicit spare; this cross-field rule
is enforced by the schema package's structural validation (like duplicate core
IDs and identical endpoint checks).

- Two endpoints create the same physical connection regardless of usage.
- One endpoint occupies a terminal but does not invent another endpoint or net.
- Two null endpoints describe an unterminated spare.
- No assignment means unassigned, not spare.
- Legacy assignments without usage remain unspecified; their old canonical
  endpoint ordering and net IDs remain compatible.

The compiler preserves authored A/B order in optional cable `assignments`
metadata. Its connected-conductor topology tables remain reserved for complete
physical endpoint pairs. Invalid dangling core IDs still report E200; partial
terminations participate in E201 exclusive-terminal checks. The old engineering
rules and diagnostic suppression order remain in force.

`buildCableSchedule(ir, cableUid)` returns every physical type core and totals.
New annotated cable queries include that schedule alongside the old connected
conductor list. `netId` identifies a complete physical core connection; null
means there is no complete connection, not that an attached end is de-energized.
Shielded construction is independent of authored shield bonding.

See the [formats and compatibility hub](formats-and-compatibility.md#cable-assignments).
