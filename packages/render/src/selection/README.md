# Semantic selection boundary

`selection.ts` preserves the internal entry points. The selectors consume the
compiled IR and catalog mappings; they do not derive nets or repair source.

| Family / entry point                                                | Graph needs                                                                                                           | Guarantees on success                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Actuation: `selectControlPaths`                                     | One mapped coil root; public net/component DTOs, approved function adjacency, and potential/channel/mapped boundaries | Both input and return arms, in the existing ranked order, with the root function owner              |
| Power: `selectPowerPaths`                                           | Mapped load lanes and phase/PE boundary roles; the same public queries and approved adjacency                         | Every root lane reaches its accepted boundary; PE traverses conductors only                         |
| Trace: `selectTraceSubgraph`                                        | Validated trace-root rule, mapped target input channels, physical conductors and supply boundaries                    | Signal and requested supply arms; omitted mapped ports retain their original provenance nets        |
| Loads: `selectLoadsSubgraph`                                        | Two mapped source outputs, qualifying complete load representations and physical conductor nets                       | Complete qualifying loads and their arms; aggregate terminal provenance is retained                 |
| Conductors: `selectCableConductors`, `selectCableConductorSubgraph` | One public cable DTO, authored conductor/endpoints and mapped terminal owners                                         | All returned cable conductors, checked against authored identities/endpoints, with original net IDs |

`contracts.ts` defines the shared interfaces. `SelectionContext` exposes only
`net` and `followConductive` from the query engine, plus per-request IR/mapping
indexes and caches. Actuation and power enable catalog-approved two-terminal
function edges. Trace and loads disable them. Conductors use `cable` with a
`SymbolMappingContext`, without a traversal context.

`RootedPathSearch` supplies family stopping policy and orientation to the existing
breadth-first search. `traversal.ts` owns visitation, predecessor ranking, query/IR
conductor agreement and path reconstruction; a policy supplies no new edges.
`boundaries.ts` constructs and ranks candidates. Query errors and family failures
retain their existing results and diagnostic context.

`conservation.ts` checks pass-through terminal ownership before subgraph assembly.
`RootPathSelectionResult` supplies root paths and function owners;
`SelectedIdentities` returns the selected functions' terminals and endpoint
devices, exactly the selected physical conductors, and their original plus
explicit provenance net IDs. Returned identity arrays and IDs are detached and
frozen. Legacy rooted views validate implicit terminal displays without adding
them to the successful DTO. `rooted.ts` dispatches control/power and applies this
common conservation gate.
