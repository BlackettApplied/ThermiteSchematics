import type { NormalizedSchematicView } from "../types.js";
import { wrapText } from "../text-metrics.js";
import { SvgWriter } from "../svg/writer.js";

export const CONTACT_TABLE_NOTICE =
  "Contact tables list device data; contacts not drawn in this packet are marked.";

export function rootedViewTitle(view: NormalizedSchematicView) {
  const intent =
    view.format === "schematic-view/0.1"
      ? view.family
      : view.intent === "trace"
        ? `trace to ${view.target.designation}`
        : view.intent;
  return `${view.root.designation} / ${intent}`;
}

export function rootedNoticeLines(
  view: NormalizedSchematicView,
  width: number,
  size: number,
) {
  const cable =
    view.format === "schematic-view/0.2" && view.intent === "conductors";
  const heading = `${cable ? "SELECTED CABLE VIEW" : "SELECTED PATH VIEW"} — ${rootedViewTitle(view)}.`;
  return [
    ...wrapText(heading, width, size).map((text) => ({ text, bold: true })),
    ...wrapText(
      "Other authored connections may be outside this view. See circuit views or packet coverage.",
      width,
      size,
    ).map((text) => ({ text, bold: false })),
  ];
}

export function rootedNoticeSvg(
  view: NormalizedSchematicView,
  x: number,
  y: number,
  width: number,
  size: number,
  pitch: number,
) {
  const writer = new SvgWriter();
  // Retain the established reservation and native drawing transforms. The
  // generic partial-view warning does not promise a printed coverage document.
  const body = wrapText(
    "Selected path only; other authored connections may be outside this view.",
    width,
    size,
  );
  const reserved = rootedNoticeLines(view, width, size);
  if (body.length > reserved.filter((line) => !line.bold).length)
    throw new Error("Generic notice exceeds its fixed reservation");
  const lines = [
    ...reserved.filter((line) => line.bold),
    ...body.map((text) => ({ text, bold: false })),
  ];
  writer.open(1, "g", {
    class: "selected-view-notice",
    "data-selected-view-notice": "true",
  });
  lines.forEach((line, index) =>
    writer.element(
      2,
      "text",
      {
        x,
        y: y + index * pitch,
        "font-family": "Thermite Sans, Thermite Math, sans-serif",
        "font-size": size,
        ...(line.bold ? { "font-weight": "700" } : {}),
        fill: "#18212b",
      },
      line.text,
    ),
  );
  writer.close(1, "g");
  return writer.finish().trimEnd();
}

export function rootedSheetView(
  view: import("../packet/types.js").RenderedSheet["view"],
): NormalizedSchematicView | undefined {
  return view.format === "schematic-view/0.1" ||
    view.format === "schematic-view/0.2"
    ? view
    : undefined;
}

export function rootedSheetNoticeSvg(
  view: import("../packet/types.js").RenderedSheet["view"],
  page: import("../packet/types.js").PaperPage,
) {
  const rooted = rootedSheetView(view);
  return rooted
    ? rootedNoticeSvg(
        rooted,
        page.marginMm + 18,
        page.marginMm + 19,
        page.widthMm - 2 * page.marginMm - 36,
        2.7,
        4,
      )
    : undefined;
}
