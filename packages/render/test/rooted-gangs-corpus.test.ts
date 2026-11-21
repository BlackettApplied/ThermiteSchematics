import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { cases, prepare } from "../../../evals/draw/corpus.mjs";
import {
  prepareSchematicDrawing,
  createSchematicRendererWithDependencies,
} from "../src/renderer.js";
import { rootedGangSegments } from "../src/symbols/rooted-gangs.js";
import { emitSchematicSvg } from "../src/svg/emitter.js";
import { gangAnchor } from "../src/symbols/gang-geometry.js";
import { OUTER_SVG_PADDING } from "../src/symbols/catalog.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";

it("paints every authored visible gang in the rooted drawing corpus, both flows and spacing profiles", async () => {
  const root = resolve("."),
    scratch = await mkdtemp(join(tmpdir(), "thermite-gang-corpus-"));
  const seen = new Set<string>(),
    compiled = new Map();
  let fixtures = 0,
    gangViews = 0,
    checkedGroups = 0;
  try {
    for (const spec of cases()) {
      const signature = JSON.stringify([
        spec.project,
        spec.request,
        spec.recipe,
        spec.flow,
        spec.sweep?.layout,
      ]);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const dest = join(scratch, String(++fixtures));
      await mkdir(dest);
      const fixture = await prepare(
        spec,
        root,
        dest,
        async (args: string[]) => {
          const r = await promisify(execFile)(
            process.execPath,
            [join(root, "thermite.mjs"), ...args],
            { cwd: root },
          );
          return { code: 0, ...r };
        },
      );
      if (!compiled.has(fixture.project))
        compiled.set(fixture.project, await compileProject(fixture.project));
      const c = compiled.get(fixture.project);
      if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
      const before = JSON.stringify(c.ir);
      for (const request of fixture.request.views.filter((v: any) =>
        v.format.startsWith("schematic-view-request/"),
      )) {
        const key = JSON.stringify([
          spec.project,
          spec.recipe,
          request,
          fixture.request.layout,
        ]);
        if (seen.has(key)) continue;
        seen.add(key);
        const dependencies =
          fixture.request.layout === "compact"
            ? { spacingProfile: "compact" as const }
            : {};
        const drawing = await prepareSchematicDrawing(
          c.ir,
          request,
          c.presentation,
          dependencies,
        );
        if (!drawing.ok)
          throw Error(`${spec.id}: ${JSON.stringify(drawing.error)}`);
        const result = await createSchematicRendererWithDependencies(
          dependencies,
        ).render(c.ir, request, c.presentation);
        if (!result.ok)
          throw Error(`${spec.id}: ${JSON.stringify(result.error)}`);
        const doc = parseHTML(result.value.svg).document;
        const strokes = [
          ...doc.querySelectorAll('line[data-mechanical-association="ganged"]'),
        ];
        let expectedTotal = 0;
        for (const group of c.ir.gangedGroups) {
          const members = drawing.value.graph.nodes.filter(
            (n) =>
              n.kind === "symbol" &&
              n.functionIds.some((f) =>
                group.functionIds.some(
                  (g: any) =>
                    f.deviceUid === g.deviceUid &&
                    f.functionKey === g.functionKey,
                ),
              ),
          );
          if (members.length < 2) continue;
          expectedTotal += members.length - 1;
          checkedGroups++;
          const painted = strokes.filter(
            (s) => s.getAttribute("data-ganged-group") === group.id,
          );
          expect(painted, `${spec.id}: ${group.id}`).toHaveLength(
            members.length - 1,
          );
          for (const line of painted) {
            expect(line.getAttribute("stroke")).toBe("#17212b");
            expect(Number(line.getAttribute("stroke-width"))).toBeGreaterThan(
              0,
            );
            expect(line.getAttribute("stroke-dasharray")).toBeTruthy();
            const functions = JSON.parse(
              line.getAttribute("data-ganged-functions")!,
            );
            expect(functions).toHaveLength(2);
            for (const [i, fn] of functions.entries()) {
              expect(group.functionIds).toContainEqual(fn);
              const member = members.find(
                (n) =>
                  n.kind === "symbol" &&
                  n.functionIds.some(
                    (f) =>
                      f.deviceUid === fn.deviceUid &&
                      f.functionKey === fn.functionKey,
                  ),
              );
              if (!member || member.kind !== "symbol")
                throw Error("Missing emitted gang member");
              const anchor = gangAnchor(member),
                origin = drawing.value.layout.nodes.find(
                  (n) => n.id === member.id,
                )?.primitiveOrigin;
              if (!anchor || !origin)
                throw Error("Missing emitted gang anchor");
              for (const axis of ["x", "y"] as const)
                expect(
                  Number(line.getAttribute(`${axis}${i + 1}`)),
                ).toBeCloseTo(
                  origin[axis] + anchor[axis] + OUTER_SVG_PADDING,
                  3,
                );
            }
          }
        }
        expect(strokes).toHaveLength(expectedTotal);
        if (expectedTotal) gangViews++;
      }
      expect(JSON.stringify(c.ir)).toBe(before);
    }
    expect(gangViews).toBeGreaterThanOrEqual(14);
    expect(checkedGroups).toBeGreaterThanOrEqual(28);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 120000);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "refuses a forced gang/annotation collision in %s without emitting partial ink",
  async (flow) => {
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const prepared = await prepareSchematicDrawing(c.ir, {
      format: "schematic-view-request/0.1",
      family: "power",
      root: { by: "designation", value: "M1" },
      flow,
    });
    if (!prepared.ok) throw Error(prepared.error.message);
    const p = prepared.value,
      gangs = rootedGangSegments(c.ir, p.graph, p.layout);
    if (!gangs.ok) throw Error(gangs.error.message);
    const link = gangs.value[0]!,
      blocked = structuredClone(p.layout);
    const label = blocked.labels.find((l) =>
      p.graph.nodes.some(
        (n) =>
          n.kind !== "junction" &&
          n.labels.some(
            (s) => s.id === l.id && (s.printableText ?? s.text) !== "",
          ),
      ),
    )!;
    label.x = (link.from.x + link.to.x) / 2 - label.width / 2;
    label.y = (link.from.y + link.to.y) / 2 - label.height / 2;
    for (const result of [
      rootedGangSegments(c.ir, p.graph, blocked),
      emitSchematicSvg(
        p.graph,
        blocked,
        p.titleContext,
        SYMBOL_CATALOG,
        false,
        undefined,
        c.ir,
      ),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "R006",
          reason: "unprintable-layout",
          details: {
            reason: "mechanical-gang",
            groupId: link.groupId,
            expectedStrokes: 2,
          },
        },
      });
      if (!result.ok) expect(result.error.message).toContain(link.groupId);
      expect("value" in result).toBe(false);
    }
  },
);
