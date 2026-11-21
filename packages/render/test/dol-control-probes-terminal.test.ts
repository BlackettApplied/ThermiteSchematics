// Guards selected, projected, reference and audited identities independently.
// AUX7 has no selected contact, so device presence cannot hide terminal-only W906.
import { beforeAll, expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { dolProbeFixture } from "./dol-control-probes-fixture.js";
import {
  selectedInventory,
  rejectMutation,
} from "./dol-control-probes-contract.js";
import { terminalOnlyProbe } from "./dol-terminal-projection-fixture.js";
import { control, flows, required } from "./off-view-fixtures.js";

async function observe(
  ir: ElectricalIr,
  flow: (typeof flows)[number],
  designation: string,
) {
  const drawing = await prepareSchematicDrawing(ir, control(flow));
  const packet = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    page: { size: "a3" },
    index: true,
    views: [control(flow)],
  });
  if (!drawing.ok || !packet.ok)
    throw Error(JSON.stringify({ drawing, packet }));
  const contexts = drawing.value.graph.nodes.filter(
    (n) =>
      n.kind === "symbol" &&
      n.representation === "terminal" &&
      n.designation === designation,
  );
  const sheets = packet.value.sheets.filter(
    (s) => s.view.format !== "documentation-view/0.1",
  );
  const w906 = packet.value.coverage.diagnostics?.find(
    (d) => d.code === "W906",
  );
  return {
    designation,
    selected: selectedInventory(ir, drawing.value.summary).functions,
    contexts: contexts.map((n) => ({
      functions: n.functionIds.map((f) => f.functionKey),
    })),
    references: sheets
      .flatMap((s) => s.references)
      .filter((r) => r.designation === designation)
      .map((r) => ({
        representation: r.representation,
        functions: [...r.functions],
      })),
    audited: [
      ...required(
        packet.value.coverage.functions.find(
          (f) => f.designation === `${designation}/coil`,
        ),
      ).appearances,
    ],
    counts: packet.value.coverage.counts,
    unaudited: [...packet.value.coverage.unauditedSheets],
    sheetNumbers: packet.value.sheets.map((s) => s.number),
    w906: w906?.message,
    missing: w906?.devices,
  };
}
type Observed = Awaited<ReturnType<typeof observe>>;
function assertTerminalScope(o: Observed) {
  expect(o.selected, "selected coil").not.toContain(`${o.designation}.coil`);
  expect(o.contexts, "context functions").toEqual([{ functions: [] }]);
  const terminal = o.references.filter((r) => r.representation === "terminal");
  expect(terminal.length, "terminal references").toBeGreaterThan(0);
  expect(
    terminal.every((r) => r.functions.length === 0),
    "terminal reference functions",
  ).toBe(true);
  expect(
    o.references.flatMap((r) => r.functions),
    "reference coil",
  ).not.toContain("coil");
  expect(o.audited, "audited coil").toEqual([]);
  expect(o.counts.conductors.represented).toBe(0);
  expect(o.counts.functions.represented).toBe(0);
  expect(o.unaudited).toEqual(o.sheetNumbers);
  if (o.designation === "AUX7") {
    expect(o.w906, "terminal-only W906").toContain(
      "AUX7 (terminal context only)",
    );
    expect(o.missing).toContainEqual(
      expect.objectContaining({
        designation: "AUX7",
        appearance: "reports-only",
      }),
    );
  } else {
    // The selected contact provides R1 device presence, never a coil appearance.
    expect(o.selected).toContain("R1.contact14");
    expect(o.missing?.some((d) => d.designation === "R1")).toBe(false);
  }
}

const observed = new Map<string, Observed>();
beforeAll(async () => {
  const saved = await dolProbeFixture("saved");
  const aux = await terminalOnlyProbe();
  try {
    for (const flow of flows) {
      observed.set(`R1:${flow}`, await observe(saved.ir, flow, "R1"));
      observed.set(`AUX7:${flow}`, await observe(aux.ir, flow, "AUX7"));
    }
  } finally {
    await saved.dispose();
    await aux.dispose();
  }
});

it.each(
  ["R1", "AUX7"].flatMap((designation) =>
    flows.map((flow) => ({ designation, flow })),
  ),
)(
  "keeps $designation terminal-only coil scope in $flow",
  ({ designation, flow }) => {
    assertTerminalScope(required(observed.get(`${designation}:${flow}`)));
  },
);

it.each(
  ["R1", "AUX7"].flatMap((designation) =>
    [
      "selected",
      "context",
      "reference",
      "audited",
      ...(designation === "AUX7" ? ["W906"] : []),
    ].flatMap((layer) => flows.map((flow) => ({ designation, layer, flow }))),
  ),
)(
  "rejects terminal mutant $designation $layer in $flow",
  ({ designation, layer, flow }) => {
    const mutant = structuredClone(
      required(observed.get(`${designation}:${flow}`)),
    );
    if (layer === "selected") mutant.selected.push(`${designation}.coil`);
    if (layer === "context")
      required(mutant.contexts[0]).functions.push("coil");
    if (layer === "reference")
      required(
        mutant.references.find((r) => r.representation === "terminal"),
      ).functions.push("coil");
    if (layer === "audited")
      mutant.audited.push({ sheet: 1, view: "K1", kind: "circuit" });
    if (layer === "W906") mutant.w906 = undefined;
    rejectMutation(() => assertTerminalScope(mutant));
  },
);
