import {
  renderCache,
  MAX_GEOMETRY_CACHE_KEY_UNITS,
  MAX_GEOMETRY_CACHE_TOTAL_KEY_UNITS,
} from "./render-cache.js";
import { required } from "../presentation/util.js";
import {
  svgTree,
  svgStyles,
  descendants,
  declarations,
  type SvgNode,
} from "../device-legend/svg-tree.js";
import {
  identity,
  multiply,
  transform,
  project,
  intersection,
  type Matrix,
  type Rect,
} from "../device-legend/geometry.js";
export interface NavigationGeometry {
  node: SvgNode;
  matrix: Matrix;
  clip: Rect;
  visible: boolean;
  viewKey: string;
  deviceUid?: string;
  style?: Readonly<Record<string, string>>;
}
function viewportGeometry(node: SvgNode, matrix: Matrix, clip: Rect) {
  const a = node.attrs;
  if (node.name === "svg" && a.viewBox) {
    const v = a.viewBox.split(/[ ,]+/).map(Number);
    const x = required(v[0], "Missing navigation viewport"),
      y = required(v[1], "Missing navigation viewport"),
      w = required(v[2], "Missing navigation viewport"),
      h = required(v[3], "Missing navigation viewport");
    const width = parseFloat(a.width ?? String(w)),
      height = parseFloat(a.height ?? String(h));
    const s = Math.min(width / w, height / h);
    matrix = multiply(matrix, [
      s,
      0,
      0,
      s,
      Number(a.x ?? 0) - x * s + (width - w * s) / 2,
      Number(a.y ?? 0) - y * s + (height - h * s) / 2,
    ]);
    clip = intersection(clip, project({ x, y, w, h }, matrix)) ?? {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
  }
  return { matrix, clip };
}

function labelClip(
  a: Record<string, string>,
  matrix: Matrix,
  clip: Rect,
  clips: ReadonlyMap<string | undefined, Record<string, string> | undefined>,
) {
  const label = clips.get(/url\(#([^)]+)\)/.exec(a["clip-path"] ?? "")?.[1]);
  if (label)
    clip = intersection(
      clip,
      project(
        {
          x: Number(label.x ?? 0),
          y: Number(label.y ?? 0),
          w: Number(label.width),
          h: Number(label.height),
        },
        matrix,
      ),
    ) ?? { x: 0, y: 0, w: 0, h: 0 };
  return clip;
}

/** Read-only parse of this exact SVG, when the bounded render cache has it. */
export function cachedNavigationTree(svg: string): SvgNode | undefined {
  return svg.length <= MAX_GEOMETRY_CACHE_KEY_UNITS
    ? renderCache.getStore()?.entries.get(svg)?.[0]?.node
    : undefined;
}

/** Exact generated SVG repeats are read-only within the render operation. */
export function navigationGeometry(svg: string): NavigationGeometry[] {
  const cache =
      svg.length <= MAX_GEOMETRY_CACHE_KEY_UNITS
        ? renderCache.getStore()
        : undefined,
    prior = cache?.entries.get(svg);
  if (prior) return prior;
  const result = measureNavigationGeometry(svg);
  // Keep a packet's measurements bounded and release them at the render boundary.
  if (
    cache &&
    cache.entries.size < 256 &&
    cache.nodes + result.length <= 50000 &&
    cache.keyUnits + svg.length <= MAX_GEOMETRY_CACHE_TOTAL_KEY_UNITS
  ) {
    cache.entries.set(svg, result);
    cache.nodes += result.length;
    cache.keyUnits += svg.length;
  }
  return result;
}

/** Generated SVG only. Retains transforms and clips instead of treating copied inner SVG as full glyphs. */
function measureNavigationGeometry(svg: string): NavigationGeometry[] {
  const tree = svgTree(svg),
    styles = svgStyles(tree),
    all = descendants(tree);
  const clips = new Map(
    all
      .filter((n) => n.name === "clipPath")
      .map((n) => [
        n.attrs.id,
        n.children.find((c) => c.name === "rect")?.attrs,
      ]),
  );
  const result: NavigationGeometry[] = [];
  const visit = (
    node: SvgNode,
    parent: NavigationGeometry,
    inherited: Record<string, string>,
  ) => {
    if (["defs", "style", "title", "desc"].includes(node.name)) return;
    const a = node.attrs;
    const css = {
      ...inherited,
      ...a,
      ...Object.assign(
        {},
        ...(a.class ?? "").split(" ").map((c) => styles.get(c)),
      ),
      ...declarations(a.style ?? ""),
    };
    let matrix = multiply(parent.matrix, transform(a.transform)),
      clip = parent.clip;
    ({ matrix, clip } = viewportGeometry(node, matrix, clip));
    clip = labelClip(a, matrix, clip, clips);
    const deviceUid = a["data-device-uid"] ?? parent.deviceUid;
    const state = {
      node,
      matrix,
      clip,
      viewKey: a["data-navigation-view"] ?? parent.viewKey,
      ...(deviceUid ? { deviceUid } : {}),
      style: css,
      visible:
        parent.visible &&
        css.display !== "none" &&
        css.visibility !== "hidden" &&
        css.opacity !== "0",
    };
    result.push(state);
    for (const child of node.children) visit(child, state, css);
  };
  visit(
    tree,
    {
      node: tree,
      matrix: identity,
      clip: { x: -1e6, y: -1e6, w: 2e6, h: 2e6 },
      visible: true,
      viewKey: "",
    },
    {},
  );
  return result;
}
