import { parseReportBytes } from "./report-file.mjs";
// Browser-required character sensitivity acceptance on actual checkpoint crops.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { captureSourceCrop } from "./crop-source.mjs";
import { captureAttempts } from "./crop-attempts.mjs";
import { pinnedSource, assertSourceBytes } from "./source-hashes.mjs";
import { pipelineCrops } from "./crop-index.mjs";
import { json, hash } from "./support.mjs";
const { values: v } = parseArgs({
  options: { report: { type: "string" }, output: { type: "string" } },
});
assert(
  v.report && v.output,
  "Use --report <summary.json> --output <swaps.json>",
);
const raw = await readFile(resolve(v.report)),
  root = dirname(resolve(v.report)),
  report = parseReportBytes(raw);
const rows = pipelineCrops(parseReportBytes(raw), hash(raw))
  .filter((r) => r.scope.medium === "svg")
  .sort(
    (a, b) => a.sourceBbox.w * a.sourceBbox.h - b.sourceBbox.w * b.sourceBbox.h,
  );
const browser = await launch(),
  results = [];
try {
  const ctx = await browser.newContext(drawingContextOptions),
    page = await ctx.newPage();
  await page.emulateMedia({ media: "print" });
  async function examine(row) {
    const svg = await readFile(
      join(
        root,
        row.scope.case,
        `sheet-${String(row.physicalSheet).padStart(3, "0")}.svg`,
      ),
      "utf8",
    );
    assertSourceBytes(Buffer.from(svg), pinnedSource(report, row));
    await openSheet(page, svg);
    const nodes = await page.evaluate((box) => {
      const root = document.querySelector("body>svg"),
        rr = root.getBoundingClientRect(),
        sx = root.viewBox.baseVal.width / rr.width;
      return [...root.querySelectorAll("text")].flatMap((t, i) => {
        if (t.children.length || !t.textContent.trim()) return [];
        const r = t.getBoundingClientRect(),
          x = (r.x - rr.x) * sx,
          y = (r.y - rr.y) * sx,
          w = r.width * sx,
          h = r.height * sx;
        return x >= box.x &&
          y >= box.y &&
          x + w <= box.x + box.w &&
          y + h <= box.y + box.h
          ? [
              {
                i,
                text: t.textContent,
                fontMm:
                  parseFloat(getComputedStyle(t).fontSize) *
                  Math.hypot(t.getScreenCTM().c, t.getScreenCTM().d) *
                  sx,
              },
            ]
          : [];
      });
    }, row.sourceBbox);
    return { row, svg, nodes: nodes.sort((a, b) => a.fontMm - b.fontMm) };
  }
  let smallest, largest;
  for (const r of rows) {
    const x = await examine(r);
    if (x.nodes.length) {
      smallest = x;
      break;
    }
  }
  for (const r of rows.slice().reverse()) {
    const x = await examine(r);
    if (x.nodes.length) {
      largest = x;
      break;
    }
  }
  assert(smallest && largest, "No text crops found");
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
  for (const [size, c] of [
    ["smallest", smallest],
    ["largest", largest],
  ]) {
    const selected = [
      c.nodes[0],
      c.nodes[Math.floor(c.nodes.length / 2)],
      c.nodes.at(-1),
    ];
    for (const [rank, node] of selected.entries()) {
      async function variant(char) {
        await openSheet(page, c.svg);
        const svg = await page.evaluate(
          ({ i, char }) => {
            const s = document.querySelector("body>svg"),
              t = s.querySelectorAll("text")[i];
            t.textContent += char;
            return new XMLSerializer().serializeToString(s);
          },
          { i: node.i, char },
        );
        return svg;
      }
      for (const [a, b] of pairs) {
        const A = await captureSourceCrop(browser, await variant(a), c.row),
          B = await variant(b),
          attempts = [],
          references = new Map();
        let refused = false;
        try {
          await captureAttempts(
            A,
            0,
            () => captureSourceCrop(browser, B, c.row),
            references,
            attempts,
          );
        } catch (error) {
          if (
            attempts.length !== 3 ||
            attempts.some((x) => x.verdict !== "refused")
          )
            throw error;
          refused = true;
        }
        results.push({
          crop: c.row.pipelineCrop,
          size,
          rank,
          fontMm: node.fontMm,
          text: node.text,
          swap: `${a}→${b}`,
          refused,
          frozenSha256: hash(A),
          attempts,
        });
      }
    }
  }
} finally {
  await browser.close();
}
await writeFile(resolve(v.output), json({ reportSha256: hash(raw), results }), {
  flag: "wx",
});
const accepted = results.filter((r) => !r.refused);
console.log(
  json({
    pairs: results.length,
    comparisons: results.reduce((n, r) => n + r.attempts.length, 0),
    accepted: accepted.length,
    minMaximum: Math.min(
      ...results.flatMap((r) => r.attempts.map((a) => a.stats.maximum)),
    ),
    minFontMm: Math.min(...results.map((r) => r.fontMm)),
  }),
);
assert(
  results.length === 90 && results.every((r) => r.attempts.length === 3),
  "Expected 90 frozen wrong crops and 270 comparisons",
);
assert(
  !accepted.length,
  "Character changes were accepted; inspect swap results",
);
