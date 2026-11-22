import type { RootedCandidate } from "../../src/packet/rooted-build.js";
import type { PreparedSchematicDrawing } from "../../src/renderer.js";
import { rootedDraft } from "../../src/packet/rooted-draft.js";
import { svgSemanticId } from "../../src/svg/escape.js";
import { sideCandidate, fixtureInk } from "./side-candidate.js";
export function sideLocation(
  count = 1,
  x = 0,
  width = 200,
  firstWidth = 40,
): { candidate: RootedCandidate; inner: string } {
  const c = sideCandidate(),
    labels = Array.from({ length: count }, (_, i) => ({
      id: `location-label-${i}`,
      ownerKind: "location",
      ownerId: `location-${i}`,
      role: "location",
      text: count === 1 ? "FIELD" : `LOCATION-${i}`,
      x,
      y: 20 + i * 2,
      width: 65,
      height: 14,
      baselineY: 30 + i * 2,
    }));
  const groups = labels.map((l) => ({
    id: l.ownerId,
    label: { id: l.id, text: l.text, textLength: 65 },
  }));
  c.prepared = {
    ...c.prepared,
    graph: {
      ...c.prepared.graph,
      locationGroups: groups,
      nodes: c.prepared.graph.nodes.map((n, i) =>
        i === 0 ? { ...n, symbolSize: { width: firstWidth, height: 40 } } : n,
      ),
    },
    layout: {
      ...c.prepared.layout,
      width,
      labels,
      nodes: [
        ...c.prepared.layout.nodes.map((n, i) =>
          i === 0 ? { ...n, width: firstWidth } : n,
        ),
        ...groups.map((g) => ({
          id: g.id,
          kind: "location",
          x: 0,
          y: 0,
          width: 240,
          height: 130,
        })),
      ],
    },
  } as unknown as PreparedSchematicDrawing;
  c.grid.xs = [0, width + 40];
  const b = { ...c.drafts[0]!.drawingBounds!, w: (width + 40) * c.scale };
  const inner =
    fixtureInk +
    labels
      .map(
        (l) =>
          `<text class="label-location" clip-path="url(#${svgSemanticId("clip", [l.id])})" x="${x}" y="30">${l.text}</text>`,
      )
      .join("");
  const prior = c.drafts;
  c.drafts = prior.map((d, i) => ({
    ...rootedDraft(c.prepared, c.grid, 0, i, b, c.scale, inner),
    links: d.links,
  }));
  return { candidate: c, inner };
}
