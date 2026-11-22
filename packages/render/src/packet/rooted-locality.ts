import type { PreparedSchematicDrawing } from "../renderer.js";
import type { RootedCandidate } from "./rooted-build.js";
import { required } from "../presentation/util.js";

export const CARD_LOCALITY_AIM_MM = 15;
/** Terminal-marker centre to the nearest painted card border, in sheet mm.
 * The frame's 0.75-unit stroke is independent of text/advance reservations. */
export function cardLocalities(p: PreparedSchematicDrawing, scale: number) {
  const ports = new Map(p.layout.ports.map((p) => [p.id, p]));
  const labels = new Map(p.layout.labels.map((l) => [l.id, l]));
  return p.graph.nodes.flatMap((n) =>
    (n.kind === "junction" ? [] : n.labels).flatMap((l) => {
      if (!l.offView) return [];
      const port = required(ports.get(l.ownerId), "Missing card terminal"),
        box = required(labels.get(l.id), "Missing card border");
      const x = port.x + port.width / 2,
        y = port.y + port.height / 2;
      // SVG rect borders use mitered corners: expand each axis by half the stroke.
      return [
        {
          key: JSON.stringify([
            n.id,
            l.offView.terminal.deviceUid,
            l.offView.terminal.terminalKey,
          ]),
          distance:
            Math.hypot(
              Math.max(box.x - 0.375 - x, 0, x - box.x - box.width - 0.375),
              Math.max(box.y - 0.375 - y, 0, y - box.y - box.height - 0.375),
            ) * scale,
        },
      ];
    }),
  );
}

export function cardDistances(p: PreparedSchematicDrawing, scale: number) {
  return cardLocalities(p, scale).map((c) => c.distance);
}
// Candidates retain their layout, scale and physical page count after build.
// Weak keys keep the memoized geometry scoped to one finite view search.
const distanceCache = new WeakMap<
  RootedCandidate,
  ReadonlyMap<string, number>
>();
const eligibilityCache = new WeakMap<
  RootedCandidate,
  WeakMap<RootedCandidate, boolean>
>();
function candidateDistances(c: RootedCandidate) {
  let found = distanceCache.get(c);
  if (!found) {
    found = new Map(
      cardLocalities(c.prepared, c.scale).map((d) => [d.key, d.distance]),
    );
    distanceCache.set(c, found);
  }
  return found;
}
/** Fixed route-safe reference makes equal-sheet locality a total-order key.
 * Physical sheet savings always win; the 15 mm excess remains a soft score. */
export function localityRegression(
  c: RootedCandidate,
  reference?: RootedCandidate,
) {
  if (
    !reference ||
    c === reference ||
    c.drafts.length < reference.drafts.length
  )
    return false;
  let entries = eligibilityCache.get(c);
  if (!entries) {
    entries = new WeakMap();
    eligibilityCache.set(c, entries);
  }
  const saved = entries.get(reference);
  if (saved !== undefined) return saved;
  const old = candidateDistances(reference);
  const result = [...candidateDistances(c)].some(([key, distance]) => {
    const before = old.get(key);
    // A card absent from the reference conservatively counts as a regression.
    return before === undefined || distance > before + 0.1;
  });
  entries.set(reference, result);
  return result;
}
