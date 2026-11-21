import { identifyZones } from "./zones.mjs";
import { shapeGeometry, shapeVisibility } from "./shape-geometry.mjs";
import { shapeRaster } from "./shape-raster.mjs";
import { bottomDigitClearance } from "./shape-bottom.mjs";
const grouped = (pairs) => {
  const m = new Map();
  for (const { a, b } of pairs) {
    if (!m.has(a.id)) m.set(a.id, { a, bs: [] });
    m.get(a.id).bs.push(b);
  }
  return [...m.values()];
};

export async function extendedInk(
  page,
  svg,
  { artifactDir, tag = "sheet", onlyBottom = false } = {},
) {
  await page.setContent(
    "<style>body{margin:0}</style>" + svg.replace(/<\?xml[^>]*>/, ""),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(identifyZones);
  const p = await page.evaluate(`(${shapeGeometry})(${shapeVisibility})`),
    raster = shapeRaster(page, p, { artifactDir, tag });
  const { pairHit, restore } = raster;
  const zoneShapeHits = [],
    labelWireHits = [];
  for (const pair of grouped(onlyBottom ? [] : p.zoneShape)) {
    const h = await pairHit(pair, "zone-shape");
    if (h) zoneShapeHits.push(h);
  }
  for (const pair of grouped(onlyBottom ? [] : p.labelWire)) {
    const h = await pairHit(pair, "label-wire");
    if (h) labelWireHits.push(h);
  }
  const bottom = await bottomDigitClearance(p, raster, { artifactDir, tag });
  await restore();
  return {
    zoneShapeCandidates: p.zoneShape.length,
    labelWireCandidates: p.labelWire.length,
    zoneShapeCollisions: zoneShapeHits,
    labelWireCollisions: labelWireHits,
    bottomRuleClearanceMm: bottom.bottomRuleClearanceMm,
    rawBottomRuleClearanceMm: bottom.rawBottomRuleClearanceMm,
    bottomMaskOutsideBBoxPixels: bottom.bottomMaskOutsideBBoxPixels,
    labels: p.labels,
    bottomDigits: bottom.bottomDigits,
  };
}
