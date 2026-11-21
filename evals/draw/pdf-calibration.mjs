import { parseReportBytes } from "./report-file.mjs";
// Read-only calibration of retained PDFs. This never upgrades an old C1/apply target.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { isDeepStrictEqual as equal } from "node:util";
import { hash, json, canonical } from "./support.mjs";
import { within } from "./repin-io.mjs";
import { instanceInventory } from "./repin-core.mjs";
import { loadPdfBytes, pdfText, PDFJS_VERSION } from "./pdf.mjs";
import { pdfPageMetadata, checkPdfInstance } from "./pdf-source-policy.mjs";
import { pinnedSource, captureSources } from "./source-hashes.mjs";
export async function pdfCalibration(path) {
  path = resolve(path);
  const raw = await readFile(path),
    original = parseReportBytes(raw),
    report = structuredClone(original),
    root = dirname(path);
  assert(
    original.mode === "strict" && original.subset === "full",
    "PDF calibration requires a retained full strict report",
  );
  const initial = instanceInventory(original, hash(raw)).instances.filter(
    (t) => t.scope.medium === "pdf",
  );
  const targets = original.results
    .filter((r) => r.evidence?.crop)
    .flatMap((r) => {
      const t = initial.find((t) => t.row === r.id);
      return t ? [t] : [];
    });
  report.mode = "calibration";
  report.calibration = {
    kind: "boxed-pdf",
    originalSummarySha256: hash(raw),
    applyTarget: false,
  };
  const associated = new Map();
  for (const id of [...new Set(targets.map((t) => t.scope.case))]) {
    const bytes = await readFile(
        await within(join(root, id, "packet.pdf"), root, { existing: true }),
      ),
      doc = await loadPdfBytes(bytes);
    try {
      const pages = [];
      for (let n = 1; n <= doc.numPages; n++)
        pages.push(pdfPageMetadata(await doc.getPage(n)));
      const old = original.sourceHashes.sheets.filter((s) => s.case === id),
        htmlFile = old[0].html.path.slice(id.length + 1);
      const pins = await captureSources(
        join(root, id),
        id,
        pages.map((p) => p.number),
        htmlFile,
        { bytes, pdfjsVersion: PDFJS_VERSION, pages },
      );
      for (const pin of pins) {
        const originalPin = old.find((p) => p.sheet === pin.sheet);
        assert(
          originalPin &&
            equal(pin.svg, originalPin.svg) &&
            equal(pin.html, originalPin.html),
          "Calibration SVG/HTML source pins differ",
        );
        if (originalPin.pdf)
          assert(
            equal(pin.pdf, originalPin.pdf),
            "Calibration PDF bytes/page differ from original PDF pins",
          );
        Object.assign(
          report.sourceHashes.sheets.find(
            (s) => s.case === id && s.sheet === pin.sheet,
          ),
          { pdf: pin.pdf },
        );
      }
      const textByPage = new Map();
      for (const t of targets.filter((t) => t.scope.case === id)) {
        checkPdfInstance(original, t);
        if (!textByPage.has(t.physicalSheet))
          textByPage.set(
            t.physicalSheet,
            await pdfText(
              await doc.getPage(t.physicalSheet),
              doc.fontFamilies,
              doc.fontCaps,
            ),
          );
        const text = textByPage
          .get(t.physicalSheet)
          .find(
            (x) =>
              x.text === t.facts.text &&
              equal(canonical(x.bbox), canonical(t.bbox)),
          );
        assert(
          text,
          "Delivered PDF text/page/exported box association differs: " + t.row,
        );
        associated.set(t.row, {
          fontFace: text.fontFace,
          fontMm: text.fontSize,
          text: text.text,
          bbox: canonical(text.bbox),
          physicalSheet: t.physicalSheet,
        });
      }
      doc.assertNoExternalResources();
    } finally {
      await doc.loadingTask.destroy();
    }
  }
  const calibrationSha256 = hash(json(report)),
    inventory = instanceInventory(report, calibrationSha256);
  const samples = targets.map((t) =>
    inventory.instances.find(
      (x) =>
        x.row === t.row &&
        x.finding === t.finding &&
        x.instance === t.instance &&
        x.scope.medium === "pdf",
    ),
  );
  for (const t of samples) pinnedSource(report, t);
  return {
    root,
    report,
    original,
    originalSha256: hash(raw),
    calibrationSha256,
    samples,
    associated,
  };
}
