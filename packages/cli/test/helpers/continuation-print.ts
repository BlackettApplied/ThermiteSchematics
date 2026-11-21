/** Browser-side physical measurements; independent of renderer reservations. */
export function continuationEmSizes() {
  return [
    ...document.querySelectorAll(
      'a[data-continuation-id] text, [data-cable-uid][data-conductor-id] text[font-size="2.5"]',
    ),
  ].map((t) => {
    const root = t.closest("section")!.querySelector("svg")!,
      m = (t as SVGGraphicsElement).getScreenCTM()!,
      box = root.getBoundingClientRect();
    return (
      (parseFloat(getComputedStyle(t).fontSize) *
        Math.hypot(m.c, m.d) *
        root.viewBox.baseVal.width) /
      box.width
    );
  });
}
export function continuationCrop(a: Element) {
  const b = a.getBoundingClientRect(),
    root = a.closest("section")!.querySelector("svg")!,
    r = root.getBoundingClientRect(),
    k = root.viewBox.baseVal.width / r.width;
  return {
    x: (b.x - r.x) * k - 1,
    y: (b.y - r.y) * k - 1,
    width: b.width * k + 2,
    height: b.height * k + 2,
  };
}

import { expect } from "vitest";
import type {
  RenderedPacket,
  RenderedSheet,
} from "../../../render/src/sheets.js";
import { embedPrintableFont } from "../../src/printable-font.js";
import {
  launchBrowser,
  browserCrop,
  pdfCrop,
  inkBounds,
  unmatchedInk,
} from "./pdf-raster.js";

/** Inspect actual PDF rows and transforms, without the continuation formatter. */
export async function assertContinuationPdf(
  bytes: Buffer,
  rows: Element[],
  height: number,
) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  try {
    const doc = await task.promise,
      page = await doc.getPage(1),
      content = await page.getTextContent();
    for (const row of rows) {
      const y = height - Number(row.getAttribute("y")),
        x = Number(row.getAttribute("x"));
      const items = content.items.filter(
        (i) =>
          "str" in i &&
          Math.abs((i.transform[5]! * 25.4) / 72 - y) < 0.1 &&
          (i.transform[4]! * 25.4) / 72 > x - 0.1,
      );
      const text = items
        .map((i) => ("str" in i ? i.str : ""))
        .join("")
        .replace(/\s+/gu, " ");
      expect(text).toContain(
        (row.textContent ?? "").normalize("NFC").replace(/\s+/gu, " ").trim(),
      );
      for (const i of items)
        if ("str" in i && i.str.trim())
          expect(
            (Math.hypot(i.transform[0]!, i.transform[1]!) * 25.4) / 72,
          ).toBeGreaterThanOrEqual(2.499);
    }
  } finally {
    await task.destroy();
  }
}

export async function assertContinuationBrowser(
  packet: RenderedPacket,
  sheet: RenderedSheet,
  bytes: Buffer,
) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: "print" });
    await page.setContent(packet.html);
    await page.evaluate(() => document.fonts.ready);
    const ems = await page.evaluate(continuationEmSizes);
    expect(ems.length).toBeGreaterThan(4);
    expect(Math.min(...ems)).toBeGreaterThanOrEqual(2.499);
    const crop = await page
      .locator(`#sheet-${sheet.number} a[data-continuation-id]`)
      .first()
      .evaluate(continuationCrop);
    const htmlInk = await browserCrop(
        browser,
        embedPrintableFont(sheet.svg),
        crop,
      ),
      pdfInk = await pdfCrop(bytes, crop);
    expect(inkBounds(htmlInk).count).toBeGreaterThan(100);
    expect(inkBounds(pdfInk).count).toBeGreaterThan(100);
    expect(unmatchedInk(htmlInk, pdfInk)).toBeLessThan(0.04);
    expect(unmatchedInk(pdfInk, htmlInk)).toBeLessThan(0.04);
  } finally {
    await browser.close();
  }
}
