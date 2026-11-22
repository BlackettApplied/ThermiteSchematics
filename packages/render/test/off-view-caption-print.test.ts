import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { textInk, inkOverlaps } from "../src/packet/rooted-caption.js";
import { parseSvg } from "./off-view-fixtures.js";

it.each(["conveyor-line", "machine-demo", "motor-starter"])(
  "keeps actual printed continued-location text clear of notices and links (%s)",
  async (project) => {
    const c = await compileProject("examples/" + project);
    if (!c.ok) throw Error("Compile failed");
    const request = {
      format: "schematic-packet-request/0.1" as const,
      layout: "compact" as const,
      ...(project === "motor-starter" ? { page: { size: "a3" as const } } : {}),
      views: (project === "motor-starter" ? ["M1"] : ["M1", "M2"]).map(
        (value) => ({
          format: "schematic-view-request/0.1" as const,
          family: "power" as const,
          root: { by: "designation" as const, value },
          flow: "top-to-bottom" as const,
        }),
      ),
    };
    const r = await renderSchematicPacket(c.ir, request, c.presentation);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    let checked = 0;
    for (const sheet of r.value.sheets) {
      const doc = parseSvg(sheet.svg),
        caption = [...doc.querySelectorAll("text")].find((t) =>
          t.textContent?.startsWith("CONTINUED LOCATION:"),
        );
      if (!caption) continue;
      const ink = (e: Element) =>
        textInk(
          e.textContent ?? "",
          Number(e.getAttribute("x")),
          Number(e.getAttribute("y")),
          Number(e.getAttribute("font-size")),
          e.getAttribute("font-weight") === "700",
          e.getAttribute("text-anchor") ?? "start",
        );
      const captionInk = ink(caption);
      for (const other of doc.querySelectorAll(
        "[data-selected-view-notice] text,a text",
      ))
        expect(
          inkOverlaps(captionInk, ink(other)),
          `${project} sheet ${sheet.number}: ${other.textContent}`,
        ).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  },
  30000,
);
