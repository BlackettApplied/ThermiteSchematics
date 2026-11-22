// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function textFields1(c) {
  const {
    anchor,
    baselineShift,
    cap,
    cell,
    columnIndex,
    continuationOwner,
    css,
    e,
    emBbox,
    id,
    ids,
    knockout,
    lengthScale,
    m,
    naturalAdvance,
    orders,
    plate,
    point,
    renderedString,
    reportRuns,
    root,
    scaleX,
    scaleY,
    sourceTextKey,
    tagIdentity,
    v,
  } = c;
  return {
    ...id,
    ...tagIdentity(e),
    ...(e.tagName.toLowerCase() === "tspan"
      ? { locatorElement: ids.get(e.closest("text")) }
      : {}),
    sourceTextKey,
    text: renderedString.trim(),
    renderedString,
    order: orders.get(e),
    baseline: css.dominantBaseline + "/" + css.alignmentBaseline,
    baselineShiftMm: baselineShift * scaleY,
    bbox: v.b,
    emBbox,
    painted: v.painted,
    semantic: e.getAttribute("clip-path")?.match(/-clip-([a-f0-9]+)\)/)?.[1],
    nested: !!e.parentElement.closest("svg:not(body>svg):not(section>svg)"),
    anchor: point(anchor.x, anchor.y),
    capHeightMm: cap.actualBoundingBoxAscent * scaleY,
    naturalAdvanceMm: naturalAdvance * scaleX,
    advanceRatio: (lengthScale * scaleX) / scaleY,
    viewport: v.clip,
    cell,
    columnIndex,
    reportRuns: e.closest("[data-report-row]")
      ? reportRuns(e, renderedString, m)
      : undefined,
    continuationRuns: continuationOwner(e)
      ? reportRuns(e, renderedString, m)
      : undefined,
    knockout,
    plate,
    wireBlock: e.closest("[data-wire-label]")
      ? ids.get(e.closest("[data-wire-label]"))
      : undefined,
    sheetText: e.parentElement === root,
    continuation: !!e.closest('a[href^="#sheet-"]'),
  };
}

export function textFields2(c) {
  const {
    clip,
    continuationErrors,
    continuationInfo,
    continuationOwner,
    css,
    e,
    ids,
    nativeSvgAdvance,
    role,
    scaleX,
    scaleY,
    tagIdentity,
  } = c;
  return {
    continuationError: continuationErrors.get(e.closest("text")),
    continuationAnchor: continuationInfo(e)?.anchor,
    continuationDestination: continuationInfo(e)?.toSheet,
    continuationLink: continuationOwner(e)
      ? ids.get(continuationOwner(e))
      : undefined,
    circuitText:
      !tagIdentity(e).tagField &&
      e.parentElement.hasAttribute("data-circuit-functions")
        ? (() => {
            const owner = e.parentElement;
            const fn = [...owner.children].find((c) =>
              c.hasAttribute("data-function-key"),
            );
            const key = fn?.getAttribute("data-function-key");
            const title = fn?.querySelector("title")?.textContent;
            return {
              boundary:
                JSON.parse(owner.getAttribute("data-circuit-functions"))
                  .length === 0,
              related:
                JSON.parse(owner.getAttribute("data-related-functions") ?? "[]")
                  .length > 0,
              primaryDesignation:
                key && title?.endsWith("/" + key)
                  ? title.slice(0, -key.length - 1)
                  : undefined,
            };
          })()
        : undefined,
    cableScope: ids.get(e.closest("g[data-cable-uid][data-conductor-id]")),
    fontMeasured: "Chromium resolved " + css.fontFamily,
    clip,
    role,
    font: css.fontFamily,
    fontSize: parseFloat(css.fontSize) * scaleY,
    tagNativeAdvanceMm: nativeSvgAdvance * scaleX,
  };
}

export function textFields3(c) {
  const {
    actualAdvance,
    css,
    e,
    lengthScale,
    m,
    nativeSvgAdvance,
    paintedAxisRatio,
    scaleX,
    scaleY,
    sx,
    sy,
    h,
  } = c;
  return {
    tagHorizontalFactor:
      nativeSvgAdvance > 0 && scaleY > 0
        ? (actualAdvance / nativeSvgAdvance) * paintedAxisRatio
        : null,
    capReferenceEmMm: parseFloat(css.fontSize) * scaleX * lengthScale,
    angle: (Math.atan2(m.b, m.a) * 180) / Math.PI,
    advance: e.getComputedTextLength() * Math.hypot(m.a * sx, m.b * sy),
  };
}
