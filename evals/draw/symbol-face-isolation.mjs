import { distance, lineCross, overlap } from "./checks.mjs";
import { reportIssue } from "./report-checks.mjs";

const terminalKey = (uid, key) => JSON.stringify([uid, key]);
const SAMPLE_EPSILON_MM = 0.03;

function strokesTouch(a, b) {
  const reach = (a.stroke + b.stroke) / 2 + SAMPLE_EPSILON_MM;
  if (!overlap(a.bbox, b.bbox, -reach)) return false;
  return a.faceSegments.some(([p, q]) =>
    b.faceSegments.some(
      ([r, s]) =>
        lineCross(p, q, r, s) ||
        distance(p, r, s) <= reach ||
        distance(q, r, s) <= reach ||
        distance(r, p, q) <= reach ||
        distance(s, p, q) <= reach,
    ),
  );
}

function approach(points, port) {
  for (const [start, next] of [
    [points[0], points[1]],
    [points.at(-1), points.at(-2)],
  ]) {
    if (!next || Math.hypot(start.x - port.x, start.y - port.y) > 0.1) continue;
    const x = next.x - start.x,
      y = next.y - start.y;
    return Math.abs(x) > Math.abs(y)
      ? x > 0
        ? "west"
        : "east"
      : y > 0
        ? "north"
        : "south";
  }
}

function componentFindings(strokes, terminals, designation) {
  const parent = strokes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const landings = strokes.flatMap((s, i) =>
    terminals.flatMap((t) => {
      const side = approach(s.points, t.point);
      const reach = Math.max(t.bbox.w, t.bbox.h) / 2 + s.stroke / 2;
      return side &&
        s.faceSegments.some(([p, q]) => distance(t.point, p, q) <= reach)
        ? [{ i, side, terminal: t.terminal, net: t.nativeNet }]
        : [];
    }),
  );
  if (new Set(landings.map((p) => p.net)).size < 2) return [];
  for (const [i, a] of strokes.entries())
    for (let j = i + 1; j < strokes.length; j++)
      if (strokesTouch(a, strokes[j])) parent[find(i)] = find(j);
  const byApproach = Map.groupBy(landings, (p) => `${find(p.i)}/${p.side}`);
  return [...byApproach.values()].flatMap((ports) => {
    const nets = [...new Set(ports.map((p) => p.net))].sort();
    if (nets.length < 2) return [];
    const first = strokes[ports[0].i];
    const points = strokes
      .filter((_, i) => find(i) === find(ports[0].i))
      .flatMap((s) => s.points);
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    const x = Math.min(...xs),
      y = Math.min(...ys);
    return [
      reportIssue(
        "symbol-face-joins-independent-stubs",
        {
          ...first,
          designation,
          bbox: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
        },
        {
          side: ports[0].side,
          netIds: nets,
          terminals: [...new Set(ports.map((p) => p.terminal))].sort(),
        },
      ),
    ];
  });
}

/** Use native nets and painted strokes on the same symbol appearance. A
 * through-glyph such as a fuse or winding has its own established semantics. */
export function faceStubFindings(g, ir) {
  const groups = Map.groupBy(
    [...g.shapes, ...(g.faceOutlines ?? [])].filter(
      (s) =>
        s.symbolGroup &&
        s.deviceUid &&
        s.faceSegments?.length &&
        s.stroke > 0 &&
        s.symbol !== "ais:source-winding",
    ),
    (s) => s.symbolGroup,
  );
  if (groups.size === 0) return [];
  const netByTerminal = new Map(
    ir.nets.flatMap((n) =>
      n.terminalIds.map((t) => [terminalKey(t.deviceUid, t.terminalKey), n.id]),
    ),
  );
  const terminalsByDevice = Map.groupBy(
    g.terminals.filter((t) => t.bbox && t.painted !== false),
    (t) => t.deviceUid,
  );
  const designations = new Map(ir.devices.map((d) => [d.uid, d.designation]));
  return [...groups.values()].flatMap((strokes) => {
    const { deviceUid, symbol, symbolGroup, circuitGroup } = strokes[0];
    const terminals = (terminalsByDevice.get(deviceUid) ?? []).flatMap((t) => {
      if (
        symbol ? t.symbolGroup !== symbolGroup : t.circuitGroup !== circuitGroup
      )
        return [];
      const nativeNet = netByTerminal.get(terminalKey(deviceUid, t.terminal));
      return nativeNet ? [{ ...t, nativeNet }] : [];
    });
    return componentFindings(strokes, terminals, designations.get(deviceUid));
  });
}
