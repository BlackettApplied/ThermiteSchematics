// Browser-free classification of measured geometry and exported source roles.
import { inside } from "./checks.mjs";
import { classifyReferenceTags } from "./device-tags.mjs";
import { printedZones } from "./printed-zones.mjs";
const normal = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
export function classifyTextGeometry(g, ir = {}) {
  classifyReferenceTags(g, ir);
  const texts = [...g.texts, ...(g.hiddenTexts ?? [])];
  const frame = g.frame,
    header = g.headerRule;
  const { numbers: zoneNumbers, letters } = printedZones(g);
  const topBand =
    frame && header && zoneNumbers.length
      ? {
          x: frame.x,
          y: header.y,
          w: frame.w,
          h:
            Math.max(...zoneNumbers.map((t) => t.bbox.y + t.bbox.h)) - header.y,
        }
      : null;
  const headerBand =
    frame && header
      ? { x: frame.x, y: frame.y, w: frame.w, h: header.y - frame.y }
      : null;
  const zoneIds = new Set([...zoneNumbers, ...letters].map((t) => t.element));
  const devices = new Map(
    (ir.devices ?? []).map((d) => [d.uid, d.designation]),
  );
  for (const t of texts) {
    const unowned =
      !t.nested && !t.deviceUid && !t.wire && !t.row && !t.continuation;
    t.furniture = !!(
      t.tagField == null &&
      unowned &&
      (zoneIds.has(t.element) ||
        [headerBand, topBand, g.titleBlock].some((b) => b && inside(t.bbox, b)))
    );
    const role = t.circuitText;
    const primary = normal(
      devices.get(t.deviceUid) ?? role?.primaryDesignation,
    );
    t.secondaryReference = !!(
      t.nativeReference ||
      (t.tagField == null &&
        role &&
        primary &&
        normal(t.text) !== primary &&
        ((role.boundary && normal(t.text) === "BOUNDARY") || role.related))
    );
  }
  g.zoneStrip = topBand;
  return g;
}
