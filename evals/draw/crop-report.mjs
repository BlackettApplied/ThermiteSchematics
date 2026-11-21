// Pure report/entry binding. Geometry and labels come from hash-bound instances.
import { assertCropContainsInstance } from "./crop-geometry.mjs";
import assert from "node:assert/strict";
import { instanceInventory } from "./repin-core.mjs";
import { canonical, json } from "./support.mjs";
import { pinnedSource } from "./source-hashes.mjs";
import { drawingReferences } from "./repin-drawing-bindings.mjs";
import { renameTextChanged } from "./repin-mappings.mjs";
import { checkPdfRegion, pdfFacts } from "./pdf-source-policy.mjs";
import { PDF_INK_FORMAT } from "./pdf-ink-policy.mjs";
import { SOURCE_FORMAT, checkIndexCapture } from "./crop-source-policy.mjs";
const same = (a, b, message) => assert(json(a) === json(b), message);
const ascii = (s) =>
  String(s).replace(
    /[^\x20-\x7e]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
export const cropHeader = (t) => [
  `${t.markerId} | ${t.scope.medium === "pdf" ? "PDF em+ink" : t.scope.medium.toUpperCase()} | 300 dpi`,
  `${t.scope.case} | ${ascii(t.scope.sheet)} | physical page ${t.physicalSheet}`,
  `Report instance ${t.token}`,
  `Text ${ascii(t.facts.text)}`,
];
export function sourcePath(t) {
  assert(
    ["svg", "html", "pdf"].includes(t.scope.medium),
    "Source crop medium must be SVG, HTML or supported PDF",
  );
  return t.scope.medium === "pdf"
    ? `${t.scope.case}/packet.pdf`
    : t.scope.medium === "html"
      ? `${t.scope.case}/packet.html.gz`
      : `${t.scope.case}/sheet-${String(t.physicalSheet).padStart(3, "0")}.svg`;
}
export function reportInstances(reports) {
  return new Map(
    [...reports].map(([sha, r]) => [sha, instanceInventory(r, sha)]),
  );
}
export function renameCropEligibility(file, inventories) {
  const eligible = new Map(),
    from = new Set(),
    to = new Set();
  for (const entry of file.entries.filter((e) => e.action === "rename")) {
    const before = inventories.get(file.baselineSha256),
      after = inventories.get(file.summarySha256);
    assert(
      before && after,
      "Rename crops require the exact baseline and current report",
    );
    assert(
      Array.isArray(entry.pairs) && entry.pairs.length,
      "List individual rename pairs",
    );
    const changed = [];
    for (const pair of entry.pairs) {
      const a = before.byToken.get(pair.from),
        b = after.byToken.get(pair.to);
      assert(
        a && b,
        "Rename pair needs known baseline/current report instance tokens",
      );
      assert(
        !from.has(pair.from) && !to.has(pair.to),
        "Rename instance token reused",
      );
      from.add(pair.from);
      to.add(pair.to);
      if (renameTextChanged(pair, a, b)) changed.push(pair);
    }
    assert(
      changed.length || !entry.crop,
      "Unused crop on an unchanged-text move",
    );
    eligible.set(entry, changed);
  }
  return eligible;
}
export function entryTokens(file, entry, crop, eligible) {
  if (entry !== crop)
    return entry.action === "rename"
      ? eligible.get(entry).map((p) => p.to)
      : (entry.instances ?? []);
  const d = (file.notMove ?? []).find((d) => d.crops?.includes(crop));
  assert(d, "Crop has no decision reference");
  return [d.crops.indexOf(crop) === 0 ? d.from : d.to];
}
function checkTarget(file, entry, crop, t, eligible) {
  const ref = entry.to;
  if (ref) {
    assert(
      ref.scope.medium !== "pdf" || t.scope.medium === "pdf",
      "A PDF-scope entry cannot use SVG/HTML evidence",
    );
    same(
      ref,
      { markerId: t.markerId, scope: t.scope },
      "Crop entry marker/scope differs from report instance",
    );
  }
  assert(
    entryTokens(file, entry, crop, eligible).includes(t.token),
    "Crop token is not one of the entry's instances eligible for this crop; text-changing renames must cite a changed-text pair",
  );
}
export function checkIndexedEntries(
  file,
  index,
  reports,
  contexts = new Map(),
) {
  assert(
    reports.has(file.summarySha256),
    "Bind requires the exact --report named by summarySha256",
  );
  checkIndexCapture(index.crops);
  assert(
    !index.crops.some((c) => c.scope.medium === "pdf") ||
      index.format === "thermite-draw-crop-index/3.0",
    "New PDF index requires format 3.0",
  );
  const inventories = reportInstances(reports),
    eligible = renameCropEligibility(file, inventories),
    rows = new Map(index.crops.map((c) => [c.path, c]));
  const errors = [];
  for (const { entry, crop } of drawingReferences(file)) {
    try {
      const c = rows.get(crop.path);
      assert(c, "Cited crop is missing from index");
      const t = inventories.get(c.reportSha256)?.byToken.get(c.token);
      assert(
        t,
        "Crop token/report hash is not in the supplied report or baseline",
      );
      checkTarget(file, entry, crop, t, eligible);
      same(
        c.scope,
        t.scope,
        "Crop case/medium/view differs from report instance",
      );
      same(c.markerId, t.markerId, "Crop marker differs from report instance");
      same(
        c.instanceBbox,
        t.bbox,
        "Crop instance box differs from report instance",
      );
      assert(
        c.row === t.row && c.physicalSheet === t.physicalSheet,
        "Crop row/physical sheet differs from report instance",
      );
      assert(c.text === t.facts.text, "Crop text differs from report instance");
      sourcePath(t);
      const ref = pinnedSource(
          reports.get(c.reportSha256),
          t,
          contexts.get(c.reportSha256),
        ),
        expected = ref.path,
        r = c.sourceRender;
      assert(
        r?.medium === t.scope.medium && r[t.scope.medium] === expected,
        "Source path must match the report case and physical sheet",
      );
      assert(
        r[t.scope.medium + "Sha256"] === ref.sha256,
        "Source render hash differs from C1 report",
      );
      assertCropContainsInstance({ bbox: c.instanceBbox }, c.sourceBbox);
      if (t.scope.medium === "pdf") {
        same(
          pdfFacts(r),
          pdfFacts(ref),
          "PDF source page/backend/version differs from report pin",
        );
        same(
          c.classification,
          t.classification,
          "PDF classification differs from report instance",
        );
        checkPdfRegion(ref.page, c.instanceBbox, c.sourceBbox, c.cropShape);
      }
      if (c.headerPixels === 86)
        same(
          c.headerLines,
          cropHeader(t),
          "Crop header differs from report instance",
        );
    } catch (e) {
      errors.push(crop.path + ": " + e.message);
    }
  }
  assert(!errors.length, "Crop/report refusals:\n" + errors.join("\n"));
}
export function checkReportedSources(file, reports) {
  const inventories = reportInstances(reports),
    eligible = renameCropEligibility(file, inventories);
  for (const { entry, crop } of drawingReferences(file)) {
    const v = entry.sourceVerification;
    const t = inventories.get(v?.reportSha256)?.byToken.get(v?.token);
    assert(t, "Source attestation token/report is not in the bound report");
    checkTarget(file, entry, crop, t, eligible);
    same(v.scope, t.scope, "Source attestation scope differs from report");
    assert(
      v.markerId === t.markerId && v.row === t.row,
      "Source attestation identity differs from report",
    );
    assert(
      v.medium === t.scope.medium && v.sheet === t.physicalSheet,
      "Source attestation medium/physical sheet differs from report",
    );
    same(
      v.instanceBbox,
      canonical(t.bbox),
      "Source attestation instance box differs from report",
    );
    assert(
      v.text === t.facts.text &&
        v.sourcePath === pinnedSource(reports.get(v.reportSha256), t).path,
      "Source attestation text/path differs from report",
    );
    if (t.scope.medium === "pdf") {
      same(
        v.pdf,
        pdfFacts(pinnedSource(reports.get(v.reportSha256), t)),
        "PDF attestation page/backend/version differs from report pin",
      );
      same(
        v.classification,
        t.classification,
        "PDF classification differs from report instance",
      );
    }
    assert(
      v.sourceSha256 === pinnedSource(reports.get(v.reportSha256), t).sha256,
      "Source attestation hash differs from C1 report",
    );
  }
}

export function verificationFact(row, sourceSha256) {
  return {
    format: row.scope.medium === "pdf" ? PDF_INK_FORMAT : SOURCE_FORMAT,
    sourceSha256,
    medium: row.scope.medium,
    sheet: row.physicalSheet,
    dpi: 300,
    sourceBbox: canonical(row.sourceBbox),
    instanceBbox: canonical(row.instanceBbox),
    reportSha256: row.reportSha256,
    token: row.token,
    markerId: row.markerId,
    scope: row.scope,
    text: row.text,
    row: row.row,
    sourcePath: row.sourceRender[row.scope.medium],
    ...(row.scope.medium === "pdf"
      ? {
          pdf: pdfFacts(row.sourceRender),
          classification: row.classification,
          cropShape: row.cropShape,
        }
      : {}),
  };
}
