import { InvalidSymbolMappingError } from "../errors.js";
import { selectControlPaths } from "./actuation.js";
import {
  pathTerminalDisplayFunctionIds,
  buildSelectedSubgraph,
} from "./conservation.js";
import { createSelectionContext } from "./context.js";
import type {
  SelectSemanticSubgraphRequest,
  SelectSemanticSubgraphResult,
} from "./contracts.js";
import { selectPowerPaths } from "./power.js";

export function selectSemanticSubgraph(
  request: SelectSemanticSubgraphRequest,
): SelectSemanticSubgraphResult {
  const created = createSelectionContext(request);
  if (!created.ok) return created;
  const context = created.value;
  const selected =
    context.view.family === "control"
      ? selectControlPaths(context)
      : selectPowerPaths(context);
  if (!selected.ok) return selected;
  const displayFunctions = pathTerminalDisplayFunctionIds(
    context,
    selected.paths,
    (detail) => {
      throw new InvalidSymbolMappingError(
        `Invalid ${context.view.family} mapping: ${detail}`,
      );
    },
    selected.rootFunctionIds,
  );
  if (!displayFunctions.ok) return displayFunctions;
  // Validate ownership without changing the successful selection DTO. Legacy
  // views already materialize terminal displays implicitly in presentation.
  return Object.freeze({
    ok: true,
    value: buildSelectedSubgraph(
      context,
      selected.paths,
      selected.rootFunctionIds,
    ),
  });
}
