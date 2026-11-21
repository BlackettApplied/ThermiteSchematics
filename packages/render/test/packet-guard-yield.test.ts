import { expect, it } from "vitest";
import { circuitAnnotationGuard } from "../src/layout/circuit-annotation-guard.js";
import { circuitCardGuard } from "../src/layout/circuit-packet-cards.js";
import { circuitPacketGuard } from "../src/layout/circuit-packet-guard.js";
import { yieldPacket, yieldSheet } from "./yield-packet.fixture.js";

function annotation(distanceMm: number | null, mode: "local" | "self-located") {
  return {
    id: "native-annotation-a",
    ownerOccurrence: "native-occurrence-a",
    ownerOccurrences: ["native-occurrence-a"],
    role: "repeat" as const,
    targets: ["native-occurrence-b"],
    text: "Synthetic device",
    primitiveIds: ["native-ink-a"],
    reservationId: "native-reservation-a",
    locality: {
      mode,
      anchorMm: { x: 10, y: 10 },
      frameMm: { x: 0, y: 0, w: 20, h: 20 },
      ownerLocation: { sheet: 1, zone: "A1" },
      distanceMm,
    },
  };
}

it.each(["local", "self-located"] as const)(
  "absorbs floating-point distance drift but rejects a 0.01 mm increase (%s)",
  (mode) => {
    const before = annotation(32.85929999999996, mode);
    expect(
      circuitAnnotationGuard(annotation(32.85935323365203, mode), before),
    ).toBe(true);
    expect(
      circuitAnnotationGuard(annotation(32.86929999999996, mode), before),
    ).toBe(false);
  },
);

it("retains absent distance only for unchanged self-located evidence", () => {
  const before = annotation(null, "self-located");
  expect(circuitAnnotationGuard(structuredClone(before), before)).toBe(true);
});

it.each([
  [null, null, "local", "local"],
  [null, 5, "self-located", "local"],
  [5, null, "self-located", "self-located"],
  [null, 5, "self-located", "self-located"],
  [5, 4, "local", "self-located"],
  [5, 6, "self-located", "self-located"],
  [NaN, NaN, "self-located", "self-located"],
  [Infinity, Infinity, "self-located", "self-located"],
  [-1, -1, "self-located", "self-located"],
] as const)(
  "fails closed for original %s / candidate %s in modes %s / %s",
  (old, next, oldMode, nextMode) => {
    expect(
      circuitAnnotationGuard(
        annotation(next, nextMode),
        annotation(old, oldMode),
      ),
    ).toBe(false);
  },
);

it("preserves native annotation ownership when null distances are permitted", () => {
  const before = annotation(null, "self-located");
  expect(
    circuitAnnotationGuard(
      { ...before, ownerOccurrence: "foreign-owner" },
      before,
    ),
  ).toBe(false);
});
it("requires finite return-owner distances even when label mode is self-located", () => {
  const source = annotation(null, "self-located");
  const before = {
    ...source,
    role: "return" as const,
    returnLocality: {
      sheet: 1,
      owners: [
        {
          occurrenceId: "native-occurrence-a",
          anchorMm: { x: 10, y: 10 },
          distanceMm: null,
        },
      ],
    },
  };
  expect(circuitAnnotationGuard(structuredClone(before), before)).toBe(false);
});

it("accepts page removal and renumbering using native card owners, not titles", () => {
  const before = yieldPacket([
    yieldSheet(1, "view-a", "a"),
    yieldSheet(2, "view-b"),
    yieldSheet(3, "view-b", "b"),
  ]);
  const after = yieldPacket([
    yieldSheet(1, "view-a", "a"),
    {
      ...yieldSheet(2, "view-b", "b"),
      view: {
        format: "documentation-view/0.1",
        kind: "circuit",
        title: "Renamed",
      },
    },
  ]);
  expect(circuitCardGuard(after, before)).toBe(true);
  expect(circuitPacketGuard(after, before)).toBe(true);
});

it.each(["owner", "conductor", "view", "missing", "farther"] as const)(
  "renumbering never hides a changed card %s",
  (kind) => {
    const before = yieldPacket([yieldSheet(3, "view-a", "a")]);
    const sheet = yieldSheet(2, "view-a", "a");
    let svg = sheet.svg;
    if (kind === "owner") svg = svg.replaceAll("device-a", "foreign-device");
    if (kind === "conductor") svg = svg.replaceAll("wire-a", "foreign-wire");
    if (kind === "view") svg = svg.replaceAll("view-a", "foreign-view");
    if (kind === "missing")
      svg = svg.replace('class="off-view-card"', 'class="absent"');
    if (kind === "farther") svg = svg.replace('x="20"', 'x="40"');
    expect(circuitCardGuard(yieldPacket([{ ...sheet, svg }]), before)).toBe(
      false,
    );
  },
);

it("preserves card multiplicity for repeated native owners", () => {
  const before = yieldPacket([
    yieldSheet(1, "view-a", "a"),
    yieldSheet(3, "view-a", "a"),
  ]);
  const after = yieldPacket([
    yieldSheet(1, "view-a", "a"),
    yieldSheet(2, "view-a", "a"),
  ]);
  expect(circuitCardGuard(after, before)).toBe(true);
  expect(
    circuitCardGuard(yieldPacket([yieldSheet(1, "view-a", "a")]), before),
  ).toBe(false);
});
