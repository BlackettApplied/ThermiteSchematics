import { assertRootedCaptionCensus } from "./helpers/wire-label-census.js";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { prepareSchematicDrawing } from "../src/renderer.js";
import type { SchematicViewRequest } from "../src/types.js";
import { required } from "./fixtures.js";

it("retains every printed edge caption across 50 requests and supports its full ink or points a visible leader to its actual native owner", async () => {
  const fixture: {
    cases: {
      key: string;
      project: string;
      request: SchematicViewRequest;
      error?: string;
    }[];
  } = JSON.parse(
    await readFile(
      new URL("./printable-anchor-baseline.json", import.meta.url),
      "utf8",
    ),
  );
  expect(fixture.cases).toHaveLength(50);
  const projects = new Map<
    string,
    Awaited<ReturnType<typeof compileProject>>
  >();
  let count = 0,
    nativeContexts = 0,
    railReplacements = 0;
  for (const c of fixture.cases) {
    if (!projects.has(c.project))
      projects.set(c.project, await compileProject(c.project));
    const compiled = required(projects.get(c.project));
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const prepared = await prepareSchematicDrawing(
      compiled.ir,
      c.request,
      compiled.presentation,
    );
    if (!prepared.ok) {
      expect(c.error, c.key).toBe(prepared.error.code);
      continue;
    }
    const observed = assertRootedCaptionCensus(
      prepared.value,
      compiled.ir,
      c.key,
    );
    count += observed.count;
    railReplacements += observed.railReplacements;
    nativeContexts += observed.nativeContexts;
  }
  expect(count + railReplacements).toBe(292);
  expect(railReplacements).toBe(6);
  expect(nativeContexts).toBe(2);
}, 60000);
