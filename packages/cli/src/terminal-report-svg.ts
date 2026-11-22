import type { RenderedPacket } from "@thermite/render";

/** Only generated report groups are scanned; authored cell text stays intact. */
function headerEnd(svg: string) {
  const header = /<g\b[^>]*\bid="[^"]*document-header"[^>]*>/u.exec(svg);
  if (!header) return undefined;
  const groups = /<\/?g\b[^>]*>/gu;
  groups.lastIndex = header.index;
  let depth = 0;
  for (let group = groups.exec(svg); group; group = groups.exec(svg)) {
    if (group[0].startsWith("</")) depth--;
    else if (!group[0].endsWith("/>")) depth++;
    if (depth === 0) return groups.lastIndex;
  }
  return undefined;
}
function inventoryOnly(svg: string) {
  const withoutLinks = svg
    .replace(/<text\b[^>]*\bdata-strip-row="[^"]*"[^>]*>[\s\S]*?<\/text>/gu, "")
    .replace(/<g\b[^>]*\bdata-report-row="[^"]*"[^>]*>/gu, (group) =>
      group.replace(/\sdata-strip-ref="[^"]*"/gu, ""),
    );
  const end = headerEnd(withoutLinks);
  return end === undefined
    ? withoutLinks
    : withoutLinks.slice(0, end) +
        withoutLinks
          .slice(end)
          .replace(
            /^\s*<text\b[^>]*>Strip<\/text>\s*<text\b[^>]*>row<\/text>/u,
            "",
          );
}

/** Preserve the one-sheet SVG contract when only a terminal strip was appended.
 * Multi-sheet HTML/PDF/JSON retain the complete strip and reciprocal references. */
export function singleSheetSvg(packet: RenderedPacket): string | undefined {
  if (packet.sheets.length === 1) return packet.sheets[0]?.svg;
  const inventory = packet.sheets.filter(
    (s) =>
      s.view.format !== "documentation-view/0.1" ||
      s.view.kind !== "terminal-strip",
  );
  const sheet = inventory[0];
  if (
    inventory.length !== 1 ||
    sheet?.view.format !== "documentation-view/0.1" ||
    sheet.view.kind !== "terminals"
  )
    return undefined;
  return inventoryOnly(sheet.svg);
}
