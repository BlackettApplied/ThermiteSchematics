import { measurePacketGeometry } from "./packet-geometry.mjs";
import { caseInfrastructure } from "./case-infrastructure.mjs";
import { packetSemanticObservations } from "./navigation-strict.mjs";
import { captureSheets } from "./run-sheet.mjs";
import { inventoryMediaObservations } from "./inventory-scope-media.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command, json, hash, readJson, canonical } from "./support.mjs";
import { prepare } from "./corpus.mjs";
import { captureSources } from "./source-hashes.mjs";
import { checkSvgFontBudget } from "./font-budget.mjs";
import { retainPacket, compactCase, retainingCase } from "./retention.mjs";
import {
  displaySheet,
  cropBox,
  screenshotCrop,
  drawingContextOptions,
} from "./browser.mjs";
import { loadPdfBytes, PDFJS_VERSION, renderPdf } from "./pdf.mjs";
import { evaluatePacket, observation } from "./evaluate.mjs";
import { attachSheetIdentities } from "./sheet-identities.mjs";
import { svgLocators, attachIdentities } from "./locators.mjs";
import { buildSourceTables, scopeTables } from "./m3-documents.mjs";

export async function renderCase(c, index, env) {
  const { isInterrupted, specs, dest, values } = env;
  if (isInterrupted()) throw Error("Interrupted");
  process.stdout.write(`[${index + 1}/${specs.length}] ${c.id}\n`);
  const directory = join(dest, c.id);
  await mkdir(directory, { recursive: true });
  return retainingCase(
    directory,
    values.artifacts,
    () => captureCase(c, directory, env),
    { temporaryProject: c.recipe === "compact-frame" },
  );
}

async function captureCase(c, directory, env) {
  const { root, engine, cli, browser, values, relativeEvidence } = env;
  const local = [];
  let context;
  try {
    const { project, input, request } = await prepare(c, root, directory, cli),
      packetPath = join(directory, "packet.json");
    const args = ["packet", "--project", project, "--input", input];
    const generated = await cli([...args, "-o", packetPath]);
    await writeFile(
      join(directory, "cli.log"),
      generated.stdout + generated.stderr,
    );
    if (generated.code !== 0) return refusedCase(c, generated, local);
    let { packet, ir, tables, binding, presentation } = await nativeInputs(
      c,
      packetPath,
      directory,
      project,
      request,
      env,
    );
    const { pdfPath, htmlPath, pdf, pdfSource } = await publicArtifacts(
      args,
      directory,
      packet,
      env,
    );
    context = await browser.newContext(drawingContextOptions);
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    const geometries = [],
      sheetEvidence = [];
    const { htmlGeometry, htmlSvgs } = await measurePacketGeometry(
      page,
      htmlPath,
      packet,
      ir,
      geometries,
    );
    tables = scopeTables(packet, geometries, ir, tables, request);
    Object.assign(tables, { binding, request, presentation });
    await captureSheets(
      packet,
      {
        ...env,
        c,
        directory,
        packet,
        page,
        geometries,
        htmlGeometry,
        htmlSvgs,
        ir,
        tables,
        pdf,
        pdfSource,
        request,
        htmlPath,
        pdfPath,
      },
      local,
      sheetEvidence,
    );
    const packetRows = await capturePacketRows(
      c,
      packet,
      geometries,
      tables,
      htmlSvgs,
      ir,
      page,
      pdf,
      directory,
      htmlPath,
      relativeEvidence,
    );
    local.push(...packetRows);
    await pdf.loadingTask.destroy();
    await compactCase(directory, values.artifacts);
    if (!values.artifacts)
      for (const sheet of sheetEvidence)
        sheet.html = relativeEvidence(htmlPath + ".gz");
    return {
      case: c.id,
      spec: c,
      sourceHashes: await captureSources(
        directory,
        c.id,
        packet.sheets.map((s) => s.number),
        values.artifacts ? "packet.html" : "packet.html.gz",
        pdfSource,
      ),
      ok: true,
      rows: local,
      sheets: sheetEvidence,
    };
  } catch (error) {
    return caseInfrastructure(error, c, local, root, engine);
  } finally {
    await context?.close();
  }
}

function refusedCase(c, generated, local) {
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
        observation(c, { number: 0 }, `DQ-${String(i).padStart(2, "0")}`, [], {
          status: "not-implemented",
          reason: `No sheet produced: ${error.code}; diagnostic preserved under DQ-11.`,
        }),
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

async function nativeInputs(
  c,
  packetPath,
  directory,
  project,
  request,
  { cli, deliverSvg, compiler, query },
) {
  const packet = await readJson(packetPath);
  for (const sheet of packet.sheets) {
    sheet.svg = deliverSvg(sheet.svg);
    checkSvgFontBudget(sheet.svg, `${c.id}/sheet-${sheet.number}`);
  }
  await retainPacket(directory, packet);
  const compiled = await cli([
    "compile",
    project,
    "--diagnostics-json",
    "-o",
    join(directory, "ir.json"),
  ]);
  if (compiled.code !== 0) throw Error(`Compile failed: ${compiled.stderr}`);
  const ir = await readJson(join(directory, "ir.json"));
  const source = await compiler.compileProject(project);
  if (!source.ok) throw Error("Native source binding compilation failed");
  const binding = {
    snapshotDigest: hash(JSON.stringify(compiler.serializeIr(source.ir))),
    presentationDigest: hash(JSON.stringify(source.presentation ?? null)),
    revision: source.presentation?.revision ?? "UNSPECIFIED",
  };
  let tables = buildSourceTables(ir, request, query.buildDocumentation);
  await writeFile(join(directory, "query-reports.json"), json(tables));
  return { packet, ir, tables, binding, presentation: source.presentation };
}

async function publicArtifacts(args, directory, packet, { cli, native, root }) {
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
    if (r.code !== 0) throw Error(`PDFKit rasterization failed: ${r.stderr}`);
  }
  const pdfBytes = await readFile(pdfPath),
    pdf = await loadPdfBytes(pdfBytes),
    pdfSource = {
      bytes: pdfBytes,
      pdfjsVersion: PDFJS_VERSION,
      pages: [],
    };
  assert.equal(
    pdf.numPages,
    packet.sheets.length,
    "PDF page count differs from SVG",
  );
  return { pdfPath, htmlPath, pdf, pdfSource };
}

async function capturePacketRows(
  c,
  packet,
  geometries,
  tables,
  htmlSvgs,
  ir,
  page,
  pdf,
  directory,
  htmlPath,
  relativeEvidence,
) {
  const packetRows = [
    ...evaluatePacket(c, packet, geometries, tables),
    ...inventoryMediaObservations(c, packet, geometries, ir, observation),
    ...packetSemanticObservations(
      c,
      packet,
      geometries,
      ir,
      tables.request,
      observation,
    ),
  ];
  for (const row of packetRows) {
    const sheet = packet.sheets.find((s) => s.number === row.sheet);
    attachSheetIdentities(
      [row],
      {
        svg: svgLocators(sheet.svg, ir, sheet.view, tables),
        html: svgLocators(htmlSvgs[sheet.number - 1], ir, sheet.view, tables),
      },
      sheet.view,
      ir,
      c.project,
    );
  }
  // Packet-level diagnostics point to their first sheet at 300 dpi too.
  for (const row of packetRows.filter(packetCropRequired)) {
    const s = packet.sheets.find((s) => s.number === row.sheet);
    await displaySheet(page, s.svg);
    const box = canonical(
        cropBox(
          row.evidence.findings[0].bbox,
          packet.page.widthMm,
          packet.page.heightMm,
        ),
      ),
      crop = join(
        directory,
        `${row.dq}-packet-${hash(row.id).slice(0, 10)}.png`,
      );
    if (row.evidence.findings[0].medium === "pdf") {
      const canvas = await renderPdf(await pdf.getPage(row.sheet), 300, box);
      await writeFile(crop, canvas.toBuffer("image/png"));
    } else if (row.evidence.findings[0].medium === "html") {
      await page.setContent(await readFile(htmlPath, "utf8"));
      await page.evaluate(() => document.fonts.ready);
      await screenshotCrop(page, box, crop, `#sheet-${row.sheet}>svg`);
    } else await screenshotCrop(page, box, crop);
    row.evidence.crop = relativeEvidence(crop);
    row.evidence.cropBbox = box;
    row.evidence.cropDpi = 300;
  }
  return packetRows;
}

function packetCropRequired(row) {
  return (
    row.status === "fail" &&
    row.evidence.findings[0]?.bbox &&
    !row.id.includes("/check3c3-")
  );
}
