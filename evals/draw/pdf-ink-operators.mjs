// Deliberately small outline-text interpreter. Unsupported positioning refuses.
import assert from "node:assert/strict";
import { multiply } from "./pdf-operators.mjs";
const identity = () => [1, 0, 0, 1, 0, 0];
const finite = (a, n) =>
  a?.length === n && Array.from(a).every(Number.isFinite);
const point = (m, x, y) => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
export function pdfGlyphRuns(list, ops, viewport, glyphMetric, onGlyph) {
  assert(
    list.fnArray.length <= 1_000_000,
    "PDF operator resource budget exceeded",
  );
  let state = {
      matrix: identity(),
      text: identity(),
      font: null,
      size: 0,
      cursor: 0,
      hscale: 1,
      rise: 0,
      charSpace: 0,
      wordSpace: 0,
      mode: 0,
    },
    run;
  const stack = [],
    runs = [];
  for (const [i, fn] of list.fnArray.entries()) {
    const a = list.argsArray[i];
    if (fn === ops.save) stack.push(structuredClone(state));
    else if (fn === ops.restore) {
      assert(
        stack.length && !run,
        "Unsupported PDF restore in text or unbalanced stack",
      );
      state = stack.pop();
    } else if (fn === ops.transform) {
      assert(finite(a, 6), "Invalid PDF graphics matrix");
      state.matrix = multiply(state.matrix, a);
    } else if (fn === ops.setGState) {
      assert(
        a[0].every(([key, value]) => ["ca", "CA"].includes(key) && value === 1),
        "Unsupported PDF graphics state for ink association",
      );
    } else if (fn === ops.setFont) {
      assert(
        typeof a[0] === "string" && Number.isFinite(a[1]) && a[1] > 0,
        "Invalid PDF embedded font selection",
      );
      [state.font, state.size] = a;
    } else if (fn === ops.setTextMatrix) {
      const m = a.length === 1 ? a[0] : a;
      assert(run && finite(m, 6), "Invalid PDF text matrix or text scope");
      state.text = Array.from(m);
      state.cursor = 0;
    } else if (fn === ops.setHScale) {
      assert(
        Number.isFinite(a[0]) && a[0] > 0,
        "Unsupported PDF horizontal scale",
      );
      state.hscale = a[0] / 100;
    } else if (fn === ops.setTextRise) state.rise = a[0];
    else if (fn === ops.setCharSpacing) state.charSpace = a[0];
    else if (fn === ops.setWordSpacing) state.wordSpace = a[0];
    else if (fn === ops.setTextRenderingMode) state.mode = a[0];
    else if (fn === ops.beginText) {
      assert(!run, "Nested PDF text scope");
      state.text = identity();
      state.cursor = 0;
      run = {
        text: "",
        points: [],
        operators: [],
        fonts: new Set(),
        start: null,
        end: null,
        size: null,
      };
    } else if (fn === ops.endText) {
      assert(run, "Unbalanced PDF text scope");
      if (run.text.trim()) runs.push(run);
      run = null;
    } else if (fn === ops.showText) {
      assert(
        run &&
          state.font &&
          state.mode === 0 &&
          [state.rise, state.charSpace, state.wordSpace, state.cursor].every(
            Number.isFinite,
          ),
        "Unsupported PDF text painting state",
      );
      assert(
        a[0].length <= 10_000 && run.text.length <= 100_000,
        "PDF glyph resource budget exceeded",
      );
      const m = multiply(viewport, multiply(state.matrix, state.text));
      assert(
        finite(m, 6) && Math.abs(m[0] * m[3] - m[1] * m[2]) > 1e-12,
        "Singular PDF glyph matrix",
      );
      run.operators.push(i);
      for (const g of a[0]) {
        if (typeof g === "number") {
          assert(Number.isFinite(g), "Invalid PDF TJ spacing");
          state.cursor -= (g * state.size) / 1000;
          continue;
        }
        assert(
          g &&
            typeof g.unicode === "string" &&
            Number.isFinite(g.width) &&
            !g.accent &&
            !g.vmetric &&
            !g.isRotated,
          "Unsupported PDF glyph mapping or accent",
        );
        const metric = glyphMetric(state.font, g),
          base = point(m, state.cursor * state.hscale, state.rise),
          size = state.size * Math.hypot(m[2], m[3]);
        run.start ??= base;
        run.size ??= size;
        assert(
          Math.abs(run.size - size) < 0.001,
          "Unsupported mixed PDF em sizes",
        );
        run.text += g.unicode;
        run.fonts.add(metric.sha256);
        const advance =
          (g.width * state.size) / 1000 +
          state.charSpace +
          (g.isSpace ? state.wordSpace : 0);
        const points = [];
        if (metric.box) {
          const b = metric.box,
            scale = state.size / metric.unitsPerEm;
          for (const x of [b.minX, b.maxX])
            for (const y of [b.minY, b.maxY])
              points.push(
                point(
                  m,
                  (state.cursor + x * scale) * state.hscale,
                  y * scale + state.rise,
                ),
              );
        }
        run.points.push(...points);
        state.cursor += advance;
        run.end = point(m, state.cursor * state.hscale, state.rise);
        onGlyph?.({
          text: g.unicode,
          font: state.font,
          size,
          base,
          end: run.end,
          points,
          operator: i,
          run,
        });
      }
    } else {
      // The producer sets absolute matrices. Never approximate relative text,
      // forms, groups or alternative show-text operators.
      const unsupported = [
        ops.moveText,
        ops.setLeadingMoveText,
        ops.nextLine,
        ops.nextLineShowText,
        ops.nextLineSetSpacingShowText,
        ops.setLeading,
        ops.showSpacedText,
        ops.paintFormXObjectBegin,
        ops.paintFormXObjectEnd,
        ops.beginGroup,
        ops.endGroup,
      ];
      assert(
        !unsupported.includes(fn),
        "Unsupported PDF text positioning or form",
      );
    }
  }
  assert(!run && !stack.length, "Unbalanced PDF text/graphics scope");
  return runs;
}
