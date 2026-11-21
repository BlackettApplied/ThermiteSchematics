// Browser-only measurement helpers; dependencies arrive explicitly from the caller.
export function reportRegionVisible(c) {
  const { rect, bounds, visible, shapeClips } = c;
  try {
    const b = bounds(rect),
      v = visible(rect),
      clips = shapeClips(rect);
    return (
      !!v &&
      clips !== null &&
      [v.clip, ...(clips ?? [])].every(
        (c) =>
          b.x >= c.x - 0.001 &&
          b.y >= c.y - 0.001 &&
          b.x + b.w <= c.x + c.w + 0.001 &&
          b.y + b.h <= c.y + c.h + 0.001,
      )
    );
  } catch {
    return false;
  }
}

export function sheetFields1(c) {
  const {
    all,
    connectors,
    frame,
    headerRule,
    hiddenTexts,
    ids,
    omittedNetLabels,
    relationLandings,
    revisionCell,
    root,
    terminals,
    texts,
    titleBlock,
    vb,
    wireTerminals,
  } = c;
  return {
    width: vb.width,
    height: vb.height,
    navigationViews: [
      ...new Set(
        all
          .filter((e) => e.hasAttribute("data-navigation-view"))
          .map((e) => e.getAttribute("data-navigation-view")),
      ),
    ],
    viewFormat: root.getAttribute("data-view-format"),
    viewFamily: root.getAttribute("data-view-family"),
    texts,
    omittedNetLabels: omittedNetLabels(),
    hiddenTexts,
    frame,
    titleBlock,
    revisionCell,
    headerRule,
    connectors,
    terminals,
    wireTerminals,
    relationLandings,
    communicationRoutes: all
      .filter((e) => e.hasAttribute("data-communication-link"))
      .map((e) => ({
        link: e.getAttribute("data-communication-link"),
        appearanceScope: ids.get(e.closest("svg")),
        source: e.getAttribute("data-layout-source-port"),
        target: e.getAttribute("data-layout-target-port"),
      })),
  };
}

export function sheetFields2(c) {
  const {
    all,
    attr,
    deviceReferences,
    devices,
    ids,
    root,
    shapes,
    utilisationErrors,
    visible,
  } = c;
  return {
    communicationCaptions: all
      .filter(
        (e) =>
          e.hasAttribute("data-layout-port") &&
          e.querySelector("circle") &&
          e.closest("[data-device-uid]") &&
          visible(e),
      )
      .map((e) => ({
        layoutPort: e.getAttribute("data-layout-port"),
        appearanceScope: ids.get(e.closest("svg")),
        deviceUid: attr(e, "data-device-uid"),
        elements: Array.from(e.querySelectorAll("text")).map((t) => ids.get(t)),
      })),
    shapes,
    ...(utilisationErrors.length ? { utilisationErrors } : {}),
    devices,
    deviceReferences,
    deviceLegendEntries: Array.from(
      root.querySelectorAll(
        "[data-device-legend-entry],[data-device-reference-entry]",
      ),
    ).map((e) => ({
      deviceUid: e.getAttribute("data-tag-owner-uid"),
      key: e.getAttribute("data-tag-key"),
      kind: e.getAttribute("data-tag-kind"),
      container: ids.get(e),
    })),
    deviceReferenceEntries: Array.from(
      root.querySelectorAll("[data-device-reference-entry]"),
    ).map((e) => ({
      deviceUid: e.getAttribute("data-tag-owner-uid"),
      key: e.getAttribute("data-tag-key"),
      kind: e.getAttribute("data-tag-kind"),
      container: ids.get(e),
    })),
    catalogs: [
      ...(root.querySelector("[data-symbol-id]") ? ["ais"] : []),
      ...(root.querySelector("[data-circuit-mark]") ? ["circuit"] : []),
    ],
  };
}

export function sheetFields3(c) {
  const {
    ancestors,
    attr,
    bounds,
    ids,
    root,
    shapeClips,
    stackedReportCells,
    tableRectangles,
    visible,
    h,
  } = c;
  return {
    reportCells: Array.from(root.querySelectorAll("[data-report-row]"))
      .flatMap((row) => {
        const stacked = stackedReportCells(row);
        return stacked
          ? stacked.map((r, columnIndex) => ({
              column: row,
              rect: r.e,
              columnIndex,
            }))
          : Array.from(row.querySelectorAll("[data-report-column]")).map(
              (column) => {
                const columnIndex =
                  Number(column.getAttribute("data-report-column")) - 1;
                return {
                  column,
                  columnIndex,
                  rect: tableRectangles(column.parentElement)[columnIndex],
                };
              },
            );
      })
      .map(({ column, columnIndex, rect }) => {
        if (!rect)
          throw new h.IdentifierMeasurementError(
            "Identifier measurement: report cell rectangle missing",
          );
        const { documentKind } = c.documentIdentity(column);
        return {
          row: attr(column, "data-report-row"),
          documentId: attr(column, "data-document-id"),
          documentOrigin: attr(column, "data-document-origin"),
          primitiveIds: [column, ...ancestors(column)]
            .map((n) => n.id)
            .filter(Boolean),
          reportRowScope: ids.get(column.closest("[data-report-row]")),
          columnIndex,
          element: ids.get(column),
          bbox: bounds(rect),
          regionVisible: h.reportRegionVisible({
            rect,
            bounds,
            visible,
            shapeClips,
          }),
          ...(documentKind === undefined ? {} : { documentKind }),
        };
      }),
  };
}

export function sheetFields4(c) {
  const { root } = c;
  return {
    reportRows: Array.from(root.querySelectorAll("[data-report-row]")).map(
      (e) => e.getAttribute("data-report-row"),
    ),
  };
}

export function deviceReferenceRows(c) {
  const { texts } = c;
  const deviceReferences = texts
    .filter((t) => t.tagTerminalDeclared && t.painted)
    .map((t) => ({
      deviceUid: t.tagOwnerUid,
      terminalKey: t.tagTerminal?.terminalKey,
      tagBlock: t.tagBlock,
      tagContainer: t.tagContainer,
      tagRef: t.tagRef,
      bbox: t.bbox,
      element: t.element,
    }))
    .filter(
      (r, i, all) =>
        all.findIndex(
          (s) =>
            s.deviceUid === r.deviceUid &&
            s.tagBlock === r.tagBlock &&
            s.tagContainer === r.tagContainer,
        ) === i,
    );
  const utilisationErrors = [];
  const hasRepeatLabels = texts.some((t) =>
    /Also shown|Repeat of/.test(t.text),
  );
  Object.assign(c, { deviceReferences, utilisationErrors, hasRepeatLabels });
}

export function relationLandingRows(c) {
  const { all, identity, ownedLandings, root, visible } = c;
  const relationLandings = all
    .filter(
      (e) =>
        e.matches("path") &&
        e.closest(
          "[data-loop-conductor],[data-communication-link],[data-connector-assembly],[data-cable-assembly][data-layout-source-port]",
        ) &&
        getComputedStyle(e).stroke !== "rgb(255, 255, 255)",
    )
    .flatMap((e) => {
      const v = visible(e);
      return v
        ? [{ ...identity(e), ownedLandings: ownedLandings(e, [], v.clip) }]
        : [];
    });
  const devices = Array.from(root.querySelectorAll("[data-device-uid]"))
    .filter(
      (e) =>
        !e.closest('[data-tag-kind="reference"],.off-view-annotation') &&
        (e.matches(".device-group") ||
          e.hasAttribute("data-layout-width") ||
          (e.tagName.toLowerCase() === "g" &&
            !e.hasAttribute("data-symbol-id") &&
            Array.from(e.children).some(
              (c) => c.tagName.toLowerCase() === "rect",
            ))),
    )
    .flatMap((e) => {
      const v = visible(e);
      return v
        ? [{ ...identity(e), bbox: v.b, text: e.textContent.trim() }]
        : [];
    });
  Object.assign(c, { relationLandings, devices });
}
