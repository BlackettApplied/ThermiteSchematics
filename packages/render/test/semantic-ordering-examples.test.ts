import { compileProject } from "@thermite/compiler";
import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { expect, it } from "vitest";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicSheets } from "../src/sheets.js";
import { b4Round9Fixture } from "./b4-fixtures.js";
import { compileCoreFixture } from "./fixtures.js";
import { byDesignation } from "./render-robustness-fixture.js";
import {
  checkSeeds,
  digest,
  flows,
  reidentify,
  rootedRequests,
  semanticIdentities,
} from "./semantic-ordering-fixture.js";

const exampleProjects = [
  ...new Set(
    (await readdir("examples", { recursive: true }))
      .filter((f) => basename(f) === "system.json")
      .map(dirname),
  ),
].sort();
it("discovers all 14 shipped example projects", () => {
  expect(exampleProjects).toHaveLength(14);
  expect(exampleProjects).toContain("machine-demo");
});
it.each(exampleProjects.filter((project) => project !== "machine-demo"))(
  "shipped %s rooted views have one ELK input sequence and SVG over 30 internal UID assignments",
  async (project) => {
    const compiled = await compileProject(join("examples", project));
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    await checkSeeds(project, compiled.ir, rootedRequests(compiled.ir));
  },
  600000,
);

it("keeps a shared trace fork drawable and UID-independent over 30 assignments", async () => {
  const ir = b4Round9Fixture(await compileCoreFixture());
  const trace = {
    format: "schematic-view-request/0.2",
    root: byDesignation("LS1"),
    intent: { kind: "trace", to: byDesignation("PLC1"), includePower: false },
  } as const;
  for (const flow of flows)
    expect((await renderSchematic(ir, { ...trace, flow })).ok).toBe(true);
  await checkSeeds("shared trace fork", ir, [trace]);
}, 240000);

it("keeps paginated rooted SVGs independent of UIDs over 30 assignments", async () => {
  const base = await compileCoreFixture(),
    expected = new Map<string, unknown>();
  for (let seed = 0; seed < 30; seed++) {
    const ir = reidentify(base, seed);
    for (const flow of flows) {
      const r = await renderSchematicSheets(ir, {
        format: "schematic-view-request/0.2",
        root: byDesignation("LS1"),
        intent: {
          kind: "trace",
          to: byDesignation("PLC1"),
          includePower: true,
        },
        flow,
      });
      const actual = r.ok
        ? {
            ok: true,
            sheets: r.value.sheets.map((s) =>
              digest(semanticIdentities(ir, s.svg)),
            ),
          }
        : { ok: false, code: r.error.code };
      if (!expected.has(flow)) expected.set(flow, actual);
      expect(actual).toEqual(expected.get(flow));
    }
  }
}, 120000);
