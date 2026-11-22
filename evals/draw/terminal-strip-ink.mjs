// Browser measurement of visible SVG, never renderer geometry/coverage fields.
import { straightPath } from "./path.mjs";
import { geometry } from "./measurement/geometry.mjs";

function stripPaint(root, screenPoint, clipGeometry) {
  const painted = (e) => {
    if (e.closest("defs,clipPath,mask,symbol,pattern,marker")) return false;
    let alpha = 1;
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility !== "visible") return false;
      alpha *= Number(s.opacity);
    }
    const s = getComputedStyle(e);
    return (
      (s.fill !== "none" && alpha * Number(s.fillOpacity) >= 0.2) ||
      (s.stroke !== "none" && alpha * Number(s.strokeOpacity) >= 0.2)
    );
  };
  const visible = (e, points) => {
    let clips;
    try {
      clips = clipGeometry({ e, root, point: screenPoint });
    } catch {
      return false;
    }
    if (!clips) return false;
    for (let p = e.parentElement; p && p !== root; p = p.parentElement) {
      if (!p.matches("svg") || getComputedStyle(p).overflow === "visible")
        continue;
      const m = p.getScreenCTM();
      if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6) return false;
      const v = p.viewBox.baseVal;
      const width = v.width || p.width.animVal.value;
      const height = v.height || p.height.animVal.value;
      const inSheet = (x, y) => {
        const screen = new DOMPoint(x, y).matrixTransform(m);
        return screenPoint(screen.x, screen.y);
      };
      const a = inSheet(v.x, v.y);
      const b = inSheet(v.x + width, v.y + height);
      clips.push({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      });
    }
    const v = root.viewBox.baseVal;
    return [{ x: v.x, y: v.y, w: v.width, h: v.height }, ...clips].every((b) =>
      points.every(
        (p) =>
          p.x >= b.x - 0.001 &&
          p.x <= b.x + b.w + 0.001 &&
          p.y >= b.y - 0.001 &&
          p.y <= b.y + b.h + 0.001,
      ),
    );
  };
  const stroke = (e) => {
    const s = getComputedStyle(e);
    return (
      painted(e) &&
      !["none", "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"].includes(s.stroke) &&
      +s.strokeOpacity >= 0.2 &&
      parseFloat(s.strokeWidth) > 0
    );
  };
  return { painted, visible, stroke };
}

function stripPath(straight, { point, stroke, visible }) {
  const linearVertices = (e, style) => {
    if (e instanceof SVGLineElement)
      return [
        { x: e.x1.animVal.value, y: e.y1.animVal.value },
        { x: e.x2.animVal.value, y: e.y2.animVal.value },
      ];
    if (e instanceof SVGPolylineElement) return Array.from(e.animatedPoints);
    const d = /^path\("(.*)"\)$/u.exec(style.d)?.[1];
    return d ? straight(d) : null;
  };
  const path = (e) => {
    const length = e.getTotalLength(),
      count = Math.max(2, Math.ceil(length / 0.5)),
      style = getComputedStyle(e);
    const drawn = stroke(e);
    const vertices =
      drawn && style.strokeDasharray === "none"
        ? linearVertices(e, style)?.map((p) => point(e, p))
        : null;
    return {
      points: Array.from({ length: count + 1 }, (_, i) =>
        point(e, e.getPointAtLength((length * i) / count)),
      ),
      length,
      painted: drawn,
      vertices: vertices?.length >= 2 && visible(e, vertices) ? vertices : null,
    };
  };
  return path;
}

function stripInkHelpers(straight, clipGeometry, paintGeometry, pathGeometry) {
  const root = document.querySelector("svg"),
    inverse = root.getScreenCTM().inverse();
  const all = (s) => [...root.querySelectorAll(s)],
    attr = (e, s) => e?.getAttribute(s);
  const screenPoint = (x, y) => new DOMPoint(x, y).matrixTransform(inverse);
  const point = (e, p) =>
    new DOMPoint(p.x, p.y).matrixTransform(inverse.multiply(e.getScreenCTM()));
  const axisAligned = (e) => {
    const m = inverse.multiply(e.getScreenCTM());
    return Math.abs(m.b) <= 1e-6 && Math.abs(m.c) <= 1e-6;
  };
  const { painted, visible, stroke } = paintGeometry(
    root,
    screenPoint,
    clipGeometry,
  );
  const box = (e) => {
    const b = e.getBBox(),
      a = point(e, b),
      z = point(e, { x: b.x + b.width, y: b.y + b.height });
    return { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y };
  };
  const texts = (e) =>
    [...e.querySelectorAll("text")].map((t) => {
      const b = box(t),
        m = inverse.multiply(t.getScreenCTM());
      return {
        text: t.textContent,
        center: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        bbox: b,
        anchor: point(t, {
          x: t.x.baseVal[0]?.value ?? 0,
          y: t.y.baseVal[0]?.value ?? 0,
        }),
        size:
          parseFloat(getComputedStyle(t).fontSize) *
          Math.min(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)),
        painted: painted(t),
        inkVisible:
          painted(t) && visible(t, [b, { x: b.x + b.w, y: b.y + b.h }]),
      };
    });
  const path = pathGeometry(straight, { point, stroke, visible });
  const chunk = (e) => {
    const owner = e.closest("[data-terminal-strip]");
    return owner ? box(owner) : null;
  };
  const sheet = Number(root.getAttribute("data-sheet"));
  return {
    root,
    all,
    attr,
    painted,
    point,
    box,
    texts,
    path,
    chunk,
    sheet,
    visible,
    stroke,
    axisAligned,
  };
}
function stripGrid(h) {
  const top = h
    .all("text")
    .filter(
      (t) =>
        !t.closest("[data-terminal-strip]") &&
        /^[1-6]$/u.test(t.textContent) &&
        h.painted(t),
    )
    .map((t) => ({
      text: t.textContent,
      p: h.point(t, {
        x: t.x.baseVal[0]?.value ?? 0,
        y: t.y.baseVal[0]?.value ?? 0,
      }),
    }))
    .sort((a, b) => a.p.y - b.p.y)
    .slice(0, 6)
    .sort((a, b) => Number(a.text) - Number(b.text));
  const letters = h
    .all("text")
    .filter(
      (t) =>
        !t.closest("[data-terminal-strip]") &&
        /^[A-D]$/u.test(t.textContent) &&
        h.painted(t),
    );
  const left = ["A", "B", "C", "D"].map(
    (letter) =>
      letters
        .filter((t) => t.textContent === letter)
        .map((t) =>
          h.point(t, {
            x: t.x.baseVal[0]?.value ?? 0,
            y: t.y.baseVal[0]?.value ?? 0,
          }),
        )
        .sort((a, b) => a.x - b.x)[0],
  );
  return (p) => {
    if (
      top.length !== 6 ||
      top.some((t, index) => Number(t.text) !== index + 1) ||
      left.some((p) => !p)
    )
      return null;
    const col = top
      .slice(1)
      .filter((t, i) => p.x >= (top[i].p.x + t.p.x) / 2).length;
    const row = left
      .slice(1)
      .filter((t, i) => p.y >= (left[i].y + t.y) / 2).length;
    return "ABCD"[row] + (col + 1);
  };
}
function stripTerminals(h) {
  const headings = new Map(
    h.all("[data-terminal-strip]").map((strip) => {
      const lines = [];
      for (const e of strip.children) {
        if (!e.matches("text")) break;
        const b = h.box(e);
        if (h.painted(e) && h.visible(e, [b, { x: b.x + b.w, y: b.y + b.h }]))
          lines.push(e.textContent);
      }
      return [strip, lines.join(" ").split(" — ")[0].trim()];
    }),
  );
  return h.all("[data-strip-terminal]").map((e) => {
    const r = e.querySelector("rect");
    const b = r && h.stroke(r) && h.axisAligned(r) ? h.box(r) : null;
    const rect =
      b?.w >= 4 && b.h >= 4 && h.visible(r, [b, { x: b.x + b.w, y: b.y + b.h }])
        ? b
        : null;
    return {
      key: h.attr(e, "data-strip-terminal"),
      ref: h.attr(e, "data-strip-ref"),
      inventory: h.attr(e, "data-inventory-row"),
      rect,
      texts: h.texts(e),
      deviceHeading: headings.get(e.closest("[data-terminal-strip]")),
      chunk: h.chunk(e),
      sheet: h.sheet,
    };
  });
}
function stripShapes(h, terminalsFromInk) {
  const { all, attr, painted, box, texts, path, chunk, sheet } = h;
  const terminals = terminalsFromInk(h);
  const bridges = all("[data-strip-jumper] path").map((e) => {
    const p = e.closest("[data-strip-jumper]");
    return {
      uid: attr(p, "data-strip-jumper"),
      end: attr(p, "data-strip-jumper-end"),
      at: attr(p, "data-strip-at"),
      peer: attr(p, "data-strip-peer"),
      text: texts(p)
        .filter((t) => t.painted)
        .map((t) => t.text)
        .join(" "),
      ...path(e),
      sheet,
      chunk: chunk(e),
    };
  });
  const incidences = all("[data-strip-incidence]").flatMap((e) =>
    [...e.querySelectorAll("path,line,polyline")].map((p) => ({
      id: attr(e, "data-strip-incidence"),
      at: attr(e, "data-strip-at"),
      text: texts(e)
        .filter((t) => t.painted)
        .map((t) => t.text)
        .join(" "),
      visibleText: texts(e)
        .filter((t) => t.inkVisible)
        .map((t) => t.text)
        .join(" "),
      ...path(p),
      sheet,
    })),
  );
  const rectangles = new Set(
    all("[data-strip-terminal]").map((e) => e.querySelector("rect")),
  );
  const unclaimed = all(
    '[data-sheet-kind="terminal-strip"] :is(rect,path,line,polyline,polygon,circle,ellipse),[data-strip-accessory]',
  )
    .filter(
      (e) =>
        painted(e) &&
        !rectangles.has(e) &&
        !(
          e.matches("path,line,polyline") &&
          e.closest("[data-strip-jumper],[data-strip-incidence]")
        ),
    )
    .map((e) => ({ tag: e.tagName, bbox: box(e), sheet }));
  return { terminals, bridges, incidences, unclaimed };
}
function stripDetails(h) {
  const { root, all, attr, painted, texts, box, chunk, sheet } = h;
  const value = (e) =>
    texts(e)
      .filter((t) => t.painted)
      .map((t) => t.text)
      .join(" ");
  return {
    viewKeys: all("[data-navigation-view]").map((e) =>
      attr(e, "data-navigation-view"),
    ),
    rows: all("[data-report-row]").map((e) => ({
      key: attr(e, "data-report-row"),
      ref: attr(e, "data-strip-ref"),
    })),
    references: all("[data-strip-row]")
      .filter(painted)
      .map((e) => ({ key: attr(e, "data-strip-row"), text: e.textContent })),
    headings: all("[data-terminal-strip]").flatMap((e) =>
      texts(e).map((t) => ({
        uid: attr(e, "data-terminal-strip"),
        text: t.text,
        sheet,
      })),
    ),
    notes: texts(root)
      .filter((t) => t.painted)
      .map((t) => t.text),
    texts: all('[data-sheet-kind="terminal-strip"]').flatMap(texts),
    continuations: all("[data-strip-continuation]").map((e) => ({
      direction: attr(e, "data-strip-continuation"),
      at: attr(e, "data-strip-at"),
      target: attr(e, "data-strip-target"),
      text: value(e),
      painted: painted(e),
      bbox: box(e),
      chunk: chunk(e),
      sheet,
    })),
    bridgeLabels: all(
      "[data-strip-bridge-label],[data-strip-jumper][data-strip-jumper-end]",
    ).map((e) => ({
      uid: attr(e, "data-strip-bridge-label") ?? attr(e, "data-strip-jumper"),
      at: attr(e, "data-strip-at"),
      text: value(e),
      visibleText: texts(e)
        .filter((t) => t.inkVisible)
        .map((t) => t.text)
        .join(" "),
      sheet,
    })),
  };
}
export const stripInkScript = `(()=>{
  const h=(${stripInkHelpers})(${straightPath},(${geometry.shapeClips}),(${stripPaint}),(${stripPath}));
  const zone=(${stripGrid})(h);
  const shapes=(${stripShapes})(h,(${stripTerminals}));
  for(const t of shapes.terminals)
    t.zone=t.rect ? zone({x:t.rect.x+t.rect.w/2,y:t.rect.y+t.rect.h/2}) : null;
  return {...shapes,...(${stripDetails})(h)};
})()`;
