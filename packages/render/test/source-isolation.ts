import type {
  SymbolDefinition,
  SymbolPoint,
  SymbolPrimitive,
} from "../src/symbols/types.js";
import { DEFAULT_SYMBOL_STROKE } from "../src/symbols/catalog.js";
import { sourceEnclosureInk } from "../src/symbols/printable-policy.js";
import { captionInk } from "../src/symbols/caption-ink.js";

export type Point = SymbolPoint;
type Matrix = readonly [number, number, number, number, number, number];
export interface InkShape {
  readonly points: readonly Point[];
  readonly stroke: number;
  readonly solid?: boolean;
  readonly enclosure?: boolean;
  readonly port?: string;
}
export interface PortAnchor {
  readonly id: string;
  readonly point: Point;
}
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
// Curves are flattened with a bounded error of 0.001 mm. Distances below are
// reduced by twice that bound, so approximation can reject but cannot admit a
// curve whose true ink clearance is below the requested printable gap.
const ERROR_MM = 0.001;
const p = (x: number, y: number): Point => ({ x, y });
const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Point, b: Point, t: number) =>
  p(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const transform = (m: Matrix, q: Point) =>
  p(m[0] * q.x + m[2] * q.y + m[4], m[1] * q.x + m[3] * q.y + m[5]);
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const scaleOf = (m: Matrix) => {
  const a = m[0] ** 2 + m[1] ** 2,
    b = m[2] ** 2 + m[3] ** 2,
    c = m[0] * m[2] + m[1] * m[3];
  return Math.sqrt((a + b + Math.sqrt((a - b) ** 2 + 4 * c * c)) / 2);
};
function parseTransform(value: string): Matrix {
  let m = IDENTITY;
  const rest = value.replace(
    /([a-zA-Z]+)\(([^)]*)\)/g,
    (_, name: string, args: string) => {
      const v = args.trim().split(/[ ,]+/).filter(Boolean).map(Number);
      let next: Matrix;
      switch (name) {
        case "translate":
          next = [1, 0, 0, 1, v[0]!, v[1] ?? 0];
          break;
        case "scale":
          next = [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0];
          break;
        case "rotate": {
          const r = (v[0]! * Math.PI) / 180,
            c = Math.cos(r),
            s = Math.sin(r),
            x = v[1] ?? 0,
            y = v[2] ?? 0;
          next = multiply(multiply([1, 0, 0, 1, x, y], [c, s, -s, c, 0, 0]), [
            1,
            0,
            0,
            1,
            -x,
            -y,
          ]);
          break;
        }
        case "matrix":
          if (v.length !== 6) throw new Error("Invalid SVG matrix");
          next = [v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!];
          break;
        case "skewX":
          next = [1, 0, Math.tan((v[0]! * Math.PI) / 180), 1, 0, 0];
          break;
        case "skewY":
          next = [1, Math.tan((v[0]! * Math.PI) / 180), 0, 1, 0, 0];
          break;
        default:
          throw new Error(`Unsupported SVG transform ${name}`);
      }
      if (next.some((x) => !Number.isFinite(x)))
        throw new Error("Nonfinite SVG transform");
      m = multiply(m, next);
      return "";
    },
  );
  if (rest.trim()) throw new Error(`Unparsed SVG transform ${rest}`);
  return m;
}
function pointSegment(q: Point, a: Point, b: Point): number {
  const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return length(
    q,
    lerp(
      a,
      b,
      d
        ? Math.max(
            0,
            Math.min(
              1,
              ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / d,
            ),
          )
        : 0,
    ),
  );
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (u: Point, v: Point, w: Point) =>
    (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  if (
    Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
    Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
    Math.max(a.y, b.y) >= Math.min(c.y, d.y) &&
    Math.max(c.y, d.y) >= Math.min(a.y, b.y) &&
    cross(a, b, c) * cross(a, b, d) <= 0 &&
    cross(c, d, a) * cross(c, d, b) <= 0
  )
    return 0;
  return Math.min(
    pointSegment(a, c, d),
    pointSegment(b, c, d),
    pointSegment(c, a, b),
    pointSegment(d, a, b),
  );
}
function contains(points: readonly Point[], q: Point): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!,
      b = points[j]!;
    if (
      a.y > q.y !== b.y > q.y &&
      q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function inkClearance(a: InkShape, b: InkShape): number {
  // Outlines alone miss a terminal entirely inside a filled bar or arrowhead.
  let distance =
    (a.solid && b.points.some((q) => contains(a.points, q))) ||
    (b.solid && a.points.some((q) => contains(b.points, q)))
      ? 0
      : Infinity;
  for (let i = 1; i < a.points.length; i++)
    for (let j = 1; j < b.points.length; j++)
      distance = Math.min(
        distance,
        segmentDistance(
          a.points[i - 1]!,
          a.points[i]!,
          b.points[j - 1]!,
          b.points[j]!,
        ),
      );
  return distance - (a.stroke + b.stroke) / 2 - 2 * ERROR_MM;
}
function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  start: number,
  sweep: number,
  rotation: number,
  tolerance: number,
): Point[] {
  const step = 2 * Math.acos(Math.max(-1, 1 - tolerance / Math.max(rx, ry)));
  const count = Math.max(4, Math.ceil(Math.abs(sweep) / step));
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = start + (sweep * i) / count,
      x = rx * Math.cos(t),
      y = ry * Math.sin(t);
    return p(
      cx + x * Math.cos(rotation) - y * Math.sin(rotation),
      cy + x * Math.sin(rotation) + y * Math.cos(rotation),
    );
  });
}
function arc(
  from: Point,
  to: Point,
  rx: number,
  ry: number,
  angle: number,
  large: boolean,
  clockwise: boolean,
  tolerance: number,
): Point[] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [from, to];
  if (length(from, to) < 1e-12) return [from, to];
  const phi = (angle * Math.PI) / 180,
    c = Math.cos(phi),
    s = Math.sin(phi),
    dx = (from.x - to.x) / 2,
    dy = (from.y - to.y) / 2;
  const x = c * dx + s * dy,
    y = -s * dx + c * dy,
    correction = Math.sqrt(
      Math.max(1, (x * x) / (rx * rx) + (y * y) / (ry * ry)),
    );
  rx *= correction;
  ry *= correction;
  const factor =
    (large === clockwise ? -1 : 1) *
    Math.sqrt(
      Math.max(
        0,
        (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) /
          (rx * rx * y * y + ry * ry * x * x),
      ),
    );
  const cxp = (factor * rx * y) / ry,
    cyp = (-factor * ry * x) / rx,
    cx = c * cxp - s * cyp + (from.x + to.x) / 2,
    cy = s * cxp + c * cyp + (from.y + to.y) / 2;
  const start = Math.atan2((y - cyp) / ry, (x - cxp) / rx),
    end = Math.atan2((-y - cyp) / ry, (-x - cxp) / rx);
  let sweep = end - start;
  if (clockwise && sweep < 0) sweep += 2 * Math.PI;
  if (!clockwise && sweep > 0) sweep -= 2 * Math.PI;
  const points = ellipse(cx, cy, rx, ry, start, sweep, phi, tolerance);
  points[0] = from;
  points[points.length - 1] = to;
  return points;
}
function cubic(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tolerance: number,
  depth = 0,
): Point[] {
  if (Math.max(pointSegment(b, a, d), pointSegment(c, a, d)) <= tolerance)
    return [a, d];
  if (depth > 30) throw new Error("Curve did not converge");
  const ab = lerp(a, b, 0.5),
    bc = lerp(b, c, 0.5),
    cd = lerp(c, d, 0.5),
    abc = lerp(ab, bc, 0.5),
    bcd = lerp(bc, cd, 0.5),
    mid = lerp(abc, bcd, 0.5);
  return [
    ...cubic(a, ab, abc, mid, tolerance, depth + 1).slice(0, -1),
    ...cubic(mid, bcd, cd, d, tolerance, depth + 1),
  ];
}
function pathPoints(value: string, tolerance: number): Point[][] {
  const tokens =
    value.match(/[a-zA-Z]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g) ?? [];
  if (
    value
      .replace(/[a-zA-Z]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g, "")
      .replace(/[\s,]/g, "")
  )
    throw new Error("Unparsed SVG path");
  const paths: Point[][] = [];
  let i = 0,
    command = "",
    at = p(0, 0),
    start = at,
    points: Point[] = [],
    control: Point | undefined,
    previous = "";
  const number = () => {
    const v = tokens[i++];
    if (v === undefined || !Number.isFinite(Number(v)))
      throw new Error("Invalid SVG path number");
    return Number(v);
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i]!)) command = tokens[i++]!;
    const upper = command.toUpperCase(),
      relative = command !== upper,
      origin = at;
    const nextPoint = () => {
      const q = p(number(), number());
      return relative ? p(origin.x + q.x, origin.y + q.y) : q;
    };
    let next: Point[], lastControl: Point | undefined;
    switch (upper) {
      case "M":
        at = nextPoint();
        if (points.length) paths.push(points);
        points = [at];
        start = at;
        command = relative ? "l" : "L";
        previous = "M";
        control = undefined;
        continue;
      case "Z":
        next = [at, start];
        command = "";
        break;
      case "L":
        next = [at, nextPoint()];
        break;
      case "H":
        next = [at, p(number() + (relative ? at.x : 0), at.y)];
        break;
      case "V":
        next = [at, p(at.x, number() + (relative ? at.y : 0))];
        break;
      case "A": {
        const rx = number(),
          ry = number(),
          rotation = number(),
          large = number(),
          sweep = number();
        next = arc(
          at,
          nextPoint(),
          rx,
          ry,
          rotation,
          !!large,
          !!sweep,
          tolerance,
        );
        break;
      }
      case "C": {
        const b = nextPoint(),
          c = nextPoint(),
          d = nextPoint();
        next = cubic(at, b, c, d, tolerance);
        lastControl = c;
        break;
      }
      case "S": {
        const b =
            control && ["C", "S"].includes(previous)
              ? p(2 * at.x - control.x, 2 * at.y - control.y)
              : at,
          c = nextPoint(),
          d = nextPoint();
        next = cubic(at, b, c, d, tolerance);
        lastControl = c;
        break;
      }
      case "Q":
      case "T": {
        const b =
            upper === "Q"
              ? nextPoint()
              : control && ["Q", "T"].includes(previous)
                ? p(2 * at.x - control.x, 2 * at.y - control.y)
                : at,
          d = nextPoint();
        next = cubic(at, lerp(at, b, 2 / 3), lerp(d, b, 2 / 3), d, tolerance);
        lastControl = b;
        break;
      }
      default:
        throw new Error(`Unsupported SVG path command ${command}`);
    }
    points.push(...next.slice(1));
    at = next.at(-1)!;
    control = lastControl;
    previous = upper;
  }
  if (points.length) paths.push(points);
  return paths;
}
export function portAnchor(
  def: SymbolDefinition,
  port: SymbolDefinition["ports"][number],
): Point {
  switch (port.side) {
    case "west":
      return p(0, def.size.height * port.offset);
    case "east":
      return p(def.size.width, def.size.height * port.offset);
    case "north":
      return p(def.size.width * port.offset, 0);
    case "south":
      return p(def.size.width * port.offset, def.size.height);
  }
}
function primitivePoints(
  primitive: SymbolPrimitive,
  tolerance: number,
): Point[] {
  switch (primitive.kind) {
    case "line":
      return [primitive.from, primitive.to];
    case "polyline":
      return [...primitive.points];
    case "rect":
      return [
        p(primitive.x, primitive.y),
        p(primitive.x + primitive.width, primitive.y),
        p(primitive.x + primitive.width, primitive.y + primitive.height),
        p(primitive.x, primitive.y + primitive.height),
        p(primitive.x, primitive.y),
      ];
    case "circle":
      return ellipse(
        primitive.center.x,
        primitive.center.y,
        primitive.radius,
        primitive.radius,
        0,
        2 * Math.PI,
        0,
        tolerance,
      );
    case "arc":
      return arc(
        primitive.from,
        primitive.to,
        primitive.radiusX,
        primitive.radiusY,
        0,
        false,
        primitive.clockwise,
        tolerance,
      );
    default: {
      const exhaustive: never = primitive;
      throw new Error(`Unhandled primitive ${JSON.stringify(exhaustive)}`);
    }
  }
}
export function catalogGeometry(
  def: SymbolDefinition,
  mmPerUnit: number,
): { shapes: InkShape[]; ports: PortAnchor[] } {
  const ink = sourceEnclosureInk(mmPerUnit),
    toMm = (q: Point) => p(q.x * mmPerUnit, q.y * mmPerUnit);
  const shapes: InkShape[] = def.primitives.map((primitive) => ({
    points: primitivePoints(primitive, ERROR_MM / mmPerUnit).map(toMm),
    stroke:
      (primitive.style === "enclosure"
        ? ink.strokeWidth
        : DEFAULT_SYMBOL_STROKE) * mmPerUnit,
    enclosure: primitive.style === "enclosure",
  }));
  const ports = def.ports.map((port) => ({
    id: port.id,
    point: toMm(portAnchor(def, port)),
  }));
  for (const port of ports)
    shapes.push({
      points: ellipse(
        port.point.x,
        port.point.y,
        2 * mmPerUnit,
        2 * mmPerUnit,
        0,
        2 * Math.PI,
        0,
        ERROR_MM,
      ),
      stroke: DEFAULT_SYMBOL_STROKE * mmPerUnit,
      port: port.id,
    });
  return { shapes, ports };
}
/** Every drawable descendant is visited, including nested transformed marks.
 * Unknown geometry fails closed instead of silently disappearing from the test. */
export function svgGeometry(
  root: Element,
  mmPerUnit = 1,
): { shapes: InkShape[]; ports: PortAnchor[] } {
  const shapes: InkShape[] = [],
    ports: PortAnchor[] = [];
  function walk(
    e: Element,
    parent: Matrix,
    stroke: string,
    width: number,
    port?: string,
    enclosure = false,
    skipTransform = false,
    fill = "black",
  ) {
    if (
      ["text", "title", "desc", "defs", "style", "clipPath"].includes(
        e.localName,
      )
    )
      return;
    const inline = Object.fromEntries(
      (e.getAttribute("style") ?? "")
        .split(";")
        .filter(Boolean)
        .map((v) => v.split(":").map((v) => v.trim())),
    );
    let m = skipTransform
      ? parent
      : multiply(parent, parseTransform(e.getAttribute("transform") ?? ""));
    if (e.localName === "svg" && !skipTransform) {
      const vb = (e.getAttribute("viewBox") ?? e.getAttribute("viewbox") ?? "")
        .trim()
        .split(/[ ,]+/)
        .map(Number);
      const x = Number(e.getAttribute("x") ?? 0),
        y = Number(e.getAttribute("y") ?? 0);
      let viewport: Matrix = [1, 0, 0, 1, x, y];
      if (vb.length === 4) {
        const w = Number(e.getAttribute("width")),
          h = Number(e.getAttribute("height"));
        if (!(vb[2]! > 0 && vb[3]! > 0 && w > 0 && h > 0))
          throw new Error("Invalid nested SVG viewport");
        let sx = w / vb[2]!,
          sy = h / vb[3]!,
          dx = 0,
          dy = 0;
        const aspect = e.getAttribute("preserveAspectRatio") ?? "xMidYMid meet";
        if (aspect !== "none") {
          const scale = aspect.includes("slice")
            ? Math.max(sx, sy)
            : Math.min(sx, sy);
          sx = scale;
          sy = scale;
          dx =
            (w - vb[2]! * scale) *
            (aspect.includes("xMin") ? 0 : aspect.includes("xMax") ? 1 : 0.5);
          dy =
            (h - vb[3]! * scale) *
            (aspect.includes("YMin") ? 0 : aspect.includes("YMax") ? 1 : 0.5);
        }
        viewport = multiply(viewport, [
          sx,
          0,
          0,
          sy,
          dx - vb[0]! * sx,
          dy - vb[1]! * sy,
        ]);
      }
      m = multiply(m, viewport);
    }
    stroke = e.getAttribute("stroke") ?? inline.stroke ?? stroke;
    // The rooted catalog uses a closed stylesheet; circuit ink is inherited
    // from inline groups. Resolve the catalog classes as well as inline ink.
    if (
      [
        "symbol-body",
        "symbol-operator",
        "symbol-actuator",
        "symbol-annotation",
        "symbol-terminal",
        "terminal-marker",
      ].some((c) => e.classList.contains(c))
    ) {
      width = DEFAULT_SYMBOL_STROKE;
      stroke = "#101828";
    }
    width = Number(
      e.getAttribute("stroke-width") ?? inline["stroke-width"] ?? width,
    );
    if (
      [
        "symbol-body",
        "symbol-operator",
        "symbol-actuator",
        "symbol-annotation",
      ].some((c) => e.classList.contains(c))
    )
      fill = "none";
    if (
      ["symbol-terminal", "terminal-marker"].some((c) =>
        e.classList.contains(c),
      )
    )
      fill = "white";
    fill = e.getAttribute("fill") ?? inline.fill ?? fill;
    port =
      e.getAttribute("data-terminal-id") ??
      (e.classList.contains("terminal-marker")
        ? (e.getAttribute("data-terminal-key") ?? undefined)
        : undefined) ??
      port;
    enclosure =
      enclosure ||
      e.hasAttribute("data-source-enclosure") ||
      e.getAttribute("class") === "symbol-enclosure";
    if (!Number.isFinite(width)) throw new Error("Invalid SVG stroke width");
    const n = (name: string) => Number(e.getAttribute(name) ?? 0),
      tol = ERROR_MM / scaleOf(m);
    let paths: Point[][] = [];
    switch (e.localName) {
      case "g":
      case "svg":
        break;
      case "line":
        paths = [[p(n("x1"), n("y1")), p(n("x2"), n("y2"))]];
        break;
      case "rect":
        paths = [
          primitivePoints(
            {
              kind: "rect",
              x: n("x"),
              y: n("y"),
              width: n("width"),
              height: n("height"),
              style: "body",
            },
            tol,
          ),
        ];
        break;
      case "circle":
      case "ellipse":
        paths = [
          ellipse(
            n("cx"),
            n("cy"),
            e.localName === "circle" ? n("r") : n("rx"),
            e.localName === "circle" ? n("r") : n("ry"),
            0,
            2 * Math.PI,
            0,
            tol,
          ),
        ];
        if (port)
          ports.push({ id: port, point: transform(m, p(n("cx"), n("cy"))) });
        break;
      case "polyline":
      case "polygon": {
        const numbers = (e.getAttribute("points") ?? "")
          .trim()
          .split(/[ ,]+/)
          .map(Number);
        const pts = Array.from({ length: numbers.length / 2 }, (_, i) =>
          p(numbers[i * 2]!, numbers[i * 2 + 1]!),
        );
        if (e.localName === "polygon") pts.push(pts[0]!);
        paths = [pts];
        break;
      }
      case "path":
        paths = pathPoints(e.getAttribute("d") ?? "", tol);
        break;
      default:
        throw new Error(`Unsupported SVG geometry ${e.localName}`);
    }
    if (
      paths.flat().some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))
    )
      throw new Error("Invalid SVG geometry coordinates");
    const ink = (paint: string) =>
      !["none", "white", "#fff", "#ffffff", "transparent"].includes(
        paint.toLowerCase().trim(),
      );
    const stroked = ink(stroke) && width > 0;
    for (const path of paths) {
      const solid = ink(fill) && path.length >= 3;
      if (!stroked && !solid) continue;
      const points =
        solid && length(path[0]!, path.at(-1)!) > 0
          ? [...path, path[0]!]
          : path;
      shapes.push({
        points: points.map((q) => transform(m, q)),
        stroke: stroked ? width * scaleOf(m) : 0,
        solid,
        enclosure,
        port,
      });
    }
    for (const child of e.children)
      walk(child, m, stroke, width, port, enclosure, false, fill);
  }
  walk(
    root,
    [mmPerUnit, 0, 0, mmPerUnit, 0, 0],
    "#17212b",
    0.4,
    undefined,
    false,
    true,
  );
  return { shapes, ports };
}
export function assertSourceIsolation(
  {
    shapes,
    ports,
  }: { shapes: readonly InkShape[]; ports: readonly PortAnchor[] },
  gapMm = 0.3,
): void {
  if (ports.length < 2)
    throw new Error("Isolation test requires multiple source port anchors");
  const graph = shapes.map(() => new Set<number>());
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++)
      if (inkClearance(shapes[i]!, shapes[j]!) < gapMm) {
        graph[i]!.add(j);
        graph[j]!.add(i);
      }
  for (const port of ports) {
    const reached = new Set(
      shapes.flatMap((s, i) => (s.port === port.id ? [i] : [])),
    );
    if (!reached.size) throw new Error(`No terminal geometry for ${port.id}`);
    for (const i of reached) for (const next of graph[i]!) reached.add(next);
    if ([...reached].some((i) => shapes[i]!.enclosure))
      throw new Error(
        `Source ${port.id} lacks ${gapMm} mm enclosure clearance`,
      );
    if (
      ports.some(
        (other) =>
          other.id !== port.id &&
          [...reached].some((i) => shapes[i]!.port === other.id),
      )
    )
      throw new Error(
        `Source ${port.id} bridges another terminal within ${gapMm} mm`,
      );
  }
}

/** Physical text ink and em after every nested mark transform. Packet circuit
 * viewBox units are mm; translations/rotations must not hide a scale breach. */
export function svgTextGeometry(root: Element) {
  const texts: { element: Element; em: number; corners: Point[] }[] = [];
  function walk(e: Element, parent: Matrix) {
    const matrix = multiply(
      parent,
      parseTransform(e.getAttribute("transform") ?? ""),
    );
    if (e.localName === "text") {
      const size = Number(e.getAttribute("font-size"));
      const b = captionInk(
        e.textContent ?? "",
        Number(e.getAttribute("x")),
        Number(e.getAttribute("y")),
        size,
        e.getAttribute("text-anchor") ?? "start",
      );
      texts.push({
        element: e,
        em: size * scaleOf(matrix),
        corners: [
          p(b.left, b.top),
          p(b.right, b.top),
          p(b.right, b.bottom),
          p(b.left, b.bottom),
        ].map((v) => transform(matrix, v)),
      });
    }
    for (const child of e.children) walk(child, matrix);
  }
  walk(root, IDENTITY);
  return texts;
}
