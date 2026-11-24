// Replays shared authored-source patches and packet requests in both flows.
// Exact semantic inventories/disclosures are gates; pagination and route shape are not.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@thermite/compiler";
import { beforeAll, expect, it } from "vitest";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { navigationGeometry } from "../src/packet/navigation-walk.js";
import { project } from "../src/device-legend/geometry.js";
import { textInk } from "../src/device-legend/svg-ink.js";
import { boxDistance } from "../src/packet/navigation-symbols.js";
import { verifyPrintedPeerDestinations } from "../src/packet/terminal-peer-references.js";
import { authoredTerminalIncidence } from "../src/off-view/incidence.js";
import type { SchematicViewRequest } from "../src/types.js";
import {
  dolControlInventory,
  dolPackets,
  dolProbeFixture,
  type DrawingProbe,
} from "./dol-control-probes-fixture.js";
import {
  assertPacketAudit,
  assertRootedInventory,
  rejectMutation,
  selectedInventory,
} from "./dol-control-probes-contract.js";
import { cards, flows, parseSvg, required } from "./off-view-fixtures.js";
import expected from "./fixtures/dol-control-probes/expected.json";
import full from "./fixtures/dol-control-probes/inventory.json";

it.each(
  (Object.keys(expected) as DrawingProbe[]).flatMap((name) =>
    flows.map((flow) => ({ name, flow })),
  ),
)("replays $name source-selected packets in $flow", async ({ name, flow }) => {
  const fixture = await dolProbeFixture(name);
  try {
    const { ir, source } = fixture,
      before = JSON.stringify(ir);
    const inventory = dolControlInventory(source, ir);
    expect(inventory.wires.map((e) => e.name).sort()).toEqual(
      full.wires.filter((w) => name === "saved" || w !== "W31"),
    );
    expect(inventory.functions.map((e) => e.name).sort()).toEqual(
      full.functions,
    );
    expect(inventory.wires).toHaveLength(name === "saved" ? 17 : 16);
    expect(inventory.functions).toHaveLength(14);
    const requests = dolPackets(name, flow);
    for (const root of ["K1", "R1"] as const) {
      const request = requests[root].views[0] as SchematicViewRequest;
      const raw = await renderSchematic(ir, request);
      if (!raw.ok) throw Error(JSON.stringify(raw));
      assertRootedInventory(
        selectedInventory(ir, raw.value.summary),
        inventory,
        expected[name][root],
      );
      expect(
        cards(raw.value.svg).sort((a, b) =>
          String(a.terminal).localeCompare(String(b.terminal)),
        ),
      ).toEqual(expected[name][root].disclosures);
      const rooted = await renderSchematicPacket(ir, requests[root]);
      if (!rooted.ok) throw Error(JSON.stringify(rooted));
      assertPacketAudit(rooted.value, inventory, false);
      const printedCards = [
        ...new Set(
          rooted.value.sheets.flatMap((s) =>
            cards(s.svg).map((c) => JSON.stringify(c)),
          ),
        ),
      ]
        .map((c) => JSON.parse(c))
        .sort((a, b) => a.terminal.localeCompare(b.terminal));
      expect(printedCards).toEqual(expected[name][root].disclosures);
      expect(rooted.value.coverage.counts.conductors.total).toBe(
        name === "saved" ? 31 : 30,
      );
      expect(rooted.value.coverage.counts.functions.total).toBe(31);
      // Marker text does not create an audited wire/function appearance.
      for (const omitted of expected[name][root].omittedWires)
        expect(
          required(
            rooted.value.coverage.conductors.find(
              (c) => c.designation === omitted,
            ),
          ).appearances,
        ).toEqual([]);
    }
    for (const kind of ["circuit", "combined"] as const) {
      const packet = await renderSchematicPacket(ir, requests[kind]);
      if (!packet.ok) throw Error(JSON.stringify(packet));
      assertPacketAudit(packet.value, inventory, true);
      expect(packet.value.coverage.counts.conductors.outsideAuditedViews).toBe(
        14,
      );
      expect(packet.value.coverage.counts.functions.outsideAuditedViews).toBe(
        17,
      );
      // Complete control still omits the project's source, motor and PE symbol.
      expect(packet.value.coverage.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "W906",
          devices: ["M1", "PE1", "SRC1"].map((designation) =>
            expect.objectContaining({ designation }),
          ),
        }),
      );
    }
    expect(JSON.stringify(ir)).toBe(before);
  } finally {
    await fixture.dispose();
  }
});

it("suppresses W35 conductor-peer notes on sheet 4 while keeping sheets 1-2 off-view destinations (#571)", async () => {
  const fixture = await dolProbeFixture("p6");
  try {
    const w35 = required(
      fixture.ir.wires.find((wire) => wire.designation === "W35"),
    );
    const outcome = await renderSchematicPacket(
      fixture.ir,
      dolPackets("p6", "left-to-right").combined,
    );
    if (!outcome.ok) throw Error(outcome.error.message);
    const { svg } = required(outcome.value.sheets[3]);
    const drawing = parseSvg(svg);
    // #571: W35 is fully drawn between OL1.96 (via its solid attachment lead)
    // and R1.11 on sheet 4, so no conductor-peer note is emitted for W35 there.
    expect(
      drawing.querySelector(
        `[data-circuit-conductor="${w35.uid}"] path[stroke="#17212b"]`,
      ),
    ).not.toBeNull();
    const s4W35Notes = [
      ...drawing.querySelectorAll('[data-peer-reference="conductor-peer"]'),
    ].filter((note) =>
      note.getAttribute("data-peer-source")?.includes(w35.uid),
    );
    expect(s4W35Notes).toHaveLength(0);
    // Sheets 1-2 still carry W35's off-view destination note(s) pointing to sheet 4.
    for (const sheetIndex of [0, 1]) {
      const sheetCards = cards(required(outcome.value.sheets[sheetIndex]).svg);
      const w35Rows = sheetCards.flatMap((card) =>
        card.rows.filter((row) => row.startsWith("W35 → R1.11 ")),
      );
      expect(w35Rows.length).toBeGreaterThan(0);
      for (const row of w35Rows)
        expect(row).toMatch(/^W35 → R1\.11 04\.[A-D][1-6]$/u);
    }
  } finally {
    await fixture.dispose();
  }
});

function circuitTerminalBox(svg: string, deviceUid: string, key: string) {
  const geom = navigationGeometry(svg);
  const byNode = new Map(geom.map((g) => [g.node, g]));
  const id = JSON.stringify([deviceUid, key]);
  const port = required(
    geom.find((g) => g.visible && g.node.attrs["data-terminal-id"] === id),
  );
  const circle = required(port.node.children.find((n) => n.name === "circle"));
  const mark = required(byNode.get(circle));
  const r = Number(circle.attrs.r);
  return project(
    {
      x: Number(circle.attrs.cx ?? 0) - r,
      y: Number(circle.attrs.cy ?? 0) - r,
      w: 2 * r,
      h: 2 * r,
    },
    mark.matrix,
  );
}

function peerNoteTextBoxes(svg: string) {
  const geom = navigationGeometry(svg);
  const peerGroups = new Map<object, { group: object; kind: string }>();
  for (const g of geom) {
    const kind = g.node.attrs["data-peer-reference"];
    if (!kind || !g.visible) continue;
    if (g.node.name === "g") {
      for (const child of g.node.children)
        if (child.name === "text")
          peerGroups.set(child, { group: g.node, kind });
    } else if (g.node.name === "text") {
      peerGroups.set(g.node, { group: g.node, kind });
    }
  }
  return geom.flatMap((g) => {
    if (g.node.name !== "text" || !g.visible || !g.style) return [];
    const ink = textInk(g.node, g.style);
    if (!ink) return [];
    const box = project(ink, g.matrix);
    const peer = peerGroups.get(g.node);
    return [{ node: g.node, text: g.node.text, box, peer }];
  });
}

function assertMinPeerTextClearance(svg: string, minMm: number) {
  const boxes = peerNoteTextBoxes(svg);
  const peers = boxes.filter((b) => b.peer);
  expect(peers.length).toBeGreaterThanOrEqual(2);
  for (const p of peers) {
    for (const other of boxes) {
      if (other.node === p.node || other.peer?.group === p.peer?.group)
        continue;
      const a = p.box,
        b = other.box;
      if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) <= 0) continue;
      const gap = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
      expect(gap).toBeGreaterThanOrEqual(minMm - 1e-6);
    }
  }
  return peers;
}

it("places W37 at both R1.14 and S2.14 nearest their own terminals with >=1.5 mm text clearance in DOL P6 TTB (#507)", async () => {
  const fixture = await dolProbeFixture("p6");
  try {
    const w37 = required(
      fixture.ir.wires.find((wire) => wire.designation === "W37"),
    );
    const r1 = required(
      fixture.ir.devices.find((device) => device.designation === "R1"),
    );
    const s2 = required(
      fixture.ir.devices.find((device) => device.designation === "S2"),
    );
    const outcome = await renderSchematicPacket(
      fixture.ir,
      dolPackets("p6", "top-to-bottom").combined,
    );
    if (!outcome.ok) throw Error(outcome.error.message);
    const { svg } = required(outcome.value.sheets[4]);
    const drawing = parseSvg(svg);
    const notes = [
      ...drawing.querySelectorAll('[data-peer-reference="conductor-peer"]'),
    ].filter((el) => el.getAttribute("data-peer-source")?.includes(w37.uid));
    expect(notes).toHaveLength(2);
    const noteText = (el: Element) =>
      el.tagName.toLowerCase() === "g"
        ? [...el.querySelectorAll("text")]
            .map((t) => t.textContent ?? "")
            .join(" ")
        : (el.textContent ?? "");
    const byOwner = (uid: string) =>
      required(
        notes.find((el) => {
          const src = JSON.parse(el.getAttribute("data-peer-source") ?? "[]");
          return src[0]?.deviceUid === uid && src[0]?.terminalKey === "14";
        }),
      );
    const r1Note = byOwner(r1.uid),
      s2Note = byOwner(s2.uid);
    expect(noteText(r1Note)).toMatch(
      /^R1\.14 → 01\.[A-D][1-6] \(also shown 02\.[A-D][1-6]\)$/u,
    );
    expect(noteText(s2Note)).toMatch(/^S2\.14 → 06\.[A-D][1-6]$/u);
    expect(r1Note.getAttribute("data-peer-reference-fallback")).toBe(
      "qualified",
    );
    expect(s2Note.getAttribute("data-peer-reference-fallback")).toBe(
      "qualified",
    );
    const peers = assertMinPeerTextClearance(svg, 1.5);
    const r1Box = required(peers.find((p) => p.text.includes("R1.14"))).box;
    expect(
      boxDistance(r1Box, circuitTerminalBox(svg, r1.uid, "14")),
    ).toBeLessThan(boxDistance(r1Box, circuitTerminalBox(svg, r1.uid, "12")));
    const s2Box = required(peers.find((p) => p.text.includes("S2.14"))).box;
    expect(
      boxDistance(s2Box, circuitTerminalBox(svg, s2.uid, "14")),
    ).toBeLessThan(boxDistance(s2Box, circuitTerminalBox(svg, s2.uid, "13")));
  } finally {
    await fixture.dispose();
  }
});

function renamedW37PeerEntry(
  svg: string,
  wireUid: string,
  from: { uid: string; label: string },
  to: { uid: string; label: string },
  destination: string,
) {
  return {
    kind: "conductor-peer" as const,
    identity: [
      { deviceUid: from.uid, terminalKey: "14" },
      { kind: "wire" as const, uid: wireUid },
      { deviceUid: to.uid, terminalKey: "14" },
    ],
    owner: circuitTerminalBox(svg, from.uid, "14"),
    ownerLabel: from.label,
    value: `37.D6 · ${from.label} → ${to.label} ${destination}`,
    compact: `→ ${to.label} ${destination}`,
    destination,
  };
}

it("issues DOL P6 TTB without R006 when W37 is renamed to a sheet.zone-shaped designation (37.D6)", async () => {
  const fixture = await dolProbeFixture("p6");
  try {
    const objects = fixture.source.objects.map((o) =>
      o.designation === "W37" ? { ...o, designation: "37.D6" } : o,
    );
    await writeFile(
      join(fixture.root, "source.json"),
      JSON.stringify({ objects }),
    );
    const compiled = await compileProject(fixture.root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const req = JSON.parse(
      JSON.stringify(dolPackets("p6", "top-to-bottom").combined).replaceAll(
        '"W37"',
        '"37.D6"',
      ),
    );
    const outcome = await renderSchematicPacket(compiled.ir, req);
    if (!outcome.ok) throw Error(outcome.error.message);
    expect(outcome.value.sheets).toHaveLength(9);
    const s1Cards = cards(required(outcome.value.sheets[0]).svg);
    expect(
      s1Cards.some((c) =>
        c.rows.some((row) => row.startsWith("37.D6 → R1.14")),
      ),
    ).toBe(true);
    const s5 = required(outcome.value.sheets[4]);
    const w37 = required(
      compiled.ir.wires.find((wire) => wire.designation === "37.D6"),
    );
    const r1 = required(
      compiled.ir.devices.find((d) => d.designation === "R1"),
    );
    const s2 = required(
      compiled.ir.devices.find((d) => d.designation === "S2"),
    );
    expect(() =>
      verifyPrintedPeerDestinations(
        s5,
        new Map(),
        [
          renamedW37PeerEntry(
            s5.svg,
            w37.uid,
            { uid: r1.uid, label: "R1.14" },
            { uid: s2.uid, label: "S2.14" },
            "01.A3 (also shown 02.A3)",
          ),
          renamedW37PeerEntry(
            s5.svg,
            w37.uid,
            { uid: s2.uid, label: "S2.14" },
            { uid: r1.uid, label: "R1.14" },
            "06.C1",
          ),
        ],
        authoredTerminalIncidence(compiled.ir),
      ),
    ).not.toThrow();
  } finally {
    await fixture.dispose();
  }
});

it.each(flows)("rejects circuit coil ink mutant in %s", async (flow) => {
  const f = await dolProbeFixture("saved");
  try {
    const packet = await renderSchematicPacket(
      f.ir,
      dolPackets("saved", flow).circuit,
    );
    if (!packet.ok) throw Error(JSON.stringify(packet));
    const coilId = JSON.stringify([
      required(f.ir.devices.find((d) => d.designation === "R1")).uid,
      "coil",
    ]);
    const mutant = {
      ...packet.value,
      sheets: packet.value.sheets.map((sheet) => {
        const doc = parseSvg(sheet.svg);
        for (const mark of doc.querySelectorAll("[data-function-id]"))
          if (mark.getAttribute("data-function-id") === coilId) mark.remove();
        return { ...sheet, svg: doc.toString() };
      }),
    };
    // Device references and the claimed coverage survive; the actual coil does not.
    expect(
      mutant.sheets
        .flatMap((s) => s.references)
        .some((r) => r.designation === "R1"),
    ).toBe(true);
    expect(
      required(mutant.coverage.functions.find((e) => e.id === coilId))
        .appearances.length,
    ).toBeGreaterThan(0);
    rejectMutation(() =>
      assertPacketAudit(mutant, dolControlInventory(f.source, f.ir), true),
    );
  } finally {
    await f.dispose();
  }
});

const p6 = new Map<
  (typeof flows)[number],
  {
    inventory: ReturnType<typeof dolControlInventory>;
    selected: ReturnType<typeof selectedInventory>;
  }
>();
beforeAll(async () => {
  const f = await dolProbeFixture("p6");
  try {
    for (const flow of flows) {
      const raw = await renderSchematic(
        f.ir,
        dolPackets("p6", flow).K1.views[0] as SchematicViewRequest,
      );
      if (!raw.ok) throw Error(JSON.stringify(raw));
      p6.set(flow, {
        inventory: dolControlInventory(f.source, f.ir),
        selected: selectedInventory(f.ir, raw.value.summary),
      });
    }
  } finally {
    await f.dispose();
  }
});

it.each(
  ["W35", "W37", "W38", "W39", "R1.coil", "R1.contact14"].flatMap((identity) =>
    flows.map((flow) => ({ identity, flow })),
  ),
)("rejects P6 selection mutant $identity in $flow", ({ identity, flow }) => {
  const observed = required(p6.get(flow));
  const mutant = structuredClone(expected.p6.K1);
  if (identity.startsWith("W"))
    mutant.omittedWires = mutant.omittedWires.filter((w) => w !== identity);
  else
    mutant.omittedFunctions = mutant.omittedFunctions.filter(
      (f) => f !== identity,
    );
  rejectMutation(() =>
    assertRootedInventory(observed.selected, observed.inventory, mutant),
  );
});
