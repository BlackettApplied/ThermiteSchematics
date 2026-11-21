import type { RenderedPacket } from "../packet/types.js";
import type { IssuedDocument } from "../packet/document-types.js";
import {
  svgTree,
  descendants,
  type SvgNode,
} from "../device-legend/svg-tree.js";
import { escapeXmlText, escapeXmlAttribute } from "../svg/escape.js";

import { required } from "../presentation/util.js";

type Pages = ReadonlyMap<number, number>;
const pageId = (s: string, pages: Pages) =>
  s.replace(/(^|#)sheet-(\d+)(?=-|$|\))/g, (s, prefix, n) =>
    pages.has(Number(n)) ? `${prefix}sheet-${pages.get(Number(n))}` : s,
  );
function captionText(
  text: string,
  pages: Pages,
  documents: readonly IssuedDocument[],
) {
  const label = documents
    .map((d) =>
      d.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+"),
    )
    .join("|");
  const start = label ? text.search(new RegExp(label)) : -1;
  if (start < 0) return text;
  return text.replace(
    /\b(\d{2,3})(\.[A-D][1-6])\b/g,
    (value, n, zone, offset: number) => {
      if (offset < start) return value;
      const prefix = text.slice(start, offset),
        depth =
          (prefix.match(/\(/g)?.length ?? 0) -
          (prefix.match(/\)/g)?.length ?? 0);
      if (depth) return value;
      const next = pages.get(Number(n));
      if (next === undefined)
        throw Error("Unmapped companion caption location");
      return `${String(next).padStart(2, "0")}${zone}`;
    },
  );
}
function metadata<T>(value: T, pages: Pages): T {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (key === "sheet" && typeof item === "number")
        return pages.get(item) ?? item;
      if (key === "sheets" && Array.isArray(item))
        return item.map((n) => pages.get(n) ?? n);
      if (key === "primitiveId" && typeof item === "string")
        return pageId(item, pages);
      return item;
    }),
  ) as T;
}
function attributes(
  attrs: Record<string, string>,
  pages: Pages,
  oldTotal: number,
  total: number,
) {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => {
      if (key === "data-sheet")
        value = String(pages.get(Number(value)) ?? value);
      if (key === "data-total-sheets" && Number(value) === oldTotal)
        value = String(total);
      if (key === "aria-label")
        value = value.replace(/, sheet (\d+) of (\d+)$/, (s, n, t) =>
          Number(t) === oldTotal
            ? `, sheet ${pages.get(Number(n)) ?? n} of ${total}`
            : s,
        );
      if (
        ["id", "href", "xlink:href", "clip-path", "mask", "filter"].includes(
          key,
        )
      )
        value = pageId(value, pages);
      return [key, value];
    }),
  );
}
function frameText(
  node: SvgNode,
  packet: RenderedPacket,
  old: number,
  next: number,
  total: number,
) {
  const value = node.text,
    oldTotal = packet.sheets.length;
  if (node.name === "title")
    return value.replace(
      new RegExp(` - Sheet ${old} of ${oldTotal}$`),
      ` - Sheet ${next} of ${total}`,
    );
  if (node.name !== "text" || !packet.page) return value;
  const { widthMm: w, heightMm: h, marginMm: m } = packet.page,
    a = node.attrs;
  if (
    a["data-frame-sheet-number"] === "true" &&
    value === `${old} of ${oldTotal}`
  )
    return `${next} of ${total}`;
  const at = (x: number, y: number) =>
    Math.abs(Number(a.x) - x) < 1e-6 && Math.abs(Number(a.y) - y) < 1e-6;
  if (at(w - m - 4, m + 5) && value === `SHEET ${old} OF ${oldTotal}`)
    return `SHEET ${next} OF ${total}`;
  if (
    at(w - m - 4, m + 5) &&
    value ===
      `SHEET ${String(old).padStart(2, "0")} / ${String(oldTotal).padStart(2, "0")}`
  )
    return `SHEET ${String(next).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  if (at(w - m - 62, h - m - 2.5) && value === `SHEET ${old} OF ${oldTotal}`)
    return `SHEET ${next} OF ${total}`;
  return value;
}
function svg(
  packet: RenderedPacket,
  raw: string,
  old: number,
  next: number,
  pages: Pages,
  total: number,
  documents: readonly IssuedDocument[],
) {
  const tree = svgTree(raw),
    replacements = new Map<SvgNode, string>();
  for (const root of descendants(tree).filter(
    (n) => n.attrs["data-document-dependency"],
  )) {
    const need = packet.navigation?.dependencies?.find(
      (d) => d.id === root.attrs["data-document-dependency"],
    );
    if (!need?.caption) continue;
    const before = need.caption.text.split("\n"),
      after = captionText(need.caption.text, pages, documents).split("\n"),
      texts = descendants(root).filter((n) => n.name === "text");
    if (
      texts.length !== before.length ||
      texts.some((n, i) => n.text !== before[i])
    )
      throw Error("Caption paint differs from its own metadata");
    texts.forEach((node, i) =>
      replacements.set(
        node,
        required(after[i], "Missing normalized caption line"),
      ),
    );
  }
  const serialize = (node: SvgNode, parent?: SvgNode): string => {
    const attrs = attributes(node.attrs, pages, packet.sheets.length, total);
    const text =
      replacements.get(node) ??
      (parent?.name === "svg"
        ? frameText(node, packet, old, next, total)
        : node.text);
    const body =
      escapeXmlText(text) +
      node.children.map((child) => serialize(child, node)).join("");
    if (node.name === "document") return body;
    return `<${node.name}${Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeXmlAttribute(v)}"`)
      .join("")}>${body}</${node.name}>`;
  };
  return serialize(tree);
}
/** Comparison copies only. No rendered/exported packet is modified. Native
 * cells and identities are never rewritten as page or zone tokens. */
export function normalizedDocumentPacket(
  packet: RenderedPacket,
  pages: Pages,
  total: number,
  documents: readonly IssuedDocument[],
): RenderedPacket {
  if (
    packet.sheets.some(
      (s) =>
        !pages.has(s.number) &&
        /data-document-(?:dependency|origin)=/.test(s.svg),
    )
  )
    throw Error("Unmapped M3 paint cannot disappear during renumbering");
  const navigation = packet.navigation && metadata(packet.navigation, pages);
  if (navigation?.dependencies)
    navigation.dependencies = (packet.navigation?.dependencies ?? []).map(
      (d) => ({
        ...metadata(d, pages),
        ...(d.caption
          ? {
              caption: {
                ...metadata(d.caption, pages),
                text: captionText(d.caption.text, pages, documents),
              },
            }
          : {}),
      }),
    );
  return {
    ...packet,
    ...(navigation ? { navigation } : {}),
    sheets: packet.sheets
      .filter((s) => pages.has(s.number))
      .map((s) => {
        const number = required(pages.get(s.number), "Missing mapped sheet");
        return {
          ...s,
          number,
          svg: svg(packet, s.svg, s.number, number, pages, total, documents),
        };
      }),
  };
}
