import type { Draft, Link } from "./types.js";
import type { FramePlan } from "./frame-plan.js";
import { labelMetrics } from "./label-text.js";
import { continuationHeader, STROKE_GAP } from "./continuation-label.js";
import { required } from "../presentation/util.js";
import { n } from "./svg.js";

/** Read final glyphs at serialized SVG coordinates, never reserved 99.D6 ink. */
export function continuationInk(link: Link, serialized = false) {
  const q = serialized ? (v: number) => Number(n(v)) : (v: number) => v;
  const label = required(link.label, "Missing continuation label");
  return label.rows.map((r, i) => {
    const value =
      i === 0
        ? continuationHeader(link) +
          (label.single ? ` / ${link.conductor}` : "")
        : r.text;
    const m = labelMetrics(value);
    return {
      x: q(r.x) + m.left,
      y: q(r.y) - m.top,
      w: m.right - m.left,
      h: m.top - m.bottom,
    };
  });
}
export function cutGap(
  link: Link,
  box: { x: number; y: number; w: number; h: number },
): number {
  const x = Number(n(link.x)),
    y = Number(n(link.y));
  return link.side === "right"
    ? box.x - x
    : link.side === "left"
      ? x - box.x - box.w
      : link.side === "top"
        ? y - box.y - box.h
        : box.y - y;
}
function translateBank(links: readonly Link[], delta: number): void {
  for (const link of links) {
    const label = required(link.label, "Missing continuation label");
    const axis = link.side === "left" || link.side === "right" ? "x" : "y";
    label.bounds[axis] += delta;
    for (const row of label.rows) {
      row[axis] += delta;
      row.ink[axis] += delta;
    }
  }
}

/** Ordinary packing happens first. A fitting bank is an exact no-op. The only
 * frame translation repairs a <=0.001 mm serialization shortfall, rigidly and
 * outward. Larger failures return to legal cut/bank selection or refuse. */
export function admitFinalBanks(draft: Draft, plan: FramePlan): void {
  const banks = new Map<string, Link[]>();
  for (const link of draft.links) {
    if (!link.toZone || !link.label)
      throw Error(`Unresolved final continuation ${link.id}`);
    const key = `${link.side}:${n(link.side === "left" || link.side === "right" ? link.x : link.y)}`;
    banks.set(key, [...(banks.get(key) ?? []), link]);
  }
  for (const [key, links] of banks) {
    const gap = Math.min(
      ...links.flatMap((l) =>
        continuationInk(l, true).map((b) => cutGap(l, b)),
      ),
    );
    if (gap < STROKE_GAP - 1e-8) {
      const correction = Math.ceil((STROKE_GAP - gap) * 1000 - 1e-8) / 1000;
      if (correction > 0.001)
        throw Error(
          `Continuation bank ${key} cannot preserve ${STROKE_GAP} mm cut-to-ink clearance; use another legal cut or larger paper.`,
        );
      const first = required(links[0], "Missing bank member");
      translateBank(
        links,
        (first.side === "left" || first.side === "top" ? -1 : 1) * correction,
      );
    }
    for (const link of links)
      for (const box of continuationInk(link, true)) {
        const service = plan.service;
        const short = Math.max(
          service.x - box.x,
          box.x + box.w - service.x - service.w,
          service.y - box.y,
          box.y + box.h - service.y - service.h,
        );
        if (cutGap(link, box) < STROKE_GAP - 1e-8 || short > 0.001)
          throw Error(
            `Final continuation ${link.id} (${link.conductor}) at ${key} is short by ${Math.max(short, STROKE_GAP - cutGap(link, box)).toFixed(3)} mm outside the compact service area. Use another legal cut or larger paper.`,
          );
      }
  }
}
