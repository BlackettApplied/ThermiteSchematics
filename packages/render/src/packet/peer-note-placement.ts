import type { Rect } from "../device-legend/geometry.js";
import { required } from "../presentation/util.js";
import {
  navigationObstacles,
  NavigationSlotFailure,
} from "./navigation-slots.js";
import {
  NAVIGATION_CLEARANCE_MM,
  OWNER_MARGIN_MM,
  searchNavigationSlot,
} from "./navigation-slot-search.js";
import { boxDistance } from "./navigation-symbols.js";
import type { PeerReference } from "./peer-reference-ink.js";
import type { NavigationShape } from "./navigation-types.js";
import type { RenderedSheet } from "./types.js";

// One wire plate (4.6 mm) plus the existing 1.5 mm ink clearance.
const PEER_REACH_MM = 6.1;
// Last-resort fallback reach when a terminal sits directly on drawingBounds
// with zero 1.5 mm-clear slot inside PEER_REACH_MM (always named, always reported).
const FALLBACK_LABEL_REACH_MM = 20;
// Source-free text must start directly beside its owner.
const UNNAMED_REACH_MM = 2.1;
const unnamed = new Set(["compact", "compact-wrapped"]);
const alongPreference = [
  "qualified-wrapped",
  "named-compact-wrapped",
  "wrapped",
  "named-compact",
  "qualified",
  "full",
];

export interface PeerNotePlacement {
  box: Rect;
  lines: readonly string[];
  shapeId: string;
  fallback?: "qualified" | "terminal-label-anchor";
}

function searchPeerSlot(
  entry: PeerReference,
  forms: readonly NavigationShape[],
  field: Rect,
  ink: ReturnType<typeof navigationObstacles>,
  anchors: readonly Rect[],
  ownerTargetsFor: (shape: NavigationShape) => readonly Rect[],
  reachMm: (shape: NavigationShape) => number,
  fallback?: PeerNotePlacement["fallback"],
  preferAnchorDistance = false,
): PeerNotePlacement | undefined {
  const hasForeign = Boolean(entry.foreignOwners?.length);
  const found = searchNavigationSlot(
    forms,
    field,
    entry.owner,
    ink.ink,
    undefined,
    ink.texts,
    false,
    undefined,
    undefined,
    false,
    (shape) => ({
      anchors,
      ownerTargets: ownerTargetsFor(shape),
      gap: reachMm(shape),
      textVerticalClearanceMm: NAVIGATION_CLEARANCE_MM,
      requireOwnerNearest: true,
      ...(preferAnchorDistance ? { preferAnchorDistance: true } : {}),
      ...(fallback === "terminal-label-anchor"
        ? { maxOwnerGapMm: PEER_REACH_MM }
        : {}),
      ...(hasForeign ? { foreignOwners: entry.foreignOwners } : {}),
      ...(entry.foreignConductors?.length
        ? { foreignConductors: entry.foreignConductors }
        : {}),
      ...(entry.siblingOwners?.length
        ? { siblingOwners: entry.siblingOwners }
        : {}),
    }),
  );
  return (
    found && {
      box: found.box,
      lines: found.shape.maximumForms,
      shapeId: found.shape.id,
      ...(fallback ? { fallback } : {}),
    }
  );
}

function peerTargetSets(entry: PeerReference) {
  const ownReachMarks = entry.owners?.length ? entry.owners : [entry.owner];
  const ownPaintedMarks = entry.paintedOwners?.length
    ? entry.paintedOwners
    : ownReachMarks;
  const reachSupports = [...(entry.along ?? []), ...(entry.captions ?? [])];
  const paintedSupports = [
    ...(entry.paintedAlong ?? entry.along ?? []),
    ...(entry.captions ?? []),
  ];
  return {
    ownPaintedMarks,
    reachSupports,
    namedTargets: [...ownPaintedMarks, ...paintedSupports],
  };
}

function place(
  entry: PeerReference,
  shapes: readonly NavigationShape[],
  field: Rect,
  ink: ReturnType<typeof navigationObstacles>,
  allowTerminalLabelFallback = false,
): PeerNotePlacement | undefined {
  const reachFor = (form: NavigationShape) =>
    unnamed.has(form.id) ? UNNAMED_REACH_MM : PEER_REACH_MM;
  const { ownPaintedMarks, reachSupports, namedTargets } =
    peerTargetSets(entry);
  const ownerTargetsFor = (form: NavigationShape) =>
    unnamed.has(form.id) ? ownPaintedMarks : namedTargets;
  const near = searchPeerSlot(
    entry,
    shapes,
    field,
    ink,
    [entry.owner],
    ownerTargetsFor,
    reachFor,
  );
  if (near) return near;
  const alternates = entry.owners?.filter((o) => o !== entry.owner) ?? [];
  const alt = alternates.length
    ? searchPeerSlot(
        entry,
        shapes,
        field,
        ink,
        alternates,
        ownerTargetsFor,
        reachFor,
      )
    : undefined;
  if (alt) return alt;
  if (reachSupports.length) {
    const named = alongPreference.flatMap((id) =>
      shapes.filter((s) => s.id === id),
    );
    const alongHit = searchPeerSlot(
      entry,
      named,
      field,
      ink,
      reachSupports,
      () => namedTargets,
      () => PEER_REACH_MM,
      undefined,
      true,
    );
    if (alongHit) return alongHit;
  }
  if (!allowTerminalLabelFallback || !entry.terminalLabels?.length) return;
  const named = shapes.filter((s) => !unnamed.has(s.id));
  return named.length
    ? searchPeerSlot(
        entry,
        named,
        field,
        ink,
        entry.terminalLabels,
        () => namedTargets,
        () => FALLBACK_LABEL_REACH_MM,
        "terminal-label-anchor",
      )
    : undefined;
}

const WORDING_FAMILIES: readonly (readonly string[])[] = [
  ["full", "wrapped"],
  ["named-compact", "named-compact-wrapped"],
  ["compact", "compact-wrapped"],
  ["qualified", "qualified-wrapped"],
];

const NAMED_WORDING_FAMILIES = WORDING_FAMILIES.filter(
  (family) => !family.some((id) => unnamed.has(id)),
);

type PeerCandidate = {
  index: number;
  entry: PeerReference;
  shapes: NavigationShape[];
};

function tryPeerOrder(
  order: readonly PeerCandidate[],
  allowed: ReadonlySet<string>,
  field: Rect,
  ink: ReturnType<typeof navigationObstacles>,
  allowTerminalLabelFallback: boolean,
) {
  const localInk = { ink: [...ink.ink], texts: [...ink.texts] };
  const placed = new Map<number, PeerNotePlacement>();
  for (const { index, entry, shapes } of order) {
    const familyShapes = shapes.filter((s) => allowed.has(s.id));
    if (!familyShapes.length) return { failed: entry };
    const result = place(
      entry,
      familyShapes,
      field,
      localInk,
      allowTerminalLabelFallback,
    );
    if (!result) return { failed: entry };
    localInk.ink.push(result.box);
    localInk.texts.push(result.box);
    placed.set(index, result);
  }
  return { placed, ink: localInk };
}

function withPlacedInk(
  ink: ReturnType<typeof navigationObstacles>,
  placed: ReadonlyMap<number, PeerNotePlacement>,
) {
  const boxes = [...placed.values()].map((p) => p.box);
  return { ink: [...ink.ink, ...boxes], texts: [...ink.texts, ...boxes] };
}

const COMFORTABLE_FOREIGN_MARGIN_MM = OWNER_MARGIN_MM;

function entryScore(entry: PeerReference, placed: PeerNotePlacement) {
  const ownMarks = entry.paintedOwners?.length
    ? entry.paintedOwners
    : entry.owners?.length
      ? entry.owners
      : [entry.owner];
  const supports = [
    ...(entry.paintedAlong ?? entry.along ?? []),
    ...(entry.captions ?? []),
  ];
  const targets = unnamed.has(placed.shapeId)
    ? ownMarks
    : [...ownMarks, ...supports];
  const ownerGap = Math.min(...targets.map((t) => boxDistance(placed.box, t)));
  const foreign = [
    ...(entry.foreignOwners ?? []),
    ...(entry.foreignConductors ?? []),
  ];
  const margin = foreign.length
    ? Math.min(...foreign.map((f) => boxDistance(placed.box, f))) - ownerGap
    : Infinity;
  return { margin, ownerGap };
}

function sharedOwnerReorders(
  group: readonly PeerCandidate[],
  placed: ReadonlyMap<number, PeerNotePlacement>,
): PeerCandidate[][] {
  const byOwner = new Map<string, number[]>();
  group.forEach((c, pos) => {
    const key = c.entry.ownerLabel ?? JSON.stringify(c.entry.owner);
    const list = byOwner.get(key) ?? [];
    list.push(pos);
    byOwner.set(key, list);
  });
  const orders: PeerCandidate[][] = [];
  for (const positions of byOwner.values()) {
    if (positions.length < 2) continue;
    const tight = positions.some((pos) => {
      const c = required(group[pos], "Missing peer candidate");
      const p = placed.get(c.index);
      return (
        p !== undefined &&
        entryScore(c.entry, p).margin < COMFORTABLE_FOREIGN_MARGIN_MM
      );
    });
    if (!tight) continue;
    const reordered = [...group];
    const reversed = [...positions].reverse();
    positions.forEach((pos, i) => {
      const from = required(reversed[i], "Missing peer index");
      reordered[pos] = required(group[from], "Missing peer candidate");
    });
    orders.push(reordered);
  }
  return orders;
}

function betterSharedOrder(
  group: readonly PeerCandidate[],
  candidate: ReadonlyMap<number, PeerNotePlacement>,
  baseline: ReadonlyMap<number, PeerNotePlacement>,
) {
  const score = (map: ReadonlyMap<number, PeerNotePlacement>) =>
    group.map(({ index, entry }) =>
      entryScore(entry, required(map.get(index), "Missing peer placement")),
    );
  const cand = score(candidate);
  const base = score(baseline);
  // Reject any reorder that introduces a worse minimum foreign margin.
  const candMin = Math.min(...cand.map((s) => s.margin));
  const baseMin = Math.min(...base.map((s) => s.margin));
  if (candMin + 0.05 < baseMin) return false;
  const candSorted = cand.map((s) => s.margin).sort((a, b) => a - b);
  const baseSorted = base.map((s) => s.margin).sort((a, b) => a - b);
  for (let i = 0; i < candSorted.length; i++) {
    const diff = (candSorted[i] ?? 0) - (baseSorted[i] ?? 0);
    if (Math.abs(diff) > 0.05) return diff > 0;
  }
  return (
    Math.max(0, ...cand.map((s) => s.ownerGap)) + 0.05 <
    Math.max(0, ...base.map((s) => s.ownerGap))
  );
}

function tryPeerFamily(
  group: readonly PeerCandidate[],
  family: readonly string[],
  field: Rect,
  ink: ReturnType<typeof navigationObstacles>,
  allowTerminalLabelFallback: boolean,
) {
  const allowed = new Set(family);
  const forward = tryPeerOrder(
    group,
    allowed,
    field,
    ink,
    allowTerminalLabelFallback,
  );
  if (forward.placed) {
    let best = forward.placed;
    if (group.length > 1) {
      for (const order of sharedOwnerReorders(group, best)) {
        const attempt = tryPeerOrder(
          order,
          allowed,
          field,
          ink,
          allowTerminalLabelFallback,
        );
        if (attempt.placed && betterSharedOrder(group, attempt.placed, best))
          best = attempt.placed;
      }
    }
    return { placed: best, ink: withPlacedInk(ink, best) };
  }
  if (group.length > 1) {
    // Nearby captions can compete for the same slot. Retry in reverse order
    // within the same wording family before stepping down to a shorter family.
    const backward = tryPeerOrder(
      [...group].reverse(),
      allowed,
      field,
      ink,
      allowTerminalLabelFallback,
    );
    if (backward.placed)
      return {
        placed: backward.placed,
        ink: withPlacedInk(ink, backward.placed),
      };
  }
  return { failed: required(forward.failed, "Missing failed peer reference") };
}

function placePeerGroup(
  group: readonly PeerCandidate[],
  field: Rect,
  ink: ReturnType<typeof navigationObstacles>,
) {
  let firstFailed = required(group[0], "Missing peer group").entry;
  const passes = [
    { families: WORDING_FAMILIES, allowTerminalLabelFallback: false },
    ...(group.some((item) => item.entry.terminalLabels?.length)
      ? [
          {
            families: NAMED_WORDING_FAMILIES,
            allowTerminalLabelFallback: true,
          },
        ]
      : []),
  ];
  for (const { families, allowTerminalLabelFallback } of passes) {
    for (const family of families) {
      const attempt = tryPeerFamily(
        group,
        family,
        field,
        ink,
        allowTerminalLabelFallback,
      );
      if ("placed" in attempt) return attempt;
      firstFailed = attempt.failed;
    }
  }
  return { failed: firstFailed };
}

export function placePeerNotes(
  sheet: RenderedSheet,
  field: Rect,
  entries: readonly PeerReference[],
  forms: (
    entry: PeerReference,
    unique: boolean,
    uniqueForOwner: boolean,
  ) => NavigationShape[],
): PeerNotePlacement[] {
  const uses = new Map<string, number>();
  const ownerUses = new Map<string, number>();
  const ownerDestination = (e: PeerReference) =>
    JSON.stringify([e.ownerLabel, e.destination]);
  for (const entry of entries) {
    uses.set(entry.destination, (uses.get(entry.destination) ?? 0) + 1);
    const key = ownerDestination(entry);
    ownerUses.set(key, (ownerUses.get(key) ?? 0) + 1);
  }
  const candidates: PeerCandidate[] = entries.map((entry, index) => ({
    index,
    entry,
    shapes: forms(
      entry,
      uses.get(entry.destination) === 1,
      ownerUses.get(ownerDestination(entry)) === 1,
    ),
  }));
  const obstacles = navigationObstacles(sheet.svg, true);
  // Enforce one consistent peer-reference wording family per kind per sheet (#483).
  const byKind = new Map<PeerReference["kind"], PeerCandidate[]>();
  for (const item of candidates) {
    const list = byKind.get(item.entry.kind) ?? [];
    list.push(item);
    byKind.set(item.entry.kind, list);
  }
  let currentInk = { ink: [...obstacles.ink], texts: [...obstacles.texts] };
  const placements = new Array<PeerNotePlacement>(entries.length);
  for (const group of byKind.values()) {
    const result = placePeerGroup(group, field, currentInk);
    if ("failed" in result) {
      const entry = result.failed;
      throw new NavigationSlotFailure(
        `Navigation ${entry.kind} cannot fit sheet ${sheet.number}: ${entry.value} has no clear slot within ${PEER_REACH_MM} mm of its owner.`,
        { field, owner: entry.owner },
      );
    }
    currentInk = result.ink;
    for (const [index, placed] of result.placed) placements[index] = placed;
  }
  return placements;
}
