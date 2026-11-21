import assert from "node:assert/strict";
import { prepareOraclePdf, prepareOracleHtml } from "./tranche3-pdf.mjs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { command, json, canonical } from "./support.mjs";
import { sheetCropName } from "./sheet-crop-name.mjs";
import { displaySheet, cropBox, screenshotCrop } from "./browser.mjs";
import {
  renderPdf,
  pdfTextMeasurements,
  imageCanvas,
  ink,
  portableLabelRisks,
} from "./pdf.mjs";
import {
  evaluateSheet,
  textGeometryIssues,
  symbolsFromGeometry,
  observation,
} from "./evaluate.mjs";
import { pdfPageMetadata } from "./pdf-source-policy.mjs";
import { attachSheetIdentities } from "./sheet-identities.mjs";
import { svgLocators } from "./locators.mjs";
import { requireReportCells } from "./checks.mjs";
import { mediaIdentifiers } from "./identifier-observations.mjs";

export async function captureSheets(packet, env, local, sheetEvidence) {
  const { values, native, relativeEvidence, htmlPath, pdfPath } = env;
  for (const s of packet.sheets) {
    const evidence = await readSheetEvidence(s, env);
    const { measured, htmlRow } = await measureSheetEvidence(s, env, evidence);
    await captureSheetCrops(s, env, evidence, measured, htmlRow);
    const { svgPath, pngPath, pdfPngPath, nativePath, pdfPage } = evidence;
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
}

async function readSheetEvidence(
  s,
  {
    directory,
    page,
    geometries,
    htmlGeometry,
    htmlSvgs,
    ir,
    tables,
    values,
    pdf,
    pdfSource,
    native,
    c,
  },
) {
  const prefix = `sheet-${String(s.number).padStart(3, "0")}`,
    svgPath = join(directory, `${prefix}.svg`);
  await writeFile(svgPath, s.svg);
  await displaySheet(page, s.svg);
  const g = geometries[s.number - 1];
  requireReportCells(g);
  requireReportCells(htmlGeometry[s.number - 1]);
  const locatorIndexes = {
    svg: svgLocators(s.svg, ir, s.view, tables),
    html: svgLocators(htmlSvgs[s.number - 1], ir, s.view, tables),
  };
  // Pin the call-site wiring independently of the chosen index argument.
  assert.deepEqual(
    locatorIndexes.html,
    svgLocators(htmlSvgs[s.number - 1], ir, s.view, tables),
    "HTML locator index must use the measured HTML SVG, not delivered SVG",
  );
  assert.equal(
    htmlGeometry[s.number - 1].texts.filter((t) => t.painted !== false).length,
    g.texts.filter((t) => t.painted !== false).length,
    "HTML/SVG visible label inventory differs",
  );
  const htmlIssues = textGeometryIssues(htmlGeometry[s.number - 1]);
  prepareOracleHtml(g, htmlGeometry[s.number - 1]);
  const pngPath = join(directory, `${prefix}.png`);
  if (values.artifacts)
    await page.locator("body>svg").screenshot({ path: pngPath, scale: "css" });
  const mask = await page.evaluateHandle(() => {
    const style = document.createElement("style");
    style.textContent =
      "svg :is(path,line,polyline,polygon,rect,circle,ellipse):not(defs *){visibility:hidden!important}";
    document.head.append(style);
    return style;
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
  pdfSource.pages.push(pdfPageMetadata(pdfPage));
  const { text, metrics } = await pdfTextMeasurements(
    pdfPage,
    pdf.fontFamilies,
    pdf.fontCaps,
  );
  await prepareOraclePdf(g, ir, s, pdfPage, text);
  if (values.artifacts)
    await writeFile(join(directory, `${prefix}-pdf-text.json`), json(text));
  const nativePath = join(
      directory,
      `pdfkit-${String(s.number).padStart(3, "0")}.png`,
    ),
    nativeCanvas = native
      ? await imageCanvas(await readFile(nativePath))
      : null;
  const parity = labelParityMeasurements(
    g,
    labelCanvas,
    pdfCanvas,
    nativeCanvas,
  );
  const maskRisks = await portableLabelRisks(pdfPage);
  return {
    prefix,
    svgPath,
    g,
    locatorIndexes,
    htmlIssues,
    pngPath,
    pdfPage,
    pdfPngPath,
    text,
    metrics,
    nativePath,
    parity,
    maskRisks,
  };
}

async function measureSheetEvidence(
  s,
  {
    c,
    packet,
    ir,
    tables,
    geometries,
    request,
    identifierPolicy,
    htmlGeometry,
  },
  { g, text, metrics, parity, maskRisks, pdfPage, htmlIssues, locatorIndexes },
) {
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
    request,
    identifierPolicy,
    metrics,
  );
  appendPortableLabelRisks(measured, g, maskRisks);
  const htmlRow = observation(c, s, "DQ-02", htmlIssues, {
    id: `${c.id}/DQ-02/html-${s.number}`,
    medium: "html",
    scope:
      "Real CLI HTML document in Chromium, independently measured from standalone SVG.",
  });
  measured.push(htmlRow);
  measured.push(
    ...(await mediaIdentifiers(
      c,
      s,
      packet,
      g,
      htmlGeometry[s.number - 1],
      ir,
      tables,
      pdfPage,
      identifierPolicy,
      observation,
    )),
  );
  attachSheetIdentities(measured, locatorIndexes, s.view, ir, c.project);
  return { measured, htmlRow };
}

async function captureSheetCrops(
  s,
  { directory, page, root, native, relativeEvidence, htmlPath, pdfPath },
  { prefix, g, pdfPage },
  measured,
  htmlRow,
) {
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
    const box = canonical(cropBox(finding.bbox, g.width, g.height)),
      crop = join(directory, sheetCropName(prefix, row, measured, htmlRow));
    if (row.dq === "DQ-01" && row.evidence.findings[0].backend === "PDFKit") {
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
          join(cropDir, `pdfkit-${String(s.number).padStart(3, "0")}.png`),
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
      await page.evaluate(() => document.fonts.ready);
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
}

function labelParityMeasurements(g, labelCanvas, pdfCanvas, nativeCanvas) {
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
  return parity;
}

function appendPortableLabelRisks(measured, g, maskRisks) {
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
}
