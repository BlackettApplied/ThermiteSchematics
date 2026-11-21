import { fullCircuitAppearances } from "./circuit-appearances.mjs";
import { painted, extent, groupBy } from "./review-geometry.mjs";

// Quantize measured coordinates to Q=0.01 mm BEFORE half-open grid lookup.
// No renderer anchor, zone or navigation planner participates.
export const quantize = (n) =>
  (Math.sign(n) * Math.floor(Math.abs(n) * 100 + 0.500001)) / 100;
export function measuredZone(g, p) {
  const top = g.texts
    .filter(
      (t) =>
        painted(t) &&
        t.sheetText &&
        /^[1-6]$/.test(t.text) &&
        t.anchor &&
        t.bbox.y < 30,
    )
    .sort((a, b) => +a.text - +b.text);
  const left = g.texts
    .filter(
      (t) =>
        painted(t) &&
        t.sheetText &&
        /^[A-D]$/.test(t.text) &&
        t.anchor &&
        t.bbox.x < 20,
    )
    .sort((a, b) => a.text.localeCompare(b.text));
  if (top.length !== 6 || left.length !== 4) return null;
  const x = quantize(p.x),
    y = quantize(p.y);
  const col = top
    .slice(1)
    .filter((t, i) => x >= quantize((top[i].anchor.x + t.anchor.x) / 2)).length;
  const row = left
    .slice(1)
    .filter(
      (t, i) => y >= quantize((left[i].anchor.y + t.anchor.y) / 2),
    ).length;
  return "ABCD"[row] + (col + 1);
}
export const boxExtent = (items) =>
  extent(
    items.flatMap((t) => [
      { x: t.bbox.x, y: t.bbox.y },
      { x: t.bbox.x + t.bbox.w, y: t.bbox.y + t.bbox.h },
    ]),
  );
export const centroid = (ports) => ({
  x: quantize(ports.reduce((n, t) => n + t.point.x, 0) / ports.length),
  y: quantize(ports.reduce((n, t) => n + t.point.y, 0) / ports.length),
});
const complete = (s) => {
  const b = s.bbox,
    v = s.viewport;
  return (
    !v ||
    (b.x >= v.x - 0.002 &&
      b.y >= v.y - 0.002 &&
      b.x + b.w <= v.x + v.w + 0.002 &&
      b.y + b.h <= v.y + v.h + 0.002)
  );
};
// Source terminal membership, not glyph keys, decides which native functions
// a painted aggregate or individual symbol represents. Single terminal context
// and clipped fragments cannot discharge a full-function obligation.
export function fullFunctionAppearances(packet, geometries, ir, request) {
  const appearances = [];
  const issuedViews = [
    ...new Set(
      geometries.flatMap(
        (g) =>
          g?.navigationViews ??
          (g?.shapes ?? []).map((s) => s.navigationView).filter(Boolean),
      ),
    ),
  ];
  for (const [i, sheet] of packet.sheets.entries()) {
    const g = geometries[i];
    if (!g) continue;
    const bodies = (g.shapes ?? []).filter(
      (s) =>
        (s.nativeFunctionScope || s.functionScope) &&
        !s.terminal &&
        !s.conductor &&
        !s.attachment &&
        (s.glyphBody ||
          s.symbol ||
          s.circuitFunctions?.length ||
          s.functionKey) &&
        s.nativeBodyPainted !== false &&
        (s.inkSegments?.length ||
          s.stroke > 0 ||
          !["none", "white", "rgb(255, 255, 255)"].includes(s.fill ?? "none")),
    );
    for (const [scope, shapes] of groupBy(
      bodies,
      (s) => s.nativeFunctionScope ?? s.functionScope,
    )) {
      if (!shapes.every(complete)) continue;
      const ports = (g.terminals ?? []).filter(
        (t) =>
          (t.nativeFunctionScope ?? t.functionScope) === scope &&
          painted(t) &&
          complete({ ...t, bbox: { ...t.point, w: 0, h: 0 } }),
      );
      const uid = shapes[0].deviceUid;
      if (!uid || !ir.devices?.some((d) => d.uid === uid)) continue;
      const view = shapes[0].navigationView;
      const order = issuedViews.indexOf(view);
      // View IDs are locators into the authored request, not eligibility flags.
      // Old captures can locate a unique rooted or titled request independently.
      const views = request?.views ?? (request ? [request] : []);
      const candidates = views
        .map((v, j) => ({ v, j }))
        .filter(({ v }) =>
          sheet.view?.root
            ? v.family === sheet.view.family &&
              (v.root?.value === sheet.view.root.deviceUid ||
                v.root?.value === sheet.view.root.designation)
            : v.title && v.title === sheet.view?.title,
        );
      const selected =
        candidates.length === 1 && issuedViews.length <= 1
          ? candidates[0].j
          : order >= 0 && views[order]
            ? order
            : candidates.length === 1
              ? candidates[0].j
              : null;
      for (const fn of ir.functions ?? []) {
        if (
          fn.id.deviceUid !== uid ||
          !fn.terminals.length ||
          !fn.terminals.every((t) =>
            ports.some(
              (p) => p.deviceUid === uid && p.terminal === t.terminalKey,
            ),
          )
        )
          continue;
        const terminals = fn.terminals.map((t) =>
          ports.find((p) => p.terminal === t.terminalKey),
        );
        const anchor = centroid(terminals);
        appearances.push({
          uid,
          geometryIndex: i,
          circuitGroup: shapes[0].circuitGroup,
          primitiveIds: [
            ...new Set(shapes.flatMap((s) => s.primitiveIds ?? [])),
          ],
          functionKey: fn.id.functionKey,
          kind: fn.kind,
          view: selected ?? view,
          viewKey: view,
          order: selected,
          sheet: sheet.number,
          scope,
          anchor,
          zone: measuredZone(g, anchor),
          ports: terminals,
          bbox: boxExtent(shapes),
          element: shapes[0].element,
        });
      }
    }
  }
  return fullCircuitAppearances(appearances, geometries, ir, request);
}
export function repeatAppearances(packet, geometries, ir, request) {
  const appearances = fullFunctionAppearances(packet, geometries, ir, request);
  // The appearance unit is UID + selected view + sheet, never glyph.
  return [
    ...groupBy(appearances, (a) => JSON.stringify([a.uid, a.view, a.sheet])),
  ].map(([key, members]) => ({
    key,
    uid: members[0].uid,
    view: members[0].view,
    viewKey: members[0].viewKey,
    order: members[0].order,
    sheet: members[0].sheet,
    members,
    ports: [
      ...new Map(
        members.flatMap((a) => a.ports).map((p) => [p.terminal, p]),
      ).values(),
    ],
    bbox: boxExtent(members),
    element: members[0].element,
  }));
}
