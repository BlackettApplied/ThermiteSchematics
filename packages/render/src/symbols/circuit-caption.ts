import { symbolProfile } from "./profiles.js";
import { printableCaption } from "./printable-policy.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { printableTextMetrics } from "./printable-font.js";
export type CaptionPoint = { x: number; y: number };
export type CaptionBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export type CaptionSegment = readonly [CaptionPoint, CaptionPoint];
export function captionTouches(
  box: CaptionBox,
  [a, b]: CaptionSegment,
  inset = 0.3,
): boolean {
  let lo = 0,
    hi = 1;
  for (const [p, q] of [
    [-(b.x - a.x), a.x - box.left + inset],
    [b.x - a.x, box.right + inset - a.x],
    [-(b.y - a.y), a.y - box.top + inset],
    [b.y - a.y, box.bottom + inset - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return true;
}
const gap = (a: CaptionBox, b: CaptionBox) =>
  Math.hypot(
    Math.max(a.left - b.right, b.left - a.right, 0),
    Math.max(a.top - b.bottom, b.top - a.bottom, 0),
  );
/** Search inside the existing device box; reject an ambiguous or colliding caption.
 * Catalog segments include stroke clearance. Text uses actual bundled ink. */
export function circuitCaptionPosition(
  value: string,
  owner: CaptionPoint & { bounds: CaptionBox },
  others: readonly CaptionBox[],
  segments: readonly CaptionSegment[],
  occupied: readonly CaptionBox[],
  width: number,
  height: number,
) {
  const m = printableTextMetrics(value, 2.3),
    w = m.right - m.left,
    h = m.top - m.bottom,
    candidates: { x: number; y: number; box: CaptionBox; score: number }[] = [];
  for (let dy = -6; dy <= 6; dy += 0.5)
    for (let dx = -6; dx <= 6; dx += 0.5) {
      const left = owner.x + dx - w / 2,
        top = owner.y + dy - h / 2,
        box = { left, right: left + w, top, bottom: top + h };
      if (
        left < 0.5 ||
        box.right > width - 0.5 ||
        top < 0.5 ||
        box.bottom > height - 0.5
      )
        continue;
      const own = gap(box, owner.bounds);
      if (others.some((b) => gap(box, b) <= own)) continue;
      if (segments.some((s) => captionTouches(box, s, 0.3 + 0.4 / 3))) continue;
      if (occupied.some((b) => gap(box, b) < 0.3)) continue;
      candidates.push({
        x: left - m.left,
        y: top + m.top,
        box,
        score: Math.hypot(dx, dy),
      });
    }
  candidates.sort(
    (a, b) =>
      a.score - b.score || a.box.top - b.box.top || a.box.left - b.box.left,
  );
  return candidates[0];
}

interface CircuitContactCaption {
  type: import("@thermite/compiler").IrDeviceType;
  fn: import("@thermite/compiler").IrFunction;
  device: import("@thermite/compiler").IrDevice;
  mark: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centers: readonly { key: string; bounds: CaptionBox }[];
  segments: readonly CaptionSegment[];
  occupied: CaptionBox[];
  diagnostics: import("@thermite/schema").Diagnostic[];
  text: (x: number, y: number, value: string, size: number) => string;
}
export function emitCircuitContactCaption(c: CircuitContactCaption): string {
  if (
    symbolProfile(c.type) !== "thermite:breaker" ||
    !["contact-no", "contact-nc"].includes(c.mark)
  )
    return "";
  const caption = printableCaption({
    kind: "function",
    type: c.type,
    fn: c.fn,
    mark: `circuit:${c.mark}`,
  });
  const owner = c.centers.find((p) => p.key === c.fn.id.functionKey);
  if (!owner)
    throw Error(`Missing contact caption owner ${c.fn.id.functionKey}`);
  const p = circuitCaptionPosition(
    caption,
    { x: c.x, y: c.y, bounds: owner.bounds },
    c.centers.filter((p) => p.key !== c.fn.id.functionKey).map((p) => p.bounds),
    c.segments,
    c.occupied,
    c.width,
    c.height,
  );
  if (p) {
    c.occupied.push(p.box);
    return `<g data-contact-caption="${attr(c.fn.id.functionKey)}">${c.text(p.x, p.y, caption, 2.3)}</g>`;
  }
  c.diagnostics.push({
    code: "W907",
    severity: "warning",
    ...c.device.source,
    message: `Omitted redundant ${caption} caption for ${c.device.designation}.${c.fn.id.functionKey}: no clear owner-nearest position fits. The contact mark still shows its authored normal state.`,
  });
  return "";
}
