# Field-device hookup drawings

A signal-loop packet view shows a two-wire transmitter as a device, then follows
each of its two separate electrical nets through authored cable cores and cabinet
wiring to a selected input channel. This complements cable conductor schedules;
it does not replace the original continuous schematic renderer.

```json
{
  "format": "schematic-packet-request/0.1",
  "page": { "size": "tabloid", "orientation": "landscape" },
  "views": [{
    "format": "signal-loop-view-request/0.1",
    "from": { "device": "PT1", "function": "signal" },
    "to": { "device": "AI1", "function": "ch0" },
    "flow": "left-to-right",
    "notes": ["Proposed connector pin map; verify the selected hardware before wiring."]
  }]
}
```

Save this as `loop.request.json` and run:

```sh
node /path/to/thermite/thermite.mjs packet --project . --input loop.request.json -o drawings/loop.html
```

Use `.pdf` for a vector PDF. The same view works in a mixed packet with cable,
network and inventory views. `top-to-bottom` uses a vertical device chain;
Tabloid portrait is suitable for the four-device example. Page size remains a
packet or presentation setting. Fonts never shrink below the sheet renderer's
readability limit: choose another flow or larger paper if R006 reports no fit.

## Library and source example

The visible [field-interfaces library](../libraries/field-interfaces/README.md)
provides proposed M12 pressure-transmitter, bulkhead, terminal-strip and four-core
cordset types. It is opt-in: copy it into the electrical project's libraries
directory, reference its explicit path in `system.json`, lock, then validate.
Exact pressure range, process fitting, pinout and purchase parts remain engineering
selections. M12 does not establish a universal sensor pinout.

[The minimal source fixture](../packages/cli/fixtures/signal-loop/source.json)
contains PT1 → CB1 → XP1 → XT1 → AI1, with pins 1/2 active, 3/4 explicitly spare,
four cabinet wires and the exact Siemens UV0/2I0+ input landing pair. The
[executable fixture test](../packages/cli/test/signal-loop.test.ts) copies the
two visible libraries and creates the manifest and lock in a temporary project.
No machine-project data is required.

## Conductivity and completeness

- Wires, jumpers and cable cores are the only steps between terminal identities.
  A transmitter or input function never shorts its two terminals together.
- Each bulkhead pin and feed-through terminal is one continuous contact with
  two wiring access points. The repeated number on the two sides denotes the
  same terminal, not a hidden wire or an automatic connection between pins.
- The selected function must have two terminals on distinct nets. Both paths
  must be complete, unbranched and traverse the same device chain, up to eight
  stages. Intermediate profiles must explicitly declare a bulkhead or terminal
  strip symbol. Supply distribution outside the selected channel is not shown.
- Every core of every traversed cable is included. Additional cores must belong to an explicit auxiliary pair (below), or be
  explicitly spare, terminate at both ends, stay between adjacent stages and
  have no hidden onward connections. Dashed lines are still physical conductors.
  Loose or unassigned cores require a conductor view; additional active cores or
  branches require a more complete view. R006 explains these unsupported cases.
- Sensor symbols are functional pressure-to-current marks. Connector contact
  numbers are schematic labels, not mating-face views or mechanical orientation.

The request is closed: only `format`, `from`, `to`, `flow`, `notes`,
`cableAssemblies`, `enclosures` and `auxiliary` are allowed.
Selectors accept a unique device designation or UID and a function key. Notes
allow at most six nonempty strings, each at most 240 characters. Source profiles
`thermite:pressure-transmitter` and `thermite:two-wire-transmitter` are supported;
the latter uses a rectangular device body. Target functions must be two-terminal
input channels. Alternatively, a two-terminal output channel can drive a
`thermite:analog-actuator` endpoint. Branched loops and split-chain wiring are
explicitly unsupported. No wiring or layout is synthesized by an agent.

## Cable assemblies and cabinet boundaries

To show a molded cable as one physical assembly, add explicit display options to
the same view. The underlying electrical source and core inventory stay intact.

```json
{
  "format": "signal-loop-view-request/0.1",
  "from": { "device": "PT1", "function": "signal" },
  "to": { "device": "AI1", "function": "ch0" },
  "cableAssemblies": [{
    "cable": "CB1",
    "connector": "M12",
    "description": "4-pole A-coded molded cordset (proposed)"
  }],
  "enclosures": [{
    "label": "Main electrical cabinet",
    "devices": ["XP1", "XT1", "AI1"],
    "wallDevice": "XP1"
  }]
}
```

`cableAssemblies` selects individual cables by designation or UID. The heavy
jacket line and grouped connector glyphs represent the assembly, not a shared
net or exposed conductor breakout. Core colors are absent from the overview.
Every pin pair is derived from actual endpoints and printed beside the cable;
spares retain their explicit designation. Mapping direction follows `from` toward `to` (transmitter toward input or
output toward actuator), independent of authored end A/B order. A non-straight pin map is
printed as authored, never silently converted to straight-through wiring. Full
core IDs, endpoints and separate net IDs also remain in the SVG description.

Connector labels and assembly descriptions are explicit presentation claims;
the engine does not infer connector family or molded construction from the word
"cable" or from wire colors. Keep proposed hardware labeled as such. All cores
must end on the same pair of devices, and only one grouped assembly on each
input/output face of a device is currently supported. Other cables keep the
individual-conductor presentation. Removing `cableAssemblies` restores the fully
expanded view, including color labels. This version does not introduce a physical
pigtail/breakout drawing style.

`enclosures` declares the devices shown inside each dashed cabinet boundary.
Free-form location strings do not establish a location hierarchy, so membership
is never guessed. Only displayed devices may be listed; use a unique label and
disjoint, contiguous groups in the selected chain. An optional `wallDevice` must
be the group's first or last device, have a bulkhead profile, and accompany at
least one interior device. It straddles the entry or exit wall; the rest sit inside. Omit
`wallDevice` for a group fully inside an enclosure. The renderer rejects overlapping
boundaries and any boundary that would surround an unassigned device. These are
schematic location boundaries, not cabinet dimensions or mechanical layouts.

At most seven cable assembly options and four enclosure groups may be supplied.
Each assembly requires `cable`, `connector` (up to 8 characters), and `description`
(up to 120). Each enclosure requires `label` (up to 80) and `devices` (up to eight),
with optional `wallDevice`. Selector strings are limited to 100 characters. Unknown
fields, ambiguous or repeated selectors and text that cannot fit fail explicitly.
Both options are compatible with horizontal and vertical flow and the usual
packet search, device references, PDF export and output-file protections.


## Powered analog output devices

An output view follows the actual command from a declared two-terminal output
channel to an actuator's two-terminal command function. A separate `auxiliary`
array can select up to two additional function pairs, for example operating
power from a terminal strip through the same bulkhead and cordset. Each pair
contains only `from` and `to`, using the same two-field selectors as the main
request. Both conductors must be complete and unbranched, travel forward along
a contiguous part of the main device chain and occupy nets distinct from every
other selected pair. Additional branches and unrelated active cable cores still
fail R006. Do not label a required power conductor as spare to obtain a drawing.

```json
{
  "format": "signal-loop-view-request/0.1",
  "from": { "device": "AQ1", "function": "ch3" },
  "to": { "device": "V1", "function": "command" },
  "auxiliary": [{
    "from": { "device": "XT1", "function": "aux1" },
    "to": { "device": "V1", "function": "supply" }
  }],
  "cableAssemblies": [{
    "cable": "CB1", "connector": "M12",
    "description": "4-pole command + power cordset (proposed)"
  }],
  "enclosures": [{
    "label": "Main cabinet", "devices": ["AQ1", "XT1", "XP1"],
    "wallDevice": "XP1"
  }]
}
```

See the [minimal voltage output fixture](../packages/cli/fixtures/analog-output/source.json),
its [packet request](../packages/cli/fixtures/analog-output/packet.request.json),
and the [executable current/voltage tests](../packages/cli/test/analog-output.test.ts).
The proposed valve appears as an electrical functional box, with command and
power pins labeled. No hydraulic spool geometry, PE, shielding, enable signal,
feedback or internal return commoning is inferred. Actual part selection may
require different connectors, more wires and a more complete view.

Power-feed terminals in this fixture are explicitly unfinished marshalling
points. Showing a complete cordset does not establish a complete upstream power
supply circuit. Their labels say `feed TBD`; selected auxiliary functions also
appear in device references. Intermediate schematic contacts may be ordered to
match the actuator connector and reduce crossings. Actual terminal identities
and net IDs are preserved; the drawing is not a physical terminal-strip layout.
ELK still owns all device placement and orthogonal routing.
