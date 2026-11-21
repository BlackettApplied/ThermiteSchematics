import { expect, it } from "vitest";
import type { RenderedPacket } from "../src/packet/types.js";
import type { NavigationAnnotation } from "../src/packet/navigation-types.js";
import { circuitPacketGuard } from "../src/layout/circuit-packet-guard.js";
import { CONTACT_TABLE_NOTICE } from "../src/off-view/notice.js";
import { escapeXmlAttribute } from "../src/svg/escape.js";

function annotation(role: NavigationAnnotation["role"]): NavigationAnnotation {
  const common = {
    id: "annotation",
    ownerOccurrence: "owner",
    ownerOccurrences: ["owner"],
    role,
    targets: ["target"],
    text: "K1",
    primitiveIds: ["annotation-ink"],
    reservationId: "reservation",
  };
  if (role === "contact-notice")
    return { ...common, targets: [], text: CONTACT_TABLE_NOTICE };
  if (role === "return")
    return {
      ...common,
      returnLocality: {
        sheet: 1,
        owners: [
          { occurrenceId: "owner", anchorMm: { x: 0, y: 0 }, distanceMm: 10 },
        ],
      },
    };
  return {
    ...common,
    locality: {
      mode: "local",
      anchorMm: { x: 0, y: 0 },
      frameMm: { x: 0, y: 0, w: 10, h: 10 },
      ownerLocation: { sheet: 1, zone: "A1" },
      distanceMm: 10,
    },
    ...(role === "mirror"
      ? {
          mirror: {
            coil: { deviceUid: "device", functionKey: "coil" },
            heading: "K1",
            rows: [
              {
                source: { deviceUid: "device", functionKey: "contact" },
                state: "NO" as const,
                terminals: ["13", "14"],
                targets: ["target"],
                destinations: ["01.A1"],
                sourceOrigins: [],
                primitiveId: "row-ink",
              },
            ],
          },
        }
      : {}),
  };
}

function packet(a: NavigationAnnotation): RenderedPacket {
  const row = a.mirror?.rows[0];
  return {
    format: "schematic-packet/0.1",
    page: {
      size: "a3",
      orientation: "landscape",
      widthMm: 420,
      heightMm: 297,
      marginMm: 10,
    },
    sheets: [
      {
        number: 1,
        view: {
          format: "documentation-view/0.1",
          kind: "circuit",
          title: "Circuit",
        },
        svg: `<svg><g data-navigation-view="view"/><g data-navigation-annotation="annotation" id="annotation-ink">${row ? `<g id="row-ink" data-navigation-mirror-row="${escapeXmlAttribute(JSON.stringify(row.source))}"/>` : ""}</g></svg>`,
        references: [],
        continuations: [],
      },
    ],
    html: "",
    coverage: {} as RenderedPacket["coverage"],
    navigation: {
      format: "issued-navigation/0.1",
      snapshotDigest: "synthetic",
      anchorRule: "function-terminal-centroid/2",
      quantumMm: 0.01,
      rounding: "decimal-half-up/1",
      seeds: [],
      measurementGaps: [],
      occurrences: [],
      canonicalGroups: [],
      pageRegions: [],
      reservations: [
        {
          id: "reservation",
          ownerOccurrence: "owner",
          ownerAppearance: "owner",
          profileId: "synthetic",
          space: "sheet-slot",
          inkMm: { x: 0, y: 0, w: 100, h: 100 },
          maximumForms: [],
          allocatedMm: {
            sheet: 1,
            rect: { x: 1000, y: 1000, w: 100, h: 100 },
            placement: "local",
          },
        },
      ],
      annotations: [a],
    },
  };
}

it.each(["mirror", "repeat", "canonical", "mixed"] as const)(
  "uses final printed %s locality, never the reservation family or rectangle",
  (role) => {
    const before = packet(annotation(role)),
      after = structuredClone(before);
    const a = after.navigation!.annotations[0]!;
    a.locality!.distanceMm = 9;
    expect(circuitPacketGuard(after, before)).toBe(true);
    a.locality!.mode = "self-located";
    expect(circuitPacketGuard(after, before)).toBe(false);
    a.locality!.mode = "local";
    a.locality!.distanceMm = 10.01;
    expect(circuitPacketGuard(after, before)).toBe(false);
  },
);

it("conserves mirror source rows and painted rows independently", () => {
  const before = packet(annotation("mirror")),
    after = structuredClone(before);
  after.navigation!.annotations[0]!.mirror!.rows = [];
  expect(circuitPacketGuard(after, before)).toBe(false);
  const missingInk = structuredClone(before);
  missingInk.sheets[0]!.svg = missingInk.sheets[0]!.svg.replace(
    /<g id="row-ink"[^>]*\/>/,
    "",
  );
  expect(circuitPacketGuard(missingInk, before)).toBe(false);
});

it("compares every final return-owner distance while allowing an improvement", () => {
  const before = packet(annotation("return")),
    after = structuredClone(before);
  const a = after.navigation!.annotations[0]!.returnLocality!;
  a.owners[0]!.distanceMm = 9;
  a.owners[0]!.anchorMm.x = 5;
  expect(circuitPacketGuard(after, before)).toBe(true);
  a.owners[0]!.distanceMm = 10.01;
  expect(circuitPacketGuard(after, before)).toBe(false);
  a.owners = [];
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it("conserves the notice content while allowing NAV to wrap it", () => {
  const before = packet(annotation("contact-notice")),
    after = structuredClone(before);
  const a = after.navigation!.annotations[0]!;
  a.text = a.text.replaceAll(" ", "\n");
  expect(circuitPacketGuard(after, before)).toBe(true);
  a.text = "Contact tables";
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it.each(["mirror", "return", "contact-notice"] as const)(
  "rejects a dropped %s record or painted annotation",
  (role) => {
    const before = packet(annotation(role)),
      after = structuredClone(before);
    after.navigation!.annotations = [];
    expect(circuitPacketGuard(after, before)).toBe(false);
    const missingInk = structuredClone(before);
    missingInk.sheets[0]!.svg = '<svg><g data-navigation-view="view"/></svg>';
    expect(circuitPacketGuard(missingInk, before)).toBe(false);
  },
);
