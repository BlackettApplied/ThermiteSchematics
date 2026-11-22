import { it, expect } from "vitest";
import { legibility } from "./checks.mjs";
import { measurements } from "./marker-metrics.mjs";
for (const medium of ["svg", "html", "pdf"]) {
  it.each([
    [1 / 1.1, false],
    [1.1, false],
    [0.9091, false],
    [0.907, true],
    [1.105, true],
    [1 / (1.1 + 1e-7), true],
    [1.1 + 1e-7, true],
    [1 / (1.1 - 1e-7), false],
    [1.1 - 1e-7, false],
  ])(`${medium} uses the same symmetric limit at s=%s`, (s, bad) => {
    const t = {
      element: "text-1",
      text: "caption",
      medium,
      fontSize: 2.5,
      capReferenceEmMm: 2.5 * s,
      bbox: { x: 10, y: 40, w: 10, h: 2 },
      ...(medium === "pdf" ? {} : { advanceRatio: s }),
    };
    const fs = legibility({ texts: [t] });
    expect(fs).toHaveLength(bad ? 1 : 0);
    if (bad)
      expect(measurements(fs[0])).toEqual({ anisotropy: expect.any(Number) });
  });
}
it("uses the worse measured anisotropy when both scales are available", () => {
  const fs = legibility({
    texts: [
      {
        element: "x",
        fontSize: 2.5,
        advanceRatio: 1.01,
        capReferenceEmMm: 2.5 / 1.2,
        bbox: { x: 1, y: 40, w: 2, h: 2 },
      },
    ],
  });
  expect(fs).toHaveLength(1);
  expect(fs[0].anisotropy).toBeCloseTo(1.2);
});
