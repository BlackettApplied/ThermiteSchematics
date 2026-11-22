import { expect, it } from "vitest";
import { reidentify, semanticIdentities } from "./semantic-ordering-fixture.js";
import {
  p6Fixture,
  flows,
  control,
  cards,
  offViewFixture,
  parseSvg,
} from "./off-view-fixtures.js";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicSheets } from "../src/sheets.js";

it.each(flows)(
  "keeps card order and geometry stable under UUID and source-order changes (%s)",
  async (flow) => {
    const f = await p6Fixture();
    try {
      let expected: unknown;
      const original = JSON.stringify(f.ir);
      for (const seed of [0, 1, 7]) {
        const ir = reidentify(f.ir, seed);
        const a = await renderSchematic(ir, control(flow));
        if (!a.ok) throw Error(JSON.stringify(a));
        const actual = semanticIdentities(ir, a.value.svg);
        if (expected === undefined) expected = actual;
        expect(actual).toEqual(expected);
        const reversed = {
          ...ir,
          wires: [...ir.wires].reverse(),
          devices: [...ir.devices].reverse(),
          jumpers: [...ir.jumpers].reverse(),
          cableConductors: [...ir.cableConductors].reverse(),
        };
        expect(await renderSchematic(reversed, control(flow))).toEqual(a);
      }
      expect(JSON.stringify(f.ir)).toBe(original);
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "retains the notice on a zero-marker rooted sheet (%s)",
  async (flow) => {
    const f = await offViewFixture((objects) => {
      objects.splice(
        0,
        objects.length,
        ...objects.filter((o) =>
          ["PS1", "K1", "W1", "W2"].includes(o.designation),
        ),
      );
    });
    try {
      const r = await renderSchematicSheets(f.ir, control(flow));
      if (!r.ok) throw Error(JSON.stringify(r));
      for (const sheet of r.value.sheets) {
        expect(cards(sheet.svg)).toEqual([]);
        const notice = parseSvg(sheet.svg).querySelectorAll(
          "[data-selected-view-notice]",
        );
        expect(notice).toHaveLength(1);
        expect(notice[0]?.textContent).toContain(
          "Selected path only; other authored connections may be outside this view.",
        );
      }
    } finally {
      await f.dispose();
    }
  },
);
