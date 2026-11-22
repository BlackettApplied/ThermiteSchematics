// Internal compatibility entry point; package exports remain in index.ts.
export type {
  SelectSemanticSubgraphRequest,
  SelectSemanticSubgraphResult,
  SelectTraceSubgraphRequest,
  IncompleteTraceSelectionError,
  SelectTraceSubgraphResult,
  SelectCableConductorsRequest,
  CableConductorSelection,
  IncompleteCableConductorSelectionError,
  SelectCableConductorsResult,
  SelectCableConductorSubgraphRequest,
  SelectCableConductorSubgraphResult,
  SelectLoadsSubgraphRequest,
  IncompleteLoadsSelectionError,
  SelectLoadsSubgraphResult,
} from "./selection/contracts.js";
export {
  selectCableConductors,
  selectCableConductorSubgraph,
} from "./selection/conductors.js";
export { selectTraceSubgraph } from "./selection/trace.js";
export { selectLoadsSubgraph } from "./selection/loads.js";
export { selectSemanticSubgraph } from "./selection/rooted.js";
