# `@thermite/query`

`@thermite/query` is the deterministic, read-only query layer for a successful
`electrical-ir/0.1` compilation. It resolves exact project objects and terminals,
inspects semantic summaries, reports immediate neighbors, traces conductive
components, returns complete net membership, and describes authored cable
conductors.

The package reads only the supplied IR. It does not load project JSON, trust a
serialized IR artifact, search aliases, or mutate its input.

## Creating an engine

```ts
import { compileProject } from "@thermite/compiler";
import { createQueryEngine, serializeQueryResult } from "@thermite/query";

const compiled = await compileProject("examples/motor-starter");
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

const query = createQueryEngine(compiled.ir);
const result = query.net({
  by: "parts",
  deviceDesignation: "PLC1",
  terminalKey: "X1.0",
});

if (result.ok) {
  process.stdout.write(serializeQueryResult(result.value));
} else {
  console.error(result.error);
}
```

`createQueryEngine(ir)` requires the complete IR from the success arm of
`compileProject`. It hydrates and validates all nine serialized indexes once. A
hand-built or corrupted IR throws `InvalidElectricalIrError`; this is an invariant
or tool failure, not a normal query miss. Returned DTOs are recursively copied,
JSON-safe values and do not alias the IR or another result.

`serializeQueryResult(result)` emits deterministic two-space JSON with recursively
ordered metadata keys, LF line endings, and one final newline. It does not mutate
the result.

## Selectors and engine methods

`ObjectSelector` is either `{ by: "uid", value }` or
`{ by: "designation", value }`. Both are exact and case-sensitive. Aliases and type
IDs are not object selectors.

`TerminalSelector` has three forms:

- `{ by: "id", value: { deviceUid, terminalKey } }` uses structural identity.
- `{ by: "parts", deviceDesignation, terminalKey }` passes both opaque components
  without parsing.
- `{ by: "display", value }` applies the CLI dotted grammar: choose the longest
  compiled device designation followed by `.` and a non-empty suffix, then use the
  complete suffix as the terminal key without backtracking.

`QueryEngine` provides:

| Method                      | Result                                                   |
| --------------------------- | -------------------------------------------------------- |
| `resolveObject(selector)`   | `ProjectObjectView` for any project-object kind.         |
| `resolveTerminal(selector)` | The exact materialized `TerminalView`.                   |
| `inspect(selector)`         | `InspectResult` for any project-object kind.             |
| `neighbors(selector)`       | `NeighborsResult`; the object must be a device.          |
| `trace(selector)`           | `TraceResult`; starts from every terminal of a device.   |
| `net(selector)`             | `NetResult` with complete flat membership.               |
| `cable(selector)`           | `CableResult`; the object must be a cable.               |
| `followConductive(starts)`  | Ordered `TraceComponent[]` from structural terminal IDs. |

Every method returns `QueryResult<Value>`, either `{ ok: true, value }` or
`{ ok: false, error }`. `followConductive` validates starts in caller order before
deduplication; the first invalid start wins, and an empty list succeeds with `[]`.

## Errors

`QueryErrorCode` is the closed union `Q001 | Q002 | Q003 | Q004`.
`QueryError` always contains `code`, `message`, and the canonical `input`. It contains
no source location because query misses are not compiler diagnostics.

| Code   | Meaning                                                                         | Optional fields                     |
| ------ | ------------------------------------------------------------------------------- | ----------------------------------- |
| `Q001` | Exact UID or canonical designation was not found.                               | None.                               |
| `Q002` | The object exists but the operation requires a device or cable.                 | `expectedKind`, `actualKind`.       |
| `Q003` | A display terminal selector has no non-empty compiled-device prefix and suffix. | None.                               |
| `Q004` | The selected device has no exact materialized terminal key.                     | `deviceDesignation`, `terminalKey`. |

`input` is the unmodified object selector string, the selected terminal key for
`Q004`, or compact structural JSON for `id` and `parts` selectors where required.
Optional fields are omitted when they do not apply.

## Structural identity and shared views

Display strings are for presentation only. Terminal display is
`<device designation>.<terminal key>` and cable-conductor display is
`<cable designation>.<conductor id>`; either can collide because both components are
opaque. Use `TerminalId { deviceUid, terminalKey }`, object UIDs/designations, and
`CableConductorId { cableUid, conductorId }` as identities. Never split a returned
display string to reconstruct identity.

The shared public DTOs contain these fields:

- `ProjectObjectView`: `kind`, `uid`, optional `designation`, optional
  `description`, and sorted `aliases`.
- `ProjectObjectKind`: the `device | wire | jumper | cable | relation | potential`
  kind union.
- `DeviceView`: all project-object fields plus `kind: "device"`, required
  `designation`, `typeId`, and optional `location`.
- `TerminalView`: structural `id`, `deviceDesignation`, `display`, and optional
  `role`, `rating`, `connectionPolicy`, and `description`.
- `PotentialView`: `uid`, `name`, and authored `electrical` metadata.
- `NetSummaryView`: net `id` and sorted `potentials`.
- `ProjectRelationView`: `uid`, optional `designation`, fallback-safe `display`,
  `verb`, and resolved `from` and `to` device views.
- `ConductiveElementView`: a wire has `kind`, `uid`, `designation`, and `display`; a
  jumper has `kind`, `uid`, optional `designation`, and `display`; a cable conductor
  has `kind`, `cableUid`, `cableDesignation`, `conductorId`, and `display`.
- `ConductiveEdgeView`: `element` plus a deterministically ordered two-terminal
  `endpoints` tuple.

Optional `rating`, `electrical`, `properties`, and `construction` objects retain
their values while their keys are recursively canonicalized for serialization.

## Command result DTOs

### Inspection

`InspectResult` contains `command: "inspect"` and `object: InspectedObject`.
Every inspected object begins with the project-object fields, then adds fields by
kind:

- Device: `typeId`, optional `location`, `terminals`, `functions`, `gangedGroups`,
  `internalRelations`, and `projectRelations`. Each `InspectedTerminalView` adds its
  `net` summary and incident `elements` to `TerminalView`.
- Wire: required `designation`, optional `properties`, two `endpoints`, and `net`.
- Jumper: two `endpoints` and `net`.
- Cable: required `designation`, `typeId`, `cableType`, `conductorCount`, and
  `conductorIds`. `cableType` contains `id` plus optional `shield` and
  `construction`.
- Relation: `verb`, resolved `from`, and resolved `to` devices.
- Potential: `name`, `electrical`, selected `terminal`, and `net`.

Inspection helper DTOs are:

- `FunctionView`: `key`, `kind`, optional `normalState`, optional `direction`, and
  member `terminals`.
- `GangedGroupView`: derived group `id` and sorted `functionKeys`.
- `InternalRelationView`: `verb`, `fromFunctionKey`, and `toFunctionKey`.
- `IncidentProjectRelationView`: resolved `relation`, direction relative to the
  inspected device (`incoming`, `outgoing`, or `self`), and `otherDevice`.

### Neighbors

`NeighborsResult` contains `command: "neighbors"`, the subject `device`,
`conductive`, and `relations`.

- Each `ConductiveNeighbor` contains the subject `terminal`, physical `element`,
  `otherTerminal`, and resolved `otherDevice`.
- Each `RelationNeighbor` contains the declared project `relation`, its relative
  `direction`, and `otherDevice`.

Parallel conductors remain separate. Conductive and project-relation neighbors are
separate arrays; a `controls` relation does not imply electrical continuity.

### Trace and conductive following

`TraceResult` contains `command: "trace"`, the subject `device`, and sorted
`components`. Each `TraceComponent` contains:

- `net`: its `id` and `potentials`;
- `roots`: deduplicated starting terminals on that net;
- `visits`: breadth-first `TraceVisit` values; and
- `elements`: all physical `ConductiveEdgeView` values in the component, including
  cycle and parallel edges that are not discovery predecessors.

`TraceVisit` contains `terminal` and numeric `hops`. Non-root visits also contain
`via { from, element }`, recording the deterministic first discovery predecessor.
`followConductive` returns the same `TraceComponent` shape without a `TraceResult`
wrapper.

### Net

`NetResult` contains `command: "net"`, `selectedTerminal`, and `net`. The `net`
object contains its `id`, all `potentials`, all member `terminals`, and all physical
`elements`. Singleton terminals therefore return a valid one-terminal net rather
than an error.

### Cable

`CableResult` contains `command: "cable"`, `cable`, `cableType`, and authored
`conductors`.

- `cable` contains the project-object fields plus `kind: "cable"`, required
  `designation`, and `typeId`.
- `cableType` contains `id` and optional `shield` and `construction`.
- Each `CableConductorView` contains structural `id`, `display`, `color`, optional
  `size`, two `endpoints`, and `net { id, potentials }`.

Only authored conductor instances are returned; unused type members and shield
terminations are not synthesized.

`QueryCommandResult` is the union of `InspectResult`, `NeighborsResult`,
`TraceResult`, `NetResult`, and `CableResult`.

## Traversal limits

Traversal is deterministic, undirected breadth-first traversal over wires, jumpers,
and cable conductors only. Hops count physical conductive elements. It does not cross
contacts, channels, functions, internal relations, ganged groups, or project
relations; it does not evaluate contact state, energized state, direction,
upstream/downstream meaning, or potential sources.

M4 deliberately exports no `shortestConductivePath`, `ConductivePath`, generic search,
filter language, or point-to-point path command. Higher-level views and rendering are
downstream concerns.

## Rendering boundary

`@thermite/render` consumes the same fresh successful in-memory `ElectricalIr`
and composes query-owned net/component/terminal facts with renderer-owned,
presentation-only function traversal. The renderer may show a mapped contact as a
step in a requested view, but that does not add the contact to a derived net or make
M4 traversal cross functions. Query remains conductive-only and its public API still
has no point-to-point or presentation-path helper.

Milestone 7's [`@thermite/agent-tools`](../agent-tools/README.md) composes this
public boundary: inspect returns the existing one-hop DTO and graph query dispatches
only `neighbors`, `trace`, `net`, or `cable`. It does not widen query with a generic
search/traversal DSL, point-to-point helper, new selector semantics, or new Q-code.
