import type { Rect } from "../device-legend/geometry.js";
import {
  navigationObstacles,
  NavigationSlotFailure,
} from "./navigation-slots.js";
import { searchNavigationSlot } from "./navigation-slot-search.js";
import type { PeerReference } from "./peer-reference-ink.js";
import type { NavigationShape } from "./navigation-types.js";
import type { RenderedSheet } from "./types.js";

// One wire plate (4.6 mm) plus the existing 1.5 mm ink clearance.
const PEER_REACH_MM = 6.1;
// Source-free text must start directly beside its owner.
const UNNAMED_REACH_MM = 2.1;
const unnamed = new Set(["compact", "locator"]);
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
}

function place(
  entry: PeerReference,
  shapes: readonly NavigationShape[],
  field: Rect,
  ink: ReturnType<typeof navigationObstacles>,
) {
  const search = (
    forms: readonly NavigationShape[],
    anchors: readonly Rect[],
    reachMm: (shape: NavigationShape) => number,
  ) => {
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
      (shape) => ({ anchors, gap: reachMm(shape) }),
    );
    if (found) return { box: found.box, lines: found.shape.maximumForms };
  };
  const near = search(shapes, [entry.owner], (form) =>
    unnamed.has(form.id) ? UNNAMED_REACH_MM : PEER_REACH_MM,
  );
  if (near) return near;

  // In a tight drawing the same conductor's painted stroke or existing
  // continuation caption supplies a second anchor, always with the source named.
  const supports = [...(entry.along ?? []), ...(entry.captions ?? [])];
  if (!supports.length) return;
  const named = alongPreference.flatMap((id) =>
    shapes.filter((s) => s.id === id),
  );
  return search(named, supports, () => PEER_REACH_MM);
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
  const candidates = entries.map((entry) => ({
    entry,
    shapes: forms(
      entry,
      uses.get(entry.destination) === 1,
      ownerUses.get(ownerDestination(entry)) === 1,
    ),
  }));
  const obstacles = navigationObstacles(sheet.svg, true);
  const placeInOrder = (order: typeof candidates) => {
    const ink = { ink: [...obstacles.ink], texts: [...obstacles.texts] };
    const placements: PeerNotePlacement[] = [];
    for (const { entry, shapes } of order) {
      const result = place(entry, shapes, field, ink);
      if (!result) return { failed: entry };
      ink.ink.push(result.box);
      ink.texts.push(result.box);
      placements.push(result);
    }
    return { placements };
  };
  const forward = placeInOrder(candidates);
  if (forward.placements) return forward.placements;
  // Nearby captions can compete for the same slot. Retry in reverse order
  // with the original drawing ink before refusing the sheet.
  const backward = placeInOrder(candidates.reverse());
  if (backward.placements) return backward.placements.reverse();
  const entry = forward.failed;
  throw new NavigationSlotFailure(
    `Navigation ${entry.kind} cannot fit sheet ${sheet.number}: ${entry.value} has no clear slot within ${PEER_REACH_MM} mm of its owner.`,
    { field, owner: entry.owner },
  );
}
