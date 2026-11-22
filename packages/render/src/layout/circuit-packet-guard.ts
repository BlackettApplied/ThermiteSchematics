import { required } from "../presentation/util.js";
import { circuitCardGuard } from "./circuit-packet-cards.js";
import { circuitAnnotationGuard } from "./circuit-annotation-guard.js";
import { circuitDocumentGuard } from "./circuit-document-guard.js";
import type { RenderedPacket } from "../packet/types.js";
import { descendants, svgTree } from "../device-legend/svg-tree.js";

function viewCounts(packet: RenderedPacket) {
  const counts = new Map<string, number>();
  for (const sheet of packet.sheets) {
    const keys = new Set(
      descendants(svgTree(sheet.svg)).flatMap((n) =>
        n.attrs["data-navigation-view"]
          ? [n.attrs["data-navigation-view"]]
          : [],
      ),
    );
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
function paintedAnnotations(packet: RenderedPacket) {
  return packet.sheets
    .flatMap((s) =>
      descendants(svgTree(s.svg)).flatMap((n) => [
        ...(n.attrs["data-navigation-annotation"]
          ? [`annotation/${n.attrs["data-navigation-annotation"]}`]
          : []),
        ...(n.attrs["data-navigation-mirror-row"]
          ? [`row/${n.attrs.id}/${n.attrs["data-navigation-mirror-row"]}`]
          : []),
      ]),
    )
    .sort();
}
/** Both directions matter: an absent annotation/card must not evade locality.
 * Compare the original printed card distances and circuit cards too. */
export function circuitPacketGuard(
  candidate: RenderedPacket,
  original: RenderedPacket,
) {
  if (candidate.sheets.length > original.sheets.length) return false;
  const before = viewCounts(original),
    after = viewCounts(candidate);
  if (
    before.size !== after.size ||
    [...before].some(
      ([key, n]) =>
        !after.has(key) ||
        required(after.get(key), "Missing native circuit geometry") > n,
    )
  )
    return false;
  if (
    !circuitCardGuard(candidate, original) ||
    !circuitDocumentGuard(candidate, original) ||
    JSON.stringify(paintedAnnotations(candidate)) !==
      JSON.stringify(paintedAnnotations(original))
  )
    return false;
  const old = new Map(
    (original.navigation?.annotations ?? []).map((a) => [a.id, a]),
  );
  const current = candidate.navigation?.annotations ?? [];
  if (
    old.size !== current.length ||
    new Set(current.map((a) => a.id)).size !== old.size
  )
    return false;
  return current.every((a) => {
    const b = old.get(a.id);
    return !!b && circuitAnnotationGuard(a, b);
  });
}
