import { it, expect } from "vitest";
import { textMetricRegressions } from "../../../scripts/health-text-metrics.mjs";

const owner = "packages/render/src/text-metrics.ts";
const renderer = "packages/render/src/new-layout.ts";
const inspect = (source: string, path = renderer) =>
  textMetricRegressions([path], () => source);

it.each([
  "function textWidth(s: string) { return s.length; }",
  "const width = (s: string) => [...s].reduce((n, c) => n + (/[MW]/u.test(c) ? 1 : 0.75), 0);",
  "const width = 1.5 * label.length;",
  "const width = [...caption].length * 6.2;",
  "const width = canvas.measureText(value).width;",
  "const width = sourceGlyph.advanceWidth;",
])("rejects a local renderer measurement in %s", (source) => {
  expect(inspect(source)).toHaveLength(1);
  expect(inspect(source, owner)).toEqual([]);
  expect(inspect(source, "evals/draw/measurement/text-metrics.mjs")).toEqual(
    [],
  );
});

it("allows delegated measurements and line counts", () => {
  expect(
    inspect(`
      import { measureText } from "./text-metrics.js";
      const width = (value: string) => measureText(value, 2.7).width;
      const height = lines.length * 3.5;
      const box = { height: edge.label.length * 3.8 + 1 };
    `),
  ).toEqual([]);
});
