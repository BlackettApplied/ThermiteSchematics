import { expect, it } from "vitest";
import { prepareSchematicDrawing, renderSchematic } from "../src/renderer.js";
import { dcNames, dcTransformerFixture } from "./transformer-dc-fixture.js";
import { cards } from "./off-view-fixtures.js";
import {
  transformerFlows,
  transformerRequest,
  transformerFixture,
} from "./transformer-control-fixture.js";

for (const [supply, transformer] of dcNames)
  for (const branch of ["direct", "contact"] as const)
    for (const reordered of [false, true])
      it.each(transformerFlows)(
        `preserves base DC ${supply}/${transformer} ${branch} reordered=${reordered} in %s`,
        async (flow) => {
          const f = await dcTransformerFixture(
            supply,
            transformer,
            branch,
            reordered,
          );
          try {
            const before = JSON.stringify(f.ir),
              r = await renderSchematic(f.ir, transformerRequest(flow));
            expect(r.ok, JSON.stringify(r)).toBe(true);
            if (!r.ok) throw Error(r.error.message);
            expect(r.value.svg).not.toContain(
              'data-symbol-id="ais:source-winding"',
            );
            expect(
              cards(r.value.svg)
                .flatMap((c) => c.rows)
                .sort(),
            ).toEqual(
              [
                `WC → ${transformer}.X2`,
                ...(branch === "contact" ? ["WD → K2.11"] : []),
              ].sort(),
            );
            expect(
              r.value.summary.conductiveElementIds
                .map(
                  (id) => f.ir.wires.find((w) => w.uid === id.uid)?.designation,
                )
                .sort(),
            ).toEqual(["WA", "WB"]);
            expect(r.value.svg).toContain("data-selected-view-notice");
            const selected = r.value.summary.functionIds
              .map((id) => [
                f.ir.devices.find((d) => d.uid === id.deviceUid)!.designation,
                id.functionKey,
              ])
              .sort();
            expect(selected).toEqual(
              [
                ["R1", "coil"],
                [supply, "dc_output"],
              ].sort(),
            );
            expect(JSON.stringify(f.ir)).toBe(before);
          } finally {
            await f.dispose();
          }
        },
      );
const mixedMessage =
  "Incomplete control view: nearest input or return paths reach both transformer and non-transformer boundaries; use an explicit circuit view.";
for (const [supply, transformer] of dcNames)
  for (const reordered of [false, true])
    it.each(transformerFlows)(
      `refuses mixed nearest tiers ${supply}/${transformer} reordered=${reordered} in %s`,
      async (flow) => {
        const f = await dcTransformerFixture(
          supply,
          transformer,
          "mixed",
          reordered,
        );
        try {
          const r = await renderSchematic(f.ir, transformerRequest(flow));
          expect(r.ok).toBe(false);
          if (r.ok) throw Error("Expected mixed-boundary ambiguity");
          expect(r.error.code).toBe("R002");
          expect(r.error.message).toBe(mixedMessage);
        } finally {
          await f.dispose();
        }
      },
    );
it.each(transformerFlows)(
  "preserves incomplete-path errors when the base search has no input in %s",
  async (flow) => {
    const f = await dcTransformerFixture("PS1", "T1", "missing-base-input");
    try {
      const r = await renderSchematic(f.ir, transformerRequest(flow));
      expect(r.ok).toBe(false);
      if (r.ok) throw Error("Expected absent base input");
      expect(r.error.code).toBe("R002");
      expect(r.error.message).toBe(
        'Incomplete control view: no input path reaches a required boundary. Device "R1", function "coil". Path stopped at T1.X1 (function secondary).',
      );
    } finally {
      await f.dispose();
    }
  },
);

it.each(transformerFlows)(
  "loads advice excludes the transformer and preserves the base relay message in %s",
  async (flow) => {
    const f = await transformerFixture();
    try {
      for (const value of ["T1", "R1", "H1", "XT1"]) {
        const r = await prepareSchematicDrawing(f.ir, {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value },
          intent: { kind: "loads" },
          flow,
        });
        expect(r.ok).toBe(false);
        if (r.ok) throw Error("Expected loads root refusal");
        expect(r.error.code).toBe("R001");
        expect(r.error.message).not.toContain("thermite:transformer");
        expect(
          (r.error.details?.acceptedRoots as { profile: string }[]).map(
            (r) => r.profile,
          ),
        ).toEqual([
          "thermite:power-source",
          "thermite:dc-supply",
          "thermite:io-module",
          "thermite:terminal-strip",
        ]);
        if (value === "R1") expect(r.error.message).toBe(BASE_LOADS_MESSAGE);
      }
    } finally {
      await f.dispose();
    }
  },
);

const BASE_LOADS_MESSAGE =
  'Invalid loads root: expected exactly one mapped control source with a source/return terminal pair. Device "R1" is not accepted as a loads root. Accepted profiles and shapes: thermite:power-source (aliases iec:three-phase-supply): source/2 (dc_positive_output, dc_return_output); thermite:dc-supply (aliases iec:dc-power-supply): source/2 (dc_positive_output, dc_return_output); thermite:io-module (aliases iec:plc): source/2 (dc_positive_output, dc_return_output); thermite:terminal-strip (aliases iec:terminal-block, iec:junction-box): source/2 (dc_positive_output, dc_return_output). This device can root: control. Choose another root or family.';

it("rebinds only the paired source function even if another source is selected", async () => {
  const { normalizeSchematicView } = await import("../src/view-spec.js");
  const { selectSemanticSubgraph } = await import("../src/selection.js");
  const { projectDeviceTypeSymbolMappings } =
    await import("../src/symbols/mappings.js");
  const { orientSourceWindingMappings } =
    await import("../src/symbols/source-winding.js");
  const f = await transformerFixture();
  try {
    const request = transformerRequest("left-to-right");
    const mappings = projectDeviceTypeSymbolMappings(f.ir);
    const n = normalizeSchematicView(f.ir, request, { mappings });
    if (!n.ok) throw Error(n.error.message);
    const s = selectSemanticSubgraph({
      ir: f.ir,
      view: n.value.view,
      engine: n.value.engine,
      mappings,
    });
    if (!s.ok) throw Error(s.error.message);
    const sourceFn = f.ir.functions.find((fn) => fn.kind === "source")!;
    const spare = {
      ...sourceFn,
      id: { ...sourceFn.id, functionKey: "spare" },
      terminals: ["Y1", "Y2"].map((terminalKey) => ({
        deviceUid: sourceFn.id.deviceUid,
        terminalKey,
      })),
    };
    const mapping = mappings.find(
      (m) => m.typeId === "core:control-transformer",
    )!;
    const spareRule = {
      ...mapping.functions[0]!,
      functionKey: "spare",
      bindings: [
        { portId: "feed", terminalKey: "Y1" },
        { portId: "return", terminalKey: "Y2" },
      ],
    };
    const extra = mappings.map((m) =>
      m === mapping ? { ...m, functions: [...m.functions, spareRule] } : m,
    );
    const before = JSON.stringify(extra);
    // Defensive adapter contract: unrelated selected functions retain their own ports.
    const result = orientSourceWindingMappings(
      { ...f.ir, functions: [spare, ...f.ir.functions] },
      { ...s.value, functionIds: [spare.id, ...s.value.functionIds] },
      extra,
    );
    expect(
      result
        .find((m) => m.typeId === mapping.typeId)!
        .functions.find((fn) => fn.functionKey === "spare"),
    ).toBe(spareRule);
    expect(JSON.stringify(extra)).toBe(before);
  } finally {
    await f.dispose();
  }
});
