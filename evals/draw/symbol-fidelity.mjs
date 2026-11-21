import { distance } from "./checks.mjs";
import {
  finding,
  groupBy,
  midpoint,
  segment,
  crosses,
  extent,
  mergedIntervals,
  pointDistance,
} from "./review-geometry.mjs";
const horizontal = ([a, b] = []) =>
  a && b && Math.abs(a.y - b.y) <= 0.01 && Math.abs(a.x - b.x) > 0.05;
const vertical = ([a, b] = []) =>
  a && b && Math.abs(a.x - b.x) <= 0.01 && Math.abs(a.y - b.y) > 0.05;
const ink = (s) =>
  (s.inkSegments ?? []).filter(([a, b]) => pointDistance(a, b) > 0.05);
function nativeTerminal(ir, t) {
  return ir.terminals?.find(
    (p) => p.id.deviceUid === t.deviceUid && p.id.terminalKey === t.terminal,
  );
}
function nativePolarity(ir, t) {
  const native = nativeTerminal(ir, t),
    role = native?.role ?? "";
  const dc = /^dc_(positive|return)_(input|output)$/.exec(role);
  if (dc) return dc[1];
  if (native?.rating?.voltage_type === "DC")
    return /^supply_(positive|return)$/.exec(role)?.[1];
  return undefined;
}
export function polarityFindings(g, ir) {
  const out = [];
  const owners = new Set([
    ...(g.terminals ?? []).map((t) => t.symbolGroup),
    ...g.shapes.map((s) => s.symbolGroup),
  ]);
  for (const owner of owners) {
    if (owner == null) continue;
    const ports = (g.terminals ?? []).filter((t) => t.symbolGroup === owner);
    const shapes = g.shapes.filter(
      (s) => s.symbolGroup === owner && !s.terminal,
    );
    const dc = ports.filter((t) => nativePolarity(ir, t));
    // Native DC port pairs remain in the population with both glyph locators
    // stripped. Conversely, glyph locators retain missing/forged port owners
    // for reconciliation; neither source grants an exemption from the other.
    if (
      dc.length !== 2 &&
      !shapes.some(
        (s) => s.qualifier || /source-dc|dc-load/.test(s.symbol ?? ""),
      )
    )
      continue;
    const expectedUid = shapes[0]?.deviceUid ?? ports[0]?.deviceUid;
    if (
      dc.length !== 2 ||
      !expectedUid ||
      !dc.every((t) => t.deviceUid === expectedUid) ||
      !["positive", "return"].every(
        (role) => dc.filter((t) => nativePolarity(ir, t) === role).length === 1,
      )
    ) {
      out.push(
        finding("polarity-port-ownership-unavailable", shapes[0], {
          expectedDeviceUid: expectedUid,
          ports: ports.map((t) => ({
            deviceUid: t.deviceUid,
            terminal: t.terminal,
            portId: t.symbolPortId,
          })),
          nativeDcPorts: dc.length,
        }),
      );
      continue;
    }
    for (const polarity of ["positive", "negative"]) {
      const own = dc.filter(
        (t) =>
          nativePolarity(ir, t) ===
          (polarity === "positive" ? "positive" : "return"),
      );
      const qualifiers = shapes.filter(
        (s) => s.qualifier === "polarity" && s.polarity === polarity,
      );
      const strokes = qualifiers.flatMap(ink);
      const expectedCount = polarity === "positive" ? 2 : 1;
      if (
        strokes.length !== expectedCount ||
        strokes.filter(horizontal).length !== 1 ||
        (polarity === "positive" && strokes.filter(vertical).length !== 1)
      )
        out.push(
          finding(
            "polarity-primitive-not-upright",
            qualifiers[0] ?? shapes[0],
            { polarity, segments: strokes, expectedCount },
          ),
        );
      if (!qualifiers.length || own.length !== 1) continue;
      const center = midpoint(
        segment(
          qualifiers.find((s) => horizontal(segment(s) ?? [])) ?? qualifiers[0],
        ),
      );
      const ownDistance = pointDistance(center, own[0].point),
        nearestOther = Math.min(
          ...ports
            .filter((t) => t !== own[0])
            .map((t) => pointDistance(center, t.point)),
        );
      const declared = qualifiers.every(
        (s) => s.symbolPortId === own[0].symbolPortId,
      );
      const adjacencyRadius = pointDistance(dc[0].point, dc[1].point) / 2;
      if (
        !declared ||
        ownDistance >= nearestOther - 0.01 ||
        ownDistance > adjacencyRadius + 0.01
      )
        out.push(
          finding("polarity-not-adjacent-own-port", qualifiers[0], {
            polarity,
            ownPort: own[0].terminal,
            ownDistanceMm: ownDistance,
            adjacencyRadiusMm: adjacencyRadius,
            nearestOtherMm: nearestOther,
            declaredPortIds: qualifiers.map((s) => s.symbolPortId),
          }),
        );
      const overlap = strokes.some(([a, b]) =>
        shapes.some(
          (s) =>
            !s.qualifier &&
            !s.outline &&
            ink(s).some(
              ([c, d]) => distance(a, c, d) < 0.03 && distance(b, c, d) < 0.03,
            ),
        ),
      );
      if (overlap)
        out.push(
          finding("polarity-ink-merged-with-lead", qualifiers[0], {
            polarity,
            segments: strokes,
          }),
        );
    }
  }
  return out;
}
function nativeFunction(ir, shapes) {
  const ids = shapes[0].circuitFunctions ?? [];
  return (
    ir.functions?.filter(
      (f) =>
        ids.some(
          (id) =>
            id.deviceUid === f.id.deviceUid &&
            id.functionKey === f.id.functionKey,
        ) &&
        (!shapes[0].functionKey || shapes[0].functionKey === f.id.functionKey),
    ) ?? []
  );
}
export function markFindings(g, ir) {
  const out = [];
  for (const shapes of groupBy(g.shapes ?? [], (s) => s.markGroup).values()) {
    // Attachment paths share the function owner, but are not a second glyph.
    if (
      !shapes.some((s) => s.mark || s.primitiveRole) &&
      g.shapes.some(
        (s) =>
          (s.mark || s.primitiveRole) &&
          s.deviceUid === shapes[0].deviceUid &&
          s.functionKey === shapes[0].functionKey,
      )
    )
      continue;
    const first = shapes[0],
      functions = nativeFunction(ir, shapes);
    const earth = functions.some(
      (f) =>
        f.terminals.length === 1 &&
        ir.terminals?.some(
          (t) =>
            t.id.deviceUid === f.id.deviceUid &&
            t.id.terminalKey === f.terminals[0].terminalKey &&
            t.role === "protective_earth",
        ),
    );
    if (earth || first.mark === "earth") {
      const bars = shapes
        .filter((s) => s.primitiveRole === "earth-bar")
        .flatMap(ink);
      const ordered = bars
        .slice()
        .sort((a, b) => midpoint(a).y - midpoint(b).y);
      if (
        bars.length !== 3 ||
        !bars.every(horizontal) ||
        !ordered.every(
          (s, i) =>
            i === 0 ||
            pointDistance(...s) < pointDistance(...ordered[i - 1]) - 0.05,
        )
      )
        out.push(
          finding("earth-primitive-not-upright", first, {
            bars,
            sourceEarth: earth,
          }),
        );
    }
    const supported = functions.filter((f) => f.kind === "contact");
    const operatorNative = supported.some((f) => {
      const t = ir.deviceTypes?.find(
        (t) =>
          t.id === ir.devices?.find((d) => d.uid === f.id.deviceUid)?.typeId,
      );
      return /pressure|level/.test(
        JSON.stringify(t?.render ?? t?.rendering ?? t?.symbol ?? {}),
      );
    });
    if (!operatorNative && !/^(pressure|level)-(no|nc)$/.test(first.mark ?? ""))
      continue;
    const links = shapes.filter((s) => s.primitiveRole === "operating-link"),
      axes = links.map(segment).filter(Boolean);
    const axis = axes[0];
    let merged = [];
    if (axis) {
      const length = pointDistance(...axis),
        u = {
          x: (axis[1].x - axis[0].x) / length,
          y: (axis[1].y - axis[0].y) / length,
        };
      const project = (p) => (p.x - axis[0].x) * u.x + (p.y - axis[0].y) * u.y;
      // Union all collinear visible ink, including a solid forged duplicate.
      const intervals = shapes
        .flatMap(ink)
        .filter(
          ([a, b]) =>
            Math.abs((a.x - axis[0].x) * u.y - (a.y - axis[0].y) * u.x) <
              0.03 &&
            Math.abs((b.x - axis[0].x) * u.y - (b.y - axis[0].y) * u.x) < 0.03,
        )
        .map(([a, b]) => [
          Math.max(0, Math.min(project(a), project(b))),
          Math.min(length, Math.max(project(a), project(b))),
        ])
        .filter(([a, b]) => b - a > 0.05);
      merged = mergedIntervals(intervals);
    }
    if (merged.length < 2)
      out.push(
        finding("operating-link-without-visible-dashes", first, {
          visibleIntervalsMm: merged,
          linkCount: links.length,
        }),
      );
    const closed = supported.some((f) => f.normal_state === "closed");
    if (closed) {
      const bars = shapes
          .filter((s) =>
            ["contact-moving", "contact-fixed"].includes(s.primitiveRole),
          )
          .flatMap(ink),
        slashes = shapes
          .filter((s) => s.primitiveRole === "contact-state")
          .flatMap(ink);
      if (
        bars.length !== 2 ||
        !slashes.some((s) => bars.every((b) => crosses(s, b)))
      )
        out.push(
          finding("closed-contact-slash-misses-bars", first, {
            bars,
            slashes,
            bbox: extent(shapes.flatMap((s) => s.points)),
          }),
        );
    }
  }
  return out;
}
