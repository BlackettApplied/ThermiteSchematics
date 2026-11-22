import { expect, it } from "vitest";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicSheets } from "../src/sheets.js";
import {
  cards,
  control,
  offViewFixture,
  parseSvg,
  required,
} from "./off-view-fixtures.js";

it("uses authored IDs instead of display overrides and preserves punctuation/Unicode", async () => {
  const f = await offViewFixture((objects) => {
    const wire = objects.find((o) => o.designation === "W3");
    wire.designation = 'W<&"Ω';
    wire.properties = { label: "DISPLAY ONLY" };
  });
  try {
    const r = await renderSchematic(f.ir, control());
    if (!r.ok) throw Error(JSON.stringify(r));
    expect(cards(r.value.svg).flatMap((c) => c.rows)).toContain(
      'W<&"Ω → H1.X1',
    );
    expect(r.value.svg).not.toContain("DISPLAY ONLY");
    expect(r.value.svg).toContain("&lt;&amp;");
  } finally {
    await f.dispose();
  }
});

it.each([
  { glyph: "W", length: 160 },
  { glyph: "i", length: 160 },
  { glyph: "W", length: 161 },
])(
  "wraps complete authored fields up to 160 code points and reports R005 beyond ($glyph, $length)",
  async ({ glyph, length }) => {
    const id = glyph.repeat(length),
      f = await offViewFixture((objects) => {
        objects.find((o) => o.designation === "W3").designation = id;
      });
    try {
      const r = await renderSchematic(f.ir, control());
      if (length > 160) {
        expect(r).toMatchObject({
          ok: false,
          error: {
            code: "R005",
            field: "wire.designation",
            reason: "over-160-code-points",
          },
        });
        return;
      }
      if (!r.ok) throw Error(JSON.stringify(r));
      const group = required(
        parseSvg(r.value.svg).querySelector('[data-off-view-terminal="PS1.+"]'),
      );
      expect(
        [...group.querySelectorAll(".off-view-row")]
          .map((t) => t.textContent)
          .join(""),
      ).toContain(id + " → H1.X1");
      expect(group.querySelectorAll("[textLength], [clip-path]")).toHaveLength(
        0,
      );
    } finally {
      await f.dispose();
    }
  },
);

it("refuses an unprintable complete card with its terminal and IDs, rather than dropping rows", async () => {
  const f = await offViewFixture((objects) => {
    const template = objects.find((o) => o.designation === "W3");
    for (let n = 0; n < 90; n++)
      objects.push({
        ...structuredClone(template),
        uid: `84000000-0000-4001-8000-${String(n).padStart(12, "0")}`,
        designation: `EXTRA${n}`,
      });
  });
  try {
    const continuous = await renderSchematic(f.ir, control());
    if (!continuous.ok) throw Error(JSON.stringify(continuous));
    expect(
      cards(continuous.value.svg)
        .flatMap((c) => c.rows)
        .filter((s) => s.startsWith("EXTRA")),
    ).toHaveLength(90);
    const paper = await renderSchematicSheets(f.ir, control());
    expect(paper).toMatchObject({
      ok: false,
      error: { code: "R006", reason: "unprintable-layout" },
    });
    if (paper.ok) throw Error("Expected complete-card print refusal");
    expect(paper.error.message).toContain("PS1.+");
    expect(paper.error.message).toContain("EXTRA0");
    expect(paper.error.message).toContain("EXTRA89");
  } finally {
    await f.dispose();
  }
});
