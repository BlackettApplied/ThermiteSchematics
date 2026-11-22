import { required } from "../presentation/util.js";
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Matrix = readonly [number, number, number, number, number, number];
export const identity: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function transform(value = ""): Matrix {
  let m = identity;
  for (const match of value.matchAll(
    /(matrix|translate|scale|rotate)\(([^)]+)\)/g,
  )) {
    const v = required(match[2], "Missing legend geometry")
        .split(/[ ,]+/)
        .map(Number),
      x = required(v[0], "Missing legend geometry"),
      y = v[1] ?? x;
    let b: Matrix;
    if (match[1] === "matrix") b = v as unknown as Matrix;
    else if (match[1] === "translate") b = [1, 0, 0, 1, x, v[1] ?? 0];
    else if (match[1] === "scale") b = [x, 0, 0, y, 0, 0];
    else {
      const r = (x * Math.PI) / 180,
        c = Math.cos(r),
        s = Math.sin(r),
        cx = v[1] ?? 0,
        cy = v[2] ?? 0;
      b = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
    }
    m = multiply(m, b);
  }
  return m;
}
export function project(b: Rect, m: Matrix): Rect {
  const pts = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map(([x, y]) => [
    m[0] * required(x, "Missing legend geometry") +
      m[2] * required(y, "Missing legend geometry") +
      m[4],
    m[1] * required(x, "Missing legend geometry") +
      m[3] * required(y, "Missing legend geometry") +
      m[5],
  ]);
  const x = Math.min(
      ...pts.map((p) => required(p[0], "Missing legend geometry")),
    ),
    y = Math.min(...pts.map((p) => required(p[1], "Missing legend geometry")));
  return {
    x,
    y,
    w:
      Math.max(...pts.map((p) => required(p[0], "Missing legend geometry"))) -
      x,
    h:
      Math.max(...pts.map((p) => required(p[1], "Missing legend geometry"))) -
      y,
  };
}
export { intersectInk as intersection } from "../packet/rooted-ink.js";
export const inside = (a: Rect, b: Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
export const expand = (b: Rect, n: number): Rect => ({
  x: b.x - n,
  y: b.y - n,
  w: b.w + 2 * n,
  h: b.h + 2 * n,
});
export function separated(a: Rect, b: Rect, gap = 3) {
  return (
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}
