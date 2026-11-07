# RM3 generic interface inventory

This synthetic fixture contains every basic-machine inventory item from RM3,
plus a dry-contact level switch, junction box and a second relay for a PLC output
sample. It uses only shipped core 0.2.0. It is an interface and rendering fixture,
not a selected, rated or operational machine design.

`starter.json` retains the DOL starter's supply, motor power train and control
circuit. `automation.json` adds the larger PLC, HMI, operators and sensors. All
18 PLC channels have authored logical addresses; 7 are in use and 11 explicitly
spare. The four-core sensor cordset has three connected cores and one loose
spare end. Ethernet is a separate planned relation, with connector and protocol
unspecified, and never joins electrical nets.

The transmitter-to-AI harness has two separate nets through the single-pair cable
and terminal strip. It is deliberately unpowered. It demonstrates two-ended
interface continuity and the existing signal-loop profile; it does not assert
loop power, a current shunt, a configured AI mode or electrical compatibility.
A normal passive-input loop wired through an external power supply fails R006,
with or without an auxiliary supply pair; only the direct TX-to-AI harness draws
today. This is a renderer gap, not a reason to substitute the unpowered harness
for a complete machine loop. Select and review actual loop hardware before service.

`specimens.json` contains the remaining 1P/2P breakers, 2P/3P fuses and a separate
three-pole disconnect. These optional-pole inventory specimens are unconnected;
no pole is selected for service. The original DS1 remains unwired. A separate
test extension inserts its three poles between SRC1 and Q1 in a scratch copy,
adding three wires and retaining the separate PE connection. It exercises
[`disconnector-power.request.json`](disconnector-power.request.json) in both
flows. The request selects M1's power path; the test materializes the connected
source variant before rendering it. Its open poles use the disconnector mark,
with authored ganging and terminal identity. This asserts function identity;
isolation suitability, load-break, ratings and operation means remain unassessed.
RM3 tests draw every circuit-supported device function, the transmitter signal
loop, all cable cores and the Ethernet link in both flows. The matrix separately
pins every catalog family and the rooted successes/gaps, including the
disconnector's power binding and control parity. The packet audit covers circuit/wiring drawings;
it does not yet count signal-loop or conductor-inventory sheets. Tests check
the actual SVG records for those views separately.

Validation has zero errors and warnings, with one honest I304 notice about an
unassessed rated net. Completeness has zero missing required points and I003;
generic and optional/spare connection information remains visible.

PLC/HMI supplies declare DC class without a voltage magnitude. Each supply has
a loads binding. The complete PS1 loads view draws B1, HMI1 and PLC1 in both
flows, alongside the individual-supply probes. The larger PLC's AI pairs are separate;
isolation and shared returns unspecified.
