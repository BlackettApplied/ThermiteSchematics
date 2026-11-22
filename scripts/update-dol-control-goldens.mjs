import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, resolve } from "node:path";
import {
  compileProject,
  writeFileAtomically,
} from "../packages/compiler/dist/index.js";
import { renderSchematic } from "../packages/render/dist/index.js";

/** Saved rooted DOL control golden maintenance.
 * Build first: bun run build
 * Verify: bun scripts/update-dol-control-goldens.mjs --check
 * Intentional update: bun scripts/update-dol-control-goldens.mjs --write
 *
 * Owns only k1-left-to-right.svg, k1-top-to-bottom.svg,
 * r1-left-to-right.svg and r1-top-to-bottom.svg under the dol-control goldens.
 * Tests consume these bytes and never update them as a side effect.
 * Review every diff and fixed-paper HTML, SVG and direct PDF in both flows,
 * including each junction at print size. These views preserve bounded selection;
 * they do not promise whole-rung coverage or add an omitted coil or pilot lamp.
 * Never change a lock, electrical connection or rating to make a golden pass.
 */
export async function updateDolControlGoldens(mode) {
  if (!["--check", "--write"].includes(mode))
    throw Error(
      "Usage: bun scripts/update-dol-control-goldens.mjs --check|--write",
    );
  const c = await compileProject(
    fileURLToPath(
      new URL(
        "../packages/core-library/test/fixtures/dol-starter/",
        import.meta.url,
      ),
    ),
  );
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const dest = new URL(
    "../packages/render/test/goldens/dol-control/",
    import.meta.url,
  );
  if (mode === "--write") await mkdir(dest, { recursive: true });
  for (const root of ["K1", "R1"])
    for (const flow of ["left-to-right", "top-to-bottom"]) {
      const r = await renderSchematic(c.ir, {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: root },
        family: "control",
        flow,
      });
      if (!r.ok) throw Error(JSON.stringify(r.error));
      const path = new URL(`${root.toLowerCase()}-${flow}.svg`, dest),
        bytes = Buffer.from(r.value.svg);
      if (mode === "--write")
        await writeFileAtomically(fileURLToPath(path), bytes);
      else if (!(await readFile(path)).equals(bytes))
        throw Error(
          `DOL control golden is stale: ${basename(fileURLToPath(path))}`,
        );
    }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await updateDolControlGoldens(process.argv[2]);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
