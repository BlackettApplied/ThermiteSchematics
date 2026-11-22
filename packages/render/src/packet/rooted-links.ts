import { required } from "../presentation/util.js";
import type { PresentationEdge, LayoutEdge, RenderOutcome } from "../types.js";
import type { Draft, DrawingBounds, Link } from "./types.js";
import { continuationIdentity } from "./continuation-identity.js";
import { continuationCutMessage } from "./continuation-cut-message.js";
import { rootedCrossings } from "./rooted-crossings.js";
import { failure } from "./errors.js";

export interface RootedSpacingWitness {
  edgeIds: readonly [string, string];
  draftIndex: number;
  side: "top" | "bottom";
}

export function drawingContinuations(
  drafts: Draft[],
  graph: {
    readonly edges: readonly Pick<
      PresentationEdge,
      "id" | "label" | "conductor" | "elementIds"
    >[];
  },
  layout: {
    readonly edges: readonly Pick<LayoutEdge, "id" | "points" | "netId">[];
  },
  xs: readonly number[],
  ys: readonly number[],
  b: DrawingBounds,
  scale: number,
  onSpacing?: (witness: RootedSpacingWitness) => void,
): RenderOutcome<void> {
  let serial = 0;
  const edgeIds = onSpacing && new Map<string, string>();
  for (const edge of layout.edges) {
    const semantic = graph.edges.find((e) => e.id === edge.id);
    if (!semantic || semantic.label?.role === "reference") continue;
    const crossings = rootedCrossings(edge, xs, ys, b, scale);
    if (!crossings.length) continue;
    const identity = continuationIdentity(semantic);
    if (!identity)
      return failure("unprintable-layout", continuationCutMessage(semantic), {
        continuationIdentity: edge.id,
      });
    for (const c of crossings) {
      const id = `C${String(++serial).padStart(3, "0")}`;
      edgeIds?.set(id, edge.id);
      appendCrossing(drafts, c, b, { id, ...identity, netId: edge.netId });
    }
  }
  for (const [draftIndex, d] of drafts.entries())
    for (let i = 0; i < d.links.length; i++)
      for (const other of d.links.slice(i + 1)) {
        const l = required(d.links[i], "Missing endpoint");
        if (l.side !== other.side) continue;
        const vertical = l.side === "left" || l.side === "right";
        const actualMm = vertical
          ? Math.abs(l.y - other.y)
          : Math.abs(l.x - other.x);
        const minimumMm = vertical ? 3 : 18;
        if (actualMm < minimumMm) {
          if (edgeIds && onSpacing && (l.side === "top" || l.side === "bottom"))
            onSpacing({
              edgeIds: [
                required(edgeIds.get(l.id), "Missing blocking route"),
                required(edgeIds.get(other.id), "Missing blocking route"),
              ],
              draftIndex,
              side: l.side,
            });
          const rounded = actualMm.toFixed(2);
          const distance =
            Number(rounded) < minimumMm ? rounded : `<${minimumMm}`;
          return failure(
            "unprintable-layout",
            `Continuation labels are too close to print clearly (${distance} mm apart, ${minimumMm} mm required). Change flow, use a larger sheet, or narrow the view.`,
            {
              conductorIds: [l.provenance, other.provenance],
              continuationSpacing: { actualMm, minimumMm },
            },
          );
        }
      }
  return { ok: true, value: undefined };
}

function appendCrossing(
  drafts: Draft[],
  c: ReturnType<typeof rootedCrossings>[number],
  b: DrawingBounds,
  common: Omit<Link, "x" | "y" | "side" | "to">,
) {
  const from = required(drafts[c.from], "Missing source section");
  const to = required(drafts[c.to], "Missing peer section");
  from.links.push({
    ...common,
    end: 0,
    to: c.to + 1,
    ...sheetEndpoint(c.a, from, b),
  });
  to.links.push({
    ...common,
    end: 1,
    to: c.from + 1,
    ...sheetEndpoint(c.z, to, b),
  });
}

/** Each fallback sheet can release a cut-free side reservation. Construct its
 * route-end anchor in that sheet's viewport coordinate system. */
function sheetEndpoint<T extends { x: number; y: number }>(
  endpoint: T,
  draft: Draft | undefined,
  base: DrawingBounds,
): T {
  const area = draft?.drawingBounds ?? base;
  if (area.x === base.x && area.y === base.y) return endpoint;
  return {
    ...endpoint,
    x: endpoint.x + area.x - base.x,
    y: endpoint.y + area.y - base.y,
  };
}
