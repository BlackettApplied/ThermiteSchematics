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
