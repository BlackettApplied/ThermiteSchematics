// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function textFontMetrics(c) {
  const { continuationOwner, e, textCanvas, v } = c;
  const css = getComputedStyle(e),
    m = e.getScreenCTM();
  let hiddenContinuation = false;
  if (continuationOwner(e)) {
    for (let node = e; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (Number(style.opacity) === 0 || style.visibility === "collapse")
        hiddenContinuation = true;
      if (style.maskImage && style.maskImage !== "none")
        throw Error("Continuation measurement: unsupported mask");
    }
    if (
      (css.fill === "none" ||
        css.fill === "rgba(0, 0, 0, 0)" ||
        Number(css.fillOpacity) === 0) &&
      (css.stroke === "none" || Number(css.strokeOpacity) === 0)
    )
      hiddenContinuation = true;
  }
  const emBbox = v.b;
  textCanvas.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  textCanvas.textAlign = "left";
  textCanvas.textBaseline = "alphabetic";
  let spaceElement = e;
  while (spaceElement && !spaceElement.hasAttribute("xml:space"))
    spaceElement = spaceElement.parentElement;
  const preserve =
    /^(pre|pre-wrap|break-spaces)$/.test(css.whiteSpace) ||
    (!css.whiteSpace && spaceElement?.getAttribute("xml:space") === "preserve");
  const renderedString = preserve
    ? e.textContent.replace(/\r\n?/g, "\n")
    : e.textContent.replace(/[ \t\r\n]+/g, " ").trim();
  const metrics = textCanvas.measureText(renderedString),
    cap = textCanvas.measureText("H");
  const naturalAdvance = metrics.width,
    actualAdvance = e.getComputedTextLength();
  const lengthScale = naturalAdvance > 0 ? actualAdvance / naturalAdvance : 1;
  Object.assign(c, {
    css,
    m,
    hiddenContinuation,
    emBbox,
    spaceElement,
    preserve,
    renderedString,
    metrics,
    cap,
    naturalAdvance,
    actualAdvance,
    lengthScale,
  });
}

export function textNativeBaseline(c) {
  const { actualAdvance, e } = c;
  const start = e.getStartPositionOfChar(0);
  const textRoot = e.closest("text"),
    alphabetic = textRoot.cloneNode(true);
  const part =
    e === textRoot
      ? alphabetic
      : [...alphabetic.querySelectorAll("tspan")][
          [...textRoot.querySelectorAll("tspan")].indexOf(e)
        ];
  alphabetic.style.setProperty("dominant-baseline", "alphabetic", "important");
  alphabetic.style.setProperty("alignment-baseline", "alphabetic", "important");
  part.style.setProperty("dominant-baseline", "alphabetic", "important");
  part.style.setProperty("alignment-baseline", "alphabetic", "important");
  textRoot.parentElement.appendChild(alphabetic);
  const baselineShift = e.getBBox().y - part.getBBox().y;
  alphabetic.removeAttribute("textLength");
  for (const span of alphabetic.querySelectorAll("[textLength]"))
    span.removeAttribute("textLength");
  const nativeSvgAdvance =
    e.closest("text[textLength],tspan[textLength]") ||
    e.querySelector("[textLength]")
      ? part.getComputedTextLength()
      : actualAdvance;
  alphabetic.remove();
  Object.assign(c, {
    start,
    textRoot,
    alphabetic,
    part,
    baselineShift,
    nativeSvgAdvance,
  });
}

export function textInkGeometry(c) {
  const {
    baselineShift,
    bounds,
    e,
    intersect,
    lengthScale,
    m,
    metrics,
    start,
    sx,
    sy,
    textCanvas,
    textPaintGeometry,
    v,
  } = c;
  const { hiddenContinuation } = c;
  const local = {
    x: start.x - metrics.actualBoundingBoxLeft * lengthScale,
    y: start.y + baselineShift - metrics.actualBoundingBoxAscent,
    width:
      (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) *
      lengthScale,
    height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
  };
  textPaintGeometry.set(e, {
    local,
    font: textCanvas.font,
    width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
    height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
    left: metrics.actualBoundingBoxLeft,
    ascent: metrics.actualBoundingBoxAscent,
  });
  v.b = bounds(e, local);
  const intersection = intersect(v.b, v.clip);
  v.painted =
    !hiddenContinuation && intersection.w > 0.001 && intersection.h > 0.001;
  const scaleX = Math.hypot(m.a * sx, m.b * sy),
    scaleY = Math.hypot(m.c * sx, m.d * sy),
    // Screen CSS pixels are isotropic. Separate viewport-to-mm inverses
    // contain root layout rounding and must not invent glyph distortion.
    paintedAxisRatio = Math.hypot(m.a, m.b) / Math.hypot(m.c, m.d);
  const anchor = new DOMPoint(
    e.x.baseVal[0]?.value ?? start.x,
    e.y.baseVal[0]?.value ?? start.y,
  ).matrixTransform(m);
  let cell,
    plate,
    columnIndex,
    knockout = false;
  const reportColumn = e.closest("[data-report-column]");
  Object.assign(c, {
    local,
    intersection,
    scaleX,
    scaleY,
    paintedAxisRatio,
    anchor,
    cell,
    plate,
    columnIndex,
    knockout,
    reportColumn,
  });
}

export function textReportCell(c) {
  const { bounds, reportColumn, reportTextCell, tableRectangles, v } = c;
  let { cell, columnIndex } = c;
  if (reportColumn) {
    const stacked = reportTextCell(reportColumn, v.b);
    columnIndex =
      stacked?.index ??
      Number(reportColumn.getAttribute("data-report-column")) - 1;
    const rectangle =
      stacked?.e ?? tableRectangles(reportColumn.parentElement)[columnIndex];
    if (!rectangle)
      throw new c.h.IdentifierMeasurementError(
        "Report column has no independently measurable SVG cell rectangle",
      );
    cell = bounds(rectangle);
  }
  Object.assign(c, { columnIndex, cell });
}

export function textBackground(c) {
  const { bounds, e, ids, orders } = c;
  let { cell, columnIndex, knockout, plate } = c;
  for (
    let prev = e.previousElementSibling;
    prev;
    prev = prev.previousElementSibling
  ) {
    if (prev.tagName.toLowerCase() === "rect") {
      const row = e.closest("[data-report-row]");
      if (row)
        columnIndex = Array.from(row.children)
          .filter((r) => r.tagName.toLowerCase() === "rect")
          .indexOf(prev);
      if (
        prev.classList.contains("label-background") ||
        e.closest("[data-report-row]") ||
        prev.getAttribute("stroke") === "#9ba6b4"
      )
        cell ??= bounds(prev);
      if (
        (prev.classList.contains("label-background") ||
          e.closest("[data-wire-label]")) &&
        ["white", "rgb(255, 255, 255)"].includes(getComputedStyle(prev).fill)
      ) {
        knockout = true;
        plate = {
          element: ids.get(prev),
          order: orders.get(prev),
          bbox: bounds(prev),
        };
      }
      break;
    }
    if (!["text", "tspan"].includes(prev.tagName.toLowerCase())) break;
  }
  let clip;
  const ref = e.getAttribute("clip-path")?.match(/url\(#(.+)\)/)?.[1];
  Object.assign(c, { clip, ref, columnIndex, cell, knockout, plate });
}
