import { inside, project, type Rect } from "../device-legend/geometry.js";
import type { NavigationGeometry } from "./navigation-walk.js";

/** Circumscribed painted radius, including stroke under the emitted transform. */
function markerRadiusMm(g: NavigationGeometry) {
  const [a, b, c, d] = g.matrix;
  const sum = a * a + b * b + c * c + d * d,
    determinant = a * d - b * c;
  const scale = Math.sqrt(
    (sum + Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) /
      2,
  );
  const radius = Number(g.node.attrs.r ?? 0);
  const stroke =
    g.style?.stroke && g.style.stroke !== "none"
      ? parseFloat(g.style["stroke-width"] ?? "1") / 2
      : 0;
  const strokeScale =
    g.style?.["vector-effect"] === "non-scaling-stroke" ? 1 : scale;
  // Cover emitted coordinate rounding and the generated-ink envelope allowance.
  return radius * scale + stroke * strokeScale + 0.003;
}

export function captionTerminalMarkers(
  all: readonly NavigationGeometry[],
  uid: string,
  keys: readonly string[],
  field: Rect,
) {
  return all.flatMap((g) => {
    if (
      g.deviceUid !== uid ||
      g.node.name !== "circle" ||
      !keys.every((key) => key === g.node.attrs["data-terminal-key"])
    )
      return [];
    const point = project(
      { x: Number(g.node.attrs.cx), y: Number(g.node.attrs.cy), w: 0, h: 0 },
      g.matrix,
    );
    return inside(point, field) && inside(point, g.clip)
      ? [{ point, radiusMm: markerRadiusMm(g) }]
      : [];
  });
}
