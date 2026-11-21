import { renumberedDocumentPackets } from "./circuit-document-renumber.js";
import type { RenderedPacket } from "../packet/types.js";
import { navigationGeometry } from "../packet/navigation-walk.js";
import { descendants } from "../device-legend/svg-tree.js";

function documents(packet: RenderedPacket) {
  const n = packet.navigation,
    targets = new Set(
      n?.dependencies?.flatMap((d) => d.resolution.map((r) => r.documentId)),
    );
  return n?.documents?.filter((d) => d.autoOrigin || targets.has(d.id));
}

function metadata(packet: RenderedPacket) {
  const n = packet.navigation;
  return [
    n?.documentFormat,
    n?.dependencies,
    documents(packet),
    n?.autoDocuments,
  ];
}

/** Keep actual ink, inherited styles, transforms and clips, independently of
 * the M3 locators. A matching JSON caption is not proof of matching paint. */
function painted(packet: RenderedPacket) {
  const ids = new Set(documents(packet)?.map((d) => d.id));
  const rows = new Set(
    documents(packet)?.flatMap((d) => d.rows.map((r) => r.primitiveId)),
  );
  return packet.sheets.flatMap((sheet) => {
    if (
      !sheet.svg.includes("data-document-dependency=") &&
      !sheet.svg.includes("data-document-origin=") &&
      !ids.size
    )
      return [];
    const geometry = navigationGeometry(sheet.svg);
    return geometry.flatMap((g) => {
      const a = g.node.attrs;
      if (
        !a["data-document-dependency"] &&
        !ids.has(a["data-document-id"] ?? "") &&
        a["data-document-origin"] !== "auto" &&
        !rows.has(a.id ?? "")
      )
        return [];
      const nodes = new Set([g.node, ...descendants(g.node)]);
      return [
        {
          sheet: sheet.number,
          node: g.node,
          geometry: geometry
            .filter((p) => nodes.has(p.node))
            .map(({ matrix, clip, visible, style }) => ({
              matrix,
              clip,
              visible,
              style,
            })),
        },
      ];
    });
  });
}

function companionPages(packet: RenderedPacket) {
  const pages = new Set(
    packet.navigation?.autoDocuments?.flatMap((d) => d.sheets) ?? [],
  );
  return [...pages]
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      sheet: packet.sheets.find((s) => s.number === number),
    }));
}

/** M3 owns fixed final sheet-space captions. Conserve their painted geometry
 * and the owning view's placement, rather than treating a reservation as ink. */
function owners(packet: RenderedPacket) {
  const dependencies = packet.navigation?.dependencies ?? [];
  if (!dependencies.length) return [];
  const geometry = new Map(
    packet.sheets.map((s) => [s.number, navigationGeometry(s.svg)]),
  );
  return dependencies.map((d) => ({
    id: d.id,
    sheet: d.owner.sheet,
    views: (geometry.get(d.owner.sheet) ?? [])
      .filter((g) => g.node.attrs["data-navigation-view"] === d.owner.viewKey)
      .map(({ matrix, clip, visible }) => ({ matrix, clip, visible })),
  }));
}

/** Both directions conserve every caption, native row, resolution and auto
 * page. Unchanged companion pages add no separate page-count restriction. */
export function circuitDocumentGuard(
  candidate: RenderedPacket,
  original: RenderedPacket,
) {
  const packets = renumberedDocumentPackets(
    candidate,
    original,
    documents(original),
    documents(candidate),
  );
  if (!packets) return false;
  [candidate, original] = packets;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  return (
    same(metadata(candidate), metadata(original)) &&
    same(painted(candidate), painted(original)) &&
    same(companionPages(candidate), companionPages(original)) &&
    same(owners(candidate), owners(original))
  );
}
