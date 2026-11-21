import { clippedSegment, strokeMetadata } from "./painted-ink.js";
import type { Page } from "playwright-core";
import {
  svgOutlineGeometry,
  primitiveDistance,
  distance,
  bounds,
} from "../../../cli/test/helpers/svg-outline-geometry.js";

function textOwners() {
  return [...document.querySelectorAll("text")]
    .filter(
      (e) =>
        !e.closest("defs") &&
        getComputedStyle(e).display !== "none" &&
        getComputedStyle(e).visibility !== "hidden" &&
        e.textContent?.trim(),
    )
    .map((e) => {
      const hex = e.getAttribute("clip-path")?.match(/clip-([a-f0-9]+)/u)?.[1];
      if (!hex) return null;
      const tuple = JSON.parse(
        hex
          .match(/.{4}/gu)
          ?.map((s) => String.fromCharCode(parseInt(s, 16)))
          .join("") ?? "[]",
      );
      const owner = tuple[1] === "symbol" ? JSON.parse(tuple[2]) : null;
      return owner ? { device: owner[1], functionKey: owner[2] } : null;
    });
}

/** Pinned glyph outlines and every painted stroke, including terminal
 * attachments. Reads no placement slots or production obstacle lists. */
export async function captionOracle(page: Page, svg: string) {
  const g = await svgOutlineGeometry(page, svg),
    metadata = await page.evaluate(strokeMetadata, false),
    owners = await page.evaluate(textOwners);
  const shapes = g.shapes.flatMap((s, i) => {
    const meta = metadata[i];
    if (!meta?.ink) return [];
    return s.points.slice(1).flatMap((p, j) => {
      const a = s.points[j];
      if (!a) return [];
      const points = clippedSegment(a, p, meta.clip);
      return points.length ? [{ ...s, ...meta, points }] : [];
    });
  });
  const texts = g.texts.filter((t) => t.painted);
  return texts.map((t) => {
    const owner = owners[g.texts.indexOf(t)];
    const device = t.device ?? owner?.device;
    const own = shapes.filter(
        (s) => s.device === device && (s.attachment || s.stub),
      ),
      wiring = shapes.filter((s) => s.attachment || s.stub || s.conductor),
      mark = shapes.filter(
        (s) =>
          s.device === device &&
          s.symbol &&
          (!owner?.functionKey || s.functionKey === owner.functionKey),
      );
    const nearest = (ss: typeof shapes) =>
      Math.min(
        ...ss.map((s) =>
          Math.max(0, primitiveDistance(t.box, s.points) - s.stroke / 2),
        ),
      );
    return {
      ...t,
      device,
      attachmentGap: nearest(own),
      ownerStrokeGap: nearest(shapes.filter((s) => s.device === device)),
      wiringGap: nearest(wiring),
      markGap: nearest(mark),
      cardGap: nearest(shapes.filter((s) => s.card)),
      textGap: Math.min(
        ...texts.filter((o) => o !== t).map((o) => distance(t.box, o.box)),
      ),
      markDistance: mark.length
        ? distance(t.box, bounds(mark.flatMap((s) => s.points)))
        : null,
    };
  });
}
