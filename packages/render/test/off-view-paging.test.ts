import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  control,
  flows,
  foldedControlFixture,
  parseSvg,
} from "./off-view-fixtures.js";

function assertCompleteVisibleCards(svg: string) {
  const doc = parseSvg(svg),
    visible: string[] = [];
  for (const viewport of doc.querySelectorAll(
    "svg[data-layout-config-version]",
  )) {
    const [x, y, w, h] = String(viewport.getAttribute("viewBox"))
      .split(/\s+/)
      .map(Number);
    const right = Number(x) + Number(w),
      bottom = Number(y) + Number(h);
    for (const card of viewport.querySelectorAll("[data-off-view-terminal]")) {
      const rect = card.querySelector("rect");
      if (!rect) throw Error("Missing card border");
      const cx = Number(rect.getAttribute("x")),
        cy = Number(rect.getAttribute("y")),
        cr = cx + Number(rect.getAttribute("width")),
        cb = cy + Number(rect.getAttribute("height"));
      if (cr <= Number(x) || cx >= right || cb <= Number(y) || cy >= bottom)
        continue;
      expect(cx).toBeGreaterThanOrEqual(Number(x));
      expect(cy).toBeGreaterThanOrEqual(Number(y));
      expect(cr).toBeLessThanOrEqual(right);
      expect(cb).toBeLessThanOrEqual(bottom);
      const terminal = JSON.parse(
        String(card.getAttribute("data-off-view-terminal-id")),
      );
      const anchors = [
        ...viewport.querySelectorAll("circle.terminal-marker"),
      ].filter(
        (c) =>
          c.getAttribute("data-device-uid") === terminal.deviceUid &&
          c.getAttribute("data-terminal-key") === terminal.terminalKey,
      );
      expect(
        anchors.some((c) => {
          const group = c.closest(".symbol"),
            match = group
              ?.getAttribute("transform")
              ?.match(/translate\(([-.\d]+) ([-.\d]+)\)/);
          if (!match) return false;
          const ax = Number(match[1]) + Number(c.getAttribute("cx")),
            ay = Number(match[2]) + Number(c.getAttribute("cy"));
          return (
            ax >= Number(x) && ax <= right && ay >= Number(y) && ay <= bottom
          );
        }),
      ).toBe(true);
      visible.push(String(card.getAttribute("data-off-view-terminal")));
    }
  }
  expect(doc.querySelectorAll("[data-selected-view-notice]")).toHaveLength(1);
  return visible;
}

it.each(flows)(
  "protects cards with their terminals through cuts, compact folding and all notices (%s)",
  async (flow) => {
    const f = await foldedControlFixture();
    try {
      const r = await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        layout: "compact",
        views: [control(flow)],
      });
      if (!r.ok) throw Error(JSON.stringify(r));
      const seen = r.value.sheets.flatMap((s) =>
        assertCompleteVisibleCards(s.svg),
      );
      expect([...new Set(seen)].sort()).toEqual(["PS1.+", "PS1.-"]);
      if (flow === "left-to-right") {
        expect(r.value.sheets.length).toBeGreaterThan(1);
        expect(
          r.value.sheets.some((s) => s.svg.includes("Folded circuit sections")),
        ).toBe(true);
      }
      expect(
        r.value.sheets
          .flatMap((s) => s.continuations ?? [])
          .some((c) => String(c.conductor).includes("EXTRA")),
      ).toBe(false);
    } finally {
      await f.dispose();
    }
  },
);
