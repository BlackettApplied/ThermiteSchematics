// Reindex existing measured evidence with source locators. No rendering, altered
// measurements or engine imports. Keep proposals under ignored evals/out/.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readJson, json } from "./support.mjs";
import { svgLocators, attachIdentities, familyFor } from "./locators.mjs";
import { cases } from "./corpus.mjs";
import { seed, serializeRegistry } from "./marker-authoring.mjs";
const directory = resolve(process.argv[2]),
  output = resolve(process.argv[3]),
  outRoot = fileURLToPath(new URL("../out/", import.meta.url));
assert(
  !relative(outRoot, output).startsWith(".."),
  "Proposals belong under evals/out",
);
const report = await readJson(join(directory, "summary.json")),
  specs = cases();
for (const c of report.cases) {
  const rows = report.results.filter((r) => r.case === c);
  let packet,
    ir = {},
    tables = [];
  try {
    packet = await readJson(join(directory, c, "packet.json"));
    ir = await readJson(join(directory, c, "ir.json"));
    tables = await readJson(join(directory, c, "query-reports.json"));
  } catch (error) {
    assert(
      !rows.some(
        (r) =>
          ["pass", "fail", "xfail"].includes(r.status) &&
          r.check !== "render" &&
          r.sheet > 0,
      ),
      `Missing saved artifacts for ${c}: ${error.message}`,
    );
  }
  const indexes = new Map();
  for (const row of rows) {
    const sheet = packet?.sheets.find((s) => s.number === row.sheet),
      view = sheet?.view ?? {};
    let index = new Map();
    if (sheet && row.evidence?.findings?.length) {
      if (!indexes.has(sheet.number))
        indexes.set(
          sheet.number,
          svgLocators(
            sheet.svg ??
              (await readFile(
                join(
                  directory,
                  c,
                  `sheet-${String(sheet.number).padStart(3, "0")}.svg`,
                ),
                "utf8",
              )),
            ir,
            view,
            tables,
          ),
        );
      index = indexes.get(sheet.number);
    }
    attachIdentities([row], index, view, ir, familyFor(c, specs));
    for (const f of row.evidence?.findings ?? []) delete f.assessments;
  }
}
const registry = seed(report.results, specs);
await writeFile(output + ".json", json(registry));
await writeFile(output + "-report.json", json(report));
try {
  const text = serializeRegistry(registry);
  await writeFile(output + ".mjs", text);
  process.stdout.write(
    `Registry ${registry.markers.length} identities, ${Buffer.byteLength(text)} bytes\n`,
  );
} catch (e) {
  process.stdout.write(`${registry.markers.length} identities; ${e.message}\n`);
}
