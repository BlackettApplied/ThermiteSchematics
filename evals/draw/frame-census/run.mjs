import { continuationGeometry } from "./continuations.mjs";
import { compactFindings } from "./findings.mjs";
// Read-only paint audit for an already rendered compact capture. No expectations
// or source fixtures are modified. Two caller-owned shards are the maximum.
import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve, join } from "node:path";
import { startCensus } from "./text.mjs";
import { extendedInk } from "./shapes.mjs";
import { labelMetrics } from "../../../packages/render/dist/packet/label-text.js";
import { embedPrintableFont } from "../../../packages/cli/dist/printable-font.js";
const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    shard: { type: "string", default: "0" },
    shards: { type: "string", default: "1" },
    case: { type: "string" },
    manifest: { type: "string" },
  },
});
if (!values.input || !values.output)
  throw Error(
    "Use --input <paired capture directory> --output <new audit directory> [--shard 0 --shards 2]",
  );
const input = resolve(values.input),
  output = resolve(values.output),
  shard = Number(values.shard),
  shards = Number(values.shards);
if (
  !Number.isInteger(shard) ||
  ![1, 2].includes(shards) ||
  shard < 0 ||
  shard >= shards
)
  throw Error("Use one or two shards");
await mkdir(output, { recursive: true });
const census = await startCensus(),
  results = [];
try {
  const cases = values.manifest
    ? JSON.parse(await readFile(values.manifest, "utf8"))
    : (await readdir(input, { withFileTypes: true }))
        .filter(
          (e) =>
            e.isDirectory() && (!values.case || e.name.includes(values.case)),
        )
        .map((e) => e.name)
        .sort();
  for (const [i, name] of cases.entries()) {
    if (i % shards !== shard) continue;
    const dir = join(input, name);
    const packet = JSON.parse(
      gunzipSync(await readFile(join(dir, "after-packet.json.gz"))),
    );
    if (!packet.ok) continue;
    for (const sheet of packet.value.sheets) {
      const svg = embedPrintableFont(sheet.svg);
      const text = await census.measure(svg, {
        artifactDir: join(output, "crops"),
        tag: name + "-" + sheet.number,
      });
      const shapes = await extendedInk(census.page, svg, {
        artifactDir: join(output, "crops"),
        tag: name + "-" + sheet.number,
      });
      const nativeCuts = await continuationGeometry(
        census.page,
        svg,
        sheet.continuations,
      );
      const gaps = [],
        banks = new Map();
      for (const l of shapes.labels) {
        const m = labelMetrics(l.text),
          b = {
            x: l.anchorX + m.left,
            y: l.anchorY - m.top,
            w: m.right - m.left,
            h: m.top - m.bottom,
          };
        const gap =
          l.side === "right"
            ? b.x - l.cut.x
            : l.side === "left"
              ? l.cut.x - b.x - b.w
              : l.side === "top"
                ? l.cut.y - b.y - b.h
                : b.y - l.cut.y;
        gaps.push(gap);
        if (l.text.startsWith(l.cid + " /"))
          banks.set(l.bank, [...(banks.get(l.bank) ?? []), l]);
      }
      const ragged = [...banks]
        .filter(
          ([key, ls]) =>
            key.startsWith("right:") &&
            Math.max(...ls.map((l) => l.anchorX)) -
              Math.min(...ls.map((l) => l.anchorX)) >
              0.002,
        )
        .map(([key]) => key);
      const row = {
        case: name,
        sheet: sheet.number,
        ...text,
        ...shapes,
        nativeCutEndpoints: nativeCuts.endpoints,
        nativeCutFindings: nativeCuts.findings,
        labels: undefined,
        minCutGapMm: gaps.length ? Math.min(...gaps) : null,
        cutGapFailures: gaps.filter((g) => g < 3.15 - 1e-8).length,
        raggedBanks: ragged,
      };
      row.findings = compactFindings(row);
      results.push(row);
      if (row.findings) console.log("HIT", JSON.stringify(row));
    }
    await writeFile(
      join(output, `rows-${shard}.json`),
      JSON.stringify(results, null, 2),
    );
    console.log("checked", results.length, name);
  }
  const summary = {
    sheets: results.length,
    findings: results.reduce((n, r) => n + r.findings, 0),
    nativeCutFailures: results.reduce(
      (n, r) => n + r.nativeCutFindings.length,
      0,
    ),
    nativeCutEndpoints: results.reduce((n, r) => n + r.nativeCutEndpoints, 0),
    zoneTextContacts: results.reduce((n, r) => n + r.inkCollisions.length, 0),
    zoneShapeContacts: results.reduce(
      (n, r) => n + r.zoneShapeCollisions.length,
      0,
    ),
    labelWireContacts: results.reduce(
      (n, r) => n + r.labelWireCollisions.length,
      0,
    ),
    titleStrikes: results.reduce((n, r) => n + r.titleRuleCollisions.length, 0),
    raggedBanks: results.reduce((n, r) => n + r.raggedBanks.length, 0),
    cutGapFailures: results.reduce((n, r) => n + r.cutGapFailures, 0),
    minCutGapMm: Math.min(...results.map((r) => r.minCutGapMm ?? Infinity)),
    minBottomRuleClearanceMm: Math.min(
      ...results.map((r) => r.bottomRuleClearanceMm),
    ),
  };
  await writeFile(
    join(output, `summary-${shard}.json`),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
} finally {
  await census.close();
}
