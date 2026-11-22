import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { offViewFixture } from "./off-view-fixtures.js";
import { appearanceFixture } from "./packet-navigation-appearance-fixture.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import { renderSchematicPacket } from "../src/sheets.js";
const unwrapped = (s: string) => s.replace(/\n/g, " ");
it("merges separately drawn gang poles into one device-appearance label", async () => {
  const source = await offViewFixture();
  try {
    const f = appearanceFixture(source.ir),
      r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(
      r.value.navigation.annotations.map((a) => unwrapped(a.text)),
    ).toEqual([
      "K1: Also shown 02.A2, 02.B2, 02.C2",
      "K1: Repeat of 01.A2, 01.B2, 01.C2 (same functions)",
    ]);
    for (const a of r.value.navigation.annotations) {
      expect(a.ownerOccurrences).toHaveLength(3);
      expect(a.locality!.anchorMm).toEqual({ x: 60, y: 65 });
      expect(a.locality!.ownerLocation.zone).toBe("B2");
    }
  } finally {
    await source.dispose();
  }
});
it("de-duplicates and sorts targets from separate functions in literal reading order", async () => {
  const source = await offViewFixture();
  try {
    const positions = [
      { key: "pole1", x: 50, y: 100 },
      { key: "pole2", x: 50, y: 20 },
      { key: "pole3", x: 50, y: 25 },
    ];
    const f = appearanceFixture(source.ir, [positions, positions]),
      r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(
      r.value.navigation.annotations.map((a) => unwrapped(a.text)),
    ).toEqual([
      "K1: Also shown 02.A2, 02.C2",
      "K1: Repeat of 01.A2, 01.C2 (same functions)",
    ]);
  } finally {
    await source.dispose();
  }
});
it("uses each mixed heading's own function count for its qualifier", async () => {
  const source = await offViewFixture();
  try {
    const coil = { key: "coil", x: 50, y: 20 },
      pole = { key: "pole1", x: 50, y: 60 };
    const f = appearanceFixture(source.ir, [[coil], [coil, pole], [pole]]),
      r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const a = r.value.navigation.annotations.filter(
      (a) => a.locality!.ownerLocation.sheet === 2,
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.role).toBe("mixed");
    expect(unwrapped(a[0]!.text)).toBe(
      "K1: Also shown 03.B2 Repeat of 01.A2 (same function)",
    );
  } finally {
    await source.dispose();
  }
});
it("prints one CB1, K1 and OL1 label per device appearance in the duplicate-M1 probe", async () => {
  const c = await compileProject("examples/conveyor-line");
  if (!c.ok) throw Error(JSON.stringify(c));
  const view = {
    format: "schematic-view-request/0.1" as const,
    root: { by: "designation" as const, value: "M1" },
    family: "power" as const,
    flow: "left-to-right" as const,
  };
  const r = await renderSchematicPacket(
    c.ir,
    { format: "schematic-packet-request/0.1", views: [view, view] },
    c.presentation,
  );
  if (!r.ok) throw Error(JSON.stringify(r.error));
  expect(r.value.sheets).toHaveLength(4);
  for (const tag of ["CB1", "K1", "OL1"]) {
    const uid = c.ir.devices.find((d) => d.designation === tag)!.uid;
    const ids = new Set(
      r.value
        .navigation!.occurrences.filter((o) => o.source.deviceUid === uid)
        .map((o) => o.id),
    );
    const labels = r.value.navigation!.annotations.filter(
      (a) =>
        ids.has(a.ownerOccurrence) &&
        ["canonical", "repeat", "mixed"].includes(a.role),
    );
    expect(labels).toHaveLength(2);
    expect(labels.map((a) => a.ownerOccurrences.length)).toEqual([3, 3]);
    if (tag === "CB1")
      expect(labels.map((a) => unwrapped(a.text))).toEqual([
        "CB1: Also shown 03.B4, 03.C4",
        "CB1: Repeat of 01.B4, 01.C4 (same functions)",
      ]);
  }
});

import { conveyorRequest } from "./packet-navigation-review-fixture.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import { symbolGeometry } from "../src/packet/navigation-symbols.js";
import { resolveLabelLocality } from "../src/packet/navigation-locality.js";
it("uses native conveyor SRC1’s all-terminal zone for local and self-located forms", async () => {
  const c = await compileProject("examples/conveyor-line");
  if (!c.ok) throw Error(JSON.stringify(c));
  const request = {
    ...conveyorRequest(),
    layout: "standard" as const,
    page: { size: "letter" as const, orientation: "portrait" as const },
  };
  const r = await renderSchematicPacket(c.ir, request, c.presentation);
  if (!r.ok) throw Error(JSON.stringify(r.error));
  // Location lines preserve this narrow packet’s capacity; native drawing
  // placement and the all-terminal anchor below remain exact.
  expect(r.value.sheets).toHaveLength(20);
  expect(
    r.value.sheets.filter((s) => s.view.format.startsWith("schematic-view/")),
  ).toHaveLength(9);
  expect(
    r.value.sheets.filter((s) => "kind" in s.view && s.view.kind === "wires"),
  ).toHaveLength(4);
  const uid = c.ir.devices.find((d) => d.designation === "SRC1")!.uid;
  const owner = r.value.navigation!.occurrences.find(
    (o) =>
      o.source.deviceUid === uid &&
      o.source.functionKey === "three_phase_source" &&
      o.destination.sheet === 1,
  )!;
  expect(owner.destination.zone).toBe("A4");
  // The appearance service must accept any member as representative, including
  // this source function whose own anchor lies just above the B-row boundary.
  const geometry = symbolGeometry(
    owner,
    r.value.navigation!.occurrences,
    r.value.sheets[0]!.svg,
    { x: 28, y: 51, w: 159.9, h: 174.4 },
  );
  expect(geometry.ownerLocation).toEqual({ sheet: 1, zone: "B4" });
  const a = r.value.navigation!.annotations.find((a) =>
    a.ownerOccurrences.includes(owner.id),
  )!;
  expect(a.locality!.anchorMm).toEqual({ x: 134, y: 95.19 });
  expect(a.locality!.ownerLocation).toEqual({ sheet: 1, zone: "B4" });
  expect(unwrapped(a.text)).toBe("SRC1: Also shown 04.A4, 04.B4");
  const slot = r.value.navigation!.reservations.find(
    (s) => s.id === a.reservationId,
  )!;
  const shape = slot.shapes!.find((s) => s.mode === "self-located")!;
  // Exercise the self-located form explicitly: this native appearance now has
  // a legal local slot when measured from its actual ink.
  const self = resolveLabelLocality(
    c.ir,
    { ...a, text: unwrapped(a.text) },
    {
      ...slot,
      allocatedMm: {
        sheet: 1,
        rect: { ...slot.allocatedMm!.rect, w: shape.inkMm.w, h: shape.inkMm.h },
        shapeId: shape.id,
        placement: "self-located",
      },
    },
    geometry,
    uid,
  );
  expect(unwrapped(self.text)).toBe("SRC1 (01.B4): Also shown 04.A4, 04.B4");
});
it("fixes the envelope to native candidates when pagination removes a repeated member", async () => {
  const source = await offViewFixture();
  try {
    const f = appearanceFixture(source.ir);
    f.drafts[0]!.navigationSeeds![0]!.fragmentEndpoints = ["1/L1"];
    f.drafts[0]!.navigationSeeds![0]!.partEndpointKeys = ["1/L1"];
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(
      r.value.navigation.annotations.map((a) => a.ownerOccurrences.length),
    ).toEqual([2, 2]);
    const literal = "K1: Repeat of 100.D1, 100.D1, 100.D1 (same functions)";
    const m = printableTextMetrics(literal, 3.502),
      w =
        Math.ceil((Math.max(m.advance, m.right) - Math.min(m.left, 0)) * 1000) /
          1000 +
        2;
    for (const slot of r.value.navigation.reservations) {
      expect(slot.profileId).toBe("repeat-max-roles/2/3/3");
      expect(slot.maximumForms[0]).toBe(
        "K1: Also shown 100.D1, 100.D1, 100.D1",
      );
      expect(slot.inkMm).toEqual({ x: 0, y: 0, w, h: 10.6 });
    }
  } finally {
    await source.dispose();
  }
});
