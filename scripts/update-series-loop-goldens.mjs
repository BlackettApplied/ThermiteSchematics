import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, resolve } from "node:path";
import { writeFileAtomically } from "../packages/compiler/dist/index.js";
import { renderSchematicPacket } from "../packages/render/dist/index.js";
import {
  seriesFixture,
  request,
} from "../packages/render/test/series-loop-fixture.ts";

/** Only the four opted-in series-loop SVG sheets are owned by this updater. */
export async function updateSeriesLoopGoldens(mode) {
  if (mode !== "--write" && mode !== "--check")
    throw new Error(
      "Usage: bun scripts/update-series-loop-goldens.mjs --write|--check",
    );
  const dest = new URL(
    "../packages/render/test/goldens/series-loop/",
    import.meta.url,
  );
  if (mode === "--write") await mkdir(dest, { recursive: true });
  for (const high of [false, true]) {
    const f = await seriesFixture(undefined, high);
    try {
      for (const flow of ["left-to-right", "top-to-bottom"]) {
        const result = await renderSchematicPacket(f.ir, {
          format: "schematic-packet-request/0.1",
          index: false,
          views: [request({ flow })],
        });
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        if (result.value.sheets.length !== 1)
          throw new Error("Series-loop golden must be a single sheet.");
        const path = new URL(`${high ? "high" : "low"}-${flow}.svg`, dest),
          bytes = Buffer.from(result.value.sheets[0].svg);
        if (mode === "--write")
          await writeFileAtomically(fileURLToPath(path), bytes);
        else if (!(await readFile(path)).equals(bytes))
          throw new Error(
            `Series-loop golden is stale: ${basename(fileURLToPath(path))}`,
          );
      }
    } finally {
      await f.dispose();
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await updateSeriesLoopGoldens(process.argv[2]);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
