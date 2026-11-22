import type { Draft, Link, PaperPage } from "./types.js";
import { bounds, zone } from "./page.js";
import { PacketDraftError } from "./errors.js";

/** Explicit reciprocal ends also distinguish two endpoints on the same sheet. */
export function resolveRootedContinuations(
  drafts: readonly Draft[],
  page: PaperPage,
) {
  const pairs = new Map<
    string,
    { link: Link; draft: Draft; sheet: number }[]
  >();
  drafts.forEach((draft, i) =>
    draft.links.forEach((link) => {
      const values = pairs.get(link.id) ?? [];
      values.push({ link, draft, sheet: i + 1 });
      pairs.set(link.id, values);
    }),
  );
  for (const [id, ends] of pairs) {
    const a = ends[0],
      z = ends[1];
    if (
      !a ||
      !z ||
      ends.length !== 2 ||
      a.link.end === undefined ||
      a.link.end === z.link.end ||
      a.link.to !== z.sheet ||
      z.link.to !== a.sheet ||
      a.link.conductor !== z.link.conductor ||
      a.link.netId !== z.link.netId
    )
      throw new PacketDraftError(
        `Continuation ${id} does not have two reciprocal authored endpoints.`,
        ends.flatMap((e) => e.draft.views ?? []),
      );
    for (const [from, to] of [
      [a, z],
      [z, a],
    ] as const) {
      if (!Number.isFinite(to.link.x) || !Number.isFinite(to.link.y))
        throw new PacketDraftError(
          `Continuation ${id} has a non-finite peer anchor.`,
          from.draft.views ?? [],
        );
      from.link.toZone = zone(
        to.link.x,
        to.link.y,
        to.draft.drawingBounds ?? bounds(to.draft.title, page),
      );
    }
  }
}

export function renderedRootedContinuations(draft: Draft) {
  return draft.links.map((link) => ({
    id: link.id,
    toSheet: link.to,
    conductor: link.conductor,
    netId: link.netId,
    ...(link.designation === undefined
      ? {}
      : { designation: link.designation }),
    ...(link.toZone === undefined ? {} : { toZone: link.toZone }),
    ...(link.provenance === undefined
      ? {}
      : { provenance: { ...link.provenance } }),
    ...(link.end === undefined ? {} : { end: link.end }),
  }));
}
