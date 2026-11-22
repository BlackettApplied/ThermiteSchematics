import { required } from "../presentation/util.js";
import { printableTextMetrics } from "../text-metrics.js";
import {
  multiply,
  transform,
  project,
  intersection,
  expand,
  inside,
  type Rect,
  type Matrix,
} from "./geometry.js";
import {
  svgTree,
  svgStyles,
  descendants,
  declarations,
  type SvgNode,
} from "./svg-tree.js";
import { pathInk, rectangleInk } from "./shape-ink.js";
import { legendReference, type LegendReference } from "./reference.js";
interface State {
  matrix: Matrix;
  clip: Rect;
  css: Record<string, string>;
  uid?: string | undefined;
}
export interface SvgInk {
  ink: Rect[];
  /** Visible text only, in the same sheet-space/clip convention as ink. */
  texts: Rect[];
  regions: Rect[];
  bodies: Map<string, Rect>;
  keys: Map<string, string[]>;
  references: Map<string, LegendReference[]>;
}
const number = (a: Record<string, string>, k: string, fallback = 0) =>
  Number.parseFloat(a[k] ?? String(fallback));
const dark = (fill: string | undefined) =>
  !!fill &&
  !["none", "white", "#fff", "#ffffff", "transparent"].includes(
    fill.toLowerCase(),
  );
function viewport(node: SvgNode, state: State, nested: boolean): State {
  if (node.name !== "svg" || !nested) return state;
  const a = node.attrs,
    v = (a.viewBox ?? "0 0 0 0").split(/[ ,]+/).map(Number),
    w = number(a, "width"),
    h = number(a, "height");
  const scale = Math.min(
    w / required(v[2], "Missing legend geometry"),
    h / required(v[3], "Missing legend geometry"),
  );
  const matrix = multiply(state.matrix, [
    scale,
    0,
    0,
    scale,
    number(a, "x") -
      required(v[0], "Missing legend geometry") * scale +
      (w - required(v[2], "Missing legend geometry") * scale) / 2,
    number(a, "y") -
      required(v[1], "Missing legend geometry") * scale +
      (h - required(v[3], "Missing legend geometry") * scale) / 2,
  ]);
  return {
    ...state,
    matrix,
    clip: intersection(
      state.clip,
      project(
        {
          x: required(v[0], "Missing legend geometry"),
          y: required(v[1], "Missing legend geometry"),
          w: required(v[2], "Missing legend geometry"),
          h: required(v[3], "Missing legend geometry"),
        },
        matrix,
      ),
    ) ?? { x: 0, y: 0, w: 0, h: 0 },
  };
}
export function textInk(
  n: SvgNode,
  css: Record<string, string>,
): Rect | undefined {
  const size = number(css, "font-size", 10),
    value =
      n.attrs["xml:space"] === "preserve"
        ? n.text
        : n.text.replace(/[\t\r\n ]+/g, " ").trim();
  if (!value) return;
  const metric = printableTextMetrics(
    value,
    size,
    css["font-weight"] === "bold" || number(css, "font-weight", 400) >= 600,
    true,
  );
  const advance = number(css, "textLength", metric.advance),
    factor = metric.advance ? advance / metric.advance : 1;
  const anchor = css["text-anchor"],
    x =
      number(css, "x") -
      (anchor === "middle" ? advance / 2 : anchor === "end" ? advance : 0),
    y = number(css, "y");
  const baseline = css["dominant-baseline"];
  return baseline && baseline !== "alphabetic"
    ? {
        x: x + metric.left * factor,
        y: y - size,
        w: (metric.right - metric.left) * factor,
        h: size * 2,
      }
    : {
        x: x + metric.left * factor,
        y: y - metric.top,
        w: (metric.right - metric.left) * factor,
        h: metric.top - metric.bottom,
      };
}
function shapeInk(n: SvgNode, css: Record<string, string>): Rect[] {
  const a = n.attrs,
    get = (k: string) => number(a, k),
    stroke = dark(css.stroke) ? number(css, "stroke-width", 1) : 0;
  if (n.name === "rect") {
    const b = { x: get("x"), y: get("y"), w: get("width"), h: get("height") },
      background = /location-frame|canvas-background/.test(a.class ?? "");
    return [
      ...rectangleInk(b, stroke),
      // Cards reserve their entire interior, including blank space between
      // captions. A legend must never enter an off-view card.
      ...((dark(css.fill) && !background) || css["data-off-view-terminal"]
        ? [b]
        : []),
    ];
  }
  if (n.name === "line")
    return stroke
      ? [
          expand(
            {
              x: Math.min(get("x1"), get("x2")),
              y: Math.min(get("y1"), get("y2")),
              w: Math.abs(get("x2") - get("x1")),
              h: Math.abs(get("y2") - get("y1")),
            },
            stroke / 2,
          ),
        ]
      : [];
  if (n.name === "circle" || n.name === "ellipse") {
    const rx = n.name === "circle" ? get("r") : get("rx"),
      ry = n.name === "circle" ? get("r") : get("ry");
    return dark(css.fill) || stroke
      ? [
          expand(
            { x: get("cx") - rx, y: get("cy") - ry, w: rx * 2, h: ry * 2 },
            stroke / 2,
          ),
        ]
      : [];
  }
  if (n.name === "path")
    return dark(css.fill) || stroke
      ? pathInk(a.d ?? "").map((b) => expand(b, stroke / 2))
      : [];
  if (n.name === "polyline" || n.name === "polygon") {
    const p = (a.points ?? "").trim().split(/[ ,]+/).map(Number),
      d =
        p.reduce(
          (s, v, i) => s + (i % 2 ? " " + v : " " + (i ? "L" : "M") + " " + v),
          "",
        ) + (n.name === "polygon" ? " Z" : "");
    return dark(css.fill) || stroke
      ? pathInk(d).map((b) => expand(b, stroke / 2))
      : [];
  }
  return [];
}
function emptyInk(): SvgInk {
  return {
    ink: [],
    texts: [],
    regions: [],
    bodies: new Map(),
    keys: new Map(),
    references: new Map(),
  };
}
function inkDocument(tree: SvgNode) {
  const root = required(
    tree.children.find((n) => n.name === "svg"),
    "Missing legend geometry",
  );
  const styles = svgStyles(tree),
    nodes = descendants(tree),
    clips = new Map(
      nodes
        .filter((n) => n.name === "clipPath")
        .map((n) => [
          required(n.attrs.id, "Missing legend geometry"),
          n.children.find((c) => c.name === "rect")?.attrs,
        ]),
    );
  return { root, styles, clips };
}
/** All final visible ink, including nested fold/stack viewports and label clips. */
export function generatedSvgInk(
  svg: string,
  scale = 1,
  parsed?: SvgNode,
): SvgInk {
  const { root, styles, clips } = inkDocument(parsed ?? svgTree(svg));
  const v = required(root.attrs.viewBox, "Missing legend geometry")
      .split(/[ ,]+/)
      .map(Number),
    out = emptyInk();
  const visit = (node: SvgNode, parent: State, nested: boolean) => {
    if (["defs", "style", "title", "desc"].includes(node.name)) return;
    const css = {
      ...parent.css,
      ...node.attrs,
      ...Object.assign(
        {},
        ...(node.attrs.class ?? "").split(" ").map((c) => styles.get(c)),
      ),
      ...declarations(node.attrs.style ?? ""),
    };
    if (
      css.display === "none" ||
      css.visibility === "hidden" ||
      css.opacity === "0"
    )
      return;
    let state = viewport(
      node,
      {
        ...parent,
        css,
        matrix: multiply(parent.matrix, transform(node.attrs.transform)),
        uid: node.attrs["data-device-uid"] ?? parent.uid,
      },
      nested,
    );
    state = labelClip(node, state, clips);
    collectNode(node, state, out);
    for (const child of node.children) visit(child, state, true);
  };
  visit(
    root,
    {
      matrix: [scale, 0, 0, scale, 0, 0],
      clip: {
        x: 0,
        y: 0,
        w: required(v[2], "Missing legend geometry") * scale,
        h: required(v[3], "Missing legend geometry") * scale,
      },
      css: { fill: "black" },
    },
    false,
  );
  return out;
}
function collectNode(node: SvgNode, state: State, out: SvgInk) {
  const a = node.attrs,
    cls = a.class ?? "",
    local = node.name === "text" ? textInk(node, state.css) : undefined;
  const boxes = local ? [local] : shapeInk(node, state.css);
  if (
    local &&
    state.css["data-tag-kind"] === "reference" &&
    state.css["data-tag-field"] === "designation" &&
    dark(state.css.fill) &&
    inside(project(local, state.matrix), expand(state.clip, 0.002))
  ) {
    const uid = state.css["data-tag-owner-uid"],
      reference = legendReference(
        node.text,
        state.css["data-tag-terminal-id"],
        uid,
        project(local, state.matrix),
      );
    if (uid && reference)
      out.references.set(uid, [...(out.references.get(uid) ?? []), reference]);
  }
  for (const b of boxes) {
    const clipped = intersection(project(b, state.matrix), state.clip);
    if (clipped && clipped.w + clipped.h > 0) {
      const box = expand(clipped, 0.003);
      out.ink.push(box);
      if (local) out.texts.push(box);
    }
  }
  if (node.name === "rect" && /location-frame|device-frame/.test(cls)) {
    const b = project(
        {
          x: number(a, "x"),
          y: number(a, "y"),
          w: number(a, "width"),
          h: number(a, "height"),
        },
        state.matrix,
      ),
      visible = intersection(b, state.clip);
    if (
      cls.includes("location-frame") &&
      visible &&
      visible.w > 0 &&
      visible.h > 0
    )
      out.regions.push(...rectangleInk(visible, 0.001));
    else if (state.uid && visible && visible.w > 0.001 && visible.h > 0.001) {
      const old = out.bodies.get(state.uid);
      if (
        !old ||
        visible.y < old.y ||
        (visible.y === old.y && visible.x < old.x)
      )
        out.bodies.set(state.uid, visible);
    }
  }
  if (
    local &&
    a["data-tag-kind"] === "body" &&
    (a["data-tag-field"] === "designation" ||
      (!a["data-tag-field"] && a["data-tag-key"] === node.text)) &&
    inside(project(local, state.matrix), expand(state.clip, 0.002))
  ) {
    const uid = a["data-tag-owner-uid"];
    if (uid) out.keys.set(uid, [...(out.keys.get(uid) ?? []), node.text]);
  }
}

function labelClip(
  node: SvgNode,
  state: State,
  clips: ReadonlyMap<string, Record<string, string> | undefined>,
): State {
  const id = /url\(#([^)]+)\)/.exec(node.attrs["clip-path"] ?? "")?.[1],
    clip = id ? clips.get(id) : undefined;
  if (clip)
    state = {
      ...state,
      clip: intersection(
        state.clip,
        project(
          {
            x: number(clip, "x"),
            y: number(clip, "y"),
            w: number(clip, "width"),
            h: number(clip, "height"),
          },
          state.matrix,
        ),
      ) ?? { x: 0, y: 0, w: 0, h: 0 },
    };
  return state;
}
