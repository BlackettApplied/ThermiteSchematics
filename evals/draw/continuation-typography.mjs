import {
  connectorRows,
  printedConductor,
  referenceRow,
  referenceHeader,
  identityMatches,
} from "./continuation-labels.mjs";
import { finding, painted, extent } from "./review-geometry.mjs";
import { printedZones } from "./printed-zones.mjs";
export const CONTINUATION_BLOCK_GAP_MM = 2.5;
import { INK_ACCURACY_MM } from "./checks.mjs";
export const MEASUREMENT_EPSILON_MM = INK_ACCURACY_MM;
export function continuationTypography(sheet, g, ir) {
  const findings = [],
    blocks = [],
    counts = new Map();
  for (const c of sheet.continuations ?? []) {
    const key = JSON.stringify([c.id, c.toSheet]),
      occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    const { source, rows } = connectorRows(
      { ...g, texts: g.texts.filter(painted) },
      c,
      occurrence,
    );
    const expected = printedConductor(c, ir),
      ref = referenceRow(rows, c.id),
      header = referenceHeader(ref, c.id);
    const body = rows.flatMap((t) => {
      const text = t === ref ? header?.body : (t.renderedString ?? t.text);
      return text ? [{ ...t, text }] : [];
    });
    if (!expected || !source || !identityMatches(rows, c, expected)) {
      findings.push(
        finding("continuation-typography-owner-or-identity", ref ?? source, {
          id: c.id,
          conductor: c.conductor,
        }),
      );
      continue;
    }
    if (
      !expected.undesignated &&
      (body.length !== 1 || body[0].text !== expected.text)
    )
      findings.push(
        finding("continuation-identifier-split", ref, {
          id: c.id,
          conductor: expected.text,
          rows: body.map((t) => ({ text: t.text, baselineMm: t.rowY })),
          bbox: extent(
            rows.flatMap((t) => [
              { x: t.bbox.x, y: t.bbox.y },
              { x: t.bbox.x + t.bbox.w, y: t.bbox.y + t.bbox.h },
            ]),
          ),
        }),
      );
    blocks.push({
      id: c.id,
      toSheet: c.toSheet,
      element: source.element,
      bbox: extent(
        rows.flatMap((t) => [
          { x: t.bbox.x, y: t.bbox.y },
          { x: t.bbox.x + t.bbox.w, y: t.bbox.y + t.bbox.h },
        ]),
      ),
    });
  }
  const zones = printedZones(g);
  const measurements = blocks
    .flatMap((a, i) =>
      blocks.slice(i + 1).map((b) => {
        const dx = Math.max(
            0,
            a.bbox.x - b.bbox.x - b.bbox.w,
            b.bbox.x - a.bbox.x - a.bbox.w,
          ),
          dy = Math.max(
            0,
            a.bbox.y - b.bbox.y - b.bbox.h,
            b.bbox.y - a.bbox.y - a.bbox.h,
          );
        return {
          elements: [a.element, b.element],
          gapMm: Math.hypot(dx, dy),
          assessment: "measured",
          minimumMm: CONTINUATION_BLOCK_GAP_MM,
          epsilonMm: MEASUREMENT_EPSILON_MM,
        };
      }),
    )
    .filter((m) => m.gapMm < 10);
  for (const m of measurements)
    if (m.gapMm < CONTINUATION_BLOCK_GAP_MM - MEASUREMENT_EPSILON_MM) {
      const a = blocks.find((b) => b.element === m.elements[0]);
      findings.push(finding("continuation-block-gap", a, m));
    }
  return {
    findings,
    measurements,
    zoneClearances: blocks
      .flatMap((b) =>
        [...zones.numbers, ...zones.letters].filter(painted).map((t) => ({
          element: b.element,
          zoneElement: t.element,
          zoneText: t.text,
          gapMm: Math.hypot(
            Math.max(
              0,
              b.bbox.x - t.bbox.x - t.bbox.w,
              t.bbox.x - b.bbox.x - b.bbox.w,
            ),
            Math.max(
              0,
              b.bbox.y - t.bbox.y - t.bbox.h,
              t.bbox.y - b.bbox.y - b.bbox.h,
            ),
          ),
          assessment: "measured-threshold-pending",
        })),
      )
      .filter((m) => m.gapMm < 10),
    sameSheetEnds: blocks.filter((b) => b.toSheet === sheet.number).length,
  };
}
