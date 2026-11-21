// Real CLI PDF producer, pdf.js renderer, exported instance boxes; no Apple PDFKit raster.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { parseArgs } from "node:util";
import { packetPdf } from "../../packages/cli/dist/alpha-pdf.js";
import { pdfCalibration } from "./pdf-calibration.mjs";
import { readCheckpointCaseFiles } from "./case-files.mjs";
import { pinnedSource } from "./source-hashes.mjs";
import {
  capturePdfCrop,
  preparePdfCrop,
  pdfCaptureEnvironment,
} from "./pdf-source.mjs";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import {
  compareSourcePixels,
  sourcePixelStats,
  pixelRefusal,
} from "./crop-source-pixels.mjs";
import { loadPdfBytes, pdfText, renderPdf } from "./pdf.mjs";
import { canonical } from "./support.mjs";
import { hash } from "./support.mjs";
const { values: v } = parseArgs({
  options: { report: { type: "string" }, output: { type: "string" } },
});
assert(
  v.report && v.output,
  "Use --report <summary.json> --output <pdf-swaps.json>",
);
const c = await pdfCalibration(v.report),
  readCaseFile = await readCheckpointCaseFiles(c.root),
  sorted = c.samples.toSorted(
    (a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h,
  ),
  results = [],
  baseline = [];
const pairs = [
  ["1", "7"],
  ["3", "8"],
  ["5", "6"],
  ["0", "8"],
  ["6", "8"],
  ["1", "l"],
  ["I", "l"],
  ["O", "0"],
  [",", "."],
  [":", ";"],
  ["-", "–"],
  ["C", "G"],
  ["E", "F"],
  ["P", "R"],
  ["V", "Y"],
];
const common = sorted.find((t) => {
  const a = c.associated.get(t.row);
  return (
    a.fontFace === "NotoSans-Regular" &&
    Math.abs(a.fontMm - 2.2) < 0.001 &&
    a.text === "ASSIGNED / USAGE UNSPECIFIED"
  );
});
assert(common, "Missing common 2.2 mm Regular mid-string control");
const tailPairs = [
  ["O", "Q"],
  ["Q", "O"],
  ["n", "g"],
  ["g", "n"],
  ["i", "j"],
  ["j", "i"],
  ["r", "f"],
  ["f", "r"],
  ["v", "y"],
  ["y", "v"],
];
const targets = [
  { size: "smallest", t: sorted[0], at: 0, pairs },
  { size: "largest", t: sorted.at(-1), at: 0, pairs },
  {
    size: "smallest-middle",
    t: sorted[0],
    at: 1,
    pairs: [...pairs, ...tailPairs],
  },
  { size: "common-middle", t: common, at: 9, pairs: [...pairs, ...tailPairs] },
  {
    size: "largest-middle",
    t: sorted.at(-1),
    at: 9,
    pairs: [...pairs, ...tailPairs],
  },
  ...[
    ["smallest", sorted[0]],
    ["common", common],
    ["largest", sorted.at(-1)],
  ].flatMap(([size, t]) => [
    {
      size: size + "-left-edge",
      t,
      at: 0,
      pairs: [
        ["i", "j"],
        ["j", "i"],
      ],
    },
    {
      size: size + "-right-edge",
      t,
      at: "last",
      pairs: [
        ["r", "f"],
        ["f", "r"],
      ],
    },
  ]),
];
const images = join(dirname(resolve(v.output)), basename(v.output) + ".images");
await mkdir(images, { recursive: true });
const browser = await launch();
try {
  const context = await browser.newContext(drawingContextOptions),
    page = await context.newPage();
  await page.emulateMedia({ media: "print" });
  for (const { size, t, at, pairs } of targets) {
    const ref = pinnedSource(c.report, t),
      directory = join(c.root, t.scope.case),
      packet = JSON.parse(await readCaseFile(t.scope.case, "packet.json"));
    for (const s of packet.sheets)
      s.svg = await readFile(
        join(directory, `sheet-${String(s.number).padStart(3, "0")}.svg`),
        "utf8",
      );
    const sheet = packet.sheets.find((s) => s.number === t.physicalSheet),
      originalSvg = sheet.svg;
    await openSheet(page, originalSvg);
    const node = await page.evaluate(
      ({ text, box }) => {
        const svg = document.querySelector("body>svg"),
          r = svg.getBoundingClientRect(),
          sx = svg.viewBox.baseVal.width / r.width;
        return [...svg.querySelectorAll("text")]
          .map((n, i) => {
            const b = n.getBoundingClientRect(),
              x = (b.x - r.x) * sx,
              y = (b.y - r.y) * sx,
              w = b.width * sx,
              h = b.height * sx;
            return {
              i,
              text: n.textContent.trim().replace(/\s+/g, " "),
              x,
              y,
              w,
              h,
            };
          })
          .filter(
            (n) =>
              n.text === text.replace(/\s+/g, " ") &&
              n.x < box.x + box.w &&
              n.x + n.w > box.x &&
              n.y < box.y + box.h &&
              n.y + n.h > box.y,
          )
          .sort(
            (a, b) =>
              Math.hypot(
                a.x + a.w / 2 - box.x - box.w / 2,
                a.y + a.h / 2 - box.y - box.h / 2,
              ) -
              Math.hypot(
                b.x + b.w / 2 - box.x - box.w / 2,
                b.y + b.h / 2 - box.y - box.h / 2,
              ),
          )[0];
      },
      { text: t.facts.text, box: t.bbox },
    );
    assert(node, "No SVG text matching the actual PDF page/box association");
    let row = {
      text: t.facts.text,
      scope: t.scope,
      physicalSheet: t.physicalSheet,
      instanceBbox: t.bbox,
      sourceBbox: t.bbox,
      sourceRender: {
        medium: "pdf",
        pdf: ref.path,
        pdfSha256: ref.sha256,
        backend: ref.backend,
        pdfjsVersion: ref.pdfjsVersion,
        page: ref.page,
      },
    };
    row = await preparePdfCrop(await readFile(join(c.root, ref.path)), row);
    const delivered = await capturePdfCrop(
        await readFile(join(c.root, ref.path)),
        row,
      ),
      reproduced = await packetPdf(packet, "PDF calibration");
    const same = await capturePdfCrop(reproduced, {
      ...row,
      sourceRender: { ...row.sourceRender, pdfSha256: hash(reproduced) },
    });
    baseline.push({
      size,
      row: t.row,
      stats: compareSourcePixels(delivered, same),
      pdf: ref,
      association: c.associated.get(t.row),
    });
    async function variant(char) {
      await openSheet(page, originalSvg);
      const changed = await page.evaluate(
        ({ i, char, at }) => {
          const svg = document.querySelector("body>svg"),
            t = svg.querySelectorAll("text")[i],
            text = t.textContent,
            position =
              at === "last"
                ? text.trimEnd().length - 1
                : text.search(/\S/) + at;
          if (position < 0 || position >= text.trimEnd().length)
            throw Error("Character control position is outside the text");
          t.textContent =
            text.slice(0, position) + char + text.slice(position + 1);
          return {
            svg: svg.outerHTML,
            text: t.textContent.trim().replace(/\s+/g, " "),
          };
        },
        { i: node.i, char, at },
      );
      sheet.svg = changed.svg;
      return {
        bytes: await packetPdf(packet, "PDF character calibration"),
        text: changed.text,
      };
    }
    for (const [a, b] of pairs) {
      const va = await variant(a),
        vb = await variant(b),
        A = va.bytes,
        B = vb.bytes;
      const referenceDoc = await loadPdfBytes(B);
      let referenceRow;
      try {
        const referencePage = await referenceDoc.getPage(t.physicalSheet),
          items = await pdfText(
            referencePage,
            referenceDoc.fontFamilies,
            referenceDoc.fontCaps,
          ),
          matches = items.filter((x) => x.text === vb.text);
        assert(
          matches.length === 1,
          `Swap reference needs one exact generated text: ${size} ${a}→${b} ${JSON.stringify(vb.text)}`,
        );
        referenceRow = await preparePdfCrop(B, {
          ...row,
          text: vb.text,
          instanceBbox: canonical(matches[0].bbox),
          sourceRender: { ...row.sourceRender, pdfSha256: hash(B) },
        });
      } finally {
        await referenceDoc.loadingTask.destroy();
      }
      // Wrong source is deliberately rendered at the correct reference's shape:
      // dimension or text-identity refusal must not masquerade as pixel signal.
      const wrongDoc = await loadPdfBytes(A);
      let wrong;
      try {
        wrong = (
          await renderPdf(
            await wrongDoc.getPage(t.physicalSheet),
            300,
            referenceRow.sourceBbox,
          )
        ).toBuffer("image/png");
        wrongDoc.assertNoExternalResources();
      } finally {
        await wrongDoc.loadingTask.destroy();
      }
      const comparisons = [];
      // Calibration trials, not a bind attempt chain: measure all three fresh
      // loads even after an accepted comparison, so clipping remains visible.
      for (let reference = 1; reference <= 3; reference++) {
        const png = await capturePdfCrop(B, referenceRow),
          stats = sourcePixelStats(wrong, png),
          reason = pixelRefusal(stats);
        comparisons.push({
          reference,
          referenceSha256: hash(png),
          stats,
          verdict: reason ? "refused" : "pass",
          reason,
        });
      }
      const refused = comparisons.every((a) => a.verdict === "refused");
      if (tailPairs.some(([from, to]) => from === a && to === b)) {
        const name = `${size}-${a}-${b}`;
        await writeFile(join(images, name + "-wrong.png"), wrong, {
          flag: "wx",
        });
        await writeFile(join(images, name + "-wrong.pdf"), A, { flag: "wx" });
        await writeFile(join(images, name + "-reference.pdf"), B, {
          flag: "wx",
        });
        await writeFile(
          join(images, name + "-reference.png"),
          await capturePdfCrop(B, referenceRow),
          { flag: "wx" },
        );
      }
      results.push({
        size,
        position: at,
        row: t.row,
        physicalSheet: t.physicalSheet,
        box: referenceRow.sourceBbox,
        instanceBbox: referenceRow.instanceBbox,
        cropShape: referenceRow.cropShape,
        classification: t.classification,
        font: c.associated.get(t.row),
        swap: `${a}→${b}`,
        artifacts: tailPairs.some(([from, to]) => from === a && to === b)
          ? `${basename(v.output)}.images/${size}-${a}-${b}`
          : null,
        frozenSha256: hash(wrong),
        wrongPdfSha256: hash(A),
        referencePdfSha256: hash(B),
        refused,
        comparisons,
      });
    }
    process.stdout.write(`${size}: ${pairs.length} frozen controls\n`);
  }
} finally {
  await browser.close();
}
const data = {
  format: "thermite-draw-pdf-swaps/2.0",
  applyTarget: false,
  originalReportSha256: c.originalSha256,
  calibrationReportSha256: c.calibrationSha256,
  capture: pdfCaptureEnvironment(),
  controls: results.length,
  comparisons: results.reduce((n, r) => n + r.comparisons.length, 0),
  accepted: results.filter((r) => !r.refused).length,
  acceptedComparisons: results
    .flatMap((r) => r.comparisons)
    .filter((a) => a.verdict === "pass").length,
  minMaximum: Math.min(
    ...results.flatMap((r) => r.comparisons.map((a) => a.stats.maximum)),
  ),
  baseline,
  results,
};
await writeFile(resolve(v.output), JSON.stringify(data, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({ ...data, baseline: undefined, results: undefined }),
);
assert(
  data.controls === 117 &&
    data.comparisons === 351 &&
    results.every((r) => r.refused),
  "PDF swap calibration must record all trials; all distinct-ink controls must refuse, including O/Q",
);
