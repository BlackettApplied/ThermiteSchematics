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
import type { SelectedTerminalOwner } from "../types.js";

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
  const terminalOwners: SelectedTerminalOwner[] = [];
  const displayFunctions = pathTerminalDisplayFunctionIds(
    context,
    selected.paths,
    (detail) => {
      throw new InvalidSymbolMappingError(
        `Invalid ${context.view.family} mapping: ${detail}`,
      );
    },
    selected.rootFunctionIds,
    terminalOwners,
  );
  if (!displayFunctions.ok) return displayFunctions;
  // Keep mapped terminal displays implicit; only projected coil terminals carry
  // separate ownership context, without selecting their owner functions.
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...buildSelectedSubgraph(
        context,
        selected.paths,
        selected.rootFunctionIds,
      ),
      ...(terminalOwners.length
        ? { terminalOwners: Object.freeze(terminalOwners) }
        : {}),
    }),
  });
}
