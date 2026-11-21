import { afterEach, expect, it, vi } from "vitest";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import * as runtime from "../src/layout/elk-runtime.js";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { compileProject, lockProject } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { routeQuality } from "../../../evals/draw/checks.mjs";
import { flows } from "./direct-loop-fixture.js";
const factory = runtime.createElkEngine;
afterEach(() => vi.restoreAllMocks());

it.each(
  flows.flatMap((flow) =>
    ["W", "W1", "AO+"].map((names) => [flow, names] as const),
  ),
)(
  "keeps the synthetic output loop complete and landed without short internal jogs in %s with %s labels",
  async (flow, names) => {
    const dir = await mkdtemp(join(tmpdir(), "thermite-output-jog-"));
    try {
      for (const name of ["field-interfaces", "industrial-pilot"])
        await cp(resolve("libraries", name), join(dir, name), {
          recursive: true,
        });
      await cp(
        resolve("packages/cli/fixtures/analog-output/source.json"),
        join(dir, "source.json"),
      );
      const source = JSON.parse(
        await readFile(join(dir, "source.json"), "utf8"),
      );
      let index = 0;
      for (const object of source.objects) {
        if (object.kind !== "wire") continue;
        object.designation =
          names === "AO+" ? `AO${++index}+` : `${names}${++index}`;
      }
      await writeFile(join(dir, "source.json"), JSON.stringify(source));
      await writeFile(
        join(dir, "system.json"),
        JSON.stringify({
          format: "electrical-system/0.1",
          project: { name: "Synthetic output loop" },
          sources: ["source.json"],
          libraries: ["field-interfaces", "industrial-pilot"].map((name) => ({
            name,
            version: "0.1.0",
            path: name,
          })),
        }),
      );
      expect((await lockProject(dir)).ok).toBe(true);
      const compiled = await compileProject(dir);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const ir = compiled.ir,
        before = JSON.stringify(ir);
      const packet = JSON.parse(
        await readFile(
          "packages/cli/fixtures/analog-output/packet.request.json",
          "utf8",
        ),
      );
      const request = { ...packet.views[0], flow };
      let input: ElkNode;
      vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
        const engine = factory();
        return {
          layout: async (graph: ElkNode) => {
            input = structuredClone(graph);
            return engine.layout(graph);
          },
        } as ReturnType<typeof factory>;
      });
      const drawing = await prepareSignalLoopDrawing(ir, request);
      expect(input!.edges!.filter((e) => e.labels!.length === 0)).toHaveLength(
        flow === "top-to-bottom" ? 6 : 0,
      );
      expect(input!.edges!.filter((e) => e.labels!.length === 1)).toHaveLength(
        flow === "top-to-bottom" ? 1 : 7,
      );
      const doc = parseHTML(drawing.content).document;
      const paths = [...doc.querySelectorAll("[data-loop-conductor]")];
      expect(paths).toHaveLength(6);
      for (const route of paths) {
        const wire = ir.wires.find(
          (w) => w.uid === route.getAttribute("data-loop-conductor"),
        )!;
        expect(route.querySelectorAll("rect")).toHaveLength(1);
        expect(route.textContent).toContain(wire.designation);
        expect(JSON.parse(route.getAttribute("data-terminal-ends")!)).toEqual(
          wire.endpoints.map((e) => e.terminal),
        );
        const points = [
          ...route
            .querySelector("path")!
            .getAttribute("d")!
            .matchAll(/[ML] ([-.\d]+) ([-.\d]+)/g),
        ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
        if (
          flow === "top-to-bottom" &&
          wire.endpoints.every((e) =>
            ["XT1", "XP1"].includes(
              ir.devices.find((d) => d.uid === e.terminal.deviceUid)!
                .designation,
            ),
          )
        )
          expect(points).toHaveLength(2);
        expect(
          routeQuality({
            width: 1000,
            height: 1000,
            shapes: [{ conductor: true, stroke: 0.4, points }],
          }),
          wire.designation,
        ).toEqual([]);
      }
      expect(doc.querySelectorAll("[data-cable-assembly]")).toHaveLength(1);
      const rendered = await renderSchematicPacket(ir, {
        ...packet,
        views: [request],
        page: {
          ...packet.page,
          orientation: flow === "top-to-bottom" ? "portrait" : "landscape",
        },
      });
      if (!rendered.ok) throw Error(JSON.stringify(rendered.error));
      expect(rendered.value.sheets).toHaveLength(2);
      expect(rendered.value.sheets[1]!.view.kind).toBe("wires");
      expect(JSON.stringify(ir)).toBe(before);
      if (flow === "top-to-bottom") {
        const detailRequest = { ...request };
        delete detailRequest.cableAssemblies;
        const detail = await renderSchematicPacket(ir, {
          ...packet,
          views: [detailRequest],
          page: { ...packet.page, orientation: "portrait" },
        });
        expect(detail.ok, JSON.stringify(detail)).toBe(true);
        expect(
          input!.edges!.filter((e) => e.labels!.length === 0),
        ).toHaveLength(6);
        expect(
          input!.edges!.filter((e) => e.labels!.length === 1),
        ).toHaveLength(4);
        if (detail.ok)
          expect(
            parseHTML(detail.value.sheets[0]!.svg).document.querySelectorAll(
              "[data-loop-conductor]",
            ),
          ).toHaveLength(10);
      }
      if (flow === "top-to-bottom" && names === "W") {
        const wide = structuredClone(ir);
        for (const w of wide.wires)
          w.designation = `W-AO-${w.designation!.slice(1).padStart(2, "0")}`;
        for (const entry of wide.indexes.objectRefByDesignation) {
          const wire = wide.wires.find((w) => w.uid === entry.value.uid);
          if (wire) entry.key = wire.designation!;
        }
        wide.indexes.objectRefByDesignation.sort((a, b) =>
          a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
        );
        const wideDrawing = await prepareSignalLoopDrawing(wide, request);
        expect(
          parseHTML(wideDrawing.content).document.querySelectorAll(
            "[data-loop-conductor]",
          ),
        ).toHaveLength(6);
        // The entire graph, including all six wire labels, returns to ELK.
        expect(input!.edges!.every((e) => e.labels!.length === 1)).toBe(true);
        expect(input!.layoutOptions!["elk.spacing.edgeEdge"]).toBe("6");
        const fallback = await renderSchematicPacket(wide, {
          ...packet,
          views: [request],
          page: { ...packet.page, orientation: "portrait" },
        });
        expect(fallback.ok, JSON.stringify(fallback)).toBe(true);
        if (fallback.ok) expect(fallback.value.sheets).toHaveLength(2);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
