import { EVALS_VERSION } from "./version.mjs";
// Standalone replay. Strict DQ-23 separately adopts the shared native/ink predicates.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildDocumentation } from "../../packages/query/dist/index.js";
import {
  launch,
  displaySheet,
  drawingContextOptions,
  drawingLaunchArgs,
} from "./browser.mjs";
import { stripInventoryEquality } from "./terminal-strip-inventory.mjs";
import { nativeStrip } from "./terminal-strip-native.mjs";
import { stripInkScript } from "./terminal-strip-ink.mjs";
import { checkTerminalStrip } from "./terminal-strip-check.mjs";
import { readReportFile } from "./report-file.mjs";
import { readCheckpointCaseFiles } from "./case-files.mjs";
import { readCheckers, checkerManifestHash } from "./checker-manifest.mjs";
import { sheetInkKindScript } from "./sheet-ink-kind.mjs";
import { hash, json } from "./support.mjs";
const { values } = parseArgs({
  options: { capture: { type: "string" }, out: { type: "string" } },
});
assert(
  values.capture && values.out,
  "Use --capture <strict checkpoint> --out <new receipt.json>",
);
const directory = resolve(values.capture),
  report = await readReportFile(join(directory, "summary.json.gz")),
  readCaseFile = await readCheckpointCaseFiles(directory),
  rows = [],
  sources = [];
async function read(id, name) {
  const bytes = await readCaseFile(id, name);
  sources.push({ case: id, file: name, sha256: hash(bytes) });
  return bytes;
}
async function measureSvg(id, s, page) {
  const name = `sheet-${String(s.number).padStart(3, "0")}.svg`,
    bytes = await read(id, name);
  const expected = report.value.sourceHashes.sheets.find(
    (x) => x.case === id && x.sheet === s.number,
  )?.svg.sha256;
  assert.equal(hash(bytes), expected, "Strip SVG differs from strict capture");
  await displaySheet(page, bytes.toString());
  return {
    measured: await page.evaluate(stripInkScript),
    kinds: await page.evaluate(sheetInkKindScript),
  };
}
async function measureView(id, page, packet, ir, v, index) {
  // Domain query selects native rows only. Native order/geometry are reconstructed separately.
  const table = buildDocumentation(ir, v),
    uids = [...new Set(table.rows.map((r) => JSON.parse(r.key)[0]))];
  if (!uids.length) {
    return {
      case: id,
      view: index,
      assessment: "not-applicable",
      reason: "Empty native terminal selection",
    };
  }
  const native = nativeStrip(ir, uids),
    ink = {
      terminals: [],
      bridges: [],
      incidences: [],
      unclaimed: [],
      rows: [],
      references: [],
      headings: [],
      notes: [],
      texts: [],
      continuations: [],
      bridgeLabels: [],
    };
  const sheets = packet.sheets.filter(
    (s) =>
      ["terminals", "terminal-strip"].includes(s.view.kind) &&
      (v.key
        ? s.sheetKey === `view:${v.key}` || s.sheetKey === v.key
        : s.view.title === table.title),
  );
  const sheetKinds = [];
  for (const s of sheets) {
    const { measured, kinds } = await measureSvg(id, s, page);
    for (const key of Object.keys(ink)) ink[key].push(...measured[key]);
    sheetKinds.push(...kinds.map((k) => ({ sheet: s.number, ...k })));
  }
  const checked = checkTerminalStrip(native, ink);
  const inventoryEquality = stripInventoryEquality(table, ink);
  const findings = [
    ...checked.findings,
    ...inventoryEquality.findings,
    ...sheetKinds.flatMap((k) =>
      k.issues.map((issue) => ({ sheet: k.sheet, ...issue })),
    ),
  ];
  return {
    case: id,
    view: index,
    title: table.title,
    sheets: sheets.map((s) => s.number),
    ...checked,
    findings,
    assessment: findings.length ? "fail" : "pass",
    sheetKinds,
    inventoryEquality: inventoryEquality.rows,
  };
}
async function measureCase(id, page) {
  if (!report.value.sourceHashes.sheets.some((s) => s.case === id)) {
    const log = JSON.parse(await read(id, "cli.log"));
    assert(
      log.error?.code === "R006" ||
        log.diagnostics?.some((d) => d.code === "R006"),
      "No issued sheets without an R006 refusal",
    );
    return [
      {
        case: id,
        dq: "DQ-23",
        owner: "#336",
        strict: false,
        repinNow: false,
        assessment: "not-measured",
        reason: "R006 refusal: no issued sheets; not measured",
      },
    ];
  }
  const packet = JSON.parse(await read(id, "packet.json")),
    ir = JSON.parse(await read(id, "ir.json")),
    request = JSON.parse(await read(id, "request.json")),
    result = [];
  for (const [index, v] of (request.views ?? []).entries()) {
    if (v.format !== "documentation-view-request/0.1" || v.kind !== "terminals")
      continue;
    result.push(await measureView(id, page, packet, ir, v, index));
  }
  return result.length
    ? result
    : [
        {
          case: id,
          dq: "DQ-23",
          owner: "#336",
          strict: false,
          repinNow: false,
          assessment: "not-applicable",
          reason: "No requested terminal plan",
        },
      ];
}
let browser, context;
try {
  browser = await launch();
  assert.equal(
    browser.version(),
    report.value.browser,
    "Use capture Chromium build",
  );
  context = await browser.newContext(drawingContextOptions);
  const page = await context.newPage();
  for (const id of report.value.cases) {
    rows.push(...(await measureCase(id, page)));
    console.log(id);
  }
} finally {
  await context?.close();
  await browser?.close();
}
const counts = {};
for (const row of rows)
  counts[row.assessment] = (counts[row.assessment] ?? 0) + 1;
const receipt = {
  format: "terminal-strip-exposure/1",
  evalsVersion: EVALS_VERSION,
  captureEvalsVersion: report.value.evalsVersion,
  dq: "DQ-23",
  owner: "#336",
  strict: false,
  repinNow: false,
  engine: report.value.engine,
  reportSha256: report.sha256,
  browser: report.value.browser,
  arguments: drawingLaunchArgs,
  checkerSha256: checkerManifestHash(
    await readCheckers(dirname(fileURLToPath(import.meta.url))),
  ),
  scope:
    "Native IR/order/incidences versus visible SVG shape paths and browser text. SVG only; HTML/PDF reviewed separately. No DIN/hardware fact is inferred.",
  counts,
  rows,
  sources,
};
const bytes = Buffer.from(json(receipt));
assert(bytes.length < 5000000, "Exposure exceeds 5 MB; do not omit rows");
await writeFile(resolve(values.out), bytes, { flag: "wx" });
console.log(json(counts));
