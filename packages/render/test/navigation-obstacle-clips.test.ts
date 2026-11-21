import { expect, it } from "vitest";
import { allocateNavigationSlots } from "../src/packet/navigation-slots.js";

it.each([
  "device-frame",
  "off-view-card",
  "device-legend-frame",
  "report-cell",
])(
  "clips %s obstacles to their section instead of reserving invisible space",
  (kind) => {
    const request = {
      owner: { x: 20, y: 20, w: 10, h: 5 },
      reservation: {
        id: "clip-proof",
        ownerAppearance: "native",
        ownerOccurrence: "native",
        profileId: "55x25",
        space: "sheet-slot" as const,
        inkMm: { x: 0, y: 0, w: 55, h: 25 },
        maximumForms: ["literal"],
      },
    };
    for (const y of [0, 20]) {
      const obstacle =
        kind === "report-cell"
          ? `<g data-report-column="1" data-cell-x="0" data-cell-y="${y}" data-cell-width="80" data-cell-height="50"/>`
          : `<rect class="${kind}" x="0" y="${y}" width="80" height="50" fill="none" stroke="black"/>`;
      const svg = `<svg viewBox="0 0 80 50"><svg width="80" height="10" viewBox="0 0 80 10">${obstacle}</svg></svg>`;
      const result = allocateNavigationSlots(
        [request],
        { x: 0, y: 12, w: 80, h: 38 },
        svg,
        1,
      );
      expect(result[0]!.allocatedMm!.rect).toMatchObject({ w: 55, h: 25 });
      expect(result[0]!.allocatedMm!.rect.y).toBeGreaterThanOrEqual(12);
      if (y === 0) {
        // Its visible 0..30 mm portion leaves less than the required 25 mm
        // below it. Partial obstacles must reserve their visible area.
        expect(() =>
          allocateNavigationSlots(
            [request],
            { x: 0, y: 12, w: 80, h: 38 },
            svg.replace(
              'height="10" viewBox="0 0 80 10"',
              'height="30" viewBox="0 0 80 30"',
            ),
            1,
          ),
        ).toThrow(/cannot fit/);
      }
      // The exact same obstacle, fully visible, must still block the request.
      expect(() =>
        allocateNavigationSlots(
          [request],
          { x: 0, y: 12, w: 80, h: 38 },
          svg.replace(
            'height="10" viewBox="0 0 80 10"',
            'height="50" viewBox="0 0 80 50"',
          ),
          1,
        ),
      ).toThrow(/cannot fit/);
    }
  },
);
