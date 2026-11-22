import {
  documentCoverRectangle,
  laterRectangleCovers,
  type CoverRectangle,
} from "./document-covering.js";
import type { Rect } from "../device-legend/geometry.js";
import type { NavigationGeometry } from "./navigation-walk.js";

/** Per immutable generated sheet; never retained across renders or IR edits. */
export function documentMeasurements(geometry: readonly NavigationGeometry[]) {
  const byId = new Map<string, NavigationGeometry>(),
    byNode = new Map<NavigationGeometry["node"], NavigationGeometry>(),
    indices = new Map<NavigationGeometry, number>(),
    texts = new Map<NavigationGeometry["node"], boolean>();
  for (const [index, g] of geometry.entries()) {
    const id = g.node.attrs.id;
    if (id !== undefined && !byId.has(id)) byId.set(id, g);
    if (!byNode.has(g.node)) byNode.set(g.node, g);
    if (!indices.has(g)) indices.set(g, index);
  }
  let rectangles: CoverRectangle[] | undefined;
  return {
    byId,
    byNode,
    texts,
    covered(ink: Rect, g: NavigationGeometry) {
      rectangles ??= geometry.flatMap((later, index) => {
        const rectangle = documentCoverRectangle(later, index);
        return rectangle ? [rectangle] : [];
      });
      const index = indices.get(g) ?? -1;
      return rectangles.some((later) =>
        laterRectangleCovers(ink, index, later),
      );
    },
  };
}
export type DocumentMeasurements = ReturnType<typeof documentMeasurements>;
