# Source-selected circuit views

Circuit views render complete, explicitly selected electrical circuits with conventional function symbols. Use them for power branches, control and relay circuits, PLC channel groups, and other circuits that need more context than one rooted trace. The original rooted schematic, wiring, signal-loop and communication views remain available.

Project JSON and compiled physical wiring are authoritative. Selecting a contact, coil, motor or transformer function for drawing does not join its terminals into one net. Circuit views do not simulate energized state, infer equipment behavior, or verify electrical design suitability.

## Request

Add a `circuit-view-request/0.1` to a normal packet request:

```json
{
  "format": "schematic-packet-request/0.1",
  "page": { "size": "tabloid", "orientation": "landscape" },
  "views": [
    {
      "format": "circuit-view-request/0.1",
      "title": "Motor control",
      "flow": "left-to-right",
      "columns": 2,
      "groups": [
        {
          "id": "motor-command",
          "label": "Contactor command and interlocks",
          "lineReference": "200",
          "functions": [
            { "device": { "by": "designation", "value": "PLC1" }, "key": "do0" },
            { "device": { "by": "designation", "value": "PB1" }, "key": "contact11" },
            { "device": { "by": "designation", "value": "OL1" }, "key": "aux95" },
            { "device": { "by": "designation", "value": "K1" }, "key": "coil" }
          ],
          "conductors": ["W-CTL-005", "W-CTL-006", "W-CTL-007", "W-CTL-008"]
        }
      ],
      "notes": ["Device functions are shown independently of energized state."]
    }
  ],
  "index": true
}
```

This example uses the portable `examples/motor-starter` source. Generate it with:

```sh
node thermite.mjs packet --project examples/motor-starter --input circuit.request.json -o output/circuit.html
```

The same request can produce JSON or PDF through the packet command. It is a packet-view contract, not an extension of the six guarded agent commands or of `schematic-view-request/0.1` and `/0.2`.

Each group selects 1–80 declared device functions and up to 120 unique physical conductors. A view accepts 1–200 groups. Function selectors use exact device UID or designation plus an exact function key; aliases or concatenated `device.function` strings are not function selectors. A conductor string resolves to a unique wire/jumper UID or designation, or a cable designation followed by `/` and its conductor key, as in `CBL1/1`.

`conductors: []` is valid. It displays the selected functions and their unconnected terminals without inventing field wiring. Duplicate source identities within one group and unknown selectors are rejected. Groups may intentionally repeat source objects in different views; those appearances still describe the same physical equipment.

The default flow is `left-to-right`; `top-to-bottom` is also supported. `columns` is 1 or 2 and defaults to 1. Group order is presentation order. A group is an indivisible circuit for pagination; preserve parallel seal-in or interlock branches in the same group. `lineReference` is an authored reference label, useful for identifying the source drawing location. It does not determine the generated sheet number.

Within a group, the first appearance of each device in `functions` establishes its preferred reading order; subsequent functions on that device share its block. List output circuits in stages such as PLC → terminal → interlock → coil, or thermocouple circuits as sensors → terminal → input module. Blocks containing only output channels or source functions prefer the supply side; blocks containing only input channels prefer the receiving side. ELK uses these presentation preferences with the actual connections and fixed terminal sides. Reordering selectors changes the drawing preference, never terminal identity, conductor membership or electrical direction.

`terminalLayout: "distributed"` optionally places each selected one-terminal bus/earth function of a `thermite:terminal-strip` device in its own ELK block. Unselected conductor endpoints on that strip also get separate boundary blocks, so a strip's source and destination points need not force a loop around the circuit. Each occurrence retains the same device designation, UUID, exact terminal/function identity and index references. Other device profiles, including multi-pole protection and switching devices, stay grouped. Multiple selected functions sharing one physical terminal are rejected in this mode; select one alias or retain grouped layout. The default, `terminalLayout: "grouped"`, preserves the existing layout.

## Source identity and boundaries

- Every selected physical conductor appears once within its group, with its exact endpoint TerminalIds, conductor identity and derived net ID in SVG metadata. A wire's `properties.label` is the prominent printed wire number; its designation and UID remain available in metadata and schedules. Authored conductor size and color print below the wire number when present. Unknown size or color is omitted.
- All terminals of each selected function are represented. A fully terminated selected wire whose endpoint function is not selected ends at a boundary representation of the real device terminal. Boundaries do not create virtual devices or new nets.
- A filled terminal mark has selected physical wiring. An open terminal has no selected wire. `[+N]` reports additional physical connections outside the group; it does not claim that an unused terminal is electrically isolated.
- Terminal-strip pass-through ports can show one physical terminal on both sides of its symbol. Local function attachments and shared relay COM terminals retain that same source TerminalId. Those display segments are distinct from scheduled physical wires.
- PLC channel rows print the authored I/O address and signal meaning, with long signal text wrapped into a measured row. Without an authored address, the function key identifies the channel. `SPARE` appears only when the source explicitly marks the channel spare. An unconnected channel is not automatically spare.
- Coil/contact references come from authored internal relationships and actual function appearances across all circuit views in the packet. Multiple referenced functions at one destination can share a compact count label; complete function IDs remain in `data-related-functions` and the generated index. These are non-conductive references. Generated sheet/zone locations appear in the packet's device/function index.
- Mechanical ganging uses selected members of actual compiled ganged groups. A ganging line is not drawn across an unrelated intervening function.

The SVG includes `data-circuit-group`, `data-source-line-reference`, `data-device-uid`, `data-function-id`, `data-terminal-id`, `data-circuit-conductor`, `data-endpoints`, and `data-net-id` attributes for audit and tooling. They are provenance, not an alternate electrical source format.

## Library symbols

Geometry is owned by the renderer's original catalog; project requests cannot provide SVG, paths, coordinates or symbol overrides. The visible local device library chooses a closed `type.symbol` profile, optionally with an explicit function-to-mark map:

```json
{
  "symbol": "thermite:overload",
  "circuitSymbols": {
    "pole1": "breaker",
    "pole2": "breaker",
    "pole3": "breaker",
    "tripNC": "contact-nc"
  }
}
```

This distinguishes main protection poles from auxiliary contacts without guessing from function names or device descriptions. Function definitions and terminal arrays must still describe the actual source device. The compiler validates explicit mappings against declared functions; an NC symbol cannot override an authored normally open contact. Library changes require a fresh lock and validation.

| Profile | Supported functions |
| --- | --- |
| `thermite:contactor`, `thermite:relay` | Two-terminal coils and contacts; relay power can be a separate load |
| `thermite:breaker`, `thermite:overload`, `thermite:fuse` | Protection contacts; explicit function marks distinguish main and auxiliary functions; fuse also supports a two-terminal `other` function |
| `thermite:motor-3ph`, `thermite:motor` | Three- or two-terminal motor loads, respectively |
| `thermite:heater` | Two- or three-terminal resistive loads; no star/delta connection is inferred |
| `thermite:transformer` | Separate two-terminal primary load and secondary source windings |
| `thermite:power-source`, `thermite:dc-supply` | Supply boundaries; DC supply input and output are separate functions |
| `thermite:io-module` | One/two-terminal channels, supply functions, contacts and explicit generic interfaces |
| `thermite:terminal-strip` | One-terminal buses with pass-through display ports |
| `thermite:solenoid`, `thermite:lamp` | Two-terminal coil or lamp load |
| `thermite:switch`, `thermite:pushbutton` | Two-terminal contacts using authored normal state |
| `thermite:thermocouple` | Two-terminal `other` function representing the sensor interface |

Supported profiles also allow a one-terminal bus. An explicit protective-earth role selects the earth mark; no bonding wire is added. Existing POC core types have explicit compatibility mappings. Unrecognized profiles and incompatible function shapes fail instead of acquiring behavior from their names.

Explicit `circuitSymbols` marks are `contact-no`, `contact-nc`, `breaker`, `overload`, `fuse`, `coil`, `motor`, `heater`, `winding`, `source`, `load`, `terminal`, `earth`, `solenoid`, `lamp`, `switch-no`, `switch-nc`, `pushbutton-no`, `pushbutton-nc`, `thermocouple`, and `interface`. Mark choice is presentation metadata; it never changes physical net derivation or rooted-view traversal.

## Layout and current limits

ELK places device/function blocks and routes all selected physical conductors. The catalog supplies component marks and their terminal attachments. Circuit groups are measured at readable size and packed into one or two columns. A wide group may span both columns; multiple wide groups can share a page. A complete group is never clipped or reduced below the circuit text size to force it onto paper. View notes appear once in a measured block after the last group, using remaining column space when available.

Wire labels, conductor details, terminal labels and PLC channel addresses use at least 2.5 mm text at printed scale. Secondary cross-reference and boundary captions use 2.3 mm text. Long labels are measured before routing and pagination; an unreadable block or group is rejected rather than clipped.

Overlapping unrelated wires, a route through a device body, an obscured wire label, an unsupported mapping, or a group that cannot fit causes an explicit R006 failure. Some complex same-net routing still needs smaller groups: equal net IDs alone do not authorize merging independent physical conductor paths or adding junction dots. A bus with multiple distinct declared terminals is not automatically shorted or treated as a one-terminal pass-through; model actual jumpers/wires and select supported functions.

This first circuit renderer prioritizes complete source coverage and clear printed circuits. It does not reproduce arbitrary ECAD page coordinates or match the reference drawing's page count. Distributed rails, denser PLC/terminal layouts and richer continuation presentation can be improved without changing the authoritative electrical source.
