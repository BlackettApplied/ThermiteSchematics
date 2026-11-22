// Initialization stages preserve the original declaration and DOM-operation order.
export function prepareGeometry(c) {
  const h = c.h;
  h.install(c, [
    "ancestors",
    "terminalDescriptionOwner",
    "reportRuns",
    "ownerKey",
    "landingOwners",
    "ownedLandings",
    "omittedNetLabels",
  ]);
  h.sheetCoordinates(c);
  h.install(c, [
    "point",
    "screenBox",
    "bounds",
    "intersect",
    "visible",
    "attr",
  ]);
  h.elementIndex(c);
  h.install(c, ["tagIdentity", "documentIdentity", "identity", "shapeClips"]);
}
export function prepareTerminals(c) {
  const h = c.h;
  h.collectTerminals(c);
  h.collectWireTerminals(c);
  h.captionOwnerIndex(c);
  h.collectCaptionOwners(c);
}
export function prepareText(c) {
  const h = c.h;
  h.install(c, ["continuationOwner", "continuationInfo"]);
  h.textCanvas(c);
  h.install(c, ["tableRectangles", "close", "reportContains"]);
  h.stackedCache(c);
  h.install(c, ["stackedTopology", "reportTextPainted"]);
  h.measuredTextIndex(c);
  h.install(c, ["paintedCellText", "stackedReportCells", "reportTextCell"]);
  h.textPaintIndex(c);
  h.collectTexts(c);
  h.indexReportText(c);
  h.collectConnectors(c);
  h.install(c, ["paintedShapeBounds"]);
}
export function preparePaint(c) {
  const h = c.h;
  h.paintCanvas(c);
  h.install(c, ["colour", "fillPaint"]);
  h.collectOccluders(c);
  h.install(c, ["contains", "occlusion"]);
  h.textPaintRows(c);
  h.collectTagLayers(c);
  h.glyphMaskIndex(c);
  h.install(c, [
    "glyphAt",
    "layerHit",
    "blend",
    "luminance",
    "contrast",
    "tagPaint",
  ]);
  h.classifyTagPaint(c);
  h.classifyReviewPaint(c);
  h.install(c, ["strokeInk"]);
  h.deviceReferenceRows(c);
}
