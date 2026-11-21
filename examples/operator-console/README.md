# Operator console example

This example shows 24 V console power, a separate protective bond, Siemens KP8
outputs, four interface relays and a red/amber/green stack light with a buzzer.
It includes ordinary source JSON, visible component libraries and a packet request.

From the engine root, run `bun thermite.mjs packet --project examples/operator-console
--input examples/operator-console/packet.request.json -o /tmp/operator-console.html`
(on one command line). Use PDF output for a printable packet.

The input supply, protective device selection, Class 2 branch implementation,
wire suitability and HMI shell attachment remain engineering review items.
The eight external KP8 I/O points are modeled in an all-output profile: four used,
four reserved. Front keys and LEDs communicate through PROFINET; they are not
additional wired terminals. The standard KP8 is not a safety controller.

HMI required supply pins, unused remote switch pins, relay NC contacts and
unused stack leads are explicitly inventoried. Relay contacts remain separate
physical nets. XT-HMI bridges are authored conductors; +24 V, protected stack
+24 V, DC return and protective bonding remain separate groups.
