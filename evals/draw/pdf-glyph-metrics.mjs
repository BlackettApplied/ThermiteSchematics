// Actual embedded font outlines, shared by crop evidence and paint inventory.
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { create } from "fontkit";
import { hash } from "./support.mjs";
export function embeddedGlyphMetric(page) {
  const fonts = new Map();
  return (name, glyph) => {
    if (!fonts.has(name)) {
      const f = page.commonObjs.get(name);
      assert(
        f?.data?.length &&
          !f.missingFile &&
          !f.isType3Font &&
          !f.vertical &&
          !f.isInvalidPDFjsFont &&
          !f.remeasure,
        "PDF ink requires a supported embedded outline font",
      );
      assert(
        equal(f.fontMatrix, [0.001, 0, 0, 0.001, 0, 0]),
        "Unsupported PDF glyph advance matrix",
      );
      const font = create(Buffer.from(f.data));
      assert(
        Number.isFinite(font.unitsPerEm) && font.unitsPerEm > 0,
        "Invalid embedded PDF font units",
      );
      fonts.set(name, { font, sha256: hash(f.data) });
    }
    const { font, sha256 } = fonts.get(name);
    // pdf.js can retain an unmapped space: it advances, but paints no outline.
    assert(
      glyph.isInFont || /^\s+$/u.test(glyph.unicode),
      "Missing embedded PDF glyph",
    );
    if (!glyph.isInFont)
      return { sha256, unitsPerEm: font.unitsPerEm, box: null };
    assert(
      [...glyph.fontChar].length === 1 &&
        font.hasGlyphForCodePoint(glyph.fontChar.codePointAt(0)),
      "Missing PDF fontChar mapping",
    );
    const box = font.glyphForCodePoint(glyph.fontChar.codePointAt(0)).bbox;
    assert(
      [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite),
      "Nonfinite PDF glyph bounds",
    );
    return {
      sha256,
      unitsPerEm: font.unitsPerEm,
      box: box.maxX > box.minX && box.maxY > box.minY ? box : null,
    };
  };
}
