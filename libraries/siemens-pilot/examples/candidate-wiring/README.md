# Siemens candidate connector example

This small electrical source project demonstrates three exact Siemens library
items independently researched while studying the supplied legacy machine
schematics. They are candidates for the library, not identified replacements
for that machine's abbreviated drawing blocks.

It connects CPU AC power, TC module DC power, HMI DC power, their separate
functional-earth points and one differential thermocouple channel. The source
boundary is deliberately abstract. This example does not specify an installation's
power supplies, protection, bonds, conductor sizes, TC alloy or PLC configuration.

From the Thermite repository root:

```sh
node thermite.mjs lock libraries/siemens-pilot/examples/candidate-wiring
node thermite.mjs validate libraries/siemens-pilot/examples/candidate-wiring
node libraries/siemens-pilot/examples/candidate-wiring/verify.mjs
node thermite.mjs packet --project libraries/siemens-pilot/examples/candidate-wiring --input libraries/siemens-pilot/examples/candidate-wiring/packet.json --paper tabloid -o alpha-out/siemens-candidate-wiring.html
```

The packet contains two terminal wiring sheets. To export PDF, change the output
extension to `.pdf`. Five W904 warnings describe the intentionally partial
models; required power is connected, so this example has no W903 missing-power
warnings. Unused channels/interfaces remain visible to completeness diagnostics
and schedules.

The CPU's 38 field terminals, TC module's 14 connector positions and HMI's
28 terminal positions plus two Ethernet sockets are source-backed inventories.
The TC connector's manufacturer-designated unassigned positions are explicitly
present. Pin assignments and coverage boundaries are documented in each type's
catalog. The physical TC leads remain separate nets: a channel function does not
short its input pair, and no functional-earth/power-return bond is inferred.

The verification script checks inventory counts, distinct power/earth/TC nets,
two-sheet rendering, missing-power warnings for each device and stale-library
lock rejection. Negative checks use a temporary copy and leave this example intact.
