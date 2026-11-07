import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  paginateCircuitGroup,
  prepareCircuitView,
  type CircuitViewRequest,
} from "../src/circuit.js";
import { compileCoreFixture } from "./fixtures.js";
import { motorCircuitView } from "./circuit-fixture.js";
import { renderSchematicPacket } from "../src/sheets.js";
let ir: ElectricalIr, view: CircuitViewRequest;
beforeAll(async () => {
  const directory = resolve("examples/circuit-pagination");
  const c = await compileProject(directory);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  expect(c.diagnostics).toEqual([]);
  ir = c.ir;
  view = JSON.parse(await readFile(resolve(directory, "packet.json"), "utf8"))
    .views[0];
});

describe("whole-conductor circuit pagination", () => {
  it("keeps selected transformer windings and their shared core together", async () => {
    const c = await compileProject(resolve("examples/functional-symbols"));
    if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
    const request = JSON.parse(
      await readFile(
        resolve(
          "examples/functional-symbols/packet-left-to-right.request.json",
        ),
        "utf8",
      ),
    ).views[0] as CircuitViewRequest;
    const original = (await prepareCircuitView(c.ir, request)).groups[0]!;
    const parts = await paginateCircuitGroup(
      c.ir,
      request,
      0,
      original,
      (g) => g.coverage.conductorIds.length <= 1,
    );
    const owner = c.ir.devices.find((d) => d.designation === "T1")!;
    const windingIds = c.ir.functions
      .filter((f) => f.id.deviceUid === owner.uid)
      .map((f) => JSON.stringify([f.id.deviceUid, f.id.functionKey]));
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.coverage.functionIds).toEqual(
        expect.arrayContaining(windingIds),
      );
      expect(
        parseHTML(part.content).document.querySelectorAll(
          '[data-magnetic-association="shared-core"]',
        ),
      ).toHaveLength(1);
    }
  });

  it("keeps selected mechanical gang members together in each occurrence", async () => {
    const core = await compileCoreFixture();
    const request = motorCircuitView();
    const original = (await prepareCircuitView(core, request)).groups[0]!;
    const parts = await paginateCircuitGroup(
      core,
      request,
      0,
      original,
      (g) => g.coverage.conductorIds.length <= 1,
    );
    expect(parts).toHaveLength(13);
    const gangs = core.gangedGroups
      .map((g) =>
        g.functionIds
          .map((f) => JSON.stringify([f.deviceUid, f.functionKey]))
          .filter((id) => original.coverage.functionIds.includes(id)),
      )
      .filter((g) => g.length > 1);
    expect(gangs.length).toBeGreaterThan(0);
    for (const part of parts)
      for (const gang of gangs)
        if (gang.some((id) => part.coverage.functionIds.includes(id)))
          expect(part.coverage.functionIds).toEqual(
            expect.arrayContaining(gang),
          );
  });
  for (const flow of ["left-to-right", "top-to-bottom"] as const)
    it.each(["tabloid", "a3", "a4", "letter"] as const)(
      `conserves wiring and symbols with reciprocal references: ${flow}, %s`,
      async (size) => {
        const before = JSON.stringify(ir);
        const original = (await prepareCircuitView(ir, { ...view, flow }))
          .groups[0]!;
        const request = {
          format: "schematic-packet-request/0.1" as const,
          page: {
            size,
            orientation:
              flow === "left-to-right"
                ? ("landscape" as const)
                : ("portrait" as const),
          },
          layout: "compact" as const,
          index: true,
          views: [
            {
              format: "documentation-view-request/0.1" as const,
              kind: "bom" as const,
            },
            { ...view, flow, columns: 2 as const },
            { ...view, flow, title: "Second independent occurrence" },
          ],
        };
        const r = await renderSchematicPacket(ir, request);
        if (!r.ok) throw new Error(r.error.message);
        const packet = r.value;
        expect(packet.coverage.counts.conductors).toEqual({
          total: 20,
          represented: 19,
          outsideAuditedViews: 1,
        });
        expect(packet.coverage.counts.functions).toEqual({
          total: 22,
          represented: 20,
          outsideAuditedViews: 2,
        });
        const selected = packet.sheets.filter(
          (s) => s.view.title === view.title,
        );
        expect(selected.length).toBeGreaterThan(1);
        const docs = selected.map((s) => parseHTML(s.svg).document);
        const conductors = docs.flatMap((d) => [
          ...d.querySelectorAll("[data-circuit-conductor]"),
        ]);
        expect(
          conductors
            .map((e) => e.getAttribute("data-circuit-conductor"))
            .sort(),
        ).toEqual(original.coverage.conductorIds);
        for (const c of packet.coverage.conductors.filter(
          (c) => c.appearances.length,
        )) {
          expect(c.appearances).toHaveLength(2);
          const e = conductors.find(
            (e) => e.getAttribute("data-circuit-conductor") === c.id,
          )!;
          expect(JSON.parse(e.getAttribute("data-endpoints")!)).toEqual(
            c.terminals,
          );
          const net = ir.indexes.netIdByTerminal.find(
            (n) => JSON.stringify(n.key) === JSON.stringify(c.terminals[0]),
          )!.value;
          expect(e.getAttribute("data-net-id")).toBe(net);
          expect(
            docs
              .flatMap((d) => [...d.querySelectorAll("[data-wire-label]")])
              .filter((e) => e.getAttribute("data-wire-label") === c.id),
          ).toHaveLength(1);
        }
        const functions = docs.flatMap((d) => [
          ...d.querySelectorAll("[data-function-id]"),
        ]);
        expect(
          [
            ...new Set(
              functions.map((e) => e.getAttribute("data-function-id")!),
            ),
          ].sort(),
        ).toEqual(original.coverage.functionIds);
        expect(
          docs.some((d) => d.documentElement.textContent!.includes("BOUNDARY")),
        ).toBe(true);
        expect(
          docs.some((d) => d.documentElement.textContent!.includes("[+1]")),
        ).toBe(true);
        expect(
          docs
            .flatMap((d) => [...d.querySelectorAll("text")])
            .filter((e) => e.textContent === view.notes![0]),
        ).toHaveLength(1);
        expect(
          docs
            .flatMap((d) => [...d.querySelectorAll("text")])
            .some(
              (e) =>
                e.textContent?.includes("P") && e.textContent?.includes("/S"),
            ),
        ).toBe(true);
        const references = selected.flatMap(
          (s) => s.circuitContinuations ?? [],
        );
        expect(references.length).toBeGreaterThan(0);
        expect(
          references.some(
            (ref) =>
              selected.find((s) => s.number === ref.toSheet)?.number !==
              selected[0]!.number,
          ),
        ).toBe(true);
        for (const sheet of selected)
          for (const ref of sheet.circuitContinuations ?? []) {
            const target = packet.sheets[ref.toSheet - 1]!;
            expect(target.view.title).toBe(view.title);
            expect(target.circuitContinuations).toContainEqual({
              ...ref,
              fromPart: ref.toPart,
              toPart: ref.fromPart,
              toSheet: sheet.number,
            });
            const doc = parseHTML(target.svg).document;
            const group = [...doc.querySelectorAll("[data-circuit-part]")].find(
              (e) => e.getAttribute("data-circuit-part") === String(ref.toPart),
            )!;
            expect(
              [...group.querySelectorAll("[data-terminal-id]")].some(
                (e) => e.getAttribute("data-terminal-id") === ref.terminalId,
              ),
            ).toBe(true);
            const source = parseHTML(sheet.svg).document;
            const rows = [
              ...source.querySelectorAll("[data-circuit-continuation]"),
            ].filter(
              (e) =>
                e.getAttribute("data-continuation-terminal") ===
                  ref.terminalId &&
                e.getAttribute("data-from-part") === String(ref.fromPart),
            );
            expect(
              rows.some((e) =>
                JSON.parse(e.getAttribute("data-destination-sheets")!).includes(
                  ref.toSheet,
                ),
              ),
            ).toBe(true);
          }
        for (const doc of docs)
          for (const text of doc.querySelectorAll(
            "[data-wire-label] text, [data-terminal-id] text, [data-function-id] text",
          ))
            expect(
              Number(text.getAttribute("font-size")),
            ).toBeGreaterThanOrEqual(2.5);
        expect(await renderSchematicPacket(ir, request)).toEqual(r);
        expect(JSON.stringify(ir)).toBe(before);
      },
    );

  it("preserves fitting group output and the single-drawing API", async () => {
    const request = {
      ...view,
      groups: [
        {
          ...view.groups[0]!,
          functions: view.groups[0]!.functions.slice(0, 2),
          conductors: ["W1"],
        },
      ],
    };
    const original = (await prepareCircuitView(ir, request)).groups[0]!;
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [request],
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.sheets[0]!.svg).toContain(original.content);
    expect(r.value.sheets[0]).not.toHaveProperty("circuitContinuations");
    expect(original).not.toHaveProperty("pagination");
  });

  it.each(["missing edge", "detached endpoint"])(
    "does not hide invalid original layout: %s",
    async (scenario) => {
      const prototype = (BundledElk as unknown as { prototype: ELK }).prototype;
      const layout = prototype.layout;
      const spy = vi
        .spyOn(prototype, "layout")
        .mockImplementationOnce(async function (this: ELK, graph: ElkNode) {
          const result = await layout.call(this, graph);
          if (scenario === "missing edge") result.edges!.pop();
          else result.edges![0]!.sections![0]!.startPoint.x += 2;
          return result;
        });
      try {
        const r = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          views: [view],
        });
        expect(r).toMatchObject({ ok: false, error: { code: "R006" } });
        expect(r).not.toHaveProperty("value");
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("fails when a complete selected symbol cannot fit", async () => {
    const changed = structuredClone(ir);
    const device = changed.devices.find((d) => d.designation === "L1")!;
    device.designation = "LONG_SYMBOL_".repeat(40);
    const r = await renderSchematicPacket(changed, {
      format: "schematic-packet-request/0.1",
      page: { size: "a4", orientation: "landscape" },
      views: [
        {
          ...view,
          groups: view.groups.map((g) => ({
            ...g,
            functions: g.functions.map((f) =>
              f.device.value === "L1"
                ? { ...f, device: { by: "uid" as const, value: device.uid } }
                : f,
            ),
          })),
        },
      ],
    });
    expect(r).toMatchObject({ ok: false, error: { code: "R006" } });
    expect(r).not.toHaveProperty("value");
  });
});
