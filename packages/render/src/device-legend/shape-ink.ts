import { required } from "../presentation/util.js";
import type { Rect } from "./geometry.js";
const segment = (x: number, y: number, a: number, b: number): Rect => ({
  x: Math.min(x, a),
  y: Math.min(y, b),
  w: Math.abs(a - x),
  h: Math.abs(b - y),
});
/** Orthogonal routes stay separate segments; curve control hulls are conservative. */
export function pathInk(d: string): Rect[] {
  const tokens =
      d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [],
    out: Rect[] = [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(required(tokens[i], "Missing legend geometry")))
      cmd = required(tokens[i++], "Missing legend geometry");
    const relative = cmd === cmd.toLowerCase(),
      kind = cmd.toUpperCase(),
      ox = x,
      oy = y;
    const n = () => {
      const t = Number(tokens[i++]);
      if (!Number.isFinite(t)) throw Error("Invalid generated path coordinate");
      return t;
    };
    const px = () => n() + (relative ? ox : 0),
      py = () => n() + (relative ? oy : 0);
    if (kind === "Z") {
      out.push(segment(x, y, sx, sy));
      x = sx;
      y = sy;
      cmd = "";
      continue;
    }
    if (kind === "M" || kind === "L") {
      x = px();
      y = py();
      if (kind === "M") {
        sx = x;
        sy = y;
        cmd = relative ? "l" : "L";
      } else out.push(segment(ox, oy, x, y));
    } else if (kind === "H") {
      x = px();
      out.push(segment(ox, oy, x, y));
    } else if (kind === "V") {
      y = py();
      out.push(segment(ox, oy, x, y));
    } else if (kind === "C" || kind === "Q") {
      const count = kind === "C" ? 3 : 2,
        pts: [number, number][] = [[x, y]];
      for (let j = 0; j < count; j++) pts.push([px(), py()]);
      [x, y] = required(pts.at(-1), "Missing curve endpoint");
      out.push(pointHull(pts));
    } else if (kind === "A") {
      const rx = n(),
        ry = n();
      n();
      n();
      n();
      x = px();
      y = py();
      out.push(expandArc(ox, oy, x, y, rx, ry));
    } else throw Error(`Unsupported generated path command ${cmd}`);
  }
  return out;
}
export function rectangleInk(b: Rect, stroke: number): Rect[] {
  if (!stroke) return [];
  const s = stroke / 2;
  return [
    { x: b.x - s, y: b.y - s, w: b.w + stroke, h: stroke },
    { x: b.x - s, y: b.y + b.h - s, w: b.w + stroke, h: stroke },
    { x: b.x - s, y: b.y - s, w: stroke, h: b.h + stroke },
    { x: b.x + b.w - s, y: b.y - s, w: stroke, h: b.h + stroke },
  ];
}

function pointHull(pts: readonly (readonly [number, number])[]): Rect {
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function expandArc(
  ox: number,
  oy: number,
  x: number,
  y: number,
  rx: number,
  ry: number,
): Rect {
  const b = segment(ox, oy, x, y),
    r = Math.max(rx, ry) * 2;
  return { x: b.x - r, y: b.y - r, w: b.w + r * 2, h: b.h + r * 2 };
}
