import { bounds } from "./page.js";
import type { PaperPage } from "./types.js";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { DrawingBounds } from "./types.js";
import { protectedDrawingIntervals } from "./rooted-geometry.js";
import { mergedIntervals } from "./safe-cuts.js";
import { OUTER_SVG_PADDING } from "../symbols/catalog.js";
import type { RenderFailure } from "../types.js";

export interface ProtectedSpanConstraint {
  readonly axis: "width" | "height";
  readonly requiredMm: number;
  readonly availableMm: number;
  readonly shortfallMm: number;
}
export type RootedConstraint = { readonly message: string } & (
  | {
      readonly kind: "protected-span";
      readonly spans: readonly ProtectedSpanConstraint[];
    }
  | { readonly kind: "grid" }
);

export interface RootedDiagnostic {
  readonly constraint?: RootedConstraint;
  readonly gridFailure?: {
    readonly error: RenderFailure;
    readonly suffix: string;
  };
}

/** Any span-fitting alternative clears the claim; otherwise retain the least
 * worst-axis shortfall. Undefined measurements cannot prove a page constraint. */
export function leastRootedConstraint(
  constraints: readonly (RootedConstraint | undefined)[],
): RootedConstraint | undefined {
  if (!constraints.length || constraints.some((c) => !c)) return;
  return (constraints as RootedConstraint[]).reduce((best, next) =>
    constraintShortfall(next) < constraintShortfall(best) ? next : best,
  );
}
function constraintShortfall(constraint: RootedConstraint) {
  return constraint.kind === "grid"
    ? 0
    : Math.max(...constraint.spans.map((s) => s.shortfallMm));
}

/** Retain only diagnostic data, never the candidate layouts themselves. */
export function recordRootedDiagnostic(
  diagnostics: RootedDiagnostic[] | undefined,
  result: RootedDiagnostic,
) {
  diagnostics?.push({
    ...(result.constraint ? { constraint: result.constraint } : {}),
    ...(result.gridFailure ? { gridFailure: result.gridFailure } : {}),
  });
}

export function rootedDiagnosticError(
  error: RenderFailure,
  diagnostics: readonly RootedDiagnostic[] = [],
): RenderFailure {
  const constraint = leastRootedConstraint(
    diagnostics.map((d) => d.constraint),
  );
  if (!constraint) return error;
  const grid = diagnostics.find(
    (d) => d.gridFailure?.error === error,
  )?.gridFailure;
  return grid
    ? { ...error, message: constraint.message + grid.suffix }
    : withRootedConstraint(error, constraint);
}

/** Carry an already-measured shortfall; never rediscover source identities. */
export function withRootedConstraint(
  error: RenderFailure,
  constraint: RootedConstraint,
): RenderFailure {
  return error.code === "R006" &&
    error.details?.continuationIdentity &&
    !error.details.pageConstraint &&
    constraint.kind === "protected-span"
    ? {
        ...error,
        message: `${error.message} ${constraint.message}`,
        details: { ...error.details, pageConstraint: constraint },
      }
    : error;
}

/** Measured reservation shortfall, not a claim about the omitted wire's route. */
export function rootedConstraint(
  p: PreparedSchematicDrawing,
  b: DrawingBounds,
  scale: number,
): RootedConstraint {
  const { protectedX, protectedY } = protectedDrawingIntervals(
    p.layout,
    OUTER_SVG_PADDING,
  );
  const constraints = [
    { name: "width" as const, items: protectedX, capacity: b.w },
    { name: "height" as const, items: protectedY, capacity: b.h },
  ].flatMap(({ name, items, capacity }) => {
    const span = Math.max(
      0,
      ...mergedIntervals(items).map((i) => (i.end - i.start) * scale),
    );
    return span > capacity + 0.001
      ? [
          {
            axis: name,
            requiredMm: span,
            availableMm: capacity,
            shortfallMm: span - capacity,
          },
        ]
      : [];
  });
  const message =
    "No safe sheet grid fits: " +
    (constraints.length
      ? constraints
          .map(
            (c) =>
              `protected ${c.axis} ${c.requiredMm.toFixed(2)} mm exceeds ${c.availableMm.toFixed(2)} mm by ${c.shortfallMm.toFixed(2)} mm`,
          )
          .join("; ")
      : "no complete grid satisfies protected bounds, 3/18 mm continuation spacing and the 40-cut/80-sheet limits") +
    ". Use a larger sheet or landscape.";
  return constraints.length
    ? { kind: "protected-span", spans: constraints, message }
    : { kind: "grid", message };
}

/** A card itself cannot become smaller by choosing a different nearby position. */
export function invariantCardConstraint(
  p: PreparedSchematicDrawing,
  page: PaperPage,
) {
  const b = bounds(p.titleContext, page, p.view),
    height = b.h - 4;
  if (height < 50)
    return "Title information leaves insufficient drawing height. Use a larger sheet or shorter title lines.";
  const width = page.widthMm - 2 * page.marginMm - 10;
  for (const n of p.graph.nodes)
    if (n.kind !== "junction")
      for (const l of n.labels)
        if (l.offView) {
          const dw = l.width * 0.25 - width,
            dh = l.height * 0.25 - height;
          if (dw > 0.001 || dh > 0.001)
            return `Card at ${l.offView.terminalName} exceeds printable ${dw > dh ? "width" : "height"} by ${Math.max(dw, dh).toFixed(2)} mm at 3 mm em. Use a larger sheet or landscape.`;
        }
}
