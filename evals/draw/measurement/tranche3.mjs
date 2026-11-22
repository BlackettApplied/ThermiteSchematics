// Measured ink only. Attributes locate identities; none assert correctness.
export function trancheSheetFields(c) {
  const { h } = c;
  return {
    ...h.sheetFields1(c),
    ...h.sheetFields2(c),
    ...h.sheetFields3(c),
    ...h.sheetFields4(c),
    ...h.trancheGeometry(c),
    ...h.tranche4Fields(c),
  };
}
export function trancheGeometry(c) {
  const { shapes, elementsById, strokeInk, visible } = c;
  if (c.options.textOnly) return {};
  const routeInk = {};
  for (const s of shapes.filter(
    (s) =>
      (s.conductor || s.loopConductor || s.loopCandidate) &&
      ["path", "line", "polyline"].includes(s.shapeTag) &&
      s.stroke > 0,
  )) {
    const e = elementsById.get(s.element),
      v = visible(e);
    routeInk[s.element] = c.h.trancheInkPieces({
      pieces: strokeInk(e, v.clip, e.getScreenCTM(), true),
    });
  }
  const leaders = [];
  for (const e of c.root.querySelectorAll("[data-wire-label-leader]")) {
    const v = visible(e);
    if (!v) continue;
    leaders.push({
      wire: e.getAttribute("data-wire-label-leader"),
      element: c.ids.get(e),
      bbox: v.b,
      segments: strokeInk(e, v.clip, e.getScreenCTM(), true),
    });
  }
  return {
    tranche3: {
      routeInk,
      leaders,
      wirePlatePaint: c.h.wirePlateGeometry(c),
      circuitJunctions: c.h.trancheCircuitJunctions(c),
    },
  };
}
// N3-private candidates: never add a class/shape to the legacy DQ-13 bundle.
export function trancheCircuitJunctions(c) {
  const { root, visible, fillPaint, strokeInk, identity } = c;
  return [...root.querySelectorAll("circle[data-circuit-junction]")].flatMap(
    (e) => {
      const v = visible(e),
        fill = fillPaint(e);
      if (!v || fill.alpha < 0.2 || fill.background) return [];
      const ink = strokeInk(e, v.clip, e.getScreenCTM(), true);
      return ink.length
        ? [{ ...identity(e), bbox: v.b, inkSegments: ink }]
        : [];
    },
  );
}
export function trancheInkPieces({ pieces }) {
  const result = [];
  for (const [a, b] of pieces) {
    const last = result.at(-1);
    if (
      last &&
      Math.hypot(last[1].x - a.x, last[1].y - a.y) < 0.00001 &&
      Math.abs(
        (last[1].x - last[0].x) * (b.y - a.y) -
          (last[1].y - last[0].y) * (b.x - a.x),
      ) < 0.000001
    )
      last[1] = b;
    else result.push([a, b]);
  }
  return result;
}
