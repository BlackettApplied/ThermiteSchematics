import assert from "node:assert/strict";
import { assertCropContainsInstance } from "./crop-geometry.mjs";
import { PDF_INK_FORMAT } from "./pdf-ink-policy.mjs";
import { checkAttempts } from "./crop-attempts.mjs";

export const SOURCE_FORMAT = "thermite-draw-source-crop/2.0";
// Exact original signed bytes, not a PR number, date or an absent field.
const historical = new Map([
  ["#92", "b56690d45cae4a53beef6dfe39b68221d00d00842cce36445cd6c175b7094da5"],
  ["#61", "f9122b862d64548e21c3dfc8dfa4067c05c5d712d4a2ff1f9029322a05cca499"],
]);
export const predatesSourceVerification = (file, sha) =>
  historical.has(file.pr) && historical.get(file.pr) === sha;
export function checkSourceVerification(entry, archivePdf2 = false) {
  const v = entry.sourceVerification;
  assert(
    (v?.medium === "pdf"
      ? v.format === PDF_INK_FORMAT ||
        (archivePdf2 && v.format === SOURCE_FORMAT)
      : v?.format === SOURCE_FORMAT) &&
      v.dpi === 300 &&
      /^[a-f0-9]{64}$/.test(v.sourceSha256 ?? "") &&
      ["svg", "html", "pdf"].includes(v.medium) &&
      Number.isSafeInteger(v.sheet) &&
      v.sheet > 0,
    "Bind crop against its source with Chromium (SVG/HTML) or pdf.js (PDF) before sign-off",
  );
  assertCropContainsInstance({ bbox: v.instanceBbox }, v.sourceBbox);
  checkAttempts(v, archivePdf2);
}
export function checkSourceReferences(
  file,
  refs,
  signedSha,
  archivePdf2 = false,
) {
  if (predatesSourceVerification(file, signedSha))
    return "historical signed hash";
  for (const { entry } of refs) checkSourceVerification(entry, archivePdf2);
  return refs.some(
    ({ entry }) =>
      entry.sourceVerification.medium === "pdf" &&
      entry.sourceVerification.format === PDF_INK_FORMAT,
  )
    ? "source-crop/3.0"
    : "source-crop/2.0";
}
export function assertNoCroplessFacts(file) {
  assert(
    file.entries.every(
      (e) =>
        e.crop ||
        (e.drawingSha256 === undefined && e.sourceVerification === undefined),
    ),
    "Crop-less entries cannot carry drawingSha256 or sourceVerification",
  );
}

export function checkIndexCapture(rows, archivePdf2 = false) {
  for (const row of rows) {
    assert(
      row.scope?.medium !== "pdf" ||
        row.cropShape?.kind === "pdf-em-ink/1.0" ||
        (archivePdf2 && row.cropShape === undefined),
      "New PDF index requires em+ink cropShape",
    );
    assert(
      row.capture === "fresh-source",
      `New crop index row ${JSON.stringify(row.path)} requires capture: "fresh-source"`,
    );
  }
}
