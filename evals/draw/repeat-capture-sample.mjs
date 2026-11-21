// Read-only shipped fixtures; generate a focused raster sample under evals/out.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cases, prepare } from "./corpus.mjs";
import { canonical, command, hash, json } from "./support.mjs";
import { within } from "./repin-io.mjs";
import {
  launch,
  drawingContextOptions,
  openSheet,
  cropBox,
} from "./browser.mjs";
import { SOURCE_HASH_FORMAT } from "./source-hashes.mjs";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";

const { values } = parseArgs({ options: { output: { type: "string" } } });
assert(values.output, "Use --output <new-directory-under-evals/out>");
const root = fileURLToPath(new URL("../../", import.meta.url)),
  outputRoot = join(root, "evals/out");
await mkdir(outputRoot, { recursive: true });
const output = await within(resolve(values.output), outputRoot);
await mkdir(output); // Never replace an earlier sample.
const cli = async (args) => {
  const result = await command(root, process.execPath, [
    join(root, "thermite.mjs"),
    ...args,
  ]);
  assert.equal(result.code, 0, result.stderr);
  return result;
};
const sources = [];
for (const flow of ["left-to-right", "top-to-bottom"]) {
  const id = `signal-loop-${flow}`,
    spec = cases().find((c) => c.id === id),
    directory = join(output, id);
  const { project, input } = await prepare(spec, root, directory, cli);
  await cli([
    "packet",
    "--project",
    project,
    "--input",
    input,
    "-o",
    join(directory, "packet.json"),
  ]);
  const packet = JSON.parse(
    await readFile(join(directory, "packet.json"), "utf8"),
  );
  assert.equal(
    packet.sheets.length,
    1,
    "Signal fixture must remain single-sheet",
  );
  sources.push({
    id,
    svg: embedPrintableFont(packet.sheets[0].svg),
    input: "evals/draw/corpus/requests.mjs:signal",
    flow,
  });
}
const series =
  "packages/render/test/goldens/series-loop/high-top-to-bottom.svg";
sources.push({
  id: "series-loop-high-top-to-bottom",
  svg: embedPrintableFont(await readFile(join(root, series), "utf8")),
  input: series,
});
const dol = "packages/core-library/test/fixtures/dol-starter";
const dolDirectory = join(output, "dol-control");
await mkdir(dolDirectory);
const dolRequest = join(dolDirectory, "request.json");
await writeFile(
  dolRequest,
  json({
    format: "schematic-packet-request/0.1",
    index: false,
    views: [
      JSON.parse(
        await readFile(join(root, dol, "control.circuit.json"), "utf8"),
      ),
    ],
  }),
);
await cli([
  "packet",
  "--project",
  join(root, dol),
  "--input",
  dolRequest,
  "-o",
  join(dolDirectory, "packet.json"),
]);
const dolPacket = JSON.parse(
  await readFile(join(dolDirectory, "packet.json"), "utf8"),
);
assert(dolPacket.sheets.length, "DOL fixture must produce sheets");
for (const sheet of dolPacket.sheets)
  sources.push({
    id: "dol-control",
    number: sheet.number,
    svg: embedPrintableFont(sheet.svg),
    input: `${dol}/control.circuit.json`,
  });

const browser = await launch(),
  sheets = [],
  results = [];
try {
  const context = await browser.newContext(drawingContextOptions),
    page = await context.newPage();
  await page.emulateMedia({ media: "print" });
  for (const { id, svg, number = 1 } of sources) {
    const directory = join(output, id),
      path = `${id}/sheet-${String(number).padStart(3, "0")}.svg`;
    await mkdir(directory, { recursive: true });
    await writeFile(join(output, path), svg, { flag: "wx" });
    sheets.push({ case: id, sheet: number, svg: { path, sha256: hash(svg) } });
    const geometry = await openSheet(page, svg),
      roles = new Set(),
      regions = [];
    for (const t of geometry.texts.filter((t) => t.painted !== false)) {
      if (roles.has(t.role)) continue;
      roles.add(t.role);
      regions.push({ bbox: t.bbox, kind: "text", role: t.role, text: t.text });
      if (roles.size === 8) break;
    }
    const conductors = await page.evaluate(() => {
      const root = document.querySelector("body>svg"),
        r = root.getBoundingClientRect(),
        v = root.viewBox.baseVal;
      return [
        ...root.querySelectorAll(
          "[data-loop-conductor],[data-circuit-conductor],[data-wire-uid]",
        ),
      ]
        .slice(0, 4)
        .map((e) => {
          const b = e.getBoundingClientRect();
          return {
            x: ((b.x - r.x) * v.width) / r.width,
            y: ((b.y - r.y) * v.height) / r.height,
            w: (b.width * v.width) / r.width,
            h: (b.height * v.height) / r.height,
          };
        });
    });
    assert(conductors.length, `No conductor regions in ${id}`);
    regions.push(...conductors.map((bbox) => ({ bbox, kind: "conductor" })));
    for (const [n, region] of regions.entries())
      results.push({
        id: `${id}/sheet-${number}/sample-${n}`,
        case: id,
        medium: "svg",
        sheet: number,
        evidence: {
          crop: `${id}/sheet-${number}-sample-${n}.png`,
          cropBbox: canonical(
            cropBox(region.bbox, geometry.width, geometry.height),
          ),
          sample: region,
        },
      });
  }
} finally {
  await browser.close();
}
await writeFile(
  join(output, "summary.json"),
  json({
    format: "thermite-draw-repeat-sample/1.0",
    purpose: "Raster stability sample; no evaluation scores or observations",
    inputs: sources.map(({ id, input, flow, number = 1 }) => ({
      id,
      input,
      flow,
      sheet: number,
    })),
    sourceHashes: { format: SOURCE_HASH_FORMAT, sheets },
    results,
  }),
  { flag: "wx" },
);
process.stdout.write(
  `Prepared ${results.length} regions across ${sources.length} sheets.\n`,
);
