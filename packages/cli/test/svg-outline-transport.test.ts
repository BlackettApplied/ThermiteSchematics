import { isDeepStrictEqual } from "node:util";
import { expect, it } from "vitest";
import { browserPath, launchBrowser } from "./helpers/pdf-raster.js";
import {
  decodeOutlineJson,
  encodeOutlineJson,
  svgOutlineGeometry,
} from "./helpers/svg-outline-geometry.js";

it("preserves NaN, infinities and negative zero across top-level and nested values", () => {
  expect(encodeOutlineJson(NaN)).toBe('{"__n":"NaN"}');
  expect(encodeOutlineJson(Infinity)).toBe('{"__n":"Infinity"}');
  expect(encodeOutlineJson(-Infinity)).toBe('{"__n":"-Infinity"}');
  expect(encodeOutlineJson(-0)).toBe('{"__n":"-0"}');

  expect(Number.isNaN(decodeOutlineJson(encodeOutlineJson(NaN)))).toBe(true);
  expect(decodeOutlineJson(encodeOutlineJson(Infinity))).toBe(Infinity);
  expect(decodeOutlineJson(encodeOutlineJson(-Infinity))).toBe(-Infinity);
  expect(Object.is(decodeOutlineJson(encodeOutlineJson(-0)), -0)).toBe(true);

  const payload = {
    texts: [
      { length: NaN, x: -0, y: 0, matrix: [1, 0, -0, 1, Infinity, -Infinity] },
      { length: Infinity, clips: [[{ x: -Infinity, y: NaN }]] },
      { length: -Infinity, plate: [{ x: -0, y: 12.5 }] },
      { length: -0, text: "NaN", note: "-0" },
    ],
    shapes: [
      {
        points: [
          { x: -Infinity, y: 20 },
          { x: Infinity, y: 20 },
          { x: NaN, y: -1e308 },
        ],
        stroke: 0.5,
      },
    ],
    nested: [[NaN, Infinity, -Infinity, -0, 0], { a: { b: -0 } }],
  };

  const encoded = encodeOutlineJson(payload);
  expect(encoded).toContain('{"__n":"NaN"}');
  expect(encoded).toContain('{"__n":"Infinity"}');
  expect(encoded).toContain('{"__n":"-Infinity"}');
  expect(encoded).toContain('{"__n":"-0"}');

  const decoded = decodeOutlineJson<typeof payload>(encoded);
  expect(isDeepStrictEqual(decoded, payload)).toBe(true);
  expect(Object.is(decoded.texts[0]!.x, -0)).toBe(true);
  expect(Object.is(decoded.texts[0]!.y, 0)).toBe(true);
  expect(Object.is(decoded.texts[3]!.length, -0)).toBe(true);
});

it("leaves ordinary numbers, strings, nulls and non-matching objects unchanged", () => {
  const ordinary = {
    zero: 0,
    integers: [-42, 0, 1, 9007199254740991],
    floats: [-1e308, -0.25, Number.MIN_VALUE, 3.14159, 1e308],
    primitives: [null, true, false, "", "NaN", "Infinity", "-Infinity", "-0"],
    unmatched: [
      { __n: "unknown" },
      { __n: "NaN", extra: 1 },
      { __n: 0 },
      { __n: null },
    ],
  };

  const encoded = encodeOutlineJson(ordinary);
  expect(encoded).not.toContain('{"__n":"NaN"}');
  expect(encoded).not.toContain('{"__n":"-0"}');
  expect(encoded).not.toContain('{"__n":"Infinity"}');
  expect(encoded).not.toContain('{"__n":"-Infinity"}');

  const decoded = decodeOutlineJson<typeof ordinary>(encoded);
  expect(isDeepStrictEqual(decoded, ordinary)).toBe(true);
  expect(Object.is(decoded.zero, 0)).toBe(true);
});

it("escapes authored __n tag objects, nested escapes, and mixed keys while preserving key order", () => {
  const tags = ["NaN", "Infinity", "-Infinity", "-0"] as const;
  for (const tag of tags) {
    const literal = { __n: tag };
    const encoded = encodeOutlineJson(literal);
    expect(encoded).toBe(`{"___n":"${tag}"}`);
    const decoded = decodeOutlineJson(encoded);
    expect(isDeepStrictEqual(decoded, literal)).toBe(true);
  }

  const nested = {
    single: { __n: "-0" },
    escapedOnce: { ___n: "x" },
    escapedTwice: { ____n: "y" },
    withNumericValue: { __n: -0, ___n: NaN, ____n: -Infinity },
    deep: {
      __n: {
        __n: "-0",
        ___n: { __n: "Infinity", ____n: Infinity },
      },
    },
  };
  const encodedNested = encodeOutlineJson(nested);
  expect(encodedNested).toContain('"___n":{"__n":"-0"}');
  expect(encodedNested).toContain('"____n":{"__n":"NaN"}');
  const decodedNested = decodeOutlineJson<typeof nested>(encodedNested);
  expect(isDeepStrictEqual(decodedNested, nested)).toBe(true);
  expect(Object.is(decodedNested.withNumericValue.__n, -0)).toBe(true);

  const mixed = {
    first: 1,
    __n: "NaN",
    _n: "untouched",
    ___n: "x",
    __n2: "untouched",
    ____n: { before: true, __n: "-Infinity", after: false },
    extra: 2,
  };
  const decodedMixed = decodeOutlineJson<typeof mixed>(
    encodeOutlineJson(mixed),
  );
  expect(isDeepStrictEqual(decodedMixed, mixed)).toBe(true);
  expect(Object.keys(decodedMixed)).toEqual(Object.keys(mixed));
  expect(Object.keys(decodedMixed.____n)).toEqual(Object.keys(mixed.____n));
});

it("preserves a scripted data-wiring-conductor marker object across the browser transport", async () => {
  if (!browserPath) return;
  const scriptedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100" stroke="black">
    <g id="authored" data-wiring-conductor='{"__n":"-0"}' data-circuit-mark="m">
      <line x1="10" y1="11" x2="20" y2="11"/>
    </g>
    <script>
      const group = document.getElementById("authored");
      const getAttribute = group.getAttribute.bind(group);
      group.getAttribute = (name) =>
        name === "data-wiring-conductor"
          ? JSON.parse(getAttribute(name))
          : getAttribute(name);
    </script>
  </svg>`;
  const browser = await launchBrowser();
  try {
    for (const preloaded of [false, true]) {
      const page = await browser.newPage();
      try {
        if (preloaded) await page.setContent(scriptedSvg);
        const geometry = await svgOutlineGeometry(
          page,
          preloaded ? undefined : scriptedSvg,
        );
        expect(geometry.shapes[0]?.wire).toEqual({ __n: "-0" });
        expect(geometry.marks[0]?.wire).toEqual({ __n: "-0" });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
