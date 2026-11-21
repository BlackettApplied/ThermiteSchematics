# Field-device hookup drawings

A direct signal-loop packet view shows a two-wire transmitter as a device, then follows
each of its two separate electrical nets through authored cable cores and cabinet
wiring to a selected input channel. This complements cable conductor schedules;
it does not replace the original continuous schematic renderer. Explicit series
loop power selects three separate nets, as described below.

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
bun /path/to/thermite/thermite.mjs packet --project . --input loop.request.json -o drawings/loop.html
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
  strip symbol. Without `loopPower`, supply distribution outside the selected
  channel is not shown.
- Every core of every traversed cable is included. Additional cores must belong to an explicit auxiliary pair (below), or be
  explicitly spare, terminate at both ends, stay between adjacent stages and
  have no hidden onward connections. Dashed lines are still physical conductors.
  Loose or unassigned cores require a conductor view; additional active cores or
  branches require a more complete view. R006 explains these unsupported cases.
- Sensor symbols are functional pressure-to-current marks. Connector contact
  numbers are schematic labels, not mating-face views or mechanical orientation.

Cable `fromLocation` and `toLocation` name ends A and B; conductor `endpoints`
has exactly two slots in that order. Only explicitly spare cores permit null
endpoints. Two real ends remain connected even for a spare, and a single real
end still occupies its terminal. Omitted cores are unassigned, never implicitly
spare. A core without usage is unspecified; without usage or locations, a cable
uses canonical end order. Shield construction never implies a shield bond.

The request is closed: only `format`, `from`, `to`, `flow`, `notes`,
`cableAssemblies`, `enclosures`, `auxiliary` and `loopPower` are allowed.
Selectors accept a unique device designation or UID and a function key. Notes
allow at most six nonempty strings, each at most 240 characters. Source profiles
`thermite:pressure-transmitter` and `thermite:two-wire-transmitter` are supported;
the latter uses a rectangular device body. Target functions must be two-terminal
input channels. Alternatively, a two-terminal output channel can drive a
`thermite:analog-actuator` endpoint. Branches away from the selected series supply and split field chains are
unsupported. No wiring or layout is synthesized by an agent.

Direct transmitter-to-input loops use the exact transmitter and input role pairs
listed below. A recognized reversal refuses with R006, naming both terminals and
roles. Unrecognized endpoint polarity prints
`polarity not verified: {endpoint references}.`
below the hookup explanation, in SVG `desc` and in enabled packet references;
endpoints are sorted by designation and function. Terminal numbers come only from
the selected function's authored bindings, in authored order; this order assigns
no polarity. One binding prints `D terminal T1`; multiple bindings print
`D terminals {terminal set}`. Exactly two terminals use an en dash unless their bare keys form a range-like pair: the same case-sensitive letter prefix (possibly empty) followed by integers differing by more than one. Thus `9 / 13`, `AI3 / AI7`, `L1 / L3` and `X2 / X5` are lists, while `13–14`, `A1–A2`, `H1–H2`, `X1–X2` and `L–N` retain the en dash. Prefixes are Unicode letters and integer suffixes are decimal digits; no element identity is inferred. A shared designation does not affect this parse. The strings actually printed, including any designation, must contain none of `-`, `–`, `−` or `+` for an en dash. Other sets use ` / `; if a printed name contains `/`, that list separator becomes `, `. Authored order is retained. Thus the input-channel set `{9, 13}` prints `9 / 13`; `A1–A2` is consecutive and stays unchanged.
The same formatter is used for references and other terminal sets. All authored
bindings are written out fully, without an ellipsis. If bindings are unavailable,
the designation alone is printed.
Function keys are never used as note labels. The note adds no warning, so a
clean `--strict` stays clean. Nothing is inferred from terminal names, descriptions
or function order. Output-to-actuator views and auxiliary pairs keep their existing
behavior.

## Series loop power

Opt in with `loopPower`; the engine never discovers a supply or changes wiring.
Without this key the direct-loop behavior is unchanged. The following packet
runs against the separate [series-loop fixture](../packages/core-library/test/fixtures/series-loop/system.json):

```json
{
  "format": "schematic-packet-request/0.1",
  "index": false,
  "page": { "size": "tabloid", "orientation": "portrait" },
  "views": [{
    "format": "signal-loop-view-request/0.1",
    "from": { "device": "TX1", "function": "signal" },
    "to": { "device": "PLC1", "function": "ai0" },
    "loopPower": { "device": "PS1", "function": "dc_output" },
    "flow": "top-to-bottom"
  }]
}
```

Save the packet as a request and run `thermite packet --project <project> --input <request> -o drawings/series.html`.
The committed [RM2 request](../packages/core-library/test/fixtures/series-loop/rm2.request.json)
uses horizontal individual-core presentation; the [RM3 request](../packages/core-library/test/fixtures/series-loop/rm3.request.json)
uses vertical flow with an explicit single-pair cable assembly. Both also run against the
new normally locked powered RM3 inventory copy, not the deliberately unpowered
[original RM3 harness](../packages/core-library/test/fixtures/rm3/loop.request.json).
These are interface demonstrations, not selected hardware or installation designs.
Other inventory devices, including the AC source and PE terminal, are outside
these loop-only sheets. W906 reports them, so these requests exit 0 normally
and 1 with `--strict`. The RM2 request is also tested against a fresh minimal
wire-only reproduction; the RM3 request uses the copied inventory's CBL3 pair.

### Selection and authored roles

| Catalog role | Profile and selected interface |
| --- | --- |
| `from` | `thermite:pressure-transmitter` or its `thermite:two-wire-transmitter` alias; two-terminal transmitter function |
| `to` | `thermite:io-module`; two-terminal channel with authored input direction |
| `intermediate` | `thermite:bulkhead-connector` or `thermite:terminal-strip`; actual feed-through contacts |
| `series-power` | `thermite:dc-supply` or a registered alias, including frozen 0.1.0's `iec:dc-power-supply`; two-terminal `source` function |

`loopPower` uses exactly `{device, function}`. Supply function terminals must be
ordered positive then return, with the two required roles below. No type edit,
new schema field, or relock of an existing PSU is needed. The transmitter, input
and supply must be on three separate devices. Selecting the loop-power source as
`from` refuses with a message naming the supply and pointing to an explicit circuit
view. A non-transmitter `from`, a `to` that is not an input channel, and selecting
loop power as `to` each refuse with a message naming the device or channel and
pointing to an explicit circuit view. Series mode accepts input views without
`auxiliary` pairs.

Only these exact authored terminal-role pairs are recognized for series polarity:

| Interface | Positive role | Negative/return role |
| --- | --- | --- |
| Supply, required and ordered | `dc_positive_output` | `dc_return_output` |
| Transmitter | `loop_positive` | `loop_negative` |
| Input, unindexed | `analog_input_positive` | `analog_input_negative` |
| Input, channel 0 | `analog_input_0_positive` | `analog_input_0_negative` |
| Input, channel 1 | `analog_input_1_positive` | `analog_input_1_negative` |

Endpoint polarity follows roles regardless of terminal names or function-array
order. Other, missing, partial, duplicate or mixed pairs, including cross-channel
pairs, mean **polarity not verified**. No case, suffix, description or arbitrary
channel-number inference is made. A recognized contradiction refuses and names
both terminals and roles. Series mode checks the selected supply path; direct
input loops check that transmitter positive reaches input positive through the
authored wiring.

Both low-side wiring (PS+ → TX+, TX− → AI+, AI− → PS−) and high-side wiring
(PS+ → AI+, AI− → TX+, TX− → PS−) can be depicted. The arrows describe reading
order across the selected interfaces; **functions never join their terminals**.
Only authored wires, jumpers and two-ended cores form the three separate physical
nets. Each leg is unbranched. The two field legs follow the same ordered
feed-through stages; the input-to-supply leg may use its own supported chain.
Every selected conductor and cable core keeps its identity and net ID. Opposite
faces of one feed-through contact use a short internal presentation link; no
function body is shorted. A crossing without a dot means not connected.

### Mandatory notes and supply branches

Every series sheet prints this exact engine note, also present in the SVG
`desc` and enabled packet references:

```text
Three separate loop nets; loop power from {power reference} as wired. Not assessed: input mode (passive/active), isolation, loop voltage budget.
```

If endpoint polarity is unverified, the final period is replaced by
`; polarity not verified: {unverifiedEndpoints}.` The endpoint list contains
device references once each, sorted by designation and function, separated by
comma-space. Each endpoint and `{power reference}` uses the same singular/plural,
separator, authored-binding and designation-only rules as direct loops; the template
does not constrain the number of bindings.
For each supply terminal with outside connections, the exact distribution text is:

```text
Outside selected loop at {PS}.{terminal}: {count} authored connections: {conductor} to {D}.{terminal}[; ...].
```

Entries are sorted by conductor identity. Wire/jumper branches at supply terminals
are counted and named, including an authored PS− to PE connection. Their outside
routes are not drawn and no bond is inferred. Other function kinds are not inferred
to be sources: an outside supply represented by a non-`source` function remains a
counted, printed connection. A second authored `source` function on a selected leg
terminal refuses with a message naming that terminal, function and selected supply.
A `source`-kind function reached through a supply branch also refuses.

In particular, **a second PSU return or a transformer X2 bonded to the same PE as
PS− refuses** with `Series loop has an additional connection at PS1.-; use a circuit view that includes the branch.`
The walk through the shared PE reaches that other authored source function. This
is a limit of this selected loop view, not a bonding-suitability judgment. Use an
explicit circuit view selecting the actual source functions and connecting
conductors; do not remove or relabel a real connection to obtain a loop sheet.

The complete notes print with references disabled, user notes, assemblies and
enclosures. Series mode never prints the direct view's two-net sentence. Notes
stay at 2.5 mm outside the diagram's scale transform; text is never hidden or
shrunk to force a fit. The note itself adds no warning. A clean packet can pass
`--strict`, but **an undrawn PE1 still produces the existing W906 warning and
`--strict` exits 1** when PE1 appears on no other schematic sheet. Schedules and
reference pages do not provide that schematic appearance.

Input mode (passive/active), isolation, bonding suitability and loop voltage
budget are not assessed. Recognized polarity and a drawn supply establish none
of them. The series view infers no rating or shunt and does not establish electrical compatibility.

### Print limits and refusals

Eight displayed devices, including the supply, is a selection limit, not a fit
promise. The measured synthetic sweep from three endpoints through five added
field strips gives these maximum displayed-device counts. `R006` means even the
three-device specimen did not fit that paper/flow/orientation combination.

| Paper | Left-to-right landscape | Left-to-right portrait | Top-to-bottom landscape | Top-to-bottom portrait |
| --- | ---: | ---: | ---: | ---: |
| Letter | 4 | 3 | R006 | 3 |
| A4 | 4 | R006 | R006 | 4 |
| A3 | 6 | 4 | 4 | 7 |
| Tabloid | 6 | 4 | 3 | 7 |

The eight-device specimen refused every measured combination. These counts are
examples, not guarantees: captions, cables, enclosures, third-leg routing and
notes change fit. Captions wrap at whitespace, widen within the existing 50 mm
caption limit, and only split an overlong token after a retained hyphen. An
unbreakable segment that cannot fit refuses; identifiers are never cut mid-token.

Measured five-device cases at the unchanged print sizes:

| Loop | Left-to-right diagram, mm | Top-to-bottom diagram, mm | Tabloid result |
| --- | --- | --- | --- |
| Frozen 0.1.0 PSU with field strip and junction box | 290.9 × 100.4 | 121.7 × 248.9 | One drawing sheet: landscape horizontal or portrait vertical |
| Realistic high-side M12/bulkhead/strip/input chain | 338.7 × 120.1 | 152.0 × 301.0 | One drawing sheet: landscape horizontal or portrait vertical |
| Realistic low-side chain | 278.0 × 207.7 | 237.7 × 251.7 | Horizontal landscape refuses; vertical portrait fits one drawing sheet |

The frozen and realistic high-side cases refuse on Letter and A4; A3 also fits
in the same orientations as Tabloid. The low-side horizontal layout no longer
fits Tabloid landscape after separate opposite-face landings increased its
routed height. Counts exclude index/reference sheets; enabling both adds two
sheets to these single-view specimens. The roughly 2.8 mm terminal-to-passing-run
clearance in the vertical field case is still tight. Print at 100% on matching paper.

R006 returns no drawing for ambiguous or malformed selectors, unsupported source
shape/role order, contradictory recognized polarity, incomplete or alternative
legs, mismatched/repeated field stages, unsupported barriers, combined input/supply
devices, more than eight devices, extra sources, forbidden branches, loose or
unassigned cores, extra active cores or impossible assembly/enclosure/geometry/text
fit. More than two conductor landings on one drawn contact also refuses. A spare
core on a loop terminal is an additional connection, not a way around that rule.
Fit advice suggests another orientation or flow, larger paper where available,
or fewer devices/shorter notes; Tabloid advice does not suggest larger paper.
Use an explicit circuit view when the loop topology is outside this selection.


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

`cableAssemblies` selects individual cables by designation or UID. In direct and auxiliary views, the heavy
jacket line and grouped connector glyphs represent the assembly, not a shared
net or exposed conductor breakout. Core colors are absent from that overview. In series mode, an assembly retains
individual active/spare core routes and adds the explicit pin map; no shared
electrical net is implied.
Every pin pair is derived from actual endpoints and printed beside the cable
with `:` between terminal names: `+:5, -:6` maps transmitter `+` to pin `5` and
transmitter `-` to pin `6`. The separator stays distinct from signed terminal
names such as `+`, `-`, `~` and `±`; spares retain their explicit designation.
If either terminal name contains `:`, the pin map refuses with R006, naming the
pair; use an explicit circuit view. Terminal names are preserved.
Mapping direction follows `from` toward `to` (transmitter toward input or
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
ELK still owns all device placement and orthogonal routing. Top-to-bottom
output wire labels do not reserve transverse space in ELK's fixed 14 mm lanes.
After layout, each label is centered on its own vertical route segment, with a
white background for legibility; no route point moves. Cable-core and cable-assembly labels,
left-to-right loops and input loops retain their existing ELK placement.
If no vertical segment fits a wire label, or a placed label overlaps another
label, device body or conductor, the entire loop returns to ELK with every
original label restored at 6 mm edge spacing. This may produce honest jogs,
which the checker still reports. If that fallback cannot print, the renderer
returns R006, as the native 6 mm layout did before the inline-label change.
Each attempt routes the whole loop; labels are never
made to fit by stretching endpoints, shrinking text or editing routes.
Terminal identities, fixed ports and authored connector order are preserved.
