import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { terminalOnlyProbe } from "./dol-terminal-projection-fixture.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import { selectSemanticSubgraph } from "../src/selection.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import {
  buildPresentationGraph,
  validatePresentationGraph,
} from "../src/presentation.js";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { robustnessFixture } from "./render-robustness-fixture.js";

const flows = ["left-to-right", "top-to-bottom"] as const;
const request = (flow: (typeof flows)[number]) => ({
  format: "schematic-view-request/0.1" as const,
  root: { by: "designation" as const, value: "K1" },
  family: "control" as const,
  flow,
});
function selection(ir: ElectricalIr, flow: (typeof flows)[number]) {
  const mappings = projectDeviceTypeSymbolMappings(ir);
  const normalized = normalizeSchematicView(ir, request(flow), { mappings });
  if (!normalized.ok) throw Error(JSON.stringify(normalized));
  const selected = selectSemanticSubgraph({
    ir,
    ...normalized.value,
    mappings,
  });
  expect(selected.ok, JSON.stringify(selected)).toBe(true);
  if (!selected.ok) throw Error(JSON.stringify(selected));
  return { selected: selected.value, mappings };
}
const project = (name: string) =>
  fileURLToPath(
    new URL(`../../core-library/test/fixtures/${name}/`, import.meta.url),
  );

it("keeps the complete R003 contract for ineligible returns and non-actuation paths", async () => {
  const fixture = await robustnessFixture();
  try {
    for (const variant of [
      "loads_via_k2",
      "trace_via_k2",
      "power_via_k2",
      "actuation",
    ] as const) {
      const { ir } = await fixture.compile(variant, 0);
      for (const flow of flows) {
        const view =
          variant === "loads_via_k2"
            ? ({
                format: "schematic-view-request/0.2",
                root: { by: "designation", value: "PS1" },
                intent: { kind: "loads" },
                flow,
              } as const)
            : variant === "trace_via_k2"
              ? ({
                  format: "schematic-view-request/0.2",
                  root: { by: "designation", value: "LS1" },
                  intent: {
                    kind: "trace",
                    to: { by: "designation", value: "PLC1" },
                    includePower: true,
                  },
                  flow,
                } as const)
              : ({
                  ...request(flow),
                  root: {
                    by: "designation",
                    value: variant === "power_via_k2" ? "M1" : "K1",
                  },
                  family: variant === "power_via_k2" ? "power" : "control",
                } as const);
        const rendered = await renderSchematic(ir, view);
        expect(rendered).toMatchObject({
          ok: false,
          error: {
            code: "R003",
            details: { reason: "unrepresented-terminal" },
          },
        });
        if (rendered.ok) throw Error("Expected endpoint refusal");
        const details = rendered.error.details as {
          designation: string;
          terminalIds: { terminalKey: string }[];
          conductors: { designation: string }[];
          alternative: {
            flow: string;
            groups: {
              functions: { device: { value: string }; key: string }[];
            }[];
          };
        };
        const names = details.conductors
          .map((c) => c.designation)
          .sort()
          .join(", ");
        const functions = details.alternative.groups
          .flatMap((g) => g.functions.map((f) => `${f.device.value}.${f.key}`))
          .join(", ");
        expect(rendered.error.message).toBe(
          `Unsupported terminal representation: ${details.designation}.${details.terminalIds[0]!.terminalKey} on ${JSON.stringify(rendered.error.typeId)} is incident to selected conductors ${names} but has no selected function, mapped terminal-display symbol, or boundary representation in this rooted view. Use a circuit view to draw these conductors with their real endpoint terminals. Put details.alternative in the views array of a schematic-packet-request/0.1 file and run thermite packet --input <file>. The alternative selects ${functions}.`,
        );
        expect(details.alternative.flow).toBe(flow);
      }
    }
  } finally {
    await fixture.close();
  }
});

it.each(flows)(
  "selects only the DOL input terminal context and exact inventory in %s",
  async (flow) => {
    const compiled = await compileProject(project("dol-starter"));
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const ir = compiled.ir,
      before = JSON.stringify(ir);
    const { selected, mappings } = selection(ir, flow);
    const name = (uid: string) =>
      ir.devices.find((d) => d.uid === uid)!.designation;
    expect(
      selected.conductiveElementIds
        .map((id) => {
          if (id.kind !== "wire") throw Error("Expected wires");
          return ir.wires.find((w) => w.uid === id.uid)!.designation;
        })
        .sort(),
    ).toEqual([
      "W30",
      "W31",
      "W32",
      "W33",
      "W34",
      "W35",
      "W36",
      "W37",
      "W38",
      "W41",
    ]);
    expect(
      selected.functionIds
        .map((f) => `${name(f.deviceUid)}.${f.functionKey}`)
        .sort(),
    ).toEqual([
      "F1.pole1",
      "K1.coil",
      "OL1.aux95",
      "PS1.dc_output",
      "R1.contact14",
      "S0.contact11",
      "S1.contact11",
      "S2.contact13",
    ]);
    expect(selected.terminalOwners).toEqual([
      {
        terminal: {
          deviceUid: ir.devices.find((d) => d.designation === "R1")!.uid,
          terminalKey: "A1",
        },
        ownerFunctionIds: [
          {
            deviceUid: ir.devices.find((d) => d.designation === "R1")!.uid,
            functionKey: "coil",
          },
        ],
      },
    ]);
    const built = buildPresentationGraph({ ir, selected, mappings });
    expect(built.ok, JSON.stringify(built)).toBe(true);
    if (!built.ok) throw Error(JSON.stringify(built));
    const contexts = built.value.graph.nodes.filter(
      (n) => n.kind === "symbol" && n.representation === "terminal",
    );
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      designation: "R1",
      functionIds: [],
      symbolId: "ais:terminal",
      attachments: [{ kind: "terminal" }],
    });
    expect(contexts[0]!.ports.map((p) => p.terminal)).toEqual([
      selected.terminalOwners![0]!.terminal,
      selected.terminalOwners![0]!.terminal,
    ]);
    expect(built.value.summary.functionIds).toEqual(selected.functionIds);
    const result = await renderSchematic(ir, request(flow));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(JSON.stringify(ir)).toBe(before);
  },
);

it.each(["core:relay-1co", "core:contactor-3p-1no"])(
  "projects a pass-through terminal by facts on %s in both flows",
  async (typeId) => {
    const probe = await terminalOnlyProbe(typeId);
    try {
      const ir = probe.ir,
        before = JSON.stringify(ir);
      for (const flow of flows) {
        const { selected, mappings } = selection(ir, flow);
        const built = buildPresentationGraph({ ir, selected, mappings });
        if (!built.ok) throw Error(JSON.stringify(built));
        const graph = built.value.graph;
        const context = graph.nodes.find(
          (n) => n.kind === "symbol" && n.representation === "terminal",
        )!;
        expect(context).toMatchObject({ designation: "AUX7", functionIds: [] });
        expect(() =>
          buildPresentationGraph({
            ir,
            selected: { ...selected, terminalOwners: [] },
            mappings,
          }),
        ).toThrow();
        const noAttachment = structuredClone(graph);
        const mutant = noAttachment.nodes.find((n) => n.id === context.id)!;
        if (mutant.kind !== "symbol") throw Error("Missing context");
        (mutant as { attachments: unknown[] }).attachments = [];
        expect(() =>
          validatePresentationGraph(ir, selected, noAttachment, mappings),
        ).toThrow(/attachment/);
        const noProjection = {
          ...graph,
          nodes: graph.nodes.filter((n) => n.id !== context.id),
        };
        expect(() =>
          validatePresentationGraph(ir, selected, noProjection, mappings),
        ).toThrow();
        const rendered = await renderSchematic(ir, request(flow));
        expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
        if (!rendered.ok) throw Error(JSON.stringify(rendered));
        const doc = parseHTML(rendered.value.svg).document;
        expect(
          doc.querySelectorAll('[data-representation="terminal"]'),
        ).toHaveLength(1);
        expect(doc.documentElement.textContent).toContain("coil outside view");
        const packet = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          page: { size: "a3" },
          index: true,
          views: [request(flow)],
        });
        expect(packet.ok, JSON.stringify(packet)).toBe(true);
        if (!packet.ok) throw Error(JSON.stringify(packet));
        const refs = packet.value.sheets
          .filter((s) => s.view.format !== "documentation-view/0.1")
          .flatMap((s) => s.references)
          .filter((r) => r.designation === "AUX7");
        expect(refs.length).toBeGreaterThan(0);
        expect(
          refs.every(
            (r) => !r.functions.length && r.representation === "terminal",
          ),
        ).toBe(true);
        expect(packet.value.sheets.map((s) => s.svg).join("\n")).toContain(
          "coil outside view",
        );
        expect(
          packet.value.coverage.functions.find(
            (f) => f.designation === "AUX7/coil",
          )!.appearances,
        ).toEqual([]);
        expect(
          packet.value.coverage.diagnostics?.find((d) => d.code === "W906")
            ?.message,
        ).toContain("AUX7 (terminal context only)");
        expect(packet.value.coverage.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "W906",
            devices: expect.arrayContaining([
              expect.objectContaining({
                designation: "AUX7",
                appearance: "reports-only",
              }),
            ]),
          }),
        );
      }
      expect(JSON.stringify(ir)).toBe(before);
    } finally {
      await probe.dispose();
    }
  },
);
