# Function-level circuit symbols

A device type may declare an optional `circuitSymbols` object. Its keys name
actual functions in that same type; its values select marks from a closed
catalog. This lets a motor breaker show its power contacts as breakers and its
auxiliary contacts as NO/NC contacts, while retaining one physical device.

```json
{
  "symbol": "thermite:breaker",
  "circuitSymbols": {
    "pole1": "breaker",
    "pole2": "breaker",
    "pole3": "breaker",
    "fault": "contact-no",
    "interlock": "contact-nc"
  }
}
```

The example assumes those five functions are explicitly declared: `fault` is
normally open and `interlock` normally closed. Unspecified functions retain the
renderer profile's mapping. Function names do not imply a symbol or electrical
behavior. These overrides apply to circuit drawings; they do not change the
original continuous SVG profiles.

The compiler checks each explicit mark against these function shapes:

| Mark | Function kind | Terminal count | Additional requirement |
| --- | --- | --- | --- |
| `contact-no`, `switch-no`, `pushbutton-no`, `pressure-no`, `level-no` | contact | 2 | `normal_state: "open"` |
| `contact-nc`, `switch-nc`, `pushbutton-nc`, `pressure-nc`, `level-nc` | contact | 2 | `normal_state: "closed"` |
| `breaker`, `overload`, `fuse` | contact | 2 | — |
| `coil`, `solenoid` | coil | 2 | — |
| `motor`, `heater`, `load`, `receptacle`, `ac-input` | load | 2 or 3 | — |
| `lamp` | load | 2 | — |
| `winding` | load or source | 2 | — |
| `source` | source | 1–4 | — |
| `dc-output` | source | 2 | — |
| `terminal`, `earth` | bus | 1 | — |
| `interface` | channel | 1 or 2 | — |
| `interface` | other | 1–32 | — |
| `level-sensor` | other | 2 or 3 | — |
| `level-sensor` | channel | 1 or 2 | — |
| `conductivity-probe` | other | 2–8 | — |
| `thermocouple`, `fuse` | other | 2 | — |

`mechanism` functions have no terminals and cannot receive a mark. Choosing
`earth` does not create a bond or assign a protective-earth terminal role.
Terminal roles, ratings, wires, jumpers and cable cores remain explicit source
facts. A drawing mark never joins physical nets, including a normally closed
contact, transformer winding or fuse.

Unknown marks fail schema validation (E014). **E206** reports a missing function
key or incompatible kind, terminal count or contact state. It points to the
individual `circuitSymbols` value and links the relevant function/type declaration.
All loaded library types are checked, including unused types. Correct the
library metadata, regenerate its lock, and validate again; do not alter electrical
facts merely to force a preferred mark.

The IR retains the optional map as `IrDeviceType.circuitSymbols` and source
locations as `circuitSymbolSources`. Both are detached from loaded source objects
and preserved by canonical IR serialization, so saved/reloaded IR produces the
same diagnostics. Old types without the map acquire neither field.

Pressure and float contact marks depict an actuator together with the authored
normal contact state. The sensor/probe and receptacle marks identify an interface;
they do not infer pin roles, probe technology, float behavior or GFCI protection.
`ac-input` must be explicitly chosen when AC conversion is known. A two-terminal
`thermite:dc-supply` source uses the DC output mark; the input retains the generic
power mark unless explicitly bound to `ac-input`.

A `thermite:transformer` circuit block places its primary load windings opposite
its secondary source windings on one shared magnetic core. Each winding retains
its two distinct physical terminals. The core is a presentation association;
series/parallel wiring still requires explicit wires or jumpers. Selecting one
winding shows only that winding and its source-backed references. The drawing
neither infers a turns ratio nor asserts galvanic isolation.

The catalog uses original Thermite geometry, not reproduced legacy drawings or
a claim of compliance with a particular symbol standard. The
[synthetic example](../examples/functional-symbols/README.md) demonstrates these
marks, separate PE, an explicit primary jumper, and a twelve-pin interface in
both flows. The maximum generic interface size is 32 pins; readable paper fit is
still checked and can return R006.

## Shared printable vocabulary

Rooted and circuit views use independently authored, IEC-informed marks from the
printable policy. A coil is a rectangle; AC/DC appears only from its authored
coil-terminal voltage class. A breaker uses a blade and cross without inferred
trip technology. Aligned authored breaker and disconnector gangs get a nonconductive mechanical
link where the corridor is clear. Overload power poles use a stepped thermal
element; their auxiliary contact uses its own authored normal state. Protection
elements have no NC/NO caption. NO/NC contacts differ by the NC stroke.

`thermite:disconnector` is a canonical profile with no alias. It draws an open
blade, gap and fixed-contact disconnector bar in power, control and circuit
views. Opting in asserts author-selected disconnector-function identity. Isolation
suitability (impulse withstand, contact gap, position indication, lockability),
load-break and ratings are not asserted. No manual-operator linkage or trip
element is drawn. Gang ink requires authored `ganged_with` relations and a clear,
aligned corridor; unaligned poles retain their device tags and terminal pairs.
Power requires `power_input`/`power_output` roles in authored function order;
control retains switch traversal. Loads and signal-loop bindings are absent.
Only `normal_state: "open"` is supported: closed rooted requests return the
existing R002 unsupported-profile diagnostic, and circuit defaults refuse them.
There is no new `circuitSymbols` override value. Core 0.2.0's `disconnect-3p`
opts in; project-local switch types require an explicit profile change. On older
engines the unknown profile can validate with a renderability warning, but rooted
rendering refuses with R002. A profile change never changes physical nets.

Motor marks carry M, with 3~ only for a three-phase profile or a function with
explicit U/V/W phase-input roles. A three-terminal L/N/PE function does not
establish three phases.
Core 0.2.0's `estop-nc` uses `thermite:estop` (mushroom head and latch), and
`selector-2pos` uses `thermite:selector` (rotary handle and maintained detents).
They inherit the function/family support of `thermite:pushbutton` and
`thermite:switch`. Custom types opt in by profile; tags and descriptions do not
select operator identity. Core 0.1.0 source bytes stay frozen.

Both families use bundled Noto Sans Regular/Bold, plus Noto Sans Math for missing
mathematical glyphs. R2's shared model bounds individual glyphs; it models no
OpenType positioning or substitution features. GPOS, GSUB, GDEF and legacy/AAT
layout tables are removed from the faces used for exact metrics, SVG/HTML WOFF
subsets and PDFKit. Glyph outlines, advances and hinting are unchanged; PDFKit
embeds its own subsets of those feature-free faces. Unicode fallback positioning
and NFC normalization remain; no OpenType shaping feature is delivered.
Rooted labels use natural advance or compression down to 0.91. Necessary caption
reservations and containing node widths widen; the complete slot list is recorded
in the R4 handoff. Symbol bounds and electrical ports stay fixed. The opaque
plate uses the same exact ink box as validation. No artwork is copied and no
standards compliance or safety performance is claimed.

Breaker auxiliary captions are placed beside their owning contact and checked
against nearby ink. If no clear position fits, the renderer omits the redundant
NO/NC caption and reports `W907`; the contact mark still shows the authored state.
