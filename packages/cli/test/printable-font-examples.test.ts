import { afterAll, it, expect } from "vitest";
import { mkdtemp, rm, mkdir, glob } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { spawnSync } from "node:child_process";
import { cases, prepare } from "../../../evals/draw/corpus.mjs";
import { checkSvgFontBudget } from "../../../evals/draw/font-budget.mjs";
import { embedPrintableFont } from "../src/printable-font.js";
const scratch = await mkdtemp(join(tmpdir(), "thermite-font-examples-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));
it.each(cases().filter((c) => !c.sweep))(
  "bounds every rendered shipped-example SVG: $id",
  async (c) => {
    const dir = join(scratch, c.id);
    await mkdir(dir);
    const cli = async (args: string[]) => {
      const r = spawnSync(
        process.execPath,
        [resolve("thermite.mjs"), ...args],
        { encoding: "utf8" },
      );
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const fixture = await prepare(c, process.cwd(), dir, cli),
      compiled = await compileProject(fixture.project);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const result = await renderSchematicPacket(
      compiled.ir,
      fixture.request,
      compiled.presentation,
    );
    if (!result.ok) {
      expect(c.id).toBe("motor-starter-top-to-bottom");
      expect(result.error.code).toBe("R006");
      return;
    }
    expect(
      Buffer.byteLength(embedPrintableFont(result.value.html)) -
        Buffer.byteLength(result.value.html),
    ).toBeLessThanOrEqual(500 * 1024);
    for (const sheet of result.value.sheets) {
      const svg = embedPrintableFont(sheet.svg);
      expect(
        checkSvgFontBudget(svg, `${c.id}/${sheet.number}`),
      ).toBeLessThanOrEqual(61440);
    }
  },
);

it("covers every shipped example project in the font budget matrix", async () => {
  const inventory: string[] = [];
  for await (const file of glob("examples/**/system.json"))
    inventory.push(file.replace(/\\/gu, "/").replace(/\/system.json$/u, ""));
  expect(
    new Set(
      cases()
        .filter((c) => c.project.startsWith("examples/"))
        .map((c) => c.project),
    ),
  ).toEqual(new Set(inventory));
});
