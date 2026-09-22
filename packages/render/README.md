# `@thermite/render`

`@thermite/render` turns a successfully compiled in-memory `ElectricalIr` into a
deterministic semantic SVG schematic. It is an in-process rendering boundary: it does
not load projects, accept serialized IR, write files, infer natural-language intent,
or mutate compiler IR. Pass it the `ir` and detached `presentation` from a
successful `CompileResult` (`ok === true`). Malformed or partial IR is an invariant
violation, not a supported render input.

## Public API

The package root exports only the renderer entry points, version constants, and the
request/result/error types listed below. Symbol definitions, mappings, presentation
DTOs, ELK DTOs, layout-engine injection, and SVG helpers are internal.

```ts
import {
  LAYOUT_CONFIG_VERSION,
  RENDERER_VERSION,
  SYMBOL_CATALOG_VERSION,
  createSchematicRenderer,
  renderSchematic,
  type IntentSchematicViewRequest,
  type LegacySchematicViewRequest,
  type RenderOutcome,
  type RenderedSchematic,
  type SchematicViewRequest,
} from "@thermite/render";

const k1: LegacySchematicViewRequest = {
  format: "schematic-view-request/0.1",
  family: "control",
  root: { by: "designation", value: "K1" },
};

const m1: LegacySchematicViewRequest = {
  format: "schematic-view-request/0.1",
  family: "power",
  root: { by: "designation", value: "M1" },
  flow: "top-to-bottom",
};

const trace: IntentSchematicViewRequest = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "LS1" },
  intent: {
    kind: "trace",
    to: { by: "designation", value: "PLC1" },
    includePower: true,
  },
};

const conductors: IntentSchematicViewRequest = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "CBL1" },
  intent: { kind: "conductors" },
};

const loads: IntentSchematicViewRequest = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "PS1" },
  intent: { kind: "loads" },
};

const k1Outcome: RenderOutcome<RenderedSchematic> = await renderSchematic(
  ir,
  k1,
  presentation,
);
const renderer = createSchematicRenderer();
const m1Outcome = await renderer.render(ir, m1, presentation);
```

`renderSchematic` creates a default renderer for one call.
`createSchematicRenderer()` returns a frozen async renderer that may be reused. The
optional third argument is `CompiledProjectPresentation` from
`@thermite/compiler`. Omitting it uses revision `UNSPECIFIED`, background
`#ffffff`, and no authored title lines; project name always comes from the IR. The
current version values are:

| Export                   | Value                          |
| ------------------------ | ------------------------------ |
| `RENDERER_VERSION`       | `render/0.3`                   |
| `SYMBOL_CATALOG_VERSION` | `ais-symbols/0.3`              |
| `LAYOUT_CONFIG_VERSION`  | `elk-layered/0.4+elkjs-0.12.0` |

The request and successful result contracts are:

```ts
type SchematicViewFamily = "control" | "power";
type SchematicFlow = "left-to-right" | "top-to-bottom";

interface LegacySchematicViewRequest {
  readonly format: "schematic-view-request/0.1";
  readonly family: SchematicViewFamily;
  readonly root: ObjectSelector; // { by: 'uid' | 'designation', value: string }
  readonly flow?: SchematicFlow;
}

type DemonstrationViewIntent =
  | {
      readonly kind: "trace";
      readonly to: ObjectSelector;
      readonly includePower: boolean;
    }
  | { readonly kind: "conductors" }
  | { readonly kind: "loads" };

interface IntentSchematicViewRequest {
  readonly format: "schematic-view-request/0.2";
  readonly root: ObjectSelector;
  readonly intent: DemonstrationViewIntent;
  readonly flow?: SchematicFlow;
}

type SchematicViewRequest =
  LegacySchematicViewRequest | IntentSchematicViewRequest;

interface NormalizedLegacySchematicView {
  readonly format: "schematic-view/0.1";
  readonly family: SchematicViewFamily;
  readonly root: {
    readonly deviceUid: string;
    readonly designation: string;
  };
  readonly flow: SchematicFlow;
}

type NormalizedIntentSchematicView =
  | {
      readonly format: "schematic-view/0.2";
      readonly family: "control";
      readonly intent: "trace";
      readonly root: {
        readonly kind: "device";
        readonly deviceUid: string;
        readonly designation: string;
      };
      readonly target: {
        readonly deviceUid: string;
        readonly designation: string;
      };
      readonly includePower: boolean;
      readonly flow: SchematicFlow;
    }
  | {
      readonly format: "schematic-view/0.2";
      readonly family: "control";
      readonly intent: "conductors";
      readonly root: {
        readonly kind: "cable";
        readonly cableUid: string;
        readonly designation: string;
      };
      readonly flow: SchematicFlow;
    }
  | {
      readonly format: "schematic-view/0.2";
      readonly family: "control";
      readonly intent: "loads";
      readonly root: {
        readonly kind: "device";
        readonly deviceUid: string;
        readonly designation: string;
      };
      readonly flow: SchematicFlow;
    };

type NormalizedSchematicView =
  NormalizedLegacySchematicView | NormalizedIntentSchematicView;

interface RenderSummary {
  readonly deviceUids: readonly string[];
  readonly terminalIds: readonly TerminalId[];
  readonly functionIds: readonly FunctionId[];
  readonly conductiveElementIds: readonly ConductiveElementId[];
  readonly netIds: readonly string[];
  readonly presentationNodeIds: readonly string[];
}

interface RenderedSchematic {
  readonly view: NormalizedSchematicView;
  readonly summary: RenderSummary;
  readonly svg: string; // canonical bytes as a JS string, including one final LF
}

type RenderFailure = QueryError | RenderError;
type RenderOutcome<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: RenderFailure };
```

Successes and expected failures are recursively detached and frozen. The summary is
the sorted provenance union represented by the diagram, not a claim that every
function step is presently conductive or energized.

The complete public type export set includes `SchematicViewFamily`, `SchematicFlow`,
`LegacySchematicViewRequest`, `DemonstrationViewIntent`,
`IntentSchematicViewRequest`, `SchematicViewRequest`,
`NormalizedLegacySchematicView`, `NormalizedIntentSchematicView`,
`NormalizedSchematicView`, `RenderSummary`,
`RenderedSchematic`, `SchematicRenderer`, `RenderOutcome`, `RenderFailure`,
`RenderErrorCode`, `RenderErrorBase`, `RenderError`, `InvalidViewRequestError`,
`IncompletePathError`, `UnsupportedSymbolMappingError`, `InvalidLayoutError`,
`InvalidRenderTextError`, `RuntimeInputType`, `RequestedStringInput`,
`RequestedFormatInput`, `RequestedRootInput`, `RequestedFamilyInput`,
`RequestedIntentInput`, `RequestedBooleanInput`, `RequestedFlowInput`,
`RenderTextOwnerKind`, `RenderTextField`, and `RenderTextReason`.

## Project presentation and visible identity

The renderer keeps presentation outside electrical IR and semantic view formats.
Each SVG contains these visible title lines in order:

1. `Project: <ir.project.name>`;
2. `Revision: <compiled revision or UNSPECIFIED>`;
3. `View: <normalized view identity>`;
4. `Tool: Thermite Schematics 0.2.0 | render/0.3`; and
5. zero to four authored presentation lines in source order.

Legacy identity is `<root> | <family>`; trace identity is
`<root> -> <target> | <family>/trace`; conductors and loads use
`<root> | <family>/<intent>`.

After non-painting metadata, style, and definitions, the first paintable element is
exactly one `canvas-background` rectangle covering the final viewBox with the
compiled six-digit opaque fill. Frames, conductors, symbols, labels, and the title
block paint afterward. Root metadata includes fixed-order `data-project-name`,
`data-project-revision`, `data-tool-version`, and
`data-renderer-version="render/0.3"`.

The title block is a bottom-right footer outside ELK layout. It never translates or
relayouts the diagram. It uses fixed 10-unit monospace measurement, 6.2 units per
code point, 14-unit line spacing, and canonical SVG-number formatting. Its palette is
always white panel, `#101828` text, and `#344054` stroke, independent of the
authored canvas color.

## View-spec normalization

The TypeScript request is deliberately narrow, but the runtime boundary is total over
`unknown`. A non-record, uninspectable, missing-format, or unsupported-format request
uses the byte-compatible v0.1 error branch. Exact v0.1 requests retain request →
format → root → family → flow precedence and the original descriptor shapes.

Exact v0.2 requests snapshot own descriptors once in `format`, `root`, `intent`,
`flow`, then nested `intent.kind`, `intent.to`, `intent.includePower` order. They
validate request → format → root → intent object → intent kind → forbidden non-trace
`to` → forbidden non-trace `includePower` → trace target → trace boolean → flow.
Trace requires an explicit boolean; there is no in-process default. An own `to` or
`includePower` on `conductors` or `loads` is invalid even when its value is
`undefined` or it is an accessor. Inherited properties are ignored.

Normalization never performs ordinary property access. Accessor descriptors,
throwing descriptor traps, revoked proxies, and values whose classification throws
become `uninspectable` for the exact field, and no getter runs. Only after the entire
request variant validates is one query engine constructed.

Every R001 contains safe, serialization-ready requested-input descriptors. A requested
string is one of `missing`, `uninspectable`, an exact captured `string`, or
`non-string` with one of `null`, `boolean`, `number`, `bigint`, `symbol`, `array`,
`object`, or `function`. A requested root is `missing`, `uninspectable`, a valid
`selector`, a `non-object` (including `string`), or `malformed-selector` with safe
`by` and `value` descriptors. Arbitrary objects, proxy payloads, symbols, bigints,
functions, cyclic values, `NaN`, and infinities are never string-coerced into an
error. `RequestedIntentInput` and `RequestedBooleanInput` are similarly closed;
trace target descriptors reuse `RequestedRootInput`.

The R001 `root` is always a string: the exact selector value after validation,
`<missing>`, `<invalid-root:<inputType>>`, `<uninspectable-request>`,
`<uninspectable-root>`, or `<invalid-root-selector>`. Only after request validation
does resolution run. An unresolved valid selector remains query error Q001. Legacy
views require a compatible device root. Trace requires a supported mapped device
root, a different device target, and a mapped input channel. Conductors resolves the
root through the query engine's cable selector, and loads requires exactly one mapped
control source with its source/return terminal pair.

`SchematicViewRequest` is the deterministic structured seam. It is not a
natural-language API or a general include/exclude/traversal DSL.

## Families and semantic selection

The renderer creates no geometry during selection and never rederives conductive
nets. It uses one `@thermite/query` engine for query-owned terminal/net/component
facts, reconstructs exact physical element IDs, and adds only mapping-owned
presentation function steps. Searches are deterministic, undirected, unweighted
breadth-first traversals with conductor steps sorted before function steps.

All stop classes require positive distance from the search start: exact authored
potential anchors, PLC channels, mapped source/return boundaries, and exact-role
fallbacks cannot accept the root terminal itself. An accepted stop is not expanded.
Class rank wins before path length and the complete structural tie-breaker. The result
keeps the union of equal-shortest routes to the selected boundary and prunes longer,
dangling, behind-boundary, and non-selected-boundary branches.

Potential eligibility uses only the exact authored `IrPotential.terminal` and the
opaque polarity values `positive`, `return`, and `protective_earth`. A potential
hydrated onto another member of the same derived net is label/tie-break metadata, not
a stop. Potential UID is the final tie-breaker for duplicate declarations.

### Control

A control root is one mapped two-terminal coil. The input side searches for, in
order, a PLC output channel, an exact positive-potential anchor, or a mapped DC source.
The return side searches for an exact return-potential anchor, a mapped source-return,
or an exact-role mapped fallback. Only `control-contact`, `command-contact`,
`permissive-contact`, and `protection-contact` functions are traversable.

The K1 reference view is exactly PLC1 DO0 -> `W-CTL-005` -> PB1 NC ->
`W-CTL-006` -> OL1 aux NC -> `W-CTL-007` -> K1 coil -> `W-CTL-008` ->
the PS1 `-`/0VDC return rail. It selects PLC1, PB1, OL1, K1, and PS1; K1 power poles,
K1 aux13, and OL1 power poles are absent.

### Power

Each mapped load terminal is a separate lane. Phase lanes traverse only
`power-contact`, `breaker-pole`, and `overload-pole`; the protective-earth lane
traverses physical conductors only. Multi-terminal sources and loads are boundaries,
never adjacency that joins phases.

The M1 reference lanes are SRC1 L1/L2/L3 -> matching CB1, K1, and OL1 pole ->
M1 U/V/W, plus the separate SRC1 PE -> `W-PWR-013` -> M1 PE lane. The phase union is
`W-PWR-001` through `W-PWR-012`. The CB1-to-PS1 branch is pruned, and the control-side
devices and K1/OL1 auxiliary functions are absent.

### Demonstration intents

`trace` selects one conductor-only signal arm from a supported LS1 root to the
named, different device's highest-ranked reachable mapped input. The supported root
rules are exact: `core:limit-switch-2wire` uses `contact13` with signal `14` and
positive supply `13`; `core:prox-pnp-3wire` uses the `pnp-sensor` aggregate with
signal `4`, positive supply `1`, and return supply `3`. With `includePower: true`,
trace also selects exactly the supply arms declared by that rule. With `false`,
omitted root-port compiler nets remain non-conductive provenance; no supply path,
edge, or remote-only device is imported. It never traverses a contact, channel, or
`feeds_internal` relation.

`conductors` resolves an exact cable and renders every authored member between its
two exact endpoints, sorted by conductor ID and oriented by the complete terminal
comparator. It stops at the cable endpoints. Labels are
`<cable>.<id> · <color>[ · <size>]`; the baseline includes all four CBL1 members,
including the terminated spare.

`loads` renders every complete mapped load whose terminals cover at least two of the
root source's mapped output nets, with one equal-shortest conductor-only arm per load
terminal. The baseline PS1 view contains only PLC1's complete `supply(L+,M)` load and
`W-CTL-001`/`W-CTL-002`; partial loads are excluded. An extra port of a selected
aggregate retains its compiler net as non-conductive provenance without importing
that net's conductors.

Crossing an NO or NC function means only that the function is on the requested
presentation path; it does not assert current state, energized state, or derived-net
continuity through the function. Trace is not arbitrary reachability, conductors is
not a cable schedule or continuation past the exact cable endpoints, and loads is not
current, capacity, utilization, voltage-drop, protection, fault, or load-flow
analysis.

## Reproduced source-edit propagation

The checked-in key experiment proves both source states without changing the
canonical `examples/motor-starter` project or package-owned shipped core tree. It
copies the project to an ordinary temporary directory, rejects reparse points, uses
the same immutable shipped library, and keeps `system.json`, every library file, and
`electrical-system.lock.json` byte-identical. The sequence is exact:

1. The untouched copy validates with zero diagnostics and compiles once; all five
   requests render from that one IR.
2. Changing only LS1's type to `core:prox-pnp-3wire`, while retaining its two-wire
   description and connections, produces exactly two E102 terminal-reference errors:
   `W-FLD-002` terminal `13` and `W-FLD-003` terminal `14`.
3. Changing the description, moving those endpoints to terminals `1` and `4`,
   changing the `W-FLD-003` label, and adding only `W-FLD-004` from `JB1.X1.3` to
   `LS1.3` validates cleanly against the same lock and compiles once.

The completed state still has 11 devices and 31 nets, but has 63 terminals, 44
functions, 18 internal relations, 27 wires, and 32 physical conductive elements.
Only the +24 V, signal, and 0 V net memberships/IDs change; the other 28 net IDs stay
identical. M1 is byte-identical as the negative control. K1 changes only where the new
0 V semantic net ID is surfaced. CBL1 keeps the same four conductors, endpoints, and
order while the `1+`, `1-`, and `2+` net IDs change and spare `2-` stays identical.
The trace changes from two-wire signal/+24 V arms to PNP signal/+24 V/0 V arms. The
loads view adds LS1's complete PNP supply while keeping LS1.4's signal net as
port-only provenance with no signal-arm conductor. Both include-power traces retain
`PS1.dc_output` exactly once while stopping at the authored PS1 potential anchor.

## Symbols, mappings, and ownership

Built-in symbols are original typed TypeScript geometry. They contain no raw SVG,
XML, CSS, callbacks, project coordinates, or imported standards artwork. One drawing
unit is one ELK coordinate and one SVG user unit; it is dimensionless, not a physical
or engineering length. The left-to-right catalog uses integer geometry and port
offsets in eighths; top-to-bottom applies the fixed clockwise orientation transform
while labels remain upright.

Every core `(type, function, family)` pair is covered exactly once by a rendered
function, membership in a rendered aggregate, or a typed omission. Function bindings
cover that function's exact terminals. Aggregate bindings retain an exact member
function for every port and cover the union of all required member terminals; they do
not claim that each terminal belongs to every member.

`PresentationClass` is the closed visual/rank vocabulary: `source`, `protection`,
`power-contact`, `control-contact`, `command`, `permissive`, `coil`, `overload`,
`load`, `terminal`, `plc-input`, `plc-output`, `rail`, and `junction`.
`TraversalRole` is separately closed over `source-boundary`, `load-boundary`,
`channel-boundary`, `coil-root`, the four control contact roles, `power-contact`,
`breaker-pole`, `overload-pole`, `terminal-display`, and `non-traversable`. Visual
class never grants path adjacency.

The core mapping surface is:

| Core type                                      | Rendered function or aggregate                           | Family behavior                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `core:supply-480v-3ph`                         | `three-phase-source` aggregate -> `ais:power-source-3ph` | Power source with ordered L1/L2/L3/PE; control omitted.                                          |
| `core:breaker-3p`                              | `pole1..3` -> `ais:breaker-pole`                         | Power only; `trip` is metadata-only in both families.                                            |
| `core:contactor-3p-1no`                        | `coil`, `pole1..3`, `aux13`                              | Control selects coil or aux; power selects poles; other functions are explicitly outside-family. |
| `core:overload-3p-1nc`                         | `pole1..3`, `aux95`                                      | Control selects aux; power selects poles; `trip` is metadata-only.                               |
| `core:motor-3ph`                               | `motor` aggregate -> `ais:motor-3ph`                     | Power load U/V/W/PE; control omitted.                                                            |
| `core:pushbutton-nc`                           | `contact11` -> `ais:pushbutton-nc`                       | Control only.                                                                                    |
| `core:limit-switch-2wire`                      | `contact13` -> `ais:switch-no`                           | Control only.                                                                                    |
| `core:prox-pnp-3wire`                          | `pnp-sensor` aggregate -> `ais:switch-sensor-pnp`        | Control mapping for the M6 source-edit seam; power omitted.                                      |
| `core:plc-compact`                             | `di0`, `di1`, `do0`, `do1`, `supply`                     | Selected control channel or `supply` via `ais:dc-load`; power omitted.                           |
| `core:psu-24vdc`                               | `dc_output` -> `ais:power-source-dc`                     | Control boundary; power omitted; `ac_input` is unsupported in v0.1.                              |
| `core:terminal-block-8`, `core:junction-box-8` | each `terminal1..8` -> `ais:terminal`                    | Selected positions render in either family.                                                      |

Omission reasons are exactly `metadata-only-mechanism`, `boundary-metadata-only`,
`outside-family`, and `unsupported-v0.1`. The cable type is not a device mapping; a
selected cable conductor is an edge. `ais:fuse` is catalog vocabulary, but no current
core fuse type exists. An unknown selected type/function returns R003; no generic
symbol is guessed.

Selected devices group under the exact authored location tuple or the separately
tagged virtual `UNSPECIFIED` location. Every group/node records `parentId`.
Junctions use the least common ancestor of incident visible endpoints after boundary
collapse. A device represented only by a root rail retains device, terminal, and net
provenance on that rail and omits empty location/device groups. Groups add no
electrical connectivity. Two conductors plus one semantic attachment create an
explicit junction; an isolated perpendicular crossing has neither a dot nor shared
connectivity.

No IEC 60617 artwork is copied, embedded, redistributed, or claimed. Existing
`iec:*` library strings are semantic hints only, and this package makes no standards
conformance claim.

## Layout and text

Layout is one in-process pure-JavaScript `elkjs` 0.12.0 Layered call over fresh,
sorted adapter DTOs. It uses fixed symbol port positions and order, includes compound
children, and owns all semantic edges at the JSON root. The frozen global options are:

| Setting                         | Value                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| algorithm / direction / routing | `layered`; `RIGHT` or `DOWN`; `ORTHOGONAL`                                                                                                     |
| hierarchy / edge coordinates    | `INCLUDE_CHILDREN`; `json.edgeCoords=ROOT`                                                                                                     |
| seed / components               | `randomSeed=1`; `separateConnectedComponents=true`                                                                                             |
| model order                     | `NODES_AND_EDGES`; components `MODEL_ORDER`; port model order `true`                                                                           |
| strategies                      | cycle `GREEDY_MODEL_ORDER`; crossing `LAYER_SWEEP`; placement `BRANDES_KOEPF`; port sorting `INPUT_ORDER`                                      |
| edge merging                    | `mergeEdges=false`; `mergeHierarchyEdges=false`                                                                                                |
| straight edges                  | `nodePlacement.favorStraightEdges=true`                                                                                                        |
| spacing                         | node/node `24`; between layers `56`; edge/edge `12`; edge/node `16`; component/component `32`; label/node `8`; label/label `4`; edge/label `4` |
| edge-label side / root padding  | `DIRECTION_UP`; `[top=16,left=16,bottom=16,right=16]`                                                                                          |

### Collision geometry proofs

Amendment B1 fixes the DC source/load port pitch from geometry, not from a collision
exception. Net-label width is `max(12, 6 + 6.2 * codePoints)` and every label is 14
units high. The complete authored potential inventory measures `+24VDC=43.2`,
`0VDC=30.8`, and `PE=L1=18.4`. In top-to-bottom flow an inward TAIL net label needs
`3 + width`, so the exact requirement is:

```text
P >= max(4 + 14, 4 + 18.4, 3 + 43.2) = 46.2
```

The frozen DC source and load are therefore 64 units high with port anchors at 8 and
56: a 48-unit pitch. That leaves 30 units after the right-flow terminal-label
envelope, 25.6 after the rotated `L+` label, and 1.8 after the worst rotated TAIL net
label. A 24-unit control reproduces R004; the 48-unit geometry passes the unchanged
full validator in both flows. No ELK option or returned coordinate is changed for B1.

Amendment B2 is likewise topology-derived. Before B2, the completed PNP trace had an
unmodeled `W-FLD-003`/`CBL1.1-` interior crossing at `(2093,189)` in right flow and
`(353.4,1664)` in down flow. Spacing and port-order controls did not fix both; the
smallest passing integral value is
`org.eclipse.elk.layered.priority.direction=2`, assigned only to the first conductive
edge incident on the signal port of a `core:prox-pnp-3wire` trace root. The unchanged
two-wire trace never receives it.

In the PNP loads view, ELK placed the zero-incidence signal label at local `(4,-7)`
in right flow and `(-6.1,4)` in down flow instead of the validator-required `(4,4)`.
Any leaf with a visible labeled port and zero presentation-edge incidence therefore
gets node option `org.eclipse.elk.portLabels.placement=OUTSIDE ALWAYS_SAME_SIDE`;
other leaves retain `OUTSIDE NEXT_TO_PORT_IF_POSSIBLE ALWAYS_SAME_SIDE`. This
predicate is based only on completed presentation incidence, not on intent, UID, or
coordinates. The PNP catalog remains exactly 48 by 40 with anchors `(0,10)`,
`(0,30)`, and `(48,20)`.

Finally, a loads source-output junction with exactly two outgoing conductor arms
sorts them by stable presentation order. Arm 0 uses the primary flow side, arm 1 the
counter-clockwise perpendicular side, and the source attachment the opposite side:
right flow is east/north/west and down flow is south/east/north. All junction ports
remain at the center of the existing 6-by-6 node. These three B2 rules yield passing
ELK graph sizes `2171 x 501`/`732.6 x 1742` for PNP trace and
`1704.6 x 493`/`716.2 x 1440` for PNP loads in right/down flow. Every node, port,
label, and route coordinate returned by ELK is normalized and emitted verbatim; there
is no authored coordinate, UID patch, post-layout repair, or collision exemption.

Target-sensitive options are attached to their legal effective target. Port-label
placement targets the leaf, while horizontal/vertical port-label spacing `4` targets
the effective device/root parent. Function/aggregate/rail label placement targets its
leaf. Edge-label placement (`CENTER` for conductor, `TAIL` for net) and `inline=false`
target the exact edge label. Edge-label spacing and side selection target the root.
Location/device label placement, padding, `NODE_LABELS MINIMUM_SIZE`, and deterministic
minimum sizes target the compound. Location minimum is
`[max(32, label width + 16), 54]`; device minimum is
`[max(16, label width + 16), 38]`. Location padding is `38/16/16/16` and device
padding is `30/8/8/8` (top/left/bottom/right).

Four-lane three-phase source and motor ports use a frozen `24`-unit pitch. In
left-to-right flow a leaf keeps the centered top header; in top-to-bottom flow its
upright label occupies a left header column and the rotated symbol begins at
`label width + 16`, leaving an `8`-unit gap between label and symbol/lead corridor.

The normalizer matches ELK output by stable ID rather than return-array order. Node,
port, and node-label positions accumulate parent offsets. Root-owned edge sections and
edge-label coordinates are already global under `json.edgeCoords=ROOT`, so no owner
offset is added. Missing, non-finite, out-of-range, non-orthogonal, disconnected,
ambiguous, overlapping, T-intersecting, or colliding geometry returns R004 before SVG.

Text boxes are computed without platform font measurement. Every text element carries
deterministic `textLength` and the `spacingAndGlyphs` `lengthAdjust` to reserve inline
advance and a stable per-label `clipPath` whose rectangle hard-bounds ink. SVG bytes,
not platform-identical glyph rasterization, are guaranteed.

## Text preflight and semantic IDs

Before ELK, layout measurement, metadata construction, or SVG output, the renderer
checks project name length. Empty or more than 160 Unicode code points returns R005
with owner `project`, ID `project`, field `project.name`, and reason
`empty-string` or `over-160-code-points`.

It then scans the complete visible title lines in display order: Project, Revision,
View, Tool, then authored lines by index. The inspected value includes each fixed
prefix, arrow, separator, family, and intent. Title owners are `project`,
`presentation`, `view`, and `renderer`; their fixed IDs are `project`,
`presentation`, `normalized-view`, `render/0.3`, and
`presentation.titleBlock.lines[<index>]`.

The complete closed field vocabulary is:

```text
project.name             title.project-line        title.revision-line
title.view-line          title.tool-line           title.authored-line
device.designation       device.type             device.location
function.key             aggregate.key           terminal.key
wire.properties.label    wire.designation        jumper.designation
cable.designation        cable.conductor.id       cable.conductor.color
cable.conductor.size     potential.name           boundary.label
```

For each complete title line, the earliest offending position wins; reason precedence
at one position is `unpaired-surrogate`, `xml-illegal-code-point`, then
`forbidden-single-line-code-point`. The last reason covers exactly TAB, LF, CR,
NEL, LINE SEPARATOR, and PARAGRAPH SEPARATOR. After every title line passes, the
existing graph registry is scanned in its stable source order.

The graph-owner vocabulary remains `cable`, `device`, `function`, `aggregate`,
`terminal`, `wire`, `jumper`, `cable-conductor`, `potential`, and
`boundary`. Every selected device's authored `device.type` is checked before it can
enter `data-type-id`. Its R005 owner ID is
`device-<u16(device UID)>`; rejected text never enters an owner ID or message.

Accepted XML 1.0 code points are tab, LF, CR, `U+0020..U+D7FF`,
`U+E000..U+FFFD`, and `U+10000..U+10FFFF`. Graph text may encode legal tab/LF/CR
as `&#x9;`, `&#xA;`, or `&#xD;`; complete title lines reject them under the
single-line rule. There is no sanitizer, replacement, trimming, or normalization.
The first invalid source returns R005 and no layout or SVG.

Every nonempty semantic tuple is encoded with one grammar: a closed ASCII kind prefix,
`-`, and exactly four lowercase hexadecimal digits for each raw JavaScript UTF-16 code
unit of every tuple part, with `--` between parts. The encoding is reversible and is
used unchanged for SVG IDs, nested presentation IDs, label clips, and R005 `ownerId`.
It does not use UTF-8, replacement, hashing, slugification, case folding, or
designation parsing.

| Raw string shape                       | Code-unit encoding |
| -------------------------------------- | ------------------ |
| lone high surrogate `\uD800`           | `d800`             |
| lone low surrogate `\uDC00`            | `dc00`             |
| surrogate pair `\uD83D\uDE00`          | `d83dde00`         |
| literal replacement character `U+FFFD` | `fffd`             |

The ID encoder is total over all four shapes even though text preflight rejects lone
surrogates. They cannot collide. Function and aggregate prefixes keep equal keys in
separate namespaces; authored and virtual locations remain distinct. A rail ID uses
device UID, terminal key, and boundary kind, and its metadata retains boundary kind,
device identity/type/designation, terminal, and net. Potential UID/name appears only
when exact-anchor provenance permits it.

SVG root metadata includes `data-view-intent` for v0.2, exactly one of
`data-root-device-uid` or `data-root-cable-uid`, and
`data-target-device-uid` only for trace. V0.2 title and ARIA text use
`<intent> schematic: <root designation>`; legacy titles remain family-based.

SVG geometry is quantized to at most three decimals. The inclusive safe magnitude is
`1_000_000_000`; non-finite or larger absolute values are R004. Formatting removes
trailing zeroes and negative zero and never emits exponent notation. Output uses the
fixed element/layer/attribute order, two-space indentation, structural LF only, no
literal tab/CR, and exactly one final LF.

## Expected errors

All R-errors include `code`, `message`, and string `root`. Optional fields are omitted
when inapplicable.

| Code / public type                     | Expected failure                                                       | Additional fields and policy                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Q001/Q002 / `QueryError`               | A well-formed selector is unknown, or a conductor root is not a cable. | Returned unchanged from query; no partial result.                                                                            |
| R001 / `InvalidViewRequestError`       | Invalid syntax, root kind/capability, trace target, or loads source.   | Safe format/root/family/intent/target/include/flow descriptors with exact omission rules; `deviceUid` only after resolution. |
| R002 / `IncompletePathError`           | A required family or intent path is incomplete.                        | Legacy path-side/lane variants plus closed trace segment, cable conductors, and complete-load variants; all readonly/frozen. |
| R003 / `UnsupportedSymbolMappingError` | Selected type/function/aggregate has no valid binding.                 | `family`, `deviceUid`, `typeId`, and optional `functionKey`; never emits a generic box.                                      |
| R004 / `InvalidLayoutError`            | Returned geometry violates the layout/SVG contract.                    | `family` and optional implicated `netId`; no SVG.                                                                            |
| R005 / `InvalidRenderTextError`        | Project/title/graph text violates the fixed renderability contract.    | `family`, closed `ownerKind`, safe `ownerId`, closed `field`, and one of five closed reasons; never echoes rejected text.    |

Catalog corruption, impossible-after-validation presentation state, a thrown ELK
error, or an emitter programming failure rejects the promise as an unexpected tool
failure. It does not add a new R-code. The CLI converts those failures to E001/exit 2.

## Determinism and future seams

The source and IR contracts remain `electrical-system/0.1` and
`electrical-ir/0.1`. Presentation is the separate compatible
`project-presentation/0.1` context. Request/view formats remain
`schematic-view-request/0.1`, `schematic-view-request/0.2`,
`schematic-view/0.1`, and its `0.2` revision; symbol and layout versions remain
`ais-symbols/0.3` and `elk-layered/0.4+elkjs-0.12.0`.

For equivalent IR semantics, compiled presentation, normalized view, supported
Node/ELK runtime, and exported versions, the SVG string is byte-identical. Title
content uses only project name, declared/default revision, normalized view identity,
authored lines, and fixed product/renderer versions. Title measurement uses fixed
code-point arithmetic; no platform font API participates.

All consumed collections cross semantic boundaries as freshly sorted arrays. ELK
receives a fresh deep DTO; results and summaries do not alias later renders. No
mutable singleton, layout array order, path, clock, Git state, locale, timezone,
process ID, random value, environment value, or output filename enters SVG. ELK is
0.12.0, seed is `1`, both merge options are false, and no cache exists.

The checked-in K1 control, M1 power, LS1-to-PLC1 trace, CBL1 conductors, and PS1 loads
SVGs are reviewed byte goldens from the same unchanged motor-starter IR.
Semantic/provenance/layout/XML assertions are authoritative; the goldens supplement
them and are not auto-updated or platform-specific. No saved-view or cache format is
committed yet.

[`@thermite/agent-tools`](../agent-tools/README.md) passes the existing public
`SchematicViewRequest` union and compiler-owned presentation through to this
renderer, then returns the renderer DTOs and R-errors unchanged. It does not add
agent-owned view syntax, selection, layout, geometry, or another R-code.
