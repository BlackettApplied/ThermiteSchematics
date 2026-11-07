import { EVALS_VERSION } from "./version.mjs";
import { readCheckers, checkerManifestHash } from "./checker-manifest.mjs";
import { checkSvgFontBudget } from "./font-budget.mjs";
import { classifyTextGeometry } from "./text-classification.mjs";
import { retainLostText } from "./lost-text.mjs";
import { outputCost } from "./output.mjs";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
  mkdtemp,
} from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  command,
  pool,
  json,
  hash,
  readJson,
  canonical,
  stopCommands,
} from "./support.mjs";
import { cases, prepare, verifyCorpus, contentSeal } from "./corpus.mjs";
import { assess, exitCode, summary } from "./assessment.mjs";
import { expectations } from "./expectations.mjs";
import {
  launch,
  openSheet,
  cropBox,
  screenshotCrop,
  measureSheet,
} from "./browser.mjs";
import {
  loadPdf,
  renderPdf,
  pdfText,
  imageCanvas,
  ink,
  nativeTool,
  portableLabelRisks,
} from "./pdf.mjs";
import {
  evaluateSheet,
  textGeometryIssues,
  evaluatePacket,
  symbolsFromGeometry,
  sweepResults,
  observation,
} from "./evaluate.mjs";
import { attachSheetIdentities } from "./sheet-identities.mjs";
import { svgLocators, attachIdentities, viewKey } from "./locators.mjs";
import { criteria } from "./criteria.mjs";
import { requireReportCells } from "./checks.mjs";
import { gallery } from "./gallery.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  kit = join(root, "evals/draw");
const { values } = parseArgs({
  options: {
    checkpoint: { type: "string" },
    quick: { type: "boolean", default: false },
    "report-only": { type: "boolean", default: false },
    rev: { type: "string" },
    engine: { type: "string" },
    artifacts: { type: "boolean", default: false },
    pdfkit: { type: "boolean", default: false },
    compare: { type: "string" },
    case: { type: "string" },
  },
});
assert(
  values.checkpoint &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(values.checkpoint),
  "Use --checkpoint <portable-name>",
);
assert(!(values.rev && values.engine), "Use either --rev or --engine");
assert(
  !values.rev || values["report-only"],
  "Historical --rev requires --report-only",
);
const dest = join(root, "evals/out/draw", values.checkpoint);
await mkdir(dest, { recursive: true });
assert.equal(
  (await readdir(dest)).length,
  0,
  "Checkpoint already contains evidence; choose a fresh name",
);
const started = performance.now();
let browser,
  replay,
  engine = await realpath(resolve(values.engine ?? root));
const git = async (cwd, ...args) => {
  const r = await command(cwd, "git", args);
  if (r.code !== 0) throw Error(r.stderr);
  return r.stdout.trim();
};
const relativeEvidence = (p) => relative(dest, p).split("\\").join("/");
const rows = [],
  results = [];
let interrupted = false;
const onSignal = () => {
  interrupted = true;
  stopCommands();
  void browser?.close();
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
let metadata,
  assessment = { drift: [] };
try {
  const corpus = await verifyCorpus(root, kit),
    corpusHash = corpus.seal;
  const reseal = await command(root, process.execPath, [
    join(kit, "seal.mjs"),
    "--output",
    join(dest, "corpus-seal.json"),
  ]);
  if (reseal.code !== 0) throw Error(reseal.stderr);
  if (corpus.changedFiles.length || corpus.inventoryChanged)
    process.stdout.write(
      `Corpus drift recorded: ${corpus.changedFiles.length} tracked inputs; checkpoint seal ${corpusHash}\n`,
    );
  if (
    !values["report-only"] &&
    `${process.platform}-${process.arch}` !== "darwin-arm64"
  )
    throw Error(
      "Strict drawing markers are calibrated on darwin-arm64. Use --report-only for portable measurement; browser-free check tests support Linux/Windows/macOS.",
    );
  if (values.rev) {
    const commit = await git(
      root,
      "rev-parse",
      "--verify",
      `${values.rev}^{commit}`,
    );
    replay = await mkdtemp(join(tmpdir(), "thermite-draw-replay-"));
    const add = await command(root, "git", [
      "worktree",
      "add",
      "--detach",
      replay,
      commit,
    ]);
    if (add.code !== 0) throw Error(add.stderr);
    engine = replay;
    for (const args of [
      ["install", "--frozen-lockfile"],
      ["run", "build"],
    ]) {
      process.stdout.write(`Historical engine: bun ${args.join(" ")}\n`);
      const r = await command(engine, process.execPath, args, 180000);
      await writeFile(join(dest, `replay-${args[0]}.log`), r.stdout + r.stderr);
      if (r.code !== 0)
        throw Error(`Historical ${args[0]} failed; see replay log`);
    }
  }
  await access(join(engine, "packages/cli/dist/alpha.js"));
  browser = await launch();
  const native = values.pdfkit ? await nativeTool(root) : null;
  const query = await import(
    pathToFileURL(join(engine, "packages/query/dist/index.js")).href
  );
  // JSON intentionally carries family references only. Measure standalone SVGs
  // after the built CLI's deterministic font delivery step, just like file export.
  let deliverSvg = (svg) => svg;
  try {
    const delivery = join(engine, "packages/cli/dist/printable-font.js");
    await access(delivery);
    deliverSvg = (await import(pathToFileURL(delivery).href))
      .embedPrintableFont;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const specs = cases(values.quick).filter(
    (c) => !values.case || c.id === values.case,
  );
  assert(specs.length, "Requested case is not in this corpus/subset");
  let comparison;
  if (values.compare) {
    const priorPath = resolve(values.compare),
      prior = await readJson(priorPath);
    const priorHash =
      prior.corpus?.contentHashVersion === 1
        ? prior.corpusSha256
        : contentSeal(
            await readJson(join(dirname(priorPath), "corpus-seal.json")),
          );
    comparison = {
      sameCorpus: priorHash === corpusHash,
      warning:
        priorHash === corpusHash
          ? null
          : "Different corpus seals: results are not a paired comparison",
    };
  }
  metadata = {
    format: "thermite-draw-eval/1.0",
    evalsVersion: EVALS_VERSION,
    evals: {
      commit: await git(root, "rev-parse", "HEAD"),
      dirty:
        (await git(root, "status", "--porcelain", "--", "evals/draw")).length >
        0,
    },
    mode: values["report-only"] ? "replay" : "strict",
    subset: values.case ? "selected" : values.quick ? "quick" : "full",
    corpusSha256: corpusHash,
    corpus: {
      contentHashVersion: 1,
      base: corpus.actual.base,
      referenceSha256: corpus.reference,
      changedFiles: corpus.changedFiles,
      inventoryChanged: corpus.inventoryChanged,
    },
    ...(comparison ? { comparison } : {}),
    artifacts: values.artifacts,
    engine: {
      commit: await git(engine, "rev-parse", "HEAD"),
      dirty:
        (
          await git(
            engine,
            "status",
            "--porcelain",
            "--",
            "packages",
            "libraries",
            "scripts",
            "thermite.mjs",
            "package.json",
            "bun.lock",
          )
        ).length > 0,
    },
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform}-${process.arch}`,
    browser: browser.version(),
    raster: { fullDpi: 96, cropDpi: 300, pdfjs: true, pdfkit: !!native },
    cases: specs.map((c) => c.id),
    criteria,
    sweepCells: values.quick || values.case ? 0 : 36,
    deferred: ["D packets: E2 outputs pending; not scored"],
    checkers: await readCheckers(kit),
  };
  metadata.checkerSha256 = checkerManifestHash(metadata.checkers);
  const cli = (args) =>
    command(engine, process.execPath, [join(engine, "thermite.mjs"), ...args]);
  const rendered = await pool(specs, async (c, index) => {
    if (interrupted) throw Error("Interrupted");
    process.stdout.write(`[${index + 1}/${specs.length}] ${c.id}\n`);
    const directory = join(dest, c.id);
    await mkdir(directory, { recursive: true });
    const local = [];
    let context;
    try {
      const { project, input, request } = await prepare(
          c,
          root,
          directory,
          cli,
        ),
        packetPath = join(directory, "packet.json");
      const args = ["packet", "--project", project, "--input", input];
      const generated = await cli([...args, "-o", packetPath]);
      await writeFile(
        join(directory, "cli.log"),
        generated.stdout + generated.stderr,
      );
      if (generated.code !== 0) {
        let error;
        try {
          error = JSON.parse(generated.stderr).error;
        } catch {
          throw Error(
            `CLI did not return a structured render error: ${generated.stderr}`,
          );
        }
        if (!error || !["R004", "R006"].includes(error.code))
          throw Error(`Unexpected CLI failure: ${generated.stderr}`);
        const issue = {
          kind: "render-refusal",
          element: "request",
          designation: c.id,
          sheetLevel: true,
          error,
        };
        local.push(
          observation(c, { number: 0 }, "DQ-11", [], {
            status: "not-implemented",
            reason:
              "No drawing exists for visual confirmation of this refused configuration; executed remedies are assessed by the paired sweep.",
            diagnostic: issue,
          }),
        );
        for (let i = 1; i <= 24; i++)
          if (i !== 11)
            local.push(
              observation(
                c,
                { number: 0 },
                `DQ-${String(i).padStart(2, "0")}`,
                [],
                {
                  status: "not-implemented",
                  reason: `No sheet produced: ${error.code}; diagnostic preserved under DQ-11.`,
                },
              ),
            );
        attachIdentities(local, new Map(), {}, {}, c.project);
        return {
          case: c.id,
          spec: c,
          ok: false,
          error,
          rows: local,
          sheets: [],
        };
      }
      const packet = await readJson(packetPath);
      for (const sheet of packet.sheets) {
        sheet.svg = deliverSvg(sheet.svg);
        checkSvgFontBudget(sheet.svg, `${c.id}/sheet-${sheet.number}`);
      }
      const compiled = await cli([
        "compile",
        project,
        "--diagnostics-json",
        "-o",
        join(directory, "ir.json"),
      ]);
      if (compiled.code !== 0)
        throw Error(`Compile failed: ${compiled.stderr}`);
      const ir = await readJson(join(directory, "ir.json"));
      const tables = request.views
        .filter((v) => v.format === "documentation-view-request/0.1")
        .map((v) => query.buildDocumentation(ir, v));
      await writeFile(join(directory, "query-reports.json"), json(tables));
      // Produce each public artifact through the built CLI, not a renderer import.
      const pdfPath = join(directory, "packet.pdf"),
        htmlPath = join(directory, "packet.html");
      for (const p of [htmlPath, pdfPath]) {
        const r = await cli([...args, "-o", p]);
        await writeFile(
          join(directory, p.endsWith(".pdf") ? "pdf.log" : "html.log"),
          r.stdout + r.stderr,
        );
        if (r.code !== 0) throw Error(`Artifact export failed: ${r.stderr}`);
      }
      if (native) {
        const r = await command(root, native, [pdfPath, directory, "96"]);
        if (r.code !== 0)
          throw Error(`PDFKit rasterization failed: ${r.stderr}`);
      }
      const pdf = await loadPdf(pdfPath);
      assert.equal(
        pdf.numPages,
        packet.sheets.length,
        "PDF page count differs from SVG",
      );
      context = await browser.newContext({
        deviceScaleFactor: 300 / 96,
        viewport: { width: 1800, height: 1800 },
      });
      const page = await context.newPage();
      await page.emulateMedia({ media: "print" });
      const geometries = [],
        sheetEvidence = [];
      await page.setContent(await readFile(htmlPath, "utf8"));
      await page.evaluate(() => document.fonts.ready);
      const htmlGeometry = await page.evaluate((source) => {
        const measure = (0, eval)(`(${source})`);
        return Array.from(document.querySelectorAll("section>svg")).map(
          (_, i) =>
            measure({ selector: `#sheet-${i + 1}>svg`, textOnly: true }),
        );
      }, measureSheet.toString());
      const htmlSvgs = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll("section>svg"),
          (svg) => svg.outerHTML,
        ),
      );
      for (const g of htmlGeometry) classifyTextGeometry(g, ir);
      retainLostText(
        htmlGeometry,
        packet.sheets.map((s) => viewKey(s.view)),
      );
      // Collect all tiled copies before deciding whether a semantic label was lost.
      for (const sheet of packet.sheets)
        geometries.push(await openSheet(page, sheet.svg));
      retainLostText(
        geometries,
        packet.sheets.map((s) => viewKey(s.view)),
      );
      for (const s of packet.sheets) {
        const prefix = `sheet-${String(s.number).padStart(3, "0")}`,
          svgPath = join(directory, `${prefix}.svg`);
        await writeFile(svgPath, s.svg);
        await openSheet(page, s.svg);
        const g = geometries[s.number - 1];
        requireReportCells(g);
        requireReportCells(htmlGeometry[s.number - 1]);
        const locatorIndexes = {
          svg: svgLocators(s.svg, ir, s.view, tables),
          html: svgLocators(htmlSvgs[s.number - 1], ir, s.view, tables),
        };
        assert.equal(
          htmlGeometry[s.number - 1].texts.filter((t) => t.painted !== false)
            .length,
          g.texts.filter((t) => t.painted !== false).length,
          "HTML/SVG visible label inventory differs",
        );
        const htmlIssues = textGeometryIssues(htmlGeometry[s.number - 1]);
        g.htmlTexts = htmlGeometry[s.number - 1].texts;
        const pngPath = join(directory, `${prefix}.png`);
        if (values.artifacts)
          await page
            .locator("body>svg")
            .screenshot({ path: pngPath, scale: "css" });
        const mask = await page.addStyleTag({
          content:
            "svg :is(path,line,polyline,polygon,rect,circle,ellipse):not(defs *){visibility:hidden!important}",
        });
        const labelCanvas = await imageCanvas(
          await page.locator("body>svg").screenshot({ scale: "css" }),
        );
        await mask.evaluate((e) => e.remove());
        const pdfPage = await pdf.getPage(s.number),
          pdfCanvas = await renderPdf(pdfPage),
          pdfPngPath = join(directory, `${prefix}-pdfjs.png`);
        if (values.artifacts)
          await writeFile(pdfPngPath, pdfCanvas.toBuffer("image/png"));
        const text = await pdfText(pdfPage, pdf.fontFamilies, pdf.fontCaps);
        g.pdfTexts = text;
        if (values.artifacts)
          await writeFile(
            join(directory, `${prefix}-pdf-text.json`),
            json(text),
          );
        const nativePath = join(
            directory,
            `pdfkit-${String(s.number).padStart(3, "0")}.png`,
          ),
          nativeCanvas = native
            ? await imageCanvas(await readFile(nativePath))
            : null;
        const parity = [];
        for (const t of g.texts.filter((t) => t.painted !== false)) {
          // Tighten vertically to avoid counting nearby rules as label ink.
          const box = {
            ...t.bbox,
            y: t.bbox.y + 0.15,
            h: Math.max(0.1, t.bbox.h - 0.3),
          };
          for (const [backend, canvas] of [
            ["pdf.js", pdfCanvas],
            ...(nativeCanvas ? [["PDFKit", nativeCanvas]] : []),
          ])
            parity.push({
              ...t,
              backend,
              svgInk: ink(labelCanvas, box),
              pdfInk: ink(canvas, {
                x: box.x - 0.3,
                y: box.y - 0.3,
                w: box.w + 0.6,
                h: box.h + 0.6,
              }),
            });
        }
        const maskRisks = await portableLabelRisks(pdfPage);
        const measured = evaluateSheet(
          c,
          s,
          packet,
          g,
          ir,
          text,
          parity,
          symbolsFromGeometry(g, ir),
          tables,
          geometries,
        );
        const parityRow = measured.find((r) => r.dq === "DQ-01");
        for (const t of g.texts.filter((t) => t.painted !== false)) {
          const risk = maskRisks.find(
            (r) =>
              r.bbox.x < t.bbox.x + t.bbox.w &&
              r.bbox.x + r.bbox.w > t.bbox.x &&
              r.bbox.y < t.bbox.y + t.bbox.h &&
              r.bbox.y + r.bbox.h > t.bbox.y,
          );
          if (risk)
            parityRow.evidence.findings.push({
              kind: "soft-mask-label-loss-risk",
              element: t.element,
              designation: t.text,
              text: t.text,
              bbox: t.bbox,
              backend: "pdf.js operator audit",
              ...risk,
              bbox: t.bbox,
            });
        }
        parityRow.evidence.findingCount = parityRow.evidence.findings.length;
        parityRow.status = parityRow.evidence.findings.length ? "fail" : "pass";
        const htmlRow = observation(c, s, "DQ-02", htmlIssues, {
          id: `${c.id}/DQ-02/html-${s.number}`,
          medium: "html",
          scope:
            "Real CLI HTML document in Chromium, independently measured from standalone SVG.",
        });
        measured.push(htmlRow);
        attachSheetIdentities(measured, locatorIndexes, s.view, ir, c.project);
        // One representative 300 dpi crop per failed check/sheet. Every exact
        // finding remains in JSON; this bounds raster work without hiding counts.
        for (const row of measured.filter((r) => r.status === "fail")) {
          const finding = row.evidence.findings.find(
            (f) =>
              f.bbox &&
              f.bbox.x < g.width &&
              f.bbox.y < g.height &&
              f.bbox.x + f.bbox.w > 0 &&
              f.bbox.y + f.bbox.h > 0,
          );
          if (!finding) {
            row.evidence.noCropReason =
              "Sheet-level or entirely clipped/off-sheet finding; inspect SVG and geometry evidence";
            continue;
          }
          const box = cropBox(finding.bbox, g.width, g.height),
            crop = join(
              directory,
              `${prefix}-${row.dq}${row === htmlRow ? "-html" : row.medium === "pdf" ? "-pdf" : ""}.png`,
            );
          if (
            row.dq === "DQ-01" &&
            row.evidence.findings[0].backend === "PDFKit"
          ) {
            const cropDir = join(directory, `${prefix}-pdfkit-crop`);
            await mkdir(cropDir, { recursive: true });
            const r = await command(root, native, [
              pdfPath,
              cropDir,
              "300",
              String(s.number),
              ...[box.x, box.y, box.w, box.h].map(String),
            ]);
            if (r.code !== 0) throw Error("PDFKit crop failed");
            await writeFile(
              crop,
              await readFile(
                join(
                  cropDir,
                  `pdfkit-${String(s.number).padStart(3, "0")}.png`,
                ),
              ),
            );
          } else if (
            row.dq === "DQ-01" ||
            row.evidence.findings[0]?.medium === "pdf"
          ) {
            const canvas = await renderPdf(pdfPage, 300, box);
            await writeFile(crop, canvas.toBuffer("image/png"));
          } else if (row === htmlRow) {
            await page.setContent(await readFile(htmlPath, "utf8"));
            await screenshotCrop(page, box, crop, `#sheet-${s.number}>svg`);
          } else await screenshotCrop(page, box, crop);
          row.evidence.crop = relativeEvidence(crop);
          row.evidence.cropBbox = box;
          row.evidence.cropDpi = 300;
          if (row.dq === "DQ-01") {
            const reference = join(directory, `${prefix}-DQ-01-svg.png`);
            await screenshotCrop(page, box, reference);
            row.evidence.referenceCrop = relativeEvidence(reference);
          }
        }
        local.push(...measured);
        sheetEvidence.push({
          number: s.number,
          svg: relativeEvidence(svgPath),
          png: values.artifacts
            ? relativeEvidence(pngPath)
            : relativeEvidence(svgPath),
          pdf: relativeEvidence(pdfPath),
          html: relativeEvidence(htmlPath),
          ...(values.artifacts ? { pdfPng: relativeEvidence(pdfPngPath) } : {}),
          ...(native && values.artifacts
            ? { nativePng: relativeEvidence(nativePath) }
            : {}),
        });
        if (native && !values.artifacts) await rm(nativePath, { force: true });
        pdfPage.cleanup();
      }
      const packetRows = evaluatePacket(c, packet, geometries, tables);
      for (const row of packetRows) {
        const sheet = packet.sheets.find((s) => s.number === row.sheet);
        attachSheetIdentities(
          [row],
          {
            svg: svgLocators(sheet.svg, ir, sheet.view, tables),
            html: svgLocators(
              htmlSvgs[sheet.number - 1],
              ir,
              sheet.view,
              tables,
            ),
          },
          sheet.view,
          ir,
          c.project,
        );
      }
      // Packet-level diagnostics point to their first sheet at 300 dpi too.
      for (const row of packetRows.filter(
        (r) => r.status === "fail" && r.evidence.findings[0]?.bbox,
      )) {
        const s = packet.sheets.find((s) => s.number === row.sheet);
        await openSheet(page, s.svg);
        const box = cropBox(
            row.evidence.findings[0].bbox,
            packet.page.widthMm,
            packet.page.heightMm,
          ),
          crop = join(
            directory,
            `${row.dq}-packet-${hash(row.id).slice(0, 10)}.png`,
          );
        if (row.evidence.findings[0].medium === "pdf") {
          const canvas = await renderPdf(
            await pdf.getPage(row.sheet),
            300,
            box,
          );
          await writeFile(crop, canvas.toBuffer("image/png"));
        } else if (row.evidence.findings[0].medium === "html") {
          await page.setContent(await readFile(htmlPath, "utf8"));
          await screenshotCrop(page, box, crop, `#sheet-${row.sheet}>svg`);
        } else await screenshotCrop(page, box, crop);
        row.evidence.crop = relativeEvidence(crop);
        row.evidence.cropBbox = box;
        row.evidence.cropDpi = 300;
      }
      local.push(...packetRows);
      await pdf.loadingTask.destroy();
      // SVGs/CLI HTML retain drawing bytes; avoid a third copy inside packet JSON.
      await writeFile(
        packetPath,
        JSON.stringify(
          canonical({
            ...packet,
            html: undefined,
            sheets: packet.sheets.map(({ svg, ...sheet }) => sheet),
          }),
        ) + "\n",
      );
      for (const filename of ["ir.json", "query-reports.json"]) {
        const path = join(directory, filename);
        await writeFile(
          path,
          JSON.stringify(canonical(await readJson(path))) + "\n",
        );
      }
      if (!values.artifacts) {
        await writeFile(
          htmlPath + ".gz",
          gzipSync(await readFile(htmlPath), { level: 9 }),
        );
        await rm(htmlPath);
        for (const sheet of sheetEvidence)
          sheet.html = relativeEvidence(htmlPath + ".gz");
      }
      return {
        case: c.id,
        spec: c,
        ok: true,
        rows: local,
        sheets: sheetEvidence,
      };
    } catch (error) {
      return {
        case: c.id,
        spec: c,
        ok: false,
        sheets: [],
        rows: [
          ...local,
          {
            id: `${c.id}/infrastructure`,
            case: c.id,
            status: "infrastructure-error",
            reason: error.message
              .replaceAll(root, "<evals>")
              .replaceAll(engine, "<engine>"),
          },
        ],
      };
    } finally {
      await context?.close();
    }
  });
  results.push(...rendered);
  rows.push(
    ...rendered.flatMap((r) => r.rows),
    ...sweepResults(specs, rendered),
  );
  // Sweep observations are appended above; give their request-level failures identities.
  for (const row of rows.filter((r) => r.id.endsWith("/flow-comparison")))
    attachIdentities(
      [row],
      new Map(),
      {},
      {},
      specs.find((c) => c.id === row.case).project,
    );
  assessment = assess(rows, expectations, new Set(specs.map((c) => c.id)), {
    allCases: new Set(cases().map((c) => c.id)),
    caseStates: Object.fromEntries(
      rendered.map((r) => [
        r.case,
        {
          status: r.ok ? "rendered" : r.error ? "refused" : "infrastructure",
          sheets: r.sheets.map((s) => s.number),
        },
      ]),
    ),
  });
} catch (error) {
  rows.push({
    id: "harness/infrastructure",
    status: "infrastructure-error",
    reason: error.message.replaceAll(root, "<evals>"),
  });
} finally {
  await browser?.close().catch(() => {});
  if (replay) {
    const r = await command(root, "git", [
      "worktree",
      "remove",
      "--force",
      replay,
    ]);
    if (r.code !== 0)
      rows.push({
        id: "cleanup/infrastructure",
        status: "infrastructure-error",
        reason: r.stderr,
      });
    await rm(replay, { recursive: true, force: true });
  }
}
process.removeListener("SIGINT", onSignal);
process.removeListener("SIGTERM", onSignal);
if (interrupted)
  rows.push({
    id: "harness/interrupted",
    status: "infrastructure-error",
    reason: "Interrupted; temporary worktree cleaned",
  });
for (const [dq] of Object.entries(criteria))
  if (!rows.some((r) => r.dq === dq))
    rows.push({
      id: `harness/${dq}/unmeasured`,
      dq,
      status: "not-implemented",
      reason:
        "Infrastructure prevented measurement; see the infrastructure-error observation.",
    });
for (const row of rows.filter((r) => r.status === "infrastructure-error"))
  process.stderr.write(`${row.id}: ${row.reason}\n`);
let code = exitCode(rows, values["report-only"]);
const counts = summary(rows);
const policyCounts = Object.fromEntries(
  ["pass", "xfail", "fail", "xpass", "manual", "not-implemented"].map(
    (status) => [
      status,
      rows.filter(
        (r) => r.classification === "policy-gap" && r.status === status,
      ).length,
    ],
  ),
);
await writeFile(
  join(dest, "summary.json"),
  JSON.stringify(
    canonical({
      ...metadata,
      exitCode: code,
      summary: counts,
      policySummary: policyCounts,
      ...assessment,
      results: rows,
    }),
  ) + "\n",
);
await gallery(dest, results, rows);
await writeFile(
  join(dest, "summary.md"),
  [
    `# Drawing checkpoint ${values.checkpoint}`,
    "",
    `Mode: ${values["report-only"] ? "report-only" : "strict"}; exit ${code}. Full findings and rounded measurements: [JSON](summary.json). [Gallery](gallery.html). [Reviewer form](reviewer-form.json).`,
    "",
    "| DQ | Pass | Fail | Xfail | Xpass | Manual | Not implemented |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(counts).map(
      ([dq, c]) =>
        `| ${dq} | ${c.pass} | ${c.fail} | ${c.xfail} | ${c.xpass} | ${c.manual} | ${c["not-implemented"]} |`,
    ),
    "",
    "## Drift within marker bands",
    "",
    ...assessment.drift.map(
      (d) =>
        `- ${d.marker}: ${JSON.stringify(d.changes)}${d.partialScope ? " (partial selected scope)" : ""}${d.withinBand ? "" : " (band violation; fails above)"}`,
    ),
    "",
    "## ISO cap-height policy gaps (separate from geometry)",
    "",
    JSON.stringify(policyCounts),
    "",
    "## Observations",
    "",
    ...rows
      .filter((r) => !["pass", "manual", "not-implemented"].includes(r.status))
      .map(
        (r) =>
          `- ${r.id}: **${r.status}** ${r.reason ?? r.evidence?.findings?.[0]?.kind ?? ""}${r.evidence?.crop ? ` ([300 dpi crop](${r.evidence.crop}))` : ""}`,
      ),
    "",
  ].join("\n"),
);
const elapsedSeconds = (performance.now() - started) / 1000;
// Timing is deliberately outside deterministic report JSON.
await writeFile(
  join(dest, "timing.json"),
  json({
    elapsedSeconds,
    subset: values.case ? "selected" : values.quick ? "quick" : "full",
    cases: results.length,
    sheets: results.reduce((n, r) => n + r.sheets.length, 0),
  }),
);
let cost = await outputCost(dest, values.artifacts);
if (!cost.withinBudget) {
  code = 2;
  rows.push({
    id: "harness/output-budget",
    status: "infrastructure-error",
    reason: `Default output ${cost.outputBytes} exceeds 100 MB budget`,
  });
  await writeFile(
    join(dest, "summary.json"),
    JSON.stringify(
      canonical({
        ...metadata,
        exitCode: code,
        summary: summary(rows),
        policySummary: Object.fromEntries(
          ["pass", "xfail", "fail", "xpass", "manual", "not-implemented"].map(
            (status) => [
              status,
              rows.filter(
                (r) => r.classification === "policy-gap" && r.status === status,
              ).length,
            ],
          ),
        ),
        ...assessment,
        results: rows,
      }),
    ) + "\n",
  );
  cost = await outputCost(dest, values.artifacts);
}
process.stdout.write(
  `${JSON.stringify(counts)}\nWall time ${elapsedSeconds.toFixed(2)} s; exit ${code}; ${relative(root, dest)}/summary.json\n`,
);
process.exitCode = code;
