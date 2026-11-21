import type { PreparedSchematicDrawing } from "../renderer.js";
import type { RenderFailure } from "../types.js";
import { drawingContinuations } from "./continuations.js";
import type { RootedSpacingWitness } from "./rooted-links.js";
import { protectedDrawingIntervals } from "./rooted-geometry.js";
import { cuts } from "./rooted-cuts.js";
import { safeAxisPlans, MAX_GRID_SHEETS, MAX_GRID_PLANS } from "./safe-cuts.js";
import { OUTER_SVG_PADDING } from "../symbols/catalog.js";
import type { Draft, DrawingBounds } from "./types.js";
import { boundarySafeGrid } from "./rooted-boundary-cuts.js";

export interface RootedGrid {
  greedy?: boolean;
  xs: number[];
  ys: number[];
}

export interface RootedSpacingCut {
  edgeIds: RootedSpacingWitness["edgeIds"];
  y: number;
}

type GridRejection = (error: RenderFailure, spacing?: RootedSpacingCut) => void;
type RootedRejection = (
  error: RenderFailure,
  attempt?: "boundary-retry",
  spacing?: RootedSpacingCut,
) => void;

export function gridLinks(
  p: PreparedSchematicDrawing,
  grid: RootedGrid,
  b: DrawingBounds,
  scale: number,
  drafts?: Draft[],
  onFailure?: GridRejection,
  measureSpacing = false,
) {
  const columns = grid.xs.length - 1;
  const count = columns * (grid.ys.length - 1);
  if (count > MAX_GRID_SHEETS) return false;
  let spacing: RootedSpacingCut | undefined;
  const result = drawingContinuations(
    drafts ??
      Array.from({ length: count }, () => ({ links: [] }) as unknown as Draft),
    p.graph,
    p.layout,
    grid.xs,
    grid.ys,
    b,
    scale,
    measureSpacing && p.view?.flow === "top-to-bottom"
      ? (witness) => {
          const row = Math.floor(witness.draftIndex / columns);
          const y = grid.ys[row + Number(witness.side === "bottom")];
          if (y !== undefined)
            spacing = { edgeIds: witness.edgeIds, y: y - OUTER_SVG_PADDING };
        }
      : undefined,
  );
  if (!result.ok) onFailure?.(result.error, spacing);
  return result.ok;
}

/** Keep the successful greedy plan. On failure score complete safe grids. */
export function rootedGrids(
  p: PreparedSchematicDrawing,
  b: DrawingBounds,
  scale: number,
  fallback = true,
  explore = false,
  onFailure?: RootedRejection,
  diagnoseIdentity = false,
): RootedGrid[] {
  const existing = originalRootedGrids(
    p,
    b,
    scale,
    fallback,
    explore,
    onFailure && ((error, spacing) => onFailure(error, undefined, spacing)),
    diagnoseIdentity,
  );
  if (existing.length) return existing;
  const grid = boundarySafeGrid(p.layout, b, scale);
  const retryRejected = onFailure
    ? (error: RenderFailure, spacing?: RootedSpacingCut) =>
        onFailure(error, "boundary-retry", spacing)
    : undefined;
  return grid &&
    gridLinks(p, grid, b, scale, undefined, retryRejected, !!onFailure)
    ? [grid]
    : existing;
}

function originalRootedGrids(
  p: PreparedSchematicDrawing,
  b: DrawingBounds,
  scale: number,
  fallback = true,
  explore = false,
  onFailure?: GridRejection,
  diagnoseIdentity = false,
): RootedGrid[] {
  const w = p.layout.width + 2 * OUTER_SVG_PADDING,
    h = p.layout.height + 2 * OUTER_SVG_PADDING;
  const { protectedX, protectedY } = protectedDrawingIntervals(
    p.layout,
    OUTER_SVG_PADDING,
  );
  const xs = cuts(w, b.w / scale, [...protectedX]),
    ys = cuts(h, b.h / scale, [...protectedY]);
  const fits = gridPredicate(p, b, scale, onFailure, diagnoseIdentity);
  const fast = xs && ys && fits({ xs, ys }) ? [{ xs, ys, greedy: true }] : [];
  if (fast.length && !explore) return fast;
  if (!fallback) return [];
  const xp = safeAxisPlans(w, b.w / scale, protectedX, (x) =>
    fits({ xs: [0, x, w], ys: [0, h] }, true),
  );
  const grids: RootedGrid[] = [...fast];
  for (const x of xp) {
    const yp = safeAxisPlans(h, b.h / scale, protectedY, (y) =>
      fits({ xs: x, ys: [0, y, h] }, true),
    );
    for (const y of yp) {
      const grid = { xs: x, ys: y };
      if (
        fits(grid) &&
        !grids.some(
          (g) =>
            JSON.stringify([g.xs, g.ys]) === JSON.stringify([grid.xs, grid.ys]),
        )
      )
        grids.push(grid);
      if (grids.length >= MAX_GRID_PLANS) return grids;
    }
  }
  return grids;
}

function gridPredicate(
  p: PreparedSchematicDrawing,
  b: DrawingBounds,
  scale: number,
  onFailure: GridRejection | undefined,
  diagnoseIdentity: boolean,
) {
  return (grid: RootedGrid, axis = false) => {
    let identity = false;
    const ok = gridLinks(
      p,
      grid,
      b,
      scale,
      undefined,
      (error, spacing) => {
        identity =
          error.code === "R006" && !!error.details?.continuationIdentity;
        if (!axis) onFailure?.(error, spacing);
      },
      !axis && !!onFailure,
    );
    // Diagnostic replay can pass an identity problem through axis pruning, but
    // a complete grid still fails. Never report an incomplete axis probe.
    return ok || (diagnoseIdentity && axis && identity);
  };
}
