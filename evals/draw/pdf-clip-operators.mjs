// Native PDF rectangle clips in page millimetres. No SVG metadata is consulted.
import assert from "node:assert/strict";
import { multiply } from "./pdf-operators.mjs";
export const intersectPdfBoxes = (a, b) => {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
  };
};
export function pointBounds(points) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}
function rectangle(a, matrix, ops) {
  const p = Array.from(a?.[1]?.[0] ?? []);
  assert(
    a?.[0] === ops.endPath &&
      p.length === 13 &&
      p.every(Number.isFinite) &&
      [p[0], p[3], p[6], p[9], p[12]].join(",") === "0,1,1,1,4",
    "Unsupported PDF clipping path: native rectangle required",
  );
  const points = [p.slice(1, 3), p.slice(4, 6), p.slice(7, 9), p.slice(10, 12)];
  assert(
    points.every(([x, y], i) => {
      const q = points[(i + 1) % 4];
      return x === q[0] || y === q[1];
    }) &&
      new Set(points.map((p) => p[0])).size <= 2 &&
      new Set(points.map((p) => p[1])).size <= 2 &&
      new Set(points.map((p) => p.join(","))).size ===
        new Set(points.map((p) => p[0])).size *
          new Set(points.map((p) => p[1])).size,
    "Unsupported PDF clipping polygon",
  );
  assert(
    (Math.abs(matrix[1]) < 1e-9 && Math.abs(matrix[2]) < 1e-9) ||
      (Math.abs(matrix[0]) < 1e-9 && Math.abs(matrix[3]) < 1e-9),
    "Unsupported PDF clip transform",
  );
  return pointBounds(
    points.map(([x, y]) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
    ]),
  );
}
export function pdfGlyphClips(list, ops, viewport) {
  assert(list.fnArray.length <= 1_000_000, "PDF clip resource budget exceeded");
  let state = {
      matrix: [1, 0, 0, 1, 0, 0],
      clip: { x: 0, y: 0, w: viewport.width, h: viewport.height },
    },
    pending = false;
  const stack = [],
    clips = new Map();
  for (const [i, fn] of list.fnArray.entries()) {
    const a = list.argsArray[i];
    if (fn === ops.save) stack.push(structuredClone(state));
    else if (fn === ops.restore) {
      assert(stack.length, "Unbalanced PDF clip restore");
      state = stack.pop();
    } else if (fn === ops.transform) {
      assert(
        a?.length === 6 && Array.from(a).every(Number.isFinite),
        "Invalid PDF clip matrix",
      );
      state.matrix = multiply(state.matrix, a);
    } else if (fn === ops.clip || fn === ops.eoClip) {
      assert(!pending, "Unsupported PDF pending clip");
      pending = true;
    } else if (fn === ops.constructPath && pending) {
      state.clip = intersectPdfBoxes(
        state.clip,
        rectangle(a, multiply(viewport.transform, state.matrix), ops),
      );
      pending = false;
    } else if (fn === ops.showText) {
      assert(!pending, "Unsupported PDF clip without a path");
      clips.set(i, state.clip);
    }
  }
  assert(!stack.length && !pending, "Unbalanced PDF clip scope");
  return clips;
}
