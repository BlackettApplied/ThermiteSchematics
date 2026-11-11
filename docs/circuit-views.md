# Source-selected circuit views

Circuit views render complete, explicitly selected electrical circuits with conventional function symbols. Use them for power branches, control and relay circuits, PLC channel groups, and other circuits that need more context than one rooted trace. The original rooted schematic, wiring, signal-loop and communication views remain available.

Project JSON and compiled physical wiring are authoritative. Selecting a contact, coil, motor or transformer function for drawing does not join its terminals into one net. Circuit views do not simulate energized state, infer equipment behavior, or verify electrical design suitability.

Rooted views disclose omitted direct connections at drawn terminals with nearby
**Off-view at D.T** cards and repeat a selected-view notice on every sheet. Cards retain legal text sizes; placement and paging may add sheets or
return contextual R006 when the complete disclosure cannot fit reasonably.
A row such as `W5 → H1.X1` names only an authored conductor and its opposite endpoint;
it makes no operating, potential or function claim. These annotations neither
complete the selected circuit nor count as coverage appearances. W906 and strict
packet behavior remain unchanged. For the marker and fit rules, see
[rooted view disclosure](views.md#intents-and-roots).

## Request

Add a `circuit-view-request/0.1` to a normal packet request:

```json
{
  "format": "schematic-packet-request/0.1",
  "page": { "size": "tabloid", "orientation": "landscape" },
  "views": [
    {
      "format": "circuit-view-request/0.1",
      "title": "Starter control power",
      "flow": "left-to-right",
      "columns": 1,
      "groups": [
        {
          "id": "control-power",
          "label": "PS1 output to PLC1 supply",
          "lineReference": "200",
          "functions": [
            { "device": { "by": "designation", "value": "PS1" }, "key": "dc_output" },
            { "device": { "by": "designation", "value": "PLC1" }, "key": "supply" }
          ],
          "conductors": ["W-CTL-001", "W-CTL-002"]
        }
      ],
      "notes": ["Device functions are shown independently of energized state."]
    }
  ],
  "index": true
}
```

This example runs in the default project created by `thermite init`. Save it as
`circuit.request.json` and run from that project directory, using the launcher
named in its AGENTS.md:

```sh
thermite packet --project . --input circuit.request.json -o drawings/circuit.html
```

The same request can produce JSON or PDF through the packet command. It is a packet-view contract, not an extension of the six guarded agent commands or of `schematic-view-request/0.1` and `/0.2`.

Each group selects 1–80 declared device functions and up to 120 unique physical conductors. A view accepts 1–200 groups. Function selectors use exact device UID or designation plus an exact function key; aliases or concatenated `device.function` strings are not function selectors. A conductor string resolves to a unique wire/jumper UID or designation, or a cable designation followed by `/` and its conductor key, as in `CBL1/1`.

`conductors: []` is valid. It displays the selected functions and their unconnected terminals without inventing field wiring. Duplicate source identities within one group and unknown selectors are rejected. Groups may intentionally repeat source objects in different views; those appearances still describe the same physical equipment.

The default flow is `left-to-right`; `top-to-bottom` is also supported. `columns` is 1 or 2 and defaults to 1. Group order is presentation order. Groups that fit remain complete. Oversized groups can be split into numbered parts as described below. `lineReference` is an authored reference label, useful for identifying the source drawing location. It does not determine the generated sheet number.

Within a group, the first appearance of each device in `functions` establishes its preferred reading order; subsequent functions on that device share its block. List output circuits in stages such as PLC → terminal → interlock → coil, or thermocouple circuits as sensors → terminal → input module. Blocks containing only output channels or source functions prefer the supply side; blocks containing only input channels prefer the receiving side. ELK uses these presentation preferences with the actual connections and fixed terminal sides. Reordering selectors changes the drawing preference, never terminal identity, conductor membership or electrical direction.

`terminalLayout: "distributed"` optionally places each selected one-terminal bus/earth function of a `thermite:terminal-strip` device in its own ELK block. Unselected conductor endpoints on that strip also get separate boundary blocks, so a strip's source and destination points need not force a loop around the circuit. Each occurrence retains the same device designation, UUID, exact terminal/function identity and index references. Other device profiles, including multi-pole protection and switching devices, stay grouped. Multiple selected functions sharing one physical terminal are rejected in this mode; select one alias or retain grouped layout. The default, `terminalLayout: "grouped"`, preserves the existing layout.

## Source identity and boundaries

Rooted sheet continuations follow the same printed wire-number rule described below; see [view and packet rules](views.md).

- Every selected physical conductor appears once within its group, with its exact endpoint TerminalIds, conductor identity and derived net ID in SVG metadata. A wire's `properties.label` is the prominent printed wire number; its designation and UID remain available in metadata and schedules. Authored conductor size and color print below the wire number when present. Unknown size or color is omitted.
- All terminals of each selected function are represented. A fully terminated selected wire whose endpoint function is not selected ends at a boundary representation of the real device terminal. Boundaries do not create virtual devices or new nets.
- A real coil terminal shown as a boundary or rooted context does not draw the coil function. Select that function explicitly in a circuit view to give it an audited function appearance. Multiple rooted views can expose more paths but do not replace a source inventory or enter the circuit/wiring coverage audit. See the [bounded DOL example](views.md#bounded-dol-selection).
- A filled terminal mark has selected physical wiring. An open terminal has no selected wire on that drawing. `[+N]` reports additional physical connections outside the group, or outside the current part when a group is split; it does not claim that an unused terminal is electrically isolated.
- Terminal-strip pass-through ports can show one physical terminal on both sides of its symbol. Local function attachments and shared relay COM terminals retain that same source TerminalId. Those display segments are distinct from scheduled physical wires.
- PLC channel rows print the authored I/O address and signal meaning, with long signal text wrapped into a measured row. Without an authored address, explicit terminal roles establish AI/AO or DI/DO; an undeclared or conflicting class uses direction-only IN/OUT. Keys and free-text descriptions never establish a signal class. `SPARE` appears only when the source explicitly marks the channel spare. An unconnected channel is not automatically spare.
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

The source of truth is the data-only [`SYMBOL_PROFILES` catalog in
`@thermite/schema`](../packages/schema/src/symbol-profiles.ts), exported from
the package and included in its compiled runtime. Each entry lists reusable
aliases, original core IEC aliases, supported renderer families/roles,
function kinds, terminal counts, and any terminal-role or voltage constraints.
It is JSON-serializable for runtime help and tooling. `CORE_SYMBOL_BINDINGS`
records the original core type IDs and their reusable equivalents; those IDs do not gate rendering.

For example, `thermite:pushbutton` supports two-terminal contacts in circuit
views. `thermite:io-module` supports one/two-terminal channels in circuit views,
but rooted control bindings accept only one-terminal channels; loads support
covers its declared load/source context instead of standalone channels.
Rooted profiles also cover contactor/relay coils and contacts, pushbuttons,
switches, breakers, fuses, overloads, motors, lamps, power sources, transformer
secondary sources and three-wire sensors. Transformer control uses
[paired secondary terminals](circuit-symbols.md#transformer-control-sources).
Main contactor and overload poles require ordered `power_input` /
`power_output` roles; their control auxiliaries require two `aux` roles. A circuit-capable profile does not
automatically work in rooted power, control, or loads views. The catalog also
records existing signal-loop-only profiles so they are not mistaken for unknown
circuit profiles. Loads selection admits declared load functions and their physical
terminal/source context; it does not traverse contacts or coils. Contactors,
overloads, switches and pushbuttons therefore retain power/control support
without claiming loads support. Relay loads support is its DC load/2; I/O loads
support covers buses, DC load/2 and declared DC sources, not standalone channels. `thermite:pressure-transmitter`, `thermite:analog-actuator`,
and `thermite:bulkhead-connector` have signal-loop roles only; they cannot replace
a circuit or rooted-view symbol. Catalog `notes` explain profile semantics and
layout observations. io-module `other` interfaces bind 1–32 terminals. Isolated
left-to-right examples measured on 2026-11-04, against base `7a7c1fb` plus P1,
fit 24 terminals on tabloid and 12 on A4; larger sampled interfaces failed.
These are measured examples, not guaranteed paper limits. Larger interfaces may
need top-to-bottom or larger paper; labels and selections affect printability.

All circuit profiles allow a one-terminal bus. An explicit protective-earth
role selects the earth mark; no bonding wire is added. The catalog's original
core `iec:*` symbols resolve to their declared `thermite:*` equivalents for any
type ID, subject to the same function shapes. A byte-identical core type clone
therefore keeps its rendering support with either spelling. Core 0.1.0 library
bytes are unchanged.

`thermite:sensor-3wire` supports a two-terminal supply load and a one-terminal
output channel in circuit views. Supply terminals use authored `supply_positive`
and `supply_return` roles whenever either supply terminal carries any role.
In that case exactly one positive and one return are required; partial, duplicate
or unknown supply roles receive W111 advice before drawing and fail with R001
for a sensor trace root or R006 for a circuit view, with
`reason: "unsupported-symbol-profile"`. W111 names the actual supply-role problem;
explicit circuit marks do not establish sensor polarity. Only when
neither supply terminal has any role does authored function order mean positive,
return. Other role spellings, including `0v`, `return` and `dc_negative`, require
correction to the exact profile roles before polarity can be drawn.
Function/terminal names and pin numbers never assign those roles. Circuit terminal captions show `+`, `-` and `OUT`.
Rooted control/loads and existing trace selection combine exactly one such
supply and output on three distinct terminals. Multiple ambiguous candidates
are not combined. The core proximity sensor has this circuit mapping too.
PNP/NPN text accepts standalone positive type descriptions such as
`Three-wire PNP proximity sensor` or `NPN output sensor` (with an optional final
period). Free prose and negation are not interpreted as electrical facts. The
profile, names, pinout and wiring do not establish output type.
No function or symbol joins physical terminals.

A `thermite:dc-supply` input load with ordered `ac_line_input` /
`ac_input_return` terminal roles can root a power view when the authored feed
reaches a power source. Its DC output remains a separate control source. This
adds no traversal through the conversion function or through device relations.

Validation emits **W111** at the library type's `symbol` when a placed type
uses an unknown profile, has non-mechanism functions that fit no
cataloged family, or declares contradictory/partial sensor supply roles. It names up to ten unfit functions and ten affected device
designations, naturally sorted without locale dependence, then a remaining count.
For unknown symbols it summarizes the number of functions instead of
listing all their names.
Explicit `circuitSymbols` marks count as circuit support before any profile
lookup, including for unknown symbols. Terminal-only roles can
support devices without drawable functions; they do not excuse an unsupported
selected function.

Replacement advice names the equivalent's families for the type's actual
functions. Circuit-only profiles still require a circuit view; a matching
profile does not broaden rooted traversal or guarantee a connected root. When only some functions
fit, the first remedy is an explicit compatible `circuitSymbols` mark for the
unfit functions (checked by E206), or moving them to a separate device type.
This preserves the profile used by the already supported functions.

When nothing fits, the fallback profile list groups circuit, rooted, and
signal-loop-only support, quoting at most ten profile IDs across all groups.
Structured `allowed`, `allowedCount`, and `allowedLookup` fields follow the
standard diagnostic bounds; the complete current profile ID list is available
in W111's `allowed` field from `thermite validate <project> --json`. Shape
requirements still apply to those profiles. `thermite guide symbols` provides offline profile discovery from that catalog.

Signal-loop auxiliary capability on `thermite:terminal-strip` and
`thermite:bulkhead-connector` is conservatively cataloged as `other/2` only.
A two-terminal contact or bus must have its own supported circuit binding;
the auxiliary role does not excuse it.

Absent optional symbols and unplaced types do not trigger W111. The warning
is advisory: electrical validity is preserved. Per-function shape support does
not establish a connected path, a valid view root, or printable layout;
renderers still reject unsupported selections.

Explicit `circuitSymbols` marks include `contact-no`, `contact-nc`, `breaker`, `overload`, `fuse`, `coil`, `motor`, `heater`, `winding`, `source`, `load`, `terminal`, `earth`, `solenoid`, `lamp`, `switch-no`, `switch-nc`, `pushbutton-no`, `pushbutton-nc`, `thermocouple`, `interface`, `pressure-no`, `pressure-nc`, `level-no`, `level-nc`, `level-sensor`, `conductivity-probe`, `receptacle`, `ac-input`, and `dc-output`. Mark choice is presentation metadata; it never changes physical net derivation or rooted-view traversal.

## Layout and current limits

ELK places device/function blocks and routes all selected physical conductors. The catalog supplies component marks and their terminal attachments. Circuit groups are measured at readable size and packed into one or two columns. A wide group may span both columns; multiple wide groups can share a page. A complete group is never clipped or reduced below the circuit text size to force it onto paper. View notes appear once in a measured block after the last group, using remaining column space when available.

Each drawn device has an owned printing tag: bold designation, nonblank instance
description (otherwise type description), and the exact catalog order number when
authored. Description and part occupy separate rows; empty fields have no row.
The measured tag lane is above the body in left-to-right flow and beside the pin
and symbol lanes in top-to-bottom flow. Its reservation precedes ELK, including
any stems needed to reach the node boundary. Repeated functions in one device
node share the tag; each split part repeats its local devices' complete tags.
Tag designation uses at least 2.7 mm em and other fields at least 2.5 mm em.
Long descriptions wrap at words, then after existing separators, then graphemes;
parts prefer existing separators. Every character is retained, and wrapping adds
no punctuation or spaces. No truncation, inferred rating or subminimum fit is
used. An owner that cannot fit with its tag produces R006.

Primary symbol legends, wire labels, conductor details, terminal labels and PLC channel addresses use at least 2.5 mm em at printed scale. Secondary cross-reference and boundary captions use 2.3 mm em. Long labels are measured before routing and pagination; an unreadable block or group is rejected rather than clipped.

Vertical device designations, and relation footers in both flows, use pinned
font ink to find
the nearest clear position inside their owning device. They clear the owner's
attachment and stub strokes by at least 1 mm; unrelated terminal-caption text
retains its existing spacing rule. Placement preserves SVG element order and
never shrinks type. If the existing owner has no clear position, a measured side
lane is reserved before ELK, with a bounded retry. Owners that already fit keep
their dimensions. Relation summaries reserve width from their final printed
lines and the body/pin minimum, rather than retaining a discarded full caption's
width. A required caption that cannot fit produces `R006`.

### Oversized group parts

Packet rendering first prepares and validates the complete group. If its measured width or height cannot fit, it tries smaller selections of whole conductors. Every selected wire, jumper or fully terminated cable core appears once across the parts, with both original terminal endpoints on the same part. Conductors are never cut into invented wire segments. Complete selected functions incident to those conductors may repeat; unconnected selected functions are retained. Selected mechanical gang members and transformer windings with a shared core stay together. Unselected endpoint functions remain real terminal boundaries.

Parts retain the original group ID and line reference, with numbered headings. Repeated terminal IDs identify the same physical equipment. A measured reference block lists their other occurrences as `P2/S03` (group part 2, packet sheet 3). These references connect repeated physical terminals, not different terminals that merely share a net. Parts may share a sheet when readable space permits. Packet numbering accounts for preceding views and is independent of the optional index. View notes still print once after the last group.

Paginated sheets expose additive `circuitContinuations` metadata: original `group`, `fromPart`, `toPart`, `toSheet`, JSON-encoded `[deviceUid, terminalKey]` `terminalId`, and the derived `netId` or `null`. The printed reference rows use `data-circuit-continuation`, `data-from-part`, `data-continuation-terminal`, `data-destination-parts` and `data-destination-sheets`; physical terminal marks keep their existing audit attributes. Circuit coverage retains the original group ID, counts each conductor identity once, and records repeated function appearances. This does not assert conduction through a device function or add physical nets.

Fitting groups retain their original output. The single-drawing `prepareCircuitView` API remains unpaginated. Invalid original routing or unsupported symbols fail before partitioning; a bad part also fails explicitly. If a complete conductor, coupled symbol or continuation block cannot fit, use larger paper, another orientation/flow or a narrower source selection. No partial packet is returned. Partitioning reserves reference space conservatively and does not promise a minimum page count. See the [synthetic circuit pagination example](../examples/circuit-pagination/README.md).

Self loops reserve space around the device for measured conductor labels.
An obstructed self-loop caption can move beside its own ELK route, including
centered overhang on a short segment, only when its complete measured box
clears other wires, labels and device bodies and stays inside the drawing.
Caption recovery keeps the ELK route and source endpoints intact. See the
[synthetic nested bridge example](../examples/self-loop-labels/README.md).

Overlapping unrelated wires, a route through a device body, an obscured wire label, an unsupported mapping, or a group that cannot fit causes an explicit R006 failure. Some complex same-net routing still needs smaller groups: equal net IDs alone do not authorize merging independent physical conductor paths or adding junction dots. A bus with multiple distinct declared terminals is not automatically shorted or treated as a one-terminal pass-through; model actual jumpers/wires and select supported functions.

This first circuit renderer prioritizes complete source coverage and clear printed circuits. It does not reproduce arbitrary ECAD page coordinates or match the reference drawing's page count. Distributed rails, denser PLC/terminal layouts and richer continuation presentation can be improved without changing the authoritative electrical source.

## Packet coverage inventory

Every successful packet JSON result includes `coverage` with format
`schematic-coverage/0.1` and scope `circuit-and-wiring`. It inventories every
compiled wire, jumper and fully terminated cable core, and every declared
function. Each entry records its stable ID, designation, exact terminal IDs and
circuit/wiring appearances (sheet, view and optional circuit group). Repeated
appearances count once in `represented`, but all appearances remain available.
Entries without an appearance contribute to `outsideAuditedViews`; an empty
selection cannot appear to cover the whole project.

This inventory audits successful source-selected circuit and wiring projections.
Wiring boxes do not count as function drawings. Other view families, schedules,
indexes and communication links are explicitly outside this audit, and their
sheets appear in `unauditedSheets`. An outside-audited-views entry may be shown in
another family; this does not prove omission from the entire packet. The report
excludes unterminated/unassigned cable cores from its conductor inventory and
includes terminal-free mechanisms in its function inventory. It proves neither
printed readability nor an upstream supply path; use visual review and electrical
checks separately. Unknown selectors still fail before any packet is returned.

Rooted views can omit longer parallel branches; off-view cards disclose omitted
direct conductors at drawn terminals without drawing their functions. See the
[bounded DOL example](views.md#bounded-dol-selection). Packet coverage audits
explicit circuit/wiring selections; rooted sheets remain unaudited.
`outsideAuditedViews` proves neither absence from every sheet nor a complete supply
path.

Packets also include a separate [`coverage.topology` inventory](topology-coverage.md)
for connector assemblies, communication links and individually drawn ports.
Its counts and unaudited sheets are independent of this circuit/wiring scope.
