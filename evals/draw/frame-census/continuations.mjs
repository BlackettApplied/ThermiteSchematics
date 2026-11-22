import { straightPath } from "../path.mjs";

const EPS = 0.002;
const contains = (b, p) =>
  p.x >= b.x - EPS &&
  p.x <= b.x + b.w + EPS &&
  p.y >= b.y - EPS &&
  p.y <= b.y + b.h + EPS;
const transform = (p, m) => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
});
function segmentAtCut(a, b, cut, vertical) {
  const axis = vertical ? "x" : "y",
    other = vertical ? "y" : "x";
  if (Math.abs(b[axis] - a[axis]) < 1e-9) {
    if (Math.abs(cut[axis] - a[axis]) > EPS) return null;
    return {
      ...cut,
      [axis]: a[axis],
      [other]: Math.max(
        Math.min(a[other], b[other]),
        Math.min(Math.max(a[other], b[other]), cut[other]),
      ),
    };
  }
  const t = (cut[axis] - a[axis]) / (b[axis] - a[axis]);
  if (t < -1e-8 || t > 1 + 1e-8) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Independent straight-route/viewport check. No continuation endpoint is moved
 * to make it join; final painted path styles and native provenance decide. */
export async function continuationGeometry(page, svg, expected) {
  await page.setContent(
    "<style>body{margin:0}</style>" + svg.replace(/<\?xml[^>]*>/, ""),
  );
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => {
    const root = document.querySelector("body>svg"),
      inv = root.getScreenCTM().inverse();
    const point = (x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(inv);
      return { x: p.x, y: p.y };
    };
    const box = (e) => {
      // A nested SVG's painted bounding box is not its clipping viewport.
      const v = e.viewBox.baseVal,
        m = e.getScreenCTM(),
        start = new DOMPoint(v.x, v.y).matrixTransform(m),
        end = new DOMPoint(v.x + v.width, v.y + v.height).matrixTransform(m),
        a = point(start.x, start.y),
        z = point(end.x, end.y);
      return { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y };
    };
    const visible = (e) => {
      if (
        !e ||
        getComputedStyle(e).stroke === "none" ||
        !(parseFloat(getComputedStyle(e).strokeWidth) > 0)
      )
        return false;
      for (let a = e; a && a !== root.parentElement; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (
          s.display === "none" ||
          s.visibility !== "visible" ||
          +s.opacity === 0
        )
          return false;
      }
      return true;
    };
    const links = [...root.querySelectorAll("a[data-continuation-id]")].map(
      (a) => {
        const path = [...a.children].find((e) => e.tagName === "path");
        return {
          id: a.getAttribute("data-continuation-id"),
          end: +a.getAttribute("data-continuation-end"),
          d: path?.getAttribute("d"),
          visible: visible(path),
        };
      },
    );
    const paths = [
      ...root.querySelectorAll(
        "path[data-wire-uid],path[data-jumper-uid],path[data-cable-uid]",
      ),
    ].map((e) => {
      const m = inv.multiply(e.getScreenCTM()),
        clips = [];
      for (let a = e.parentElement; a && a !== root; a = a.parentElement)
        if (a.tagName === "svg" && getComputedStyle(a).overflow !== "visible")
          clips.push(box(a));
      return {
        d: e.getAttribute("d"),
        visible: visible(e),
        matrix: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
        clips,
        wire: e.getAttribute("data-wire-uid"),
        jumper: e.getAttribute("data-jumper-uid"),
        cable: e.getAttribute("data-cable-uid"),
        core: e.getAttribute("data-conductor-id"),
      };
    });
    return { links, paths };
  });
  const findings = [];
  for (const stub of geometry.links)
    if (
      stub.visible &&
      !expected.some((link) => link.id === stub.id && link.end === stub.end)
    )
      findings.push({
        id: stub.id,
        end: stub.end,
        kind: "unlisted-painted-stub",
      });
  for (const link of expected) {
    const own = geometry.links.filter(
      (l) => l.id === link.id && l.end === link.end,
    );
    if (own.length !== 1) {
      findings.push({ id: link.id, kind: "missing-or-duplicate-stub" });
      continue;
    }
    const stub = own[0],
      vertices = straightPath(stub.d ?? "");
    if (!stub.visible || vertices?.length !== 2) {
      findings.push({ id: link.id, kind: "hidden-or-malformed-stub" });
      continue;
    }
    const [cut, tip] = vertices,
      length = Math.hypot(tip.x - cut.x, tip.y - cut.y);
    if (Math.abs(length - 2) > 1e-6)
      findings.push({ id: link.id, kind: "trimmed-stub", length });
    const id = link.provenance;
    const routes = geometry.paths.filter(
      (p) =>
        p.visible &&
        (id?.kind === "wire"
          ? p.wire === id.uid
          : id?.kind === "jumper"
            ? p.jumper === id.uid
            : id?.kind === "cable_conductor"
              ? p.cable === id.cableUid && p.core === id.conductorId
              : false),
    );
    let supported = false;
    for (const route of routes) {
      if (!route.clips.every((b) => contains(b, cut))) continue;
      // The cut is the clipped route edge, not any interior point on the wire.
      const horizontal = Math.abs(tip.y - cut.y) < 1e-8;
      const atViewportEdge = route.clips.some((b) =>
        horizontal
          ? Math.abs(cut.x - (tip.x > cut.x ? b.x + b.w : b.x)) <= EPS
          : Math.abs(cut.y - (tip.y > cut.y ? b.y + b.h : b.y)) <= EPS,
      );
      if (!atViewportEdge) continue;
      const points = straightPath(route.d ?? "")?.map((p) =>
        transform(p, route.matrix),
      );
      for (let i = 1; points && i < points.length; i++) {
        const at = segmentAtCut(
          points[i - 1],
          points[i],
          cut,
          Math.abs(tip.y - cut.y) < 1e-8,
        );
        if (
          at &&
          Math.hypot(at.x - cut.x, at.y - cut.y) <= EPS &&
          route.clips.every((b) => contains(b, at))
        )
          supported = true;
      }
    }
    if (!supported)
      findings.push({
        id: link.id,
        end: link.end,
        kind: "stub-not-on-visible-owned-route",
        cut,
        provenance: id,
      });
  }
  return { endpoints: expected.length, findings };
}
