# ET 200pro connector example

This synthetic fixture demonstrates seven exact library types. Generic field
boundaries stand in for unspecified sensors, actuators, and upstream supplies.
It does not model a powered rack, channel configuration, trip settings, or a
complete installation.

From the repository root, after the normal source build:

```sh
node thermite.mjs validate libraries/siemens-et200pro-pilot/examples/connector-wiring
node libraries/siemens-et200pro-pilot/examples/connector-wiring/verify.mjs
node thermite.mjs packet --project libraries/siemens-et200pro-pilot/examples/connector-wiring --input libraries/siemens-et200pro-pilot/examples/connector-wiring/packet.json --output /tmp/thermite-et200pro-example.html
```

The example chooses the first SITOP +24 V/0 V duplicate screws and marks those
application-specific connections required. Its first two outputs feed a
synthetic breakout. Five separately authored conductors connect that breakout
to the IM's X03 power pins. The `HARNESS` assembly separately records physical
connector occupancy; its metadata does not create or prove that pin map.

Each I/O model has an explicit channel-0 wiring example. Differential signal
pins remain distinct from one another and from the 1M supply return. DI uses
pin 4; pin 2 on its eight-socket connection module remains unassigned. The
backplane power supply is intentionally outside this fixture and is recorded
in each type's partial-coverage warning.

After an intentional library change, regenerate this example's lock before
validation:

```sh
node thermite.mjs lock libraries/siemens-et200pro-pilot/examples/connector-wiring
```
