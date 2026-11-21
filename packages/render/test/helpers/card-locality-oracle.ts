import type { Page } from "playwright-core";
import { svgOutlineGeometry } from "../../../cli/test/helpers/svg-outline-geometry.js";

/** Read actual terminal centres and painted borders; pinned glyph outlines
 * independently check the card text. No layout reservations participate. */
export async function cardLocalityOracle(page: Page, svg: string) {
  await page.setContent(svg);
  const minimal = await page.evaluate(() => {
    for (const e of document.querySelectorAll(
      "path,line,polyline,rect,circle,text",
    ))
      if (
        !e.closest("defs,.off-view-annotation") &&
        !e.matches("circle.terminal-marker")
      )
        e.remove();
    return document.querySelector("svg")!.outerHTML;
  });
  const outlines = await svgOutlineGeometry(page, minimal);
  const raw = await page.evaluate(() => {
    const root = document.querySelector("svg") as SVGSVGElement;
    const inverse = root.getScreenCTM()!.inverse();
    const point = (e: SVGGraphicsElement, x: number, y: number) =>
      new DOMPoint(x, y).matrixTransform(inverse.multiply(e.getScreenCTM()!));
    const texts = [...root.querySelectorAll("text")].filter(
      (e) => !e.closest("defs") && !!e.textContent?.trim(),
    );
    return [
      ...root.querySelectorAll<SVGGElement>("[data-off-view-terminal]"),
    ].flatMap((card) => {
      const rect = card.querySelector("rect") as SVGRectElement;
      const section = card.closest("svg") as SVGSVGElement;
      const sv = section.viewBox.baseVal;
      const lo = point(section, sv.x, sv.y),
        hi = point(section, sv.x + sv.width, sv.y + sv.height);
      const b = rect.getBBox(),
        a = point(rect, b.x, b.y),
        z = point(rect, b.x + b.width, b.y + b.height);
      if (a.x >= hi.x || z.x <= lo.x || a.y >= hi.y || z.y <= lo.y) return [];
      const t = JSON.parse(card.getAttribute("data-off-view-terminal-id")!) as {
        deviceUid: string;
        terminalKey: string;
      };
      const markers = [
        ...section.querySelectorAll<SVGCircleElement>("circle.terminal-marker"),
      ]
        .filter(
          (e) =>
            e.getAttribute("data-device-uid") === t.deviceUid &&
            e.getAttribute("data-terminal-key") === t.terminalKey,
        )
        .map((e) => point(e, e.cx.baseVal.value, e.cy.baseVal.value));
      const terminal = markers.find(
        (p) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y,
      );
      if (!terminal)
        throw Error(
          "Card has no painted terminal: " +
            card.getAttribute("data-off-view-terminal"),
        );
      const m = inverse.multiply(rect.getScreenCTM()!),
        half =
          (parseFloat(getComputedStyle(rect).strokeWidth) *
            Math.hypot(m.a, m.b)) /
          2;
      const border = {
        left: a.x - half,
        top: a.y - half,
        right: z.x + half,
        bottom: z.y + half,
      };
      const distance = Math.hypot(
        Math.max(border.left - terminal.x, 0, terminal.x - border.right),
        Math.max(border.top - terminal.y, 0, terminal.y - border.bottom),
      );
      return [
        {
          terminal: card.getAttribute("data-off-view-terminal")!,
          distance,
          border,
          textIndices: texts.flatMap((e, i) =>
            e.closest(".off-view-annotation") === card ? [i] : [],
          ),
        },
      ];
    });
  });
  return raw.map((card) => ({
    ...card,
    textInk: card.textIndices.map((i) => {
      const t = outlines.texts[i];
      if (!t || !t.painted) throw Error("Unpainted card text");
      return t.box;
    }),
  }));
}
