import { CONTINUATION_BLOCK_GAP } from "../../../render/src/packet/continuation-label.js";
import { prepareSchematicDrawing } from "../../../render/src/renderer.js";
import { rootedGangSegments } from "../../../render/src/symbols/rooted-gangs.js";
import { emitSchematicSvg } from "../../../render/src/svg/emitter.js";
import { svgSemanticId } from "../../../render/src/svg/escape.js";
import { SYMBOL_CATALOG } from "../../../render/src/symbols/catalog.js";
import { continuationFixture } from "../../../render/test/continuation-fixtures.js";
import { actuation } from "../../../render/test/dol-control-junctions-fixture.js";
import { dolProbeFixture } from "../../../render/test/dol-control-probes-fixture.js";
import { expect } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../../../render/src/sheets.js";
import { continuationOracle } from "../../../render/test/continuation-oracle.js";
import { parseSvg } from "../../../render/test/off-view-fixtures.js";
import { noteJson, type FactModule } from "./harness.js";

const module: FactModule = {
  facts: [
    {
      claim:
        "One caption/terminal appearance, nearest its body; keep exact landings and split captions. Omit net ink only when its anchored terminal prints the same name.",
      async check() {
        const c = await compileProject("examples/motor-starter");
        if (!c.ok) throw Error(JSON.stringify(c));
        for (const flow of ["left-to-right", "top-to-bottom"] as const) {
          const d = await prepareSchematicDrawing(c.ir, {
            format: "schematic-view-request/0.2",
            root: { by: "designation", value: "LS1" },
            intent: {
              kind: "trace",
              to: { by: "designation", value: "PLC1" },
              includePower: true,
            },
            flow,
          });
          if (!d.ok) throw Error(JSON.stringify(d));
          const { graph, layout, titleContext } = d.value;
          const svg = emitSchematicSvg(
            graph,
            layout,
            titleContext,
            SYMBOL_CATALOG,
            false,
            undefined,
            c.ir,
          );
          if (!svg.ok) throw Error(JSON.stringify(svg));
          const document = parseSvg(svg.value);
          // Terminal placement and conductor ends share the owned layout port.
          for (const edge of layout.edges.filter((e) => e.kind !== "boundary"))
            for (const [id, point] of [
              [edge.sourcePortId, edge.points[0]],
              [edge.targetPortId, edge.points.at(-1)],
            ] as const) {
              const port = layout.ports.find((p) => p.id === id)!;
              expect(point).toBeDefined();
              expect(
                Math.hypot(point!.x - port.x, point!.y - port.y),
              ).toBeLessThan(0.001);
            }
          let doubleLandings = 0;
          for (const node of graph.nodes) {
            if (node.kind === "junction") continue;
            const groups = new Map<string, (typeof node.labels)[number][]>();
            for (const label of node.labels.filter(
              (l) => l.role === "terminal",
            )) {
              const terminal = node.ports.find(
                (p) => p.id === label.ownerId,
              )!.terminal;
              const key = JSON.stringify(terminal);
              groups.set(key, [...(groups.get(key) ?? []), label]);
            }
            for (const labels of groups.values()) {
              const painted = labels.filter(
                (l) =>
                  document.querySelector(
                    `text[clip-path="url(#${svgSemanticId("clip", [l.id])})"]`,
                  )?.textContent,
              );
              expect(painted).toHaveLength(1);
              if (labels.length > 1) doubleLandings++;
            }
            for (const p of node.ports)
              expect(
                document.getElementById(
                  svgSemanticId("terminal", [
                    p.terminal.deviceUid,
                    p.terminal.terminalKey,
                    p.symbolPortId,
                  ]),
                ),
              ).not.toBeNull();
          }
          const power = await prepareSchematicDrawing(c.ir, {
            format: "schematic-view-request/0.1",
            family: "power",
            root: { by: "designation", value: "M1" },
            flow,
          });
          if (!power.ok) throw Error(JSON.stringify(power));
          const ink = emitSchematicSvg(
            power.value.graph,
            power.value.layout,
            power.value.titleContext,
            SYMBOL_CATALOG,
            false,
            undefined,
            c.ir,
          );
          if (!ink.ok) throw Error(JSON.stringify(ink));
          const powerDoc = parseSvg(ink.value);
          expect(powerDoc.querySelectorAll("text.label-net")).toHaveLength(0);
          const phaseCaptions = [
            ...powerDoc.querySelectorAll("text.label-terminal"),
          ].map((t) => t.textContent);
          for (const phase of ["L1", "L2", "L3", "PE"])
            expect(phaseCaptions).toContain(phase);
          expect(doubleLandings).toBeGreaterThan(0);
          noteJson({ flow, doubleLandings, captionsPerAppearance: 1 });
        }
      },
    },
    {
      claim: "Power view switch gangs: ink/R006.",
      async check() {
        const c = await compileProject("examples/motor-starter");
        if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
        const p = await prepareSchematicDrawing(c.ir, {
          format: "schematic-view-request/0.1",
          family: "power",
          root: { by: "designation", value: "M1" },
          flow: "top-to-bottom",
        });
        if (!p.ok) throw Error(p.error.message);
        const { graph, layout, titleContext } = p.value,
          good = rootedGangSegments(c.ir, graph, layout);
        if (!good.ok) throw Error(good.error.message);
        expect(good.value).toHaveLength(4);
        const stroke = good.value[0]!,
          blocked = structuredClone(layout);
        const caption = blocked.labels.find((l) =>
          graph.deviceGroups.some((g) => g.label.id === l.id),
        )!;
        caption.x = (stroke.from.x + stroke.to.x) / 2 - caption.width / 2;
        caption.y = (stroke.from.y + stroke.to.y) / 2 - caption.height / 2;
        const result = emitSchematicSvg(
          graph,
          blocked,
          titleContext,
          SYMBOL_CATALOG,
          false,
          undefined,
          c.ir,
        );
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            reason: "unprintable-layout",
            details: { reason: "mechanical-gang", groupId: stroke.groupId },
          },
        });
        if (result.ok) throw Error("Expected gang refusal");
        expect(result.error.message).toContain(stroke.groupId);
        noteJson(result.error);
      },
    },
    {
      claim: "Flows may fold retained strips.",
      async check() {
        const c = await compileProject("examples/motor-starter");
        if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
        for (const flow of ["left-to-right", "top-to-bottom"] as const) {
          const vertical = flow === "top-to-bottom";
          const r = await renderSchematicPacket(
            c.ir,
            {
              format: "schematic-packet-request/0.1",
              layout: vertical ? "compact" : "standard",
              page: vertical
                ? { size: "tabloid", orientation: "landscape" }
                : { size: "a3", orientation: "portrait" },
              views: [
                {
                  format: "schematic-view-request/0.1",
                  family: "power",
                  root: { by: "designation", value: "M1" },
                  flow,
                },
              ],
            },
            c.presentation,
          );
          if (!r.ok) throw Error(JSON.stringify(r.error));
          expect(r.value.sheets).toHaveLength(1);
          expect(r.value.html).toContain("Folded circuit sections");
          expect(continuationOracle(c.ir, r.value).sameSheet).toBeGreaterThan(
            0,
          );
          noteJson({ flow, foldedSheets: r.value.sheets.length });
        }
      },
    },

    {
      claim:
        "Cards name omissions. Continuations print the intact identity and peer `sheet.zone` at 2.5 mm. Unnamed jumpers print `JUMPER` with the reciprocal reference. Use one form per bank and a 2.5 mm gap.",
      async check() {
        const c = await compileProject("examples/motor-starter");
        if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
        const refused = await renderSchematicPacket(c.ir, {
          format: "schematic-packet-request/0.1",
          views: [
            {
              format: "schematic-view-request/0.1",
              root: { by: "designation", value: "LS1" },
              family: "power",
            },
          ],
        });
        expect(refused).toMatchObject({
          ok: false,
          error: { code: "R001", details: { designation: "LS1" } },
        });
        const r = await renderSchematicPacket(c.ir, {
          format: "schematic-packet-request/0.1",
          views: [
            {
              format: "schematic-view-request/0.1",
              root: { by: "designation", value: "M1" },
              family: "power",
            },
            {
              format: "schematic-view-request/0.2",
              root: { by: "designation", value: "CBL1" },
              family: "control",
              intent: { kind: "conductors" },
            },
          ],
        });
        if (!r.ok) throw Error(JSON.stringify(r.error));
        const jumper = await continuationFixture(true);
        try {
          const j = await renderSchematicPacket(jumper.ir, {
            format: "schematic-packet-request/0.1",
            views: [
              {
                format: "schematic-view-request/0.1",
                root: { by: "designation", value: "K1" },
                family: "control",
              },
            ],
          });
          if (!j.ok) throw Error(JSON.stringify(j.error));
          const names = j.value.sheets.flatMap((s) =>
            s.continuations.map((link) => link.conductor),
          );
          noteJson(names);
          expect(names).toContain("JUMPER");
          expect(continuationOracle(jumper.ir, j.value).ends).toBeGreaterThan(
            0,
          );
        } finally {
          await jumper.dispose();
        }
        expect(continuationOracle(c.ir, r.value).ends).toBeGreaterThan(0);
        expect(CONTINUATION_BLOCK_GAP).toBe(2.5);
        const svg = r.value.sheets.map((s) => s.svg).join("\n");
        expect(svg).toContain("Off-view at");
        const texts = r.value.sheets.flatMap((s) => [
          ...parseSvg(s.svg).querySelectorAll(
            "a[data-continuation-id] text, [data-cable-uid][data-conductor-id] text",
          ),
        ]);
        const usage = texts.filter(
          (t) => t.textContent === "ASSIGNED / USAGE UNSPECIFIED",
        );
        expect(usage.length).toBe(4);
        for (const t of [...usage, ...texts.filter((t) => t.closest("a"))])
          expect(Number(t.getAttribute("font-size"))).toBe(2.5);
      },
    },
    {
      claim:
        "Top-down can try tighter spacing once after a label or span refusal.",
      async check() {
        const fixture = await dolProbeFixture("p5");
        try {
          const result = await renderSchematicPacket(fixture.ir, {
            format: "schematic-packet-request/0.1",
            page: { size: "tabloid", orientation: "landscape", marginMm: 20 },
            views: [actuation("R1", "top-to-bottom")],
          });
          if (!result.ok) throw Error(JSON.stringify(result.error));
          expect(result.value.sheets.length).toBeGreaterThan(1);
          expect(result.value.coverage.diagnostics).toContainEqual(
            expect.objectContaining({ code: "I906", severity: "info" }),
          );
          expect(result.value.sheets[0]?.continuations).not.toHaveLength(0);
          noteJson({ sheets: result.value.sheets.length });
        } finally {
          await fixture.dispose();
        }
      },
    },
  ],
  unexecuted: new Map(),
};
export default module;
