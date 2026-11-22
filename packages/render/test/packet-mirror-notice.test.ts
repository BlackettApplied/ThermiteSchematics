import { expect, it } from "vitest";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";
import { mirrorFixture } from "./packet-mirror-fixture.js";
import { coilUid } from "./packet-navigation-fixture.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";

it("returns R006 without pagination or mutation when every existing sheet is full", async () => {
  const source = await offViewFixture();
  try {
    const f = mirrorFixture(source.ir, [
      [{ uid: coilUid, key: "coil", x: 170, y: 100 }],
    ]);
    // One exact mirror vacancy; every other pixel is occupied and no documentation sheet exists.
    f.sheets[0]!.svg = f.sheets[0]!.svg.replace(
      "</svg>",
      '<rect width="360" height="90"/><rect y="120" width="360" height="120"/><rect y="90" width="105" height="30"/><rect x="165" y="90" width="5" height="30"/><rect x="190" y="90" width="170" height="30"/></svg>',
    );
    const before = JSON.stringify(f);
    expect(
      finalizeNavigation(f.ir, f.drafts, f.sheets, { notice: false }).ok,
    ).toBe(true);
    expect(finalizeNavigation(f.ir, f.drafts, f.sheets)).toMatchObject({
      ok: false,
      error: { code: "R006", details: { navigationInvariant: true } },
    });
    expect(JSON.stringify(f)).toBe(before);
    expect(f.sheets).toHaveLength(1);
  } finally {
    await source.dispose();
  }
});

it("places the one packet notice in a vacant existing documentation sheet without repacking the coil", async () => {
  const source = await offViewFixture();
  try {
    const f = mirrorFixture(source.ir, [
      [{ uid: coilUid, key: "coil", x: 170, y: 100 }],
      [],
    ]);
    // Only a 55×25 mirror slot is vacant on the coil sheet; the note has its own existing page.
    f.sheets[0]!.svg = f.sheets[0]!.svg.replace(
      "</svg>",
      '<rect x="0" y="0" width="360" height="90" fill="black"/><rect x="0" y="120" width="360" height="120" fill="black"/><rect x="0" y="90" width="105" height="30" fill="black"/><rect x="165" y="90" width="5" height="30" fill="black"/><rect x="190" y="90" width="170" height="30" fill="black"/></svg>',
    );
    f.drafts[1]!.documentationTable = true;
    f.drafts[1]!.view = {
      format: "documentation-view/0.1",
      kind: "references",
      title: "Existing report",
    };
    f.sheets[1]!.view = f.drafts[1]!.view;
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.sheets).toHaveLength(2);
    expect(
      parseSvg(r.value.sheets[0]!.svg).querySelector(
        '[data-navigation-role="contact-notice"]',
      ),
    ).toBeNull();
    expect(
      parseSvg(r.value.sheets[1]!.svg).querySelector(
        '[data-navigation-role="contact-notice"]',
      )!.textContent,
    ).toBe(
      "Contact tables list device data; contacts not drawn in this packet are marked.",
    );
    const note = r.value.navigation.annotations.find(
      (a) => a.role === "contact-notice",
    )!;
    expect(
      r.value.navigation.occurrences.some((o) => o.id === note.ownerOccurrence),
    ).toBe(true);
    expect(
      r.value.navigation.reservations.find((r) => r.id === note.reservationId)!
        .allocatedMm!.sheet,
    ).toBe(2);
  } finally {
    await source.dispose();
  }
});

import { placeContactNotice } from "../src/packet/mirror-notice.js";
import type {
  NavigationAnnotation,
  AnnotationReservation,
} from "../src/packet/navigation-types.js";
import type { Draft, RenderedSheet } from "../src/packet/types.js";
it.each(["reserved-envelope", "report-cell"])(
  "keeps the packet notice out of a %s even when its current ink is empty",
  (kind) => {
    const annotations: NavigationAnnotation[] = [
      {
        id: "return",
        ownerOccurrence: "coil",
        ownerOccurrences: ["coil"],
        role: "return",
        targets: [],
        text: "K1 /01.A1",
        primitiveIds: ["return-ink"],
        reservationId: "return",
      },
    ];
    const reservations: AnnotationReservation[] = [
      {
        id: "return",
        ownerAppearance: "native-coil",
        ownerOccurrence: "coil",
        profileId: "literal",
        space: "sheet-slot",
        inkMm: { x: 0, y: 0, w: 360, h: 230 },
        maximumForms: ["maximum roles"],
        allocatedMm: {
          sheet: 1,
          rect:
            kind === "reserved-envelope"
              ? { x: 0, y: 0, w: 360, h: 230 }
              : { x: 300, y: 0, w: 30, h: 6 },
        },
      },
    ];
    const draft = {
      drawingBounds: { x: 0, y: 0, w: 360, h: 240 },
      documentationTable: true,
    } as Draft;
    const cell =
      kind === "report-cell"
        ? '<g data-report-column="1" data-cell-x="0" data-cell-y="0" data-cell-width="360" data-cell-height="230"/>'
        : "";
    const sheets: RenderedSheet[] = [
      {
        number: 1,
        view: {
          format: "documentation-view/0.1",
          kind: "references",
          title: "Existing document",
        },
        references: [],
        continuations: [],
        svg: `<svg viewBox="0 0 360 240">${cell}</svg>`,
      },
    ];
    placeContactNotice(annotations, reservations, [draft], sheets);
    const note = reservations.find((r) => r.profileId === "contact-notice/2")!;
    expect(note.allocatedMm!.rect.y).toBeGreaterThanOrEqual(231.5);
  },
);
