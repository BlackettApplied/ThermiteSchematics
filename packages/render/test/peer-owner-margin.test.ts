import { expect, it } from "vitest";
import {
  CONDUCTOR_OWNER_MARGIN_MM,
  OWNER_MARGIN_MM,
  searchNavigationSlot,
} from "../src/packet/navigation-slot-search.js";
import { NavigationSlotFailure } from "../src/packet/navigation-slots.js";
import { navigationGeometry } from "../src/packet/navigation-walk.js";
import { placePeerNotes } from "../src/packet/peer-note-placement.js";
import { peerRouteIndex } from "../src/packet/peer-route-ink.js";
import { boxDistance } from "../src/packet/navigation-symbols.js";
import {
  emitPeerReferences,
  type PeerReference,
} from "../src/packet/peer-reference-ink.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import type { RenderedSheet } from "../src/packet/types.js";

const FIELD = { x: 28, y: 24, w: 360, h: 240 };

function sheetSvg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="431.8mm" height="279.4mm" viewBox="0 0 431.8 279.4">${body}</svg>`;
}

it("#573 exports OWNER_MARGIN_MM = 0.5, CONDUCTOR_OWNER_MARGIN_MM = 0.25, and rejects tied or sub-margin slots", () => {
  expect(OWNER_MARGIN_MM).toBe(0.5);
  expect(CONDUCTOR_OWNER_MARGIN_MM).toBe(0.25);
  const owner = { x: 102.82, y: 95.35, w: 1.3, h: 1.3 };
  const foreign = { x: 128.82, y: 95.35, w: 1.3, h: 1.3 };
  const shape = {
    id: "full",
    mode: "local" as const,
    inkMm: { x: 0, y: 0, w: 60, h: 2.3 },
    maximumForms: ["W-CTL-012 · S2.11 → PS1.+ 04.B2 (also shown 05.B2)"],
  };
  // Obstacles block above y=95 and force any slot below to start at x >= 97 (straddling S2.12).
  const obstacles = [
    { x: 28, y: 24, w: 360, h: 72 },
    { x: 28, y: 95, w: 67.5, h: 40 },
  ];
  const rejected = searchNavigationSlot(
    [shape],
    FIELD,
    owner,
    obstacles,
    undefined,
    [],
    false,
    undefined,
    undefined,
    false,
    () => ({
      anchors: [owner],
      ownerTargets: [owner],
      gap: 6.1,
      foreignOwners: [foreign],
      requireOwnerNearest: true,
    }),
  );
  expect(rejected).toBeUndefined();
});

it("#573 wraps/shifts to satisfy >= 0.5 mm owner margin and refuses via NavigationSlotFailure when impossible", () => {
  const owner = { x: 102.82, y: 95.35, w: 1.3, h: 1.3 };
  const foreign = { x: 128.82, y: 95.35, w: 1.3, h: 1.3 };
  const sheet: RenderedSheet = {
    number: 7,
    title: "S7",
    svg: sheetSvg(
      `<rect x="28" y="24" width="360" height="70" fill="none" stroke="#17212b" stroke-width="0.3"/>` +
        `<rect x="28" y="95" width="67.5" height="20" fill="none" stroke="#17212b" stroke-width="0.3"/>`,
    ),
    view: { format: "documentation-view/0.1", kind: "wiring" },
    continuations: [],
  };
  const entry: PeerReference = {
    kind: "conductor-peer",
    identity: ["s2.11", "w12", "ps1.+"],
    value: "W-CTL-012 · S2.11 → PS1.+ 04.B2 (also shown 05.B2)",
    compact: "→ PS1.+ 04.B2 (also shown 05.B2)",
    destination: "04.B2 (also shown 05.B2)",
    owner,
    foreignOwners: [foreign],
    ownerLabel: "S2.11",
  };
  const [placed] = placePeerNotes(sheet, FIELD, [entry], () => [
    {
      id: "full",
      mode: "local",
      inkMm: { x: 0, y: 0, w: 60, h: 2.3 },
      maximumForms: [entry.value],
    },
    {
      id: "wrapped",
      mode: "local",
      inkMm: { x: 0, y: 0, w: 28, h: 5.8 },
      maximumForms: ["W-CTL-012 · S2.11", "→ PS1.+ 04.B2 (also shown 05.B2)"],
    },
  ]);
  expect(placed).toBeDefined();
  const ownerGap = boxDistance(placed!.box, owner);
  const foreignGap = boxDistance(placed!.box, foreign);
  expect(foreignGap - ownerGap).toBeGreaterThanOrEqual(OWNER_MARGIN_MM);

  // When no placement can satisfy the margin, refuse cleanly via NavigationSlotFailure.
  const boxedEntry: PeerReference = {
    ...entry,
    foreignOwners: [
      { x: 102.82, y: 95.35, w: 1.3, h: 1.3 },
      { x: 104.2, y: 95.35, w: 1.3, h: 1.3 },
    ],
  };
  expect(() =>
    placePeerNotes(sheet, FIELD, [boxedEntry], () => [
      {
        id: "full",
        mode: "local",
        inkMm: { x: 0, y: 0, w: 60, h: 2.3 },
        maximumForms: [entry.value],
      },
    ]),
  ).toThrow(NavigationSlotFailure);
});

it("#573 biases horizontal anchor toward owner terminal among otherwise-equal candidates", () => {
  const owner = { x: 150, y: 100, w: 1.3, h: 1.3 };
  const shape = {
    id: "full",
    mode: "local" as const,
    inkMm: { x: 0, y: 0, w: 30, h: 2.3 },
    maximumForms: ["W1 · A.1 → B.1 02.B2"],
  };
  // Both vertically-below and distant-horizontal foreign terminals allow centering on owner.
  for (const foreign of [
    { x: 150, y: 130, w: 1.3, h: 1.3 },
    { x: 250, y: 100, w: 1.3, h: 1.3 },
  ]) {
    const found = searchNavigationSlot(
      [shape],
      FIELD,
      owner,
      [],
      undefined,
      [],
      false,
      undefined,
      undefined,
      false,
      () => ({
        anchors: [owner],
        ownerTargets: [owner],
        gap: 6.1,
        foreignOwners: [foreign],
        requireOwnerNearest: true,
      }),
    );
    expect(found).toBeDefined();
    const ownerCenter = owner.x + owner.w / 2;
    const noteCenter = found!.box.x + found!.box.w / 2;
    expect(Math.abs(noteCenter - ownerCenter)).toBeLessThan(0.1);
  }
});

it("#573 enforces zero-margin nearest-owner rule on same-function siblingOwners", () => {
  const note = { x: 50, y: 50, w: 10, h: 2 };
  const owner = { x: 50, y: 48, w: 1.3, h: 0.5 };
  const shape = {
    id: "full",
    mode: "local" as const,
    inkMm: note,
    maximumForms: ["K-Y · coil terminal A1 → contact terminal 14 07.C4"],
  };
  const ownerGap = boxDistance(owner, note);
  const probe = (
    extra: Partial<
      Parameters<typeof searchNavigationSlot>[10] extends
        ((s: never) => infer R) | undefined
        ? R
        : never
    >,
  ) =>
    searchNavigationSlot(
      [shape],
      note,
      owner,
      [],
      undefined,
      [],
      false,
      undefined,
      undefined,
      false,
      () => ({
        anchors: [owner],
        ownerTargets: [owner],
        gap: 6.1,
        requireOwnerNearest: true,
        ...extra,
      }),
    );
  const closerSibling = { ...owner, y: note.y + note.h + ownerGap - 0.1 };
  expect(probe({ siblingOwners: [closerSibling] })).toBeUndefined();
  const validSibling = { ...owner, y: note.y + note.h + ownerGap + 0.35 };
  expect(probe({ siblingOwners: [validSibling] })).toBeDefined();
  expect(probe({ foreignOwners: [validSibling] })).toBeUndefined();
});

function makeStrokeMarginCase(
  field: { x: number; y: number; w: number; h: number },
  owner: { x: number; y: number; w: number; h: number },
  strokeWidth: number,
  extraMm: number,
) {
  const y = +(field.y + field.h + boxDistance(field, owner) + extraMm).toFixed(
    4,
  );
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200">` +
    `<g data-device-uid="A"><circle class="terminal-marker" data-terminal-marker="true" data-terminal-key="1" cx="50.65" cy="47.35" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/></g>` +
    `<g data-circuit-conductor="w2"><path d="M40 ${y} H100" fill="none" stroke="#17212b" stroke-width="${strokeWidth}"/></g>` +
    `</svg>`;
  const runs = peerRouteIndex(navigationGeometry(svg)).foreignRuns({
    kind: "wire",
    uid: "w1",
  });
  const sheet: RenderedSheet = {
    number: 1,
    svg,
    title: "Stroke edge probe",
    view: { format: "documentation-view/0.1", kind: "wiring" },
    continuations: [],
  };
  return { y, runs, sheet };
}

it("#573 enforces 0.25 mm stroke-edge conductor margin and 0.5 mm device/terminal margin", () => {
  const value = "W1 · A.1 → B.1 02.B2";
  const compact = "→ B.1 02.B2";
  const metric = printableTextMetrics(value, 2.5);
  const field = {
    x: 50,
    y: 50,
    w: metric.right - metric.left + 0.041,
    h: metric.top - metric.bottom + 0.041,
  };
  const owner = { x: 50, y: 46.7, w: 1.3, h: 1.3 };
  const strokeWidth = 0.4;
  // 0.40 mm stroke at extra = 0.52 mm -> 0.32 mm stroke-edge margin:
  // passes foreignConductors (>= 0.25 mm) but fails foreignOwners (< 0.50 mm).
  const pass = makeStrokeMarginCase(field, owner, strokeWidth, 0.52);
  expect(pass.runs).toHaveLength(1);
  expect(pass.runs[0]!.y).toBeCloseTo(pass.y - strokeWidth / 2, 4);
  expect(pass.runs[0]!.h).toBeCloseTo(strokeWidth, 4);
  const baseEntry: PeerReference = {
    kind: "conductor-peer",
    identity: ["A.1", "w1", "B.1"],
    owner,
    value,
    compact,
    destination: "02.B2",
    ownerLabel: "A.1",
  };
  expect(() =>
    emitPeerReferences(pass.sheet, field, [
      { ...baseEntry, foreignConductors: pass.runs },
    ]),
  ).not.toThrow();
  expect(() =>
    emitPeerReferences(pass.sheet, field, [
      { ...baseEntry, foreignOwners: pass.runs },
    ]),
  ).toThrow(NavigationSlotFailure);
  // Boundary probes below 0.25 mm stroke-edge margin (centerline > 0.25 mm,
  // stroke edge 0.20 mm and 0.06 mm < 0.25 mm) must fail placement.
  for (const extraMm of [0.4, 0.26]) {
    const tight = makeStrokeMarginCase(field, owner, strokeWidth, extraMm);
    expect(() =>
      emitPeerReferences(tight.sheet, field, [
        { ...baseEntry, foreignConductors: tight.runs },
      ]),
    ).toThrow(NavigationSlotFailure);
  }
});
