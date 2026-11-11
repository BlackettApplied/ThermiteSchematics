// Browser-free classification of measured geometry and exported source roles.
import { inside } from "./checks.mjs";
const normal = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
export function classifyTextGeometry(g, ir = {}) {
  const texts = [...g.texts, ...(g.hiddenTexts ?? [])];
  const frame = g.frame,
    header = g.headerRule;
  const candidates = texts.filter(
    (t) => t.sheetText && !t.continuation && t.painted !== false,
  );
  const rows = new Map();
  for (const t of candidates.filter((t) => /^[1-6]$/.test(t.text))) {
    const key = t.anchor.y.toFixed(3);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(t);
  }
  const zoneNumbers = [...rows.values()].find(
    (row) =>
      row.length === 6 &&
      row
        .slice()
        .sort((a, b) => a.anchor.x - b.anchor.x)
        .map((t) => t.text)
        .join("") === "123456" &&
      header &&
      row.every((t) => frame && inside(t.bbox, frame) && t.bbox.y >= header.y),
  );
  const topBand =
    frame && header && zoneNumbers
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
  const zoneLetters = candidates.filter(
    (t) =>
      /^[A-D]$/.test(t.text) &&
      frame &&
      inside(t.bbox, frame) &&
      zoneNumbers &&
      t.bbox.x + t.bbox.w < Math.min(...zoneNumbers.map((q) => q.bbox.x)),
  );
  const letterGroups = new Map();
  for (const t of zoneLetters) {
    const x = t.anchor.x.toFixed(3);
    if (!letterGroups.has(x)) letterGroups.set(x, []);
    letterGroups.get(x).push(t);
  }
  const letters =
    [...letterGroups.values()].find(
      (col) =>
        col.length === 4 &&
        col
          .slice()
          .sort((a, b) => a.anchor.y - b.anchor.y)
          .map((t) => t.text)
          .join("") === "ABCD",
    ) ?? [];
  const zoneIds = new Set(
    [...(zoneNumbers ?? []), ...letters].map((t) => t.element),
  );
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
      t.tagField == null &&
      role &&
      primary &&
      normal(t.text) !== primary &&
      ((role.boundary && normal(t.text) === "BOUNDARY") || role.related)
    );
  }
  g.zoneStrip = topBand;
  return g;
}
