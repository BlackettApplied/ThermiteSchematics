// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function textCanvas(c) {
  const textCanvas = document.createElement("canvas").getContext("2d");
  const continuationErrors = new Map();
  Object.assign(c, { textCanvas, continuationErrors });
}

export const tableRectangles = ({ parent }) =>
  Array.from(parent.children).filter(
    (e) =>
      e.tagName.toLowerCase() === "rect" &&
      e.getAttribute("stroke") === "#9ba6b4",
  );

export const close = (a, { b }) => Math.abs(a - b) <= 0.02;

export const reportContains = (a, { b }) =>
  b.x >= a.x - 0.02 &&
  b.y >= a.y - 0.02 &&
  b.x + b.w <= a.x + a.w + 0.02 &&
  b.y + b.h <= a.y + a.h + 0.02;

export function stackedCache(c) {
  const stackedCache = new WeakMap();
  Object.assign(c, { stackedCache });
}

export const stackedTopology = ({
  parent,
  bounds,
  close,
  tableRectangles,
  visible,
}) => {
  const rects = tableRectangles(parent).map((e) => ({ e, b: bounds(e) }));
  if (
    !rects.length ||
    rects.every(({ b }) => close(b.y, rects[0].b.y) && close(b.h, rects[0].b.h))
  )
    return;
  if (rects.length !== 7)
    throw Error("Stacked report: missing painted sub-cell");
  const slots = [];
  for (const r of rects.sort((a, b) => a.b.x - b.b.x || a.b.y - b.b.y)) {
    let slot = slots.find((v) => close(v[0].b.x, r.b.x));
    if (!slot) slots.push((slot = []));
    slot.push(r);
  }
  if (
    slots.length !== 5 ||
    slots.some((v, i) => v.length !== (i === 1 || i === 2 ? 2 : 1))
  )
    throw Error("Stacked report: invalid painted partition");
  const top = slots[0][0].b.y,
    bottom = top + slots[0][0].b.h;
  for (const [i, slot] of slots.entries()) {
    if (
      !close(slot[0].b.y, top) ||
      !close(slot.at(-1).b.y + slot.at(-1).b.h, bottom) ||
      slot.some(
        (r) => !close(r.b.w, slot[0].b.w) || r.b.h <= 0 || !visible(r.e),
      ) ||
      (slot.length === 2 && !close(slot[0].b.y + slot[0].b.h, slot[1].b.y)) ||
      (i > 0 && !close(slots[i - 1][0].b.x + slots[i - 1][0].b.w, slot[0].b.x))
    )
      throw Error("Stacked report: invalid painted sub-cell boundary");
  }
  return [...slots.map((v) => v[0]), slots[1][1], slots[2][1]];
};

export const reportTextPainted = ({ e, visible }) => {
  let alpha = Number(getComputedStyle(e).fillOpacity);
  for (let p = e; p; p = p.parentElement)
    alpha *= Number(getComputedStyle(p).opacity);
  return alpha >= 0.2 && getComputedStyle(e).fill !== "none" && !!visible(e);
};

export function measuredTextIndex(c) {
  const measuredReportText = new Map();
  Object.assign(c, { measuredReportText });
}

export const paintedCellText = (
  parent,
  { cell, ids, measuredReportText, reportContains, reportTextPainted },
) =>
  Array.from(parent.querySelectorAll("text"))
    .filter(reportTextPainted)
    .map((t) => measuredReportText.get(ids.get(t)))
    .filter((t) => t?.painted && reportContains(cell.b, t.bbox))
    .map((t) => t.text)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();

export const stackedReportCells = ({
  parent,
  all,
  bounds,
  close,
  paintedCellText,
  stackedCache,
  stackedTopology,
  tableRectangles,
}) => {
  if (stackedCache.has(parent)) return stackedCache.get(parent);
  const cells = stackedTopology(parent);
  if (!cells) {
    stackedCache.set(parent, undefined);
    return;
  }
  const labels = [
    "Conductor / label",
    "End A / first endpoint",
    "End B / second endpoint",
    "Color / size",
    "Assignment",
    "From sheet.zone",
    "To sheet.zone",
  ];
  const row = parent.hasAttribute("data-report-row");
  const candidates = row
    ? all.filter(
        (e) =>
          e.tagName.toLowerCase() === "g" &&
          tableRectangles(e).length === 7 &&
          !e.hasAttribute("data-report-row") &&
          bounds(e).y < cells[0].b.y,
      )
    : [parent];
  const header = candidates
    .map((e) => ({ e, cells: stackedTopology(e) }))
    .filter(
      (h) =>
        h.cells &&
        h.cells.every(
          (r, i) => close(r.b.x, cells[i].b.x) && close(r.b.w, cells[i].b.w),
        ) &&
        h.cells.every((r, i) => paintedCellText(h.e, r) === labels[i]),
    )
    .sort((a, b) => bounds(b.e).y - bounds(a.e).y)[0];
  if (!header)
    throw Error("Stacked report: mismatched painted header sub-cell");
  if (
    row &&
    cells
      .slice(5)
      .some(
        (r) =>
          !/^(?:[0-9]{2,3}\.[A-D][1-6]|not drawn)$/u.test(
            paintedCellText(parent, r),
          ),
      )
  )
    throw Error(
      "Stacked report: location missing or in wrong painted sub-cell",
    );
  stackedCache.set(parent, cells);
  return cells;
};

export const reportTextCell = (
  column,
  { ink, reportContains, stackedTopology },
) => {
  const cells = stackedTopology(column.parentElement);
  if (!cells) return;
  const hits = cells
    .map((r, index) => ({ ...r, index }))
    .filter((r) => reportContains(r.b, ink));
  if (hits.length !== 1)
    throw Error("Stacked report: text outside its painted row sub-cell");
  return hits[0];
};

export function textPaintIndex(c) {
  const textPaintGeometry = new Map();
  Object.assign(c, { textPaintGeometry });
}

export function collectTexts(c) {
  const { root, continuationOwner, continuationErrors } = c;
  const h = c.h;
  const textCandidates = Array.from(root.querySelectorAll("text"))
    .flatMap((e) => {
      if (!continuationOwner(e) || !e.querySelector("tspan")) return [e];
      if (
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      ) {
        continuationErrors.set(
          e,
          "Mixed direct text and positioned spans unsupported",
        );
        return [e];
      }
      const spans = [...e.querySelectorAll("tspan")];
      if (
        spans.some(
          (n) =>
            n.children.length &&
            [...n.childNodes].some(
              (q) => q.nodeType === 3 && q.textContent.trim(),
            ),
        )
      ) {
        continuationErrors.set(e, "Mixed nested span content unsupported");
        return [e];
      }
      return spans.filter((n) => !n.children.length);
    })
    .flatMap((e) => h.textRow({ ...c, e }));
  c.textCandidates = textCandidates;
}

export function indexReportText(c) {
  const {
    bounds,
    measuredReportText,
    root,
    stackedReportCells,
    textCandidates,
  } = c;
  for (const t of textCandidates) measuredReportText.set(t.element, t);
  for (const parent of new Set(
    Array.from(root.querySelectorAll("[data-report-column]")).map(
      (c) => c.parentElement,
    ),
  ))
    stackedReportCells(parent);
  const texts = textCandidates.filter((t) => t.painted);
  const hiddenTexts = textCandidates.filter((t) => !t.painted);
  const frameElement = [...root.children].find(
    (e) =>
      e.tagName.toLowerCase() === "rect" &&
      e.getAttribute("fill") === "none" &&
      getComputedStyle(e).stroke !== "none",
  );
  const frame = frameElement ? bounds(frameElement) : null;
  const horizontalRules = [...root.children]
    .filter((e) => e.tagName.toLowerCase() === "path")
    .map((e) => bounds(e))
    .filter((b) => b.h < 0.01 && frame && b.w > frame.w * 0.8)
    .sort((a, b) => a.y - b.y);
  const headerRule = horizontalRules.length > 1 ? horizontalRules[0] : null,
    titleRule = horizontalRules.length > 1 ? horizontalRules.at(-1) : null;
  const titleBlock =
    frame && titleRule
      ? {
          x: frame.x,
          y: titleRule.y,
          w: frame.w,
          h: frame.y + frame.h - titleRule.y,
        }
      : null;
  Object.assign(c, {
    texts,
    hiddenTexts,
    frameElement,
    frame,
    horizontalRules,
    headerRule,
    titleRule,
    titleBlock,
    revisionCell: c.h.measuredRevisionCell(c, titleBlock),
  });
}

export function measuredRevisionCell(c, panel) {
  if (!panel) return undefined;
  // frame-compact.ts lays out four right-side title cells, with revision third.
  const close = (a, b) => Math.abs(a - b) <= 0.001;
  const right = panel.x + panel.w;
  const cells = [...c.root.children]
    .filter((e) => e.matches("rect"))
    .filter((e) => {
      const css = getComputedStyle(e);
      return (
        css.fill === "none" &&
        css.stroke !== "none" &&
        Number(css.opacity) > 0 &&
        parseFloat(css.strokeWidth) > 0 &&
        Number(css.strokeOpacity) > 0 &&
        c.visible(e) &&
        c.h.reportRegionVisible({ ...c, rect: e })
      );
    })
    .map((e) => c.bounds(e))
    .filter(
      (b) =>
        b.w < panel.w / 2 &&
        b.w > 0 &&
        b.h > 0 &&
        close(b.x + b.w, right) &&
        b.y >= panel.y - 0.001,
    )
    .sort((a, b) => a.y - b.y);
  if (cells.length !== 4 || !close(cells[0].y, panel.y)) return undefined;
  const first = cells[0];
  if (
    !cells.every(
      (b, i) =>
        close(b.x, first.x) &&
        close(b.h, first.h) &&
        close(b.y, first.y + i * first.h),
    )
  )
    return undefined;
  return cells[2];
}
