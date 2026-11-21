import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import { control, offViewFixture, parseSvg } from "./off-view-fixtures.js";

it("links two full synthetic coil appearances without replacing their local facts", async () => {
  const f = await offViewFixture();
  try {
    const before = JSON.stringify(f.ir);
    const result = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      views: [control(), control()],
    });
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const svg = result.value.sheets.map((s) => s.svg).join("");
    expect(svg).toContain("Repeat of");
    expect(svg).toContain("Also shown");
    expect(
      parseSvg(result.value.sheets[0]!.svg).querySelectorAll(
        "[data-off-view-terminal]",
      ).length,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(f.ir)).toBe(before);
  } finally {
    await f.dispose();
  }
});

import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import { navigationZone } from "../src/packet/navigation-location.js";
import { navigationViewKey } from "../src/packet/navigation-identity.js";
import {
  sourceIncidences,
  validateAppearanceIncidence,
} from "../src/packet/navigation-incidence.js";
import { navigationFixture, coilUid } from "./packet-navigation-fixture.js";
import { allocateNavigationSlots } from "../src/packet/navigation-slots.js";
import type { IssuedNavigation } from "../src/packet/navigation-types.js";
import type { RenderedSheet } from "../src/packet/types.js";

function finalized(f: ReturnType<typeof navigationFixture>) {
  const result = finalizeNavigation(f.ir, f.drafts, f.sheets);
  if (!result.ok) throw Error(JSON.stringify(result.error));
  return result.value;
}
/** Independent assertions against the hand-authored fixture's visible geometry and native source. */
function auditSynthetic(
  nav: IssuedNavigation,
  sheets: readonly RenderedSheet[],
) {
  expect(nav.occurrences).toHaveLength(2);
  for (const [i, o] of nav.occurrences.entries()) {
    expect(o.source).toEqual({ deviceUid: coilUid, functionKey: "coil" });
    expect(o.role).toBe("full-function");
    // (10 + 2*(10+30)/2, 20 + 2*10); literal fixture field: 120×80.
    expect(o.destination).toEqual({
      sheet: i + 1,
      zone: "C3",
      anchorMm: { x: 50, y: 40 },
      anchorRule: "function-terminal-centroid/2",
    });
    const sheet = sheets[i]!;
    const doc = parseSvg(sheet.svg);
    const markers = [...doc.querySelectorAll(".terminal-marker")];
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.getAttribute("data-device-uid"))).toEqual([
      coilUid,
      coilUid,
    ]);
    const a = nav.annotations.find((a) => a.ownerOccurrence === o.id)!;
    expect(a.role).toBe(i === 0 ? "canonical" : "repeat");
    const group = doc.querySelector(`[data-navigation-annotation="${a.id}"]`)!;
    expect(group).not.toBeNull();
    expect(group.getAttribute("display")).not.toBe("none");
    expect(group.getAttribute("transform")).toBeNull();
    expect(
      Number(group.querySelector("text")!.getAttribute("font-size")),
    ).toBeGreaterThanOrEqual(3.5);
    expect(group.getAttribute("data-navigation-owner")).toBe(o.id);
    expect(group.textContent).toBe(a.text);
    expect(a.targets).toEqual([nav.occurrences[i === 0 ? 1 : 0]!.id]);
    expect(a.text).toBe(
      i === 0 ? "K1: Also shown 02.C3" : "K1: Repeat of 01.C3 (same function)",
    );
  }
}

it("finalizes transformed geometry purely, reserves both maximum roles, and resolves after inserted sheets", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir),
      before = JSON.stringify(f);
    const a = finalized(f),
      b = finalized(f);
    auditSynthetic(a.navigation, a.sheets);
    expect(b).toEqual(a);
    expect(JSON.stringify(f)).toBe(before);
    expect(a.navigation.reservations[0]!.inkMm).toEqual(
      a.navigation.reservations[1]!.inkMm,
    );
    expect(
      a.navigation.reservations.every(
        (r) => r.maximumForms.length === 2 && r.space === "sheet-slot",
      ),
    ).toBe(true);
    const oldIds = a.navigation.occurrences.map((o) => o.id);
    f.drafts.splice(1, 0, {
      ...f.drafts[0]!,
      navigationSeeds: [],
      navigationView: undefined,
      content: "",
    });
    f.sheets.splice(1, 0, {
      ...f.sheets[0]!,
      number: 2,
      svg: '<svg viewBox="0 0 120 80"/>',
    });
    f.sheets[2] = { ...f.sheets[2]!, number: 3 };
    const moved = finalized(f);
    expect(moved.navigation.occurrences.map((o) => o.id)).toEqual(oldIds);
    expect(moved.navigation.annotations[0]!.text).toContain("03.C3");
    expect(moved.navigation.reservations.map((r) => r.inkMm)).toEqual(
      a.navigation.reservations.map((r) => r.inkMm),
    );
    f.drafts[0]!.navigationView!.authoredOrder = 2;
    const flipped = finalized(f);
    expect(flipped.navigation.canonicalGroups[0]!.canonical).toBe(oldIds[1]);
    expect(flipped.navigation.reservations.map((r) => r.inkMm)).toEqual(
      a.navigation.reservations.map((r) => r.inkMm),
    );
  } finally {
    await source.dispose();
  }
});

it("distinguishes a clipped boundary fragment from a full repeat", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir);
    f.sheets[1] = {
      ...f.sheets[1]!,
      svg: f.sheets[1]!.svg.replace(
        'width="80" height="40" viewBox="0 0 40 20"',
        'width="40" height="40" viewBox="0 0 20 20"',
      ),
    };
    const a = finalized(f);
    expect(a.navigation.occurrences.map((o) => o.role)).toEqual([
      "full-function",
      "boundary-fragment",
    ]);
    expect(a.navigation.occurrences[1]!.terminalKeys).toEqual(["A1"]);
    expect(a.navigation.occurrences[1]!.parentAppearance).toBeTruthy();
    expect(a.navigation.annotations).toEqual([]);
  } finally {
    await source.dispose();
  }
});

it.each([
  "strip-glyph-ownership",
  "strip-terminal-ownership",
  "foreign-glyph-owner",
  "drop-seed",
])("rejects provenance mutation %s", async (mutation) => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir);
    if (mutation === "drop-seed") f.drafts[0]!.navigationSeeds = [];
    else if (mutation === "foreign-glyph-owner")
      f.sheets[0] = {
        ...f.sheets[0]!,
        svg: f.sheets[0]!.svg.replace(
          `data-function-key="coil" data-device-uid="${coilUid}"`,
          'data-function-key="coil" data-device-uid="foreign"',
        ),
      };
    else
      f.sheets[0] = {
        ...f.sheets[0]!,
        svg: f.sheets[0]!.svg.replace(
          mutation === "strip-glyph-ownership"
            ? ' data-navigation-native="native"'
            : ` data-device-uid="${coilUid}" data-terminal-key="A1"`,
          mutation === "strip-terminal-ownership"
            ? ' data-terminal-key="A1"'
            : "",
        ),
      };
    expect(() => finalized(f)).toThrow(/ownership|seed/);
  } finally {
    await source.dispose();
  }
});

it.each([
  "delete-label",
  "hide-label",
  "foreign-owner",
  "wrong-zone",
  "foreign-target",
  "second-canonical",
  "fake-boundary",
])("checks the issued-output auditor control %s", async (mutation) => {
  const source = await offViewFixture();
  try {
    const a = finalized(navigationFixture(source.ir)),
      nav = structuredClone(a.navigation),
      sheets = structuredClone(a.sheets);
    const id = nav.annotations[1]!.id;
    if (mutation === "delete-label")
      sheets[1]!.svg = sheets[1]!.svg.replace(
        new RegExp(
          `<g id="[^"]*" data-navigation-annotation="${id}"[\\s\\S]*?</g>`,
        ),
        "",
      );
    if (mutation === "hide-label")
      sheets[1]!.svg = sheets[1]!.svg.replace(
        `data-navigation-annotation="${id}"`,
        `display="none" data-navigation-annotation="${id}"`,
      );
    if (mutation === "foreign-owner")
      sheets[1]!.svg = sheets[1]!.svg.replace(
        `data-navigation-owner="${nav.occurrences[1]!.id}"`,
        'data-navigation-owner="foreign"',
      );
    if (mutation === "wrong-zone") nav.occurrences[1]!.destination.zone = "D6";
    if (mutation === "foreign-target")
      nav.annotations[1]!.targets = ["report-row"];
    if (mutation === "second-canonical") nav.annotations[1]!.role = "canonical";
    if (mutation === "fake-boundary")
      nav.occurrences[1]!.role = "boundary-fragment";
    expect(() => auditSynthetic(nav, sheets)).toThrow();
  } finally {
    await source.dispose();
  }
});

it("rounds before half-open zone classification and refuses out-of-field anchors", () => {
  const b = { x: 0, y: 0, w: 120, h: 80 };
  expect(navigationZone(19.996, 19.996, b)).toBe("B2");
  expect(navigationZone(19.994, 19.994, b)).toBe("A1");
  expect(navigationZone(120, 80, b)).toBe("D6");
  expect(() => navigationZone(120.03, 40, b)).toThrow(/outside/);
  expect(navigationZone(19.97, 19.97, b)).not.toBe("B2");
});

it("refuses an actually occupied sheet slot", () => {
  expect(() =>
    allocateNavigationSlots(
      [
        {
          owner: { x: 0, y: 0, w: 10, h: 10 },
          reservation: {
            id: "r",
            ownerAppearance: "owner",
            ownerOccurrence: "owner",
            profileId: "test",
            space: "sheet-slot",
            inkMm: { x: 0, y: 0, w: 20, h: 6 },
            maximumForms: ["canonical", "repeat"],
          },
        },
      ],
      { x: 0, y: 0, w: 40, h: 40 },
      '<svg viewBox="0 0 40 40"><rect width="40" height="40" fill="black"/></svg>',
      1,
    ),
  ).toThrow(/cannot fit/);
});

it("UID-resolves stable view identities independently of tag/title/layout, keeping duplicate requests distinct", async () => {
  const f = await offViewFixture();
  try {
    const a = navigationViewKey(
      f.ir,
      {
        root: { by: "designation", value: "K1" },
        flow: "left-to-right",
        title: "old",
      },
      0,
    );
    const ir = structuredClone(f.ir);
    ir.devices.find((d) => d.uid === coilUid)!.designation = "renamed";
    expect(
      navigationViewKey(
        ir,
        {
          root: { by: "designation", value: "renamed" },
          flow: "left-to-right",
          title: "new",
          layout: "compact",
        },
        0,
      ),
    ).toBe(a);
    expect(
      navigationViewKey(
        f.ir,
        { root: { by: "designation", value: "K1" }, flow: "left-to-right" },
        1,
      ),
    ).not.toBe(a);
  } finally {
    await f.dispose();
  }
});

it("canonicalizes source snapshot order while retaining changed source facts", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir),
      before = finalized(f);
    expect(f.ir.devices.length).toBeGreaterThan(1);
    expect(f.ir.functions.length).toBeGreaterThan(1);
    f.ir.devices.reverse();
    f.ir.functions.reverse();
    expect(finalized(f)).toEqual(before);
    f.ir.project.description = "Changed authored project description";
    expect(finalized(f).navigation.snapshotDigest).not.toBe(
      before.navigation.snapshotDigest,
    );
  } finally {
    await source.dispose();
  }
});

it("keeps authored function and group keys literal when an unrelated device tag matches them", async () => {
  const f = await offViewFixture();
  try {
    const ir = structuredClone(f.ir);
    const unrelated = ir.devices.find((d) => d.uid !== coilUid)!;
    unrelated.designation = "coil";
    const selection = {
      family: "circuit",
      groups: [
        { id: "coil", device: { by: "uid", value: coilUid }, function: "coil" },
      ],
    };
    const before = navigationViewKey(ir, selection, 0);
    unrelated.designation = "unrelated-renamed";
    expect(navigationViewKey(ir, selection, 0)).toBe(before);
    expect(
      navigationViewKey(
        ir,
        {
          ...selection,
          groups: [
            { ...selection.groups[0], function: "different-authored-key" },
          ],
        },
        0,
      ),
    ).not.toBe(before);
  } finally {
    await f.dispose();
  }
});

it("enumerates a same-terminal loop twice and singly terminated cores without changing source nets", async () => {
  const f = await offViewFixture();
  try {
    const ir = structuredClone(f.ir),
      w = ir.wires[0]!;
    w.endpoints[1] = structuredClone(w.endpoints[0]!);
    const ends = sourceIncidences(ir).filter(
      (i) => i.element.kind === "wire" && i.element.uid === w.uid,
    );
    expect(ends.map((e) => e.end)).toEqual([0, 1]);
    expect(ends[0]!.terminal).toEqual(ends[1]!.terminal);
    expect(
      sourceIncidences(ir).some(
        (i) =>
          i.element.kind === "cable_conductor" && i.element.conductorId === "2",
      ),
    ).toBe(true);
    expect(
      sourceIncidences(ir).some(
        (i) =>
          i.element.kind === "cable_conductor" && i.element.conductorId === "3",
      ),
    ).toBe(false);
    expect(ir.nets).toEqual(f.ir.nets);
  } finally {
    await f.dispose();
  }
});

import { compileProject } from "@thermite/compiler";
import { resolve } from "node:path";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "retains PB1 11/12 per-appearance truth in conveyor %s",
  async (flow) => {
    const compiled = await compileProject(resolve("examples/conveyor-line"));
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const ir = compiled.ir,
      before = JSON.stringify(ir);
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      layout: "compact",
      index: true,
      views: [
        ...["M1", "M2"].map((value) => ({
          format: "schematic-view-request/0.1" as const,
          root: { by: "designation" as const, value },
          family: "power" as const,
          flow,
        })),
        ...["K1", "K2"].map((value) => ({
          format: "schematic-view-request/0.1" as const,
          root: { by: "designation" as const, value },
          family: "control" as const,
          flow,
        })),
        { format: "documentation-view-request/0.1", kind: "wires" },
        { format: "documentation-view-request/0.1", kind: "terminals" },
      ],
    });
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const packet = result.value,
      uid = ir.devices.find((d) => d.designation === "PB1")!.uid;
    const appearances = packet.navigation!.occurrences.filter(
      (o) => o.source.deviceUid === uid && o.source.functionKey === "contact11",
    );
    expect(appearances.map((o) => o.role)).toEqual([
      "full-function",
      "full-function",
    ]);
    expect(appearances.map((o) => o.terminalKeys.slice().sort())).toEqual([
      ["11", "12"],
      ["11", "12"],
    ]);
    expect(
      appearances.map((o) => `${o.destination.sheet}.${o.destination.zone}`),
    ).toEqual(flow === "left-to-right" ? ["3.B6", "4.B6"] : ["3.B3", "4.B3"]);
    const first = parseSvg(packet.sheets[2]!.svg),
      second = parseSvg(packet.sheets[3]!.svg);
    expect(
      first.querySelector('[data-off-view-terminal="PB1.12"]')!.textContent,
    ).toContain("W-CTL-009 → OL2.95");
    expect(
      second.querySelector('[data-off-view-terminal="PB1.12"]')!.textContent,
    ).toContain("W-CTL-006 → OL1.95");
    const repeat = packet.navigation!.annotations.find(
      (a) =>
        a.role === "repeat" &&
        appearances.some((o) => o.id === a.ownerOccurrence),
    )!;
    expect(repeat.text).toContain(
      flow === "left-to-right"
        ? "Repeat of 03.B6 (same contact)"
        : "Repeat of 03.B3 (same contact)",
    );
    const wireUid = ir.wires.find((w) => w.designation === "W-CTL-005")!.uid;
    for (const doc of [first, second])
      expect(
        new Set(
          [...doc.querySelectorAll(`[data-wire-uid="${wireUid}"]`)].map((p) =>
            p.getAttribute("data-wire-uid"),
          ),
        ),
      ).toEqual(new Set([wireUid]));
    expect(JSON.stringify(ir)).toBe(before);
    const mutated = structuredClone(packet.sheets);
    // Mutation: leave Repeat ink and the seed, remove the real disclosure and its clipped copies.
    for (const card of second.querySelectorAll(
      '[data-off-view-terminal="PB1.12"]',
    ))
      card.remove();
    mutated[3] = { ...mutated[3]!, svg: second.toString() };
    expect(mutated[3]!.svg).toContain("Repeat of");
    expect(() =>
      validateAppearanceIncidence(ir, packet.navigation!.occurrences, mutated),
    ).toThrow(/source-incidence/);
  },
);

it("gives members of an authored gang distinct persistent identities across sheets", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir);
    const gang = f.ir.gangedGroups.find((g) =>
      g.functionIds.some(
        (id) => id.deviceUid === coilUid && id.functionKey === "pole1",
      ),
    )!;
    expect(gang).toBeTruthy();
    for (const [i, key] of ["pole1", "pole2"].entries()) {
      const terminals = i === 0 ? ["1/L1", "2/T1"] : ["3/L2", "4/T2"];
      const seed = f.drafts[i]!.navigationSeeds![0]!;
      f.drafts[i]!.navigationSeeds = [
        {
          ...seed,
          source: { deviceUid: coilUid, functionKey: key },
          logicalKey: `gang-member-${key}`,
          terminals: seed.terminals.map((t, n) => ({
            ...t,
            key: terminals[n]!,
          })),
        },
      ];
      f.sheets[i] = {
        ...f.sheets[i]!,
        svg: f.sheets[i]!.svg.replaceAll(
          'function-key="coil"',
          `function-key="${key}"`,
        )
          .replaceAll('terminal-key="A1"', `terminal-key="${terminals[0]}"`)
          .replaceAll('terminal-key="A2"', `terminal-key="${terminals[1]}"`),
      };
    }
    const a = finalized(f);
    expect(a.navigation.occurrences.map((o) => o.source.functionKey)).toEqual([
      "pole1",
      "pole2",
    ]);
    expect(a.navigation.occurrences.map((o) => o.destination.sheet)).toEqual([
      1, 2,
    ]);
    expect(new Set(a.navigation.occurrences.map((o) => o.id)).size).toBe(2);
    f.sheets[1] = { ...f.sheets[1]!, number: 3 };
    expect(finalized(f).navigation.occurrences.map((o) => o.id)).toEqual(
      a.navigation.occurrences.map((o) => o.id),
    );
  } finally {
    await source.dispose();
  }
});

it("strictly rejects an unknown packet option without changing the public request schema", async () => {
  const f = await offViewFixture();
  try {
    const request = {
      format: "schematic-packet-request/0.1" as const,
      views: [control()],
      navigation: true,
    };
    const result = await renderSchematicPacket(f.ir, request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("invalid-packet");
  } finally {
    await f.dispose();
  }
});

import {
  createInMemoryCanonicalSchemaRegistry,
  parseJson,
  type JsonValue,
} from "@thermite/schema";
it("requires the authored contact state and never invents NO from a terminal number", () => {
  const raw = {
    kind: "device_type",
    id: "synthetic:contact",
    terminals: { "11": {}, "12": {} },
    functions: { "authored/~": { kind: "contact", terminals: ["11", "12"] } },
  };
  const parsed = parseJson(JSON.stringify(raw), "synthetic.json");
  const diagnostics = createInMemoryCanonicalSchemaRegistry().validateEntity(
    "device-type",
    parsed.value as JsonValue,
    { file: "synthetic.json", nodes: parsed.nodes },
  );
  expect(
    diagnostics.some(
      (d) => d.code === "E010" && d.message.includes("normal_state"),
    ),
  ).toBe(true);
});

it("preserves three independently selected synthetic shared-stop appearances", async () => {
  const uid = "84000000-0000-4000-8000-000000000041";
  const f = await offViewFixture((objects) => {
    objects.find((o) => o.designation === "W1").endpoints[1] = {
      device: "STOP α/~",
      terminal: "11",
    };
    objects.push(
      {
        kind: "device",
        uid,
        designation: "STOP α/~",
        type: "core:pushbutton-nc",
      },
      {
        kind: "device",
        uid: "84000000-0000-4000-8000-000000000042",
        designation: "K2",
        type: "core:contactor-3p-1no",
      },
    );
    for (const [n, designation, a, b] of [
      [43, "STOP-A", ["STOP α/~", "12"], ["K1", "A1"]],
      [44, "STOP-B", ["STOP α/~", "12"], ["K2", "A1"]],
      [45, "RETURN-B", ["K2", "A2"], ["PS1", "-"]],
    ] as const)
      objects.push({
        kind: "wire",
        uid: `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        designation,
        endpoints: [a, b].map(([device, terminal]) => ({ device, terminal })),
      });
  });
  try {
    const before = JSON.stringify(f.ir);
    const result = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        control(),
        { ...control(), root: { by: "designation", value: "K2" } },
        control(),
      ],
    });
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const nav = result.value.navigation!,
      appearances = nav.occurrences.filter((o) => o.source.deviceUid === uid);
    expect(appearances).toHaveLength(3);
    expect(new Set(appearances.map((o) => o.id)).size).toBe(3);
    expect(
      appearances.every(
        (o) =>
          o.role === "full-function" &&
          o.terminalKeys.slice().sort().join("/") === "11/12",
      ),
    ).toBe(true);
    const group = nav.canonicalGroups.find((g) => g.source.deviceUid === uid)!;
    expect(group.canonical).toBe(appearances[0]!.id);
    for (const [i, o] of appearances.entries()) {
      const doc = parseSvg(result.value.sheets[o.destination.sheet - 1]!.svg);
      expect(
        doc.querySelector('[data-off-view-terminal="STOP α/~.12"]')!
          .textContent,
      ).toContain(i === 1 ? "STOP-A → K1.A1" : "STOP-B → K2.A1");
    }
    expect(JSON.stringify(f.ir)).toBe(before);
  } finally {
    await f.dispose();
  }
});

import { centroidReferences } from "../src/packet/navigation-occurrences.js";
import { referenceTables } from "../src/packet/references.js";
it("moves function-reference rows to the same final terminal centroid", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir),
      result = finalized(f);
    f.drafts[0]!.references = [
      {
        deviceUid: coilUid,
        designation: "K1",
        functions: ["coil"],
        zone: "A1",
        xMm: 1,
        yMm: 1,
      },
    ];
    centroidReferences(f.drafts, result.navigation.occurrences);
    expect(f.drafts[0]!.references[0]).toMatchObject({
      xMm: 50,
      yMm: 40,
      zone: "C3",
    });
    const rows = referenceTables(
      f.ir,
      f.drafts,
      { page: {}, references: { appearances: "drawings" } },
      undefined,
    ).tables[1]!.rows;
    expect(rows.find((r) => r.deviceUids.includes(coilUid))!.cells[2]).toBe(
      "1 / C3",
    );
  } finally {
    await source.dispose();
  }
});

it("reserves maximum-role height for many selected views without splitting location tokens", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir);
    for (let i = 2; i < 7; i++) {
      const key = `view-${i}`,
        d = structuredClone(f.drafts[0]!);
      d.navigationView = { key, authoredOrder: i };
      d.content = d.content.replace(
        'data-navigation-view="first"',
        `data-navigation-view="${key}"`,
      );
      f.drafts.push(d);
      f.sheets.push({
        ...f.sheets[0]!,
        number: i + 1,
        svg: f.sheets[0]!.svg.replace(
          'data-navigation-view="first"',
          `data-navigation-view="${key}"`,
        ),
      });
    }
    const a = finalized(f);
    expect(a.navigation.annotations[0]!.text.replace(/\n/g, " ")).toBe(
      "K1: Also shown 02.C3, 03.C3, 04.C3, 05.C3, 06.C3, 07.C3",
    );
    for (const r of a.navigation.reservations) {
      expect(r.inkMm.h).toBe(
        Math.max(...r.maximumForms.map((f) => f.split("\n").length)) * 4.8 + 1,
      );
      expect(r.maximumForms[0]!.replace(/\n/g, " ")).toBe(
        "K1: Also shown 100.D1, 100.D1, 100.D1, 100.D1, 100.D1, 100.D1",
      );
    }
    expect(a.navigation.annotations[0]!.text).toContain("02.C3, 03.C3, 04.C3,");
    expect(a.navigation.annotations[0]!.text).toContain("05.C3, 06.C3, 07.C3");
  } finally {
    await source.dispose();
  }
});

it.each(["foreign-net", "duplicate-incidence"])(
  "rejects actual drawn source conservation mutation %s",
  async (mutation) => {
    const f = await offViewFixture();
    try {
      const result = await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        views: [control(), control()],
      });
      if (!result.ok) throw Error(JSON.stringify(result.error));
      const sheets = structuredClone(result.value.sheets),
        doc = parseSvg(sheets[0]!.svg),
        path = doc.querySelector(
          `[data-wire-uid="${f.ir.wires.find((w) => w.designation === "W1")!.uid}"]`,
        )!;
      if (mutation === "foreign-net")
        path.setAttribute("data-net-id", "foreign-net");
      else path.parentNode!.appendChild(path.cloneNode(true));
      sheets[0] = { ...sheets[0]!, svg: doc.toString() };
      expect(() =>
        validateAppearanceIncidence(
          f.ir,
          result.value.navigation!.occurrences,
          sheets,
        ),
      ).toThrow(/source-incidence|conservation/);
    } finally {
      await f.dispose();
    }
  },
);

it("reconciles fan-out incidence only through a visible, same-terminal owned attachment", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir),
      wire = source.ir.wires.find((w) => w.designation === "W1")!;
    f.ir.wires = [wire];
    const net = source.ir.indexes.netIdByTerminal.find(
      (n) => n.key.deviceUid === coilUid && n.key.terminalKey === "A1",
    )!.value;
    const route = `<path data-wire-uid="${wire.uid}" data-source-device-uid="${wire.endpoints[0].terminal.deviceUid}" data-source-terminal-key="+" data-target-device-uid="${coilUid}" data-target-terminal-key="A1" data-net-id="${net}" d="M 5 5 V 40 H 20" fill="none" stroke="black"/>`;
    const stub = `<path data-presentation-only="true" data-source-device-uid="${coilUid}" data-source-terminal-key="A1" data-target-device-uid="${coilUid}" data-target-terminal-key="A1" data-net-id="${net}" d="M 20 40 H 30" fill="none" stroke="black"/>`;
    for (const [i, sheet] of f.sheets.entries())
      f.sheets[i] = {
        ...sheet,
        svg: sheet.svg.replace(
          "</svg></g></svg>",
          `</svg>${route}${stub}</g></svg>`,
        ),
      };
    const result = finalized(f);
    expect(result.navigation.occurrences).toHaveLength(2);
    for (const mutation of ["remove-stub", "foreign-terminal", "hidden-stub"]) {
      const sheets = structuredClone(f.sheets);
      const replacement =
        mutation === "remove-stub"
          ? ""
          : mutation === "foreign-terminal"
            ? stub.replaceAll(
                'data-target-terminal-key="A1"',
                'data-target-terminal-key="A2"',
              )
            : stub.replace("<path ", '<path display="none" ');
      sheets[0] = {
        ...sheets[0]!,
        svg: sheets[0]!.svg.replace(stub, replacement),
      };
      expect(() =>
        validateAppearanceIncidence(
          f.ir,
          result.navigation.occurrences,
          sheets,
        ),
      ).toThrow(/source-incidence/);
    }
  } finally {
    await source.dispose();
  }
});

import { appendViewDrafts } from "../src/packet/assembly.js";
it("keeps both selections and unique primitive locators through compact packing", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir),
      packed: typeof f.drafts = [];
    for (const [i, d] of f.drafts.entries()) {
      d.drawingBounds = { x: 0, y: 0, w: 120, h: 200 };
      d.communicationHeight = 70;
      d.references = [
        {
          deviceUid: coilUid,
          designation: "K1",
          functions: ["coil"],
          xMm: 50,
          yMm: 40,
          zone: "A3",
        },
      ];
      appendViewDrafts(
        packed,
        [d],
        i,
        "compact",
        0,
        undefined,
        d.navigationView,
      );
    }
    expect(packed).toHaveLength(1);
    const sheets = [
      {
        ...f.sheets[0]!,
        svg: `<svg viewBox="0 0 120 200">${packed[0]!.content}</svg>`,
      },
    ];
    const result = finalizeNavigation(f.ir, packed, sheets);
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const nav = result.value.navigation;
    expect(
      nav.occurrences.map((o) => [
        o.destination.sheet,
        o.destination.zone,
        o.destination.anchorMm,
      ]),
    ).toEqual([
      [1, "A3", { x: 50, y: 40 }],
      [1, "C3", { x: 50, y: 120 }],
    ]);
    expect(nav.seeds).toHaveLength(2);
    expect(nav.annotations.map((a) => a.text.replace(/\n/g, " "))).toEqual([
      "K1: Also shown 01.C3",
      "K1: Repeat of 01.A3 (same function)",
    ]);
    expect(nav.annotations.map((a) => a.locality!.anchorMm)).toEqual([
      { x: 50, y: 40 },
      { x: 50, y: 120 },
    ]);
    expect(nav.annotations.map((a) => a.locality!.ownerLocation)).toEqual([
      { sheet: 1, zone: "A3" },
      { sheet: 1, zone: "C3" },
    ]);
    expect(nav.canonicalGroups[0]!.canonical).toBe(nav.occurrences[0]!.id);
    const ids = [
      ...parseSvg(result.value.sheets[0]!.svg).querySelectorAll("[id]"),
    ].map((n) => n.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    centroidReferences(packed, nav.occurrences);
    expect(new Set(packed[0]!.references!.map((r) => r.zone))).toEqual(
      new Set(["A3", "C3"]),
    );
  } finally {
    await source.dispose();
  }
});
