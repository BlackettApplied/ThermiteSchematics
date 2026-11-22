// Tracked plans for real pipeline crops and individual re-pin instances.
import assert from "node:assert/strict";
import { instanceInventory } from "./repin-core.mjs";
import { canonical, hash } from "./support.mjs";
import { assertCropContainsInstance } from "./crop-geometry.mjs";
import {
  cropHeader,
  sourcePath,
  entryTokens,
  reportInstances,
  renameCropEligibility,
} from "./crop-report.mjs";
import { checkPdfRegion } from "./pdf-source-policy.mjs";
import { pinnedSource } from "./source-hashes.mjs";
export const contains = (bbox, box) => {
  try {
    assertCropContainsInstance({ bbox }, box);
    return true;
  } catch {
    return false;
  }
};
export function pipelineCrops(report, reportSha256) {
  const pdfInstances = report.results.some(
    (r) =>
      r.evidence?.crop &&
      (r.medium === "pdf" ||
        r.dq === "DQ-01" ||
        r.evidence?.findings?.[0]?.medium === "pdf"),
  )
    ? instanceInventory(report, reportSha256).instances.filter(
        (t) => t.scope.medium === "pdf",
      )
    : [];
  return report.results
    .filter((r) => r.evidence?.crop)
    .map((r) => {
      const medium =
        r.dq === "DQ-01" || r.evidence.findings?.[0]?.medium === "pdf"
          ? "pdf"
          : (r.medium ?? "svg");
      let pdfInstance, reason;
      if (medium === "pdf") {
        try {
          pdfInstance = pdfInstances.find((t) => t.row === r.id);
          assert(pdfInstance, "PDF row has no exported PDF instance");
          const ref = pinnedSource(report, pdfInstance);
          checkPdfRegion(ref.page, pdfInstance.bbox, pdfInstance.bbox);
        } catch (error) {
          reason = error.message;
        }
      }
      return {
        reportSha256,
        row: r.id,
        scope: { case: r.case, medium, sheet: r.viewScope ?? "packet" },
        physicalSheet: r.sheet,
        sourceBbox: canonical(pdfInstance?.bbox ?? r.evidence.cropBbox),
        ...(pdfInstance
          ? {
              token: pdfInstance.token,
              markerId: pdfInstance.markerId,
              instanceBbox: canonical(pdfInstance.bbox),
              classification: pdfInstance.classification,
              text: pdfInstance.facts.text,
            }
          : {}),
        pipelineCrop: r.evidence.crop,
        supported: !reason,
        reason,
      };
    });
}
export function cropPlans(file, reports, contexts = new Map()) {
  const eligible = renameCropEligibility(file, reportInstances(reports));
  const targets = new Map();
  for (const [sha, r] of reports)
    for (const t of instanceInventory(r, sha).instances)
      targets.set(t.token, { t, sha, report: r });
  const requests = [];
  file.entries.forEach((entry, i) => {
    if (
      entry.action === "new-defect" ||
      entry.crop ||
      eligible.get(entry)?.length
    ) {
      entry.crop ??= {};
      requests.push({
        entry,
        crop: entry.crop,
        label: `entry ${i} (${entry.action})`,
        name: `entry-${String(i).padStart(4, "0")}.png`,
      });
    }
  });
  (file.notMove ?? []).forEach((d, i) =>
    d.crops.forEach((crop, j) =>
      requests.push({
        entry: crop,
        crop,
        label: `notMove ${i} crop ${j}`,
        name: `not-move-${i}-${j}.png`,
      }),
    ),
  );
  const errors = [],
    plans = [];
  for (const ref of requests) {
    let selected;
    try {
      const candidates = entryTokens(file, ref.entry, ref.crop, eligible).map(
        (token) => targets.get(token),
      );
      assert(
        candidates.length && candidates.every(Boolean),
        "Index builder needs known report instance tokens",
      );
      selected =
        candidates.find(({ t, report }) => {
          const r = report.results.find((r) => r.id === t.row);
          return r?.evidence?.crop && contains(t.bbox, r.evidence.cropBbox);
        }) ??
        candidates.find(({ t }) => t.bbox) ??
        candidates[0];
      const { t, sha, report } = selected;
      assert(
        ref.entry.to?.scope.medium !== "pdf" || t.scope.medium === "pdf",
        "A PDF-scope entry cannot use SVG/HTML evidence",
      );
      sourcePath(t);
      assert(t.bbox, "Instance has no exported bbox; no crop can be invented");
      const sourceRef = pinnedSource(report, t, contexts.get(sha));
      const row = report.results.find((r) => r.id === t.row),
        reuse = row?.evidence?.crop && contains(t.bbox, row.evidence.cropBbox);
      plans.push({
        ...ref,
        t,
        reportSha256: sha,
        sourceRef,
        sourceBbox:
          t.scope.medium === "pdf"
            ? null
            : reuse
              ? canonical(row.evidence.cropBbox)
              : null,
        pipelineCrop: reuse ? row.evidence.crop : undefined,
        headerLines: cropHeader(t),
      });
    } catch (error) {
      const t = selected?.t,
        scope = t?.scope ?? ref.entry.to?.scope;
      errors.push(
        `${ref.label}: case=${scope?.case ?? "not-exported"} view=${JSON.stringify(scope?.sheet ?? "not-exported")} page=${t?.physicalSheet ?? "not-exported"} marker=${t?.markerId ?? ref.entry.to?.markerId ?? "not-exported"}: ${error.message}`,
      );
    }
  }
  assert(
    !errors.length,
    `Crop planning refused ${errors.length} entry(s):\n` + errors.join("\n"),
  );
  return plans;
}
export function instanceCropRow(plan, path, bytes, box, source) {
  const { t } = plan,
    medium = t.scope.medium;
  return {
    path,
    sha256: hash(bytes),
    headerPixels: 86,
    headerLines: plan.headerLines,
    reportSha256: plan.reportSha256,
    token: t.token,
    markerId: t.markerId,
    scope: t.scope,
    row: t.row,
    physicalSheet: t.physicalSheet,
    instanceBbox: canonical(t.bbox),
    text: t.facts.text,
    sourceBbox: canonical(box),
    capture: "fresh-source",
    ...(medium === "pdf"
      ? { classification: t.classification, cropShape: plan.cropShape }
      : {}),
    sourceRender: {
      medium,
      ...(medium === "pdf"
        ? {
            backend: plan.sourceRef.backend,
            pdfjsVersion: plan.sourceRef.pdfjsVersion,
            page: plan.sourceRef.page,
          }
        : {}),
      [medium]: plan.sourceRef?.path ?? sourcePath(t),
      [medium + "Sha256"]: hash(source),
    },
  };
}
