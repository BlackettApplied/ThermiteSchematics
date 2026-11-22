import { expect } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import type { RenderSummary } from "../src/types.js";
import type { RenderedPacket } from "../src/sheets.js";
import { parseSvg, required } from "./off-view-fixtures.js";
import type { dolControlInventory } from "./dol-control-probes-fixture.js";

export type Inventory = ReturnType<typeof dolControlInventory>;
export function selectedInventory(ir: ElectricalIr, summary: RenderSummary) {
  return {
    wires: summary.conductiveElementIds
      .map((id) => {
        expect(id.kind).toBe("wire");
        return required(ir.wires.find((w) => w.uid === id.uid)).designation;
      })
      .sort(),
    functions: summary.functionIds
      .map(
        (f) =>
          `${required(ir.devices.find((d) => d.uid === f.deviceUid)).designation}.${f.functionKey}`,
      )
      .sort(),
  };
}

export function assertRootedInventory(
  actual: ReturnType<typeof selectedInventory>,
  inventory: Inventory,
  expected: { omittedWires: string[]; omittedFunctions: string[] },
) {
  for (const [field, omissions] of [
    ["wires", expected.omittedWires],
    ["functions", expected.omittedFunctions],
  ] as const) {
    const full = inventory[field].map((e) => e.name).sort();
    expect(actual[field], `selected ${field}`).toEqual(
      full.filter((n) => !omissions.includes(n)),
    );
    expect(
      full.filter((n) => !actual[field].includes(n)),
      `omitted ${field}`,
    ).toEqual(omissions);
  }
}

export function assertPacketAudit(
  packet: RenderedPacket,
  inventory: Inventory,
  audited: boolean,
) {
  const { coverage, sheets } = packet;
  const rootedSheets = sheets.filter(
    (s) => s.view.format !== "documentation-view/0.1",
  );
  expect(coverage.scope).toBe("circuit-and-wiring");
  expect(coverage.unauditedSheets).toEqual(rootedSheets.map((s) => s.number));
  for (const [field, full] of [
    ["conductors", inventory.wires],
    ["functions", inventory.functions],
  ] as const) {
    const entries = coverage[field];
    const expected = audited ? full.map((e) => e.id).sort() : [];
    expect(
      entries
        .filter((e) => e.appearances.length)
        .map((e) => e.id)
        .sort(),
      `audited ${field}`,
    ).toEqual(expected);
    expect(coverage.counts[field]).toEqual({
      total: entries.length,
      represented: expected.length,
      outsideAuditedViews: entries.length - expected.length,
    });
    for (const entry of entries)
      for (const appearance of entry.appearances) {
        expect(appearance.kind).toBe("circuit");
        const sheet = required(
          sheets.find((s) => s.number === appearance.sheet),
        );
        expect(sheet.view).toMatchObject({
          format: "documentation-view/0.1",
          kind: "circuit",
        });
        const attribute =
          field === "functions" ? "data-function-id" : "data-circuit-conductor";
        const drawn = [
          ...parseSvg(sheet.svg).querySelectorAll(`[${attribute}]`),
        ].map((g) => g.getAttribute(attribute));
        expect(drawn, `drawn ${field} ${entry.designation}`).toContain(
          entry.id,
        );
      }
  }
  for (const sheet of rootedSheets) {
    const doc = parseSvg(sheet.svg);
    expect(doc.querySelectorAll("[data-selected-view-notice]")).toHaveLength(1);
    expect(doc.documentElement.textContent).toContain("SELECTED PATH VIEW");
  }
}

// The evidence run invokes each mutant's guard directly to retain its failure.
export function rejectMutation(check: () => void) {
  expect(check).toThrow();
}
