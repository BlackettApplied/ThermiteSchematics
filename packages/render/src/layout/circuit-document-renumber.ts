import type { RenderedPacket } from "../packet/types.js";
import type { IssuedDocument } from "../packet/document-types.js";
import { normalizedDocumentPacket } from "./circuit-document-normalize.js";

/** One order-preserving page map, derived from stable M3 ids, never from text. */
export function renumberedDocumentPackets(
  candidate: RenderedPacket,
  original: RenderedPacket,
  before: readonly IssuedDocument[] = [],
  after: readonly IssuedDocument[] = [],
): readonly [RenderedPacket, RenderedPacket] | undefined {
  const pages = new Map<number, number>(),
    inverse = new Map<number, number>();
  const add = (old: number, next: number) => {
    if (
      !Number.isInteger(old) ||
      !Number.isInteger(next) ||
      old < 1 ||
      next < 1 ||
      !original.sheets.some((s) => s.number === old) ||
      !candidate.sheets.some((s) => s.number === next) ||
      (pages.has(old) && pages.get(old) !== next) ||
      (inverse.has(next) && inverse.get(next) !== old)
    )
      return false;
    pages.set(old, next);
    inverse.set(next, old);
    return true;
  };
  const dependencies = original.navigation?.dependencies ?? [],
    current = candidate.navigation?.dependencies ?? [];
  if (dependencies.length !== current.length || before.length !== after.length)
    return undefined;
  for (const d of dependencies) {
    const peer = current.find((n) => n.id === d.id);
    if (!peer || !add(d.owner.sheet, peer.owner.sheet)) return undefined;
  }
  for (const d of before) {
    const peer = after.find((n) => n.id === d.id);
    if (!peer || peer.rows.length !== d.rows.length) return undefined;
    for (const row of d.rows) {
      const next = peer.rows.find((r) => r.id === row.id);
      if (!next || !add(row.sheet, next.sheet)) return undefined;
    }
  }
  if (!autoPages(original, candidate, add)) return undefined;
  const ordered = [...pages].sort(([a], [b]) => a - b);
  let previous = 0;
  for (const [, number] of ordered) {
    if (number <= previous) return undefined;
    previous = number;
  }
  if (!pages.size) return [candidate, original];
  try {
    return [
      normalizedDocumentPacket(
        candidate,
        new Map([...inverse.keys()].map((n) => [n, n])),
        candidate.sheets.length,
        after,
      ),
      normalizedDocumentPacket(
        original,
        pages,
        candidate.sheets.length,
        before,
      ),
    ];
  } catch {
    return undefined;
  }
}

function autoPages(
  original: RenderedPacket,
  candidate: RenderedPacket,
  add: (old: number, next: number) => boolean,
) {
  const origins = original.navigation?.autoDocuments ?? [],
    nextOrigins = candidate.navigation?.autoDocuments ?? [],
    shifts = new Set<number>();
  if (origins.length !== nextOrigins.length) return false;
  for (const d of origins) {
    const peer = nextOrigins.find((n) => n.documentId === d.documentId);
    if (!peer || peer.sheets.length !== d.sheets.length) return false;
    for (const [i, old] of d.sheets.entries()) {
      const next = peer.sheets[i];
      if (next === undefined) return false;
      if (!add(old, next)) return false;
      shifts.add(next - old);
    }
  }
  return shifts.size <= 1;
}
