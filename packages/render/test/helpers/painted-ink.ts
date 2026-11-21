import type {
  Box,
  Point,
} from "../../../cli/test/helpers/svg-outline-geometry.js";

// The oracles retain their existing ink modes: captions measure strokes;
// context references also include filled marks. Both share clipping and the DOM walk.
export function clippedSegment(a: Point, b: Point, clip: Box): Point[] {
  let lo = 0,
    hi = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, clip.left, clip.right],
    [a.y, b.y - a.y, clip.top, clip.bottom],
  ]) {
    const o = Number(origin),
      d = Number(delta),
      low = Number(min),
      high = Number(max);
    if (d === 0) {
      if (o < low || o > high) return [];
    } else {
      const t = (low - o) / d,
        u = (high - o) / d;
      lo = Math.max(lo, Math.min(t, u));
      hi = Math.min(hi, Math.max(t, u));
    }
  }
  return lo > hi
    ? []
    : [
        { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo },
        { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi },
      ];
}

export function strokeMetadata(includeFill = false) {
  const colour = (value: string) =>
    !["none", "white", "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"].includes(
      value,
    );
  const root = document.querySelector("svg") as SVGSVGElement,
    inverse = root.getScreenCTM()?.inverse();
  return [
    ...document.querySelectorAll<SVGGeometryElement>(
      "line,path,polyline,rect,circle",
    ),
  ]
    .filter(
      (e) =>
        !e.closest("defs") &&
        getComputedStyle(e).display !== "none" &&
        getComputedStyle(e).visibility !== "hidden",
    )
    .map((e) => {
      const css = getComputedStyle(e),
        clip = {
          left: 0,
          top: 0,
          right: root.viewBox.baseVal.width,
          bottom: root.viewBox.baseVal.height,
        };
      for (let p = e.parentElement; p && p !== root; p = p.parentElement)
        if (
          p.tagName.toLowerCase() === "svg" &&
          getComputedStyle(p).overflow !== "visible"
        ) {
          const s = p as unknown as SVGSVGElement,
            v = s.viewBox.baseVal,
            m = inverse?.multiply(s.getScreenCTM() as DOMMatrix);
          const a = new DOMPoint(v.x, v.y).matrixTransform(m),
            b = new DOMPoint(v.x + v.width, v.y + v.height).matrixTransform(m);
          clip.left = Math.max(clip.left, a.x);
          clip.right = Math.min(clip.right, b.x);
          clip.top = Math.max(clip.top, a.y);
          clip.bottom = Math.min(clip.bottom, b.y);
        }
      return {
        clip,
        card: !!e.closest("[data-off-view-terminal]"),
        ink: includeFill
          ? colour(css.stroke) || colour(css.fill)
          : !["none", "white", "rgb(255, 255, 255)"].includes(css.stroke),
        leader: e.classList.contains("context-reference-leader"),
        circle: e.tagName.toLowerCase() === "circle",
        attachment: e
          .closest("[data-terminal-attachment]")
          ?.getAttribute("data-terminal-attachment"),
        symbol: e.closest("[data-symbol-id]")?.getAttribute("data-symbol-id"),
        functionKey: e
          .closest("[data-function-key]")
          ?.getAttribute("data-function-key"),
        stub: !!e.closest("[data-function-interface],[data-source-stub]"),
        conductor:
          !!e.closest("[data-circuit-conductor]") ||
          e.classList.contains("net-path") ||
          e.classList.contains("boundary-path"),
      };
    });
}
