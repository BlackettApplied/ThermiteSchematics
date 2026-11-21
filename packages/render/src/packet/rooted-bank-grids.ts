import type { PreparedSchematicDrawing } from "../renderer.js";
import type { InvalidSheetError } from "../errors.js";
import type { DrawingBounds } from "./types.js";
import { bankBounds, type ContinuationBank } from "./continuation-bank.js";
import { rootedGrids, type RootedSpacingCut } from "./rooted-plans.js";

/** Retain failures from tested cuts, never from uncut source conductors. A grid
 * that passes the cut guards must still report its own later fit constraint. */
export function rootedBankGrids(
  p: PreparedSchematicDrawing,
  b: DrawingBounds,
  scale: number,
  banks: readonly ContinuationBank[],
  explore: boolean,
) {
  let identityFailure: InvalidSheetError | undefined;
  let retryFailure: InvalidSheetError | undefined;
  let spacing: RootedSpacingCut | undefined;
  let boundarySpacing: RootedSpacingCut | undefined;
  const plan = (bank: ContinuationBank, replay = false) => {
    let bankIdentity: string | undefined;
    return rootedGrids(
      p,
      bankBounds(b, bank),
      scale,
      true,
      explore || replay,
      (error, attempt, cut) => {
        if (error.code !== "R006") return;
        if (cut) {
          if (attempt === "boundary-retry") boundarySpacing ??= cut;
          else spacing ??= cut;
        }
        // Pair the retry with the same bank's original boundary failure.
        if (
          attempt === "boundary-retry" &&
          bankIdentity &&
          bankIdentity === identityFailure?.details?.continuationIdentity &&
          p.graph.edges.some(
            (edge) =>
              edge.id === bankIdentity && edge.kind === "boundary-segment",
          )
        )
          retryFailure ??= error;
        const identity = error.details?.continuationIdentity;
        if (typeof identity === "string" && identity) {
          bankIdentity ??= identity;
          identityFailure ??= error;
        }
      },
      replay,
    ).map((grid) => ({ bank, grid }));
  };
  const grids = banks.flatMap((bank) => plan(bank));
  if (!grids.length && !identityFailure)
    for (const bank of banks) grids.push(...plan(bank, true));
  if (grids.length) return { grids };
  return {
    grids,
    spacing: boundarySpacing ?? spacing,
    cutFailure:
      identityFailure && retryFailure
        ? withBoundaryRetry(identityFailure, retryFailure)
        : identityFailure,
  };
}

function withBoundaryRetry(
  original: InvalidSheetError,
  retry: InvalidSheetError,
): InvalidSheetError {
  return {
    ...original,
    message: `The retry with presentation-only boundary segments kept whole failed. ${retry.message} The original grid also failed. ${original.message}`,
    details: { ...original.details, boundaryCutRetry: retry.details },
  };
}
