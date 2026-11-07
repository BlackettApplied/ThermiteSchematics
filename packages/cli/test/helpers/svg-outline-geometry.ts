import type { Page } from "playwright-core";
import { printableTextMetrics } from "../../../render/src/symbols/printable-font.js";

export type Point = { x: number; y: number };
export type Box = { left: number; right: number; top: number; bottom: number };
type Matrix = [number, number, number, number, number, number];
export const point = (p: Point, m: Matrix): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export function bounds(points: Point[]): Box {
  if (!points.length) throw Error("Empty SVG geometry");
  return points.reduce(
    (b, p) => ({
      left: Math.min(b.left, p.x),
      right: Math.max(b.right, p.x),
      top: Math.min(b.top, p.y),
      bottom: Math.max(b.bottom, p.y),
    }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
  );
}
function transformBox(b: Box, m: Matrix): Box {
  return bounds(
    [
      { x: b.left, y: b.top },
      { x: b.right, y: b.top },
      { x: b.left, y: b.bottom },
      { x: b.right, y: b.bottom },
    ].map((p) => point(p, m)),
  );
}
export function distance(a: Box, b: Box): number {
  return Math.hypot(
    Math.max(a.left - b.right, b.left - a.right, 0),
    Math.max(a.top - b.bottom, b.top - a.bottom, 0),
  );
}
export function routeDistance(box: Box, points: Point[]): number {
  return Math.min(
    ...points.slice(1).map((p, i) => {
      const a = points[i]!;
      if (Math.abs(a.x - p.x) > 1e-6 && Math.abs(a.y - p.y) > 1e-6)
        throw Error("Expected an orthogonal wiring route");
      return distance(box, bounds([a, p]));
    }),
  );
}
function segmentDistance(box: Box, a: Point, b: Point): number {
  let enter = 0,
    leave = 1;
  for (const [origin, delta, low, high] of [
    [a.x, b.x - a.x, box.left, box.right],
    [a.y, b.y - a.y, box.top, box.bottom],
  ]) {
    if (delta === 0) {
      if (origin! < low! || origin! > high!) leave = -Infinity;
    } else {
      const first = (low! - origin!) / delta!,
        last = (high! - origin!) / delta!;
      enter = Math.max(enter, Math.min(first, last));
      leave = Math.min(leave, Math.max(first, last));
    }
  }
  if (enter <= leave) return 0;
  const pointBox = (p: Point): Box => ({
    left: p.x,
    right: p.x,
    top: p.y,
    bottom: p.y,
  });
  const corners = [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.left, y: box.bottom },
    { x: box.right, y: box.bottom },
  ];
  return Math.min(
    distance(box, pointBox(a)),
    distance(box, pointBox(b)),
    ...corners.map((p) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        square = dx * dx + dy * dy,
        t = square
          ? Math.max(
              0,
              Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square),
            )
          : 0;
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    }),
  );
}
export function primitiveDistance(box: Box, points: Point[]): number {
  return points
    .slice(1)
    .reduce(
      (best, p, i) => Math.min(best, segmentDistance(box, points[i]!, p)),
      Infinity,
    );
}
export const inside = (a: Box, b: Box) =>
  a.left >= b.left &&
  a.right <= b.right &&
  a.top >= b.top &&
  a.bottom <= b.bottom;

/** Chromium supplies only affine transforms and primitive paths. Never ask it
 * for glyph bounds, advances, character positions or canvas text measurements.
 * All coordinates returned here are in the outer sheet's viewBox (mm). */
export async function svgOutlineGeometry(
  page: Page,
  svg: string,
  wiringOnly = false,
  legacyFont = false,
) {
  await page.setContent(svg);
  const raw = await page.evaluate((wiringOnly) => {
    const root = document.querySelector("svg")!,
      inverse = root.getScreenCTM()!.inverse(),
      marks = [...document.querySelectorAll("[data-circuit-mark]")];
    const matrix = (e: SVGGraphicsElement) => {
      const m = inverse.multiply(e.getScreenCTM()!);
      return [m.a, m.b, m.c, m.d, m.e, m.f] as Matrix;
    };
    const project = (p: Point, m: Matrix): Point => ({
      x: m[0] * p.x + m[2] * p.y + m[4],
      y: m[1] * p.x + m[3] * p.y + m[5],
    });
    const rectangle = (e: SVGRectElement) => {
      const m = matrix(e),
        x = e.x.baseVal.value,
        y = e.y.baseVal.value,
        w = e.width.baseVal.value,
        h = e.height.baseVal.value;
      return [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ].map(([x, y]) => project({ x: x!, y: y! }, m));
    };
    const identity = (e: Element) => ({
      wire: e
        .closest("[data-wiring-conductor]")
        ?.getAttribute("data-wiring-conductor"),
      device: e.closest("[data-device-uid]")?.getAttribute("data-device-uid"),
      mark: marks.indexOf(e.closest("[data-circuit-mark]")!),
    });
    const visible = (e: Element) =>
      !e.closest("defs") &&
      getComputedStyle(e).display !== "none" &&
      getComputedStyle(e).visibility !== "hidden";
    const clips = (e: Element) => {
      const out: Point[][] = [];
      for (let p = e.parentElement; p; p = p.parentElement) {
        if (p.tagName.toLowerCase() !== "svg") continue;
        const s = p as unknown as SVGSVGElement,
          v = s.viewBox.baseVal;
        if (s !== root && getComputedStyle(s).overflow === "visible") continue;
        out.push(
          [
            [v.x, v.y],
            [v.x + v.width, v.y + v.height],
          ].map(([x, y]) => project({ x: x!, y: y! }, matrix(s))),
        );
      }
      return out;
    };
    const texts = [
      ...document.querySelectorAll<SVGTextElement>(
        wiringOnly ? "[data-wiring-conductor] text" : "text",
      ),
    ]
      .filter((e) => visible(e) && e.textContent?.trim())
      .map((e) => {
        const css = getComputedStyle(e),
          caption = e.closest("[data-contact-caption]");
        if (
          e.querySelector("tspan,textPath") ||
          e.hasAttribute("dx") ||
          e.hasAttribute("dy") ||
          !["normal", "0px"].includes(css.letterSpacing)
        )
          throw Error("Unsupported SVG text positioning in outline test");
        let previous = e.previousElementSibling;
        while (previous?.tagName.toLowerCase() === "text")
          previous = previous.previousElementSibling;
        const plate =
          previous?.tagName.toLowerCase() === "rect" &&
          getComputedStyle(previous).fill === "rgb(255, 255, 255)"
            ? rectangle(previous as SVGRectElement)
            : undefined;
        return {
          ...identity(e),
          text: e.textContent!,
          x: e.x.baseVal[0]?.value ?? 0,
          y: e.y.baseVal[0]?.value ?? 0,
          size: parseFloat(css.fontSize),
          bold: Number(css.fontWeight) >= 600,
          family: css.fontFamily,
          anchor: css.textAnchor,
          baseline: css.dominantBaseline,
          length: e.hasAttribute("textLength")
            ? Number(e.getAttribute("textLength"))
            : undefined,
          lengthAdjust: e.getAttribute("lengthAdjust"),
          matrix: matrix(e),
          clips: clips(e),
          plate,
          caption: !!caption,
          owner: marks.indexOf(
            caption?.parentElement?.querySelector("[data-circuit-mark]")!,
          ),
        };
      });
    const shapes = [
      ...document.querySelectorAll<SVGGeometryElement>(
        wiringOnly
          ? "[data-wiring-conductor] path"
          : "line,path,polyline,rect,circle",
      ),
    ]
      .filter(visible)
      .map((e) => {
        const m = matrix(e),
          css = getComputedStyle(e),
          scale = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
        let points: Point[];
        const tokens =
          e.tagName.toLowerCase() === "path"
            ? e.getAttribute("d")!.trim().split(/\s+/u)
            : [];
        const linear =
          tokens.length > 0 &&
          tokens.length % 3 === 0 &&
          tokens.every((v, i) =>
            i % 3 === 0 ? v === (i ? "L" : "M") : Number.isFinite(Number(v)),
          );
        if (wiringOnly && !linear)
          throw Error("Unsupported wiring path in outline test");
        if (linear) {
          // Wiring emits only explicit M/L vertices. Preserve corners exactly.
          points = tokens
            .filter((_, i) => i % 3 === 0)
            .map((_, i) =>
              project(
                { x: Number(tokens[3 * i + 1]), y: Number(tokens[3 * i + 2]) },
                m,
              ),
            );
        } else if (e.tagName.toLowerCase() === "line") {
          const line = e as SVGLineElement;
          points = [
            { x: line.x1.baseVal.value, y: line.y1.baseVal.value },
            { x: line.x2.baseVal.value, y: line.y2.baseVal.value },
          ].map((p) => project(p, m));
        } else if (
          e.tagName.toLowerCase() === "rect" &&
          !(e as SVGRectElement).rx.baseVal.value &&
          !(e as SVGRectElement).ry.baseVal.value
        ) {
          points = rectangle(e as SVGRectElement);
          points.push(points[0]!);
        } else {
          const length = e.getTotalLength(),
            count = Math.max(1, Math.ceil((length * scale) / 0.01));
          points = Array.from({ length: count + 1 }, (_, i) => {
            const p = e.getPointAtLength((length * i) / count);
            return project({ x: p.x, y: p.y }, m);
          });
        }
        return {
          ...identity(e),
          points,
          stroke:
            css.stroke === "none" ? 0 : parseFloat(css.strokeWidth) * scale,
        };
      });
    return { texts, shapes, marks: marks.map((e) => identity(e)) };
  }, wiringOnly);
  const texts = raw.texts.map((t) => {
    if (
      !legacyFont &&
      !t.family.startsWith('"Thermite Sans"') &&
      !t.family.startsWith("Thermite Sans")
    )
      throw Error(`Expected pinned printable font: ${t.family}`);
    const m = printableTextMetrics(t.text, t.size, t.bold),
      advance = t.length ?? m.advance,
      sx = advance / m.advance,
      anchor =
        t.anchor === "middle" ? advance / 2 : t.anchor === "end" ? advance : 0;
    if (t.length !== undefined && t.lengthAdjust !== "spacingAndGlyphs")
      throw Error("Unsupported textLength adjustment");
    if (!["auto", "alphabetic", "middle"].includes(t.baseline))
      throw Error(`Unsupported SVG baseline: ${t.baseline}`);
    const y = t.y + (t.baseline === "middle" ? m.middleBaseline : 0),
      box = transformBox(
        {
          left: t.x - anchor + m.left * sx,
          right: t.x - anchor + m.right * sx,
          top: y - m.top,
          bottom: y - m.bottom,
        },
        t.matrix,
      );
    const painted = t.clips.every((points) => {
      const b = bounds(points);
      return (
        Math.min(box.right, b.right) > Math.max(box.left, b.left) &&
        Math.min(box.bottom, b.bottom) > Math.max(box.top, b.top)
      );
    });
    return { ...t, box, painted, plate: t.plate ? bounds(t.plate) : undefined };
  });
  return { ...raw, texts };
}

export async function wiringOutlineDistances(
  page: Page,
  svg: string,
  legacyFont = false,
) {
  const g = await svgOutlineGeometry(page, svg, true, legacyFont);
  return g.texts
    .filter((t) => t.painted)
    .map((t) => {
      const own = g.shapes.filter((s) => s.wire === t.wire);
      if (!own.length) throw Error(`No owning route for ${t.text}`);
      const inline =
        t.plate &&
        inside(t.box, t.plate) &&
        own.some((s) => routeDistance(t.plate!, s.points) === 0);
      return {
        text: t.text,
        distance: inline
          ? 0
          : Math.min(
              ...own.map((s) =>
                Math.max(0, routeDistance(t.box, s.points) - s.stroke / 2),
              ),
            ),
      };
    });
}
