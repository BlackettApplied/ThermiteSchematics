import {
  copy,
  same,
  keys,
  range,
  scopeId,
  measured,
} from "./repin-primitives.mjs";
import { createRecordReceipt, createTargetResolver } from "./repin-plan.mjs";
import { processDecisionFile } from "./repin-decisions.mjs";
import { reconcileScopes, reconcileBounds } from "./repin-resolve.mjs";
import { finishRepin } from "./repin-finish.mjs";
import {
  fontPairs,
  pairDrift,
  moveCandidates,
  checkNotMoves,
} from "./repin-reconcile.mjs";
import { CAPTURE_FORMAT, EVALS_VERSION } from "./version.mjs";
import { checkerManifestHash } from "./checker-manifest.mjs";
import { sheetRenameMap, cropClaimTracker, viewKind } from "./repin-policy.mjs";
// Guarded deltas only. This module never imports or calls seed().
import assert from "node:assert/strict";
import { assess, observations, exitCode, summary } from "./assessment.mjs";
import { readReportSummary } from "./report-summary.mjs";
import { requireCheckCoverage } from "./report-coverage.mjs";
import { identityKey, markerId, checkKey } from "./locators.mjs";
import { bands } from "./marker-metrics.mjs";
import { hash, json, canonical } from "./support.mjs";

export const DECISIONS_FORMAT = "thermite-draw-decisions/1.0";
const LEGACY_CAPTURE_FORMAT = "thermite-draw-eval/1.0";
function stateContext(rows, specs) {
  return {
    allCases: new Set(specs.map((s) => s.id)),
    caseStates: Object.fromEntries(
      specs.map((s) => {
        const sheets = [
          ...new Set(
            rows
              .filter(
                (r) =>
                  r.case === s.id && Number.isInteger(r.sheet) && r.sheet > 0,
              )
              .map((r) => r.sheet),
          ),
        ];
        return [
          s.id,
          { status: sheets.length ? "rendered" : "refused", sheets },
        ];
      }),
    ),
  };
}
export function reassess(report, registry, specs) {
  const rows = copy(report.results.filter((r) => !r.expectation));
  for (const r of rows) {
    assert(
      r.status !== "infrastructure-error",
      "Infrastructure errors cannot be re-pinned",
    );
    const has = r.evidence?.findings?.length;
    if (has)
      assert(
        ["fail", "xfail"].includes(r.status),
        `Findings on unsupported row status: ${r.id}`,
      );
    if (r.status === "fail") assert(has, `Unexplained failed row: ${r.id}`);
    if (has) r.status = "fail";
  }
  const assessment = assess(
    rows,
    registry,
    new Set(report.cases),
    stateContext(rows, specs),
  );
  return {
    rows,
    drift: assessment.drift,
    exitCode: exitCode(rows),
    summary: summary(rows),
  };
}
function validateReport(
  report,
  registry,
  registrySha256,
  specs,
  { checkerSha256, baseline = false },
) {
  keys(registry, ["format", "markers"], "registry");
  for (const m of registry.markers) {
    keys(
      m,
      [
        "id",
        "dq",
        "family",
        "kind",
        "locator",
        "check",
        "coarse",
        "scopes",
        "bands",
        "count",
      ],
      "marker",
    );
    range(m.count, 2, "existing count");
    assert(m.count.every(Number.isInteger), "Existing counts must be integers");
    for (const b of Object.values(m.bands)) range(b, 4, "existing band");
    for (const scope of m.scopes)
      keys(scope, ["cases", "sheets", "media"], "stored scope");
  }

  const supportedFormat =
    report.format === CAPTURE_FORMAT ||
    (baseline && report.format === LEGACY_CAPTURE_FORMAT);
  assert(supportedFormat, "Unsupported report format");
  assert(
    report.mode === "strict" && report.subset === "full",
    "Use a full strict report",
  );
  same(
    [...report.cases].sort(),
    specs.map((s) => s.id).sort(),
    "Full corpus case coverage required",
  );
  assert(
    new Set(report.cases).size === report.cases.length,
    "Duplicate report case",
  );
  assert(
    report.checkers?.["expectations.mjs"] === registrySha256,
    "Report registry hash is stale",
  );
  if (checkerSha256 !== undefined) {
    assert(
      report.checkerSha256 === checkerSha256,
      "Report checker bundle is stale",
    );
    assert(
      checkerManifestHash(report.checkers) === checkerSha256,
      "Report checker module inventory/hash is stale",
    );
  } else if (report.checkerSha256 !== undefined) {
    assert(
      report.checkerSha256 === checkerManifestHash(report.checkers),
      "Baseline checker manifest contradicts its bundle hash",
    );
  }
  assert(
    report.corpusSha256 && report.evalsVersion,
    "Report seal/version missing",
  );
  assert(
    !report.results.some((r) => r.status === "infrastructure-error"),
    "Infrastructure errors cannot be re-pinned",
  );
  requireCheckCoverage(report, specs);
  const checked = reassess(report, registry, specs);
  same(
    report.results.map((r) => [r.id, r.status]).sort(),
    checked.rows.map((r) => [r.id, r.status]).sort(),
    "Report statuses do not match measured findings/registry",
  );
  same(
    report.drift,
    checked.drift,
    "Report drift does not match measured findings/registry",
  );
  same(
    readReportSummary(report, checkerSha256 !== undefined),
    checked.summary,
    "Report summary does not match observations",
  );
  assert(
    report.exitCode === checked.exitCode,
    "Report exit does not match observations",
  );
  return checked;
}
export function instanceInventory(report, reportSha256) {
  const instances = [],
    groups = new Map();
  for (const row of report.results.filter(
    (r) => !r.expectation && ["fail", "xfail"].includes(r.status),
  ))
    for (const [findingIndex, f] of (row.evidence?.findings ?? []).entries())
      for (const identity of f.identities ?? []) {
        keys(
          identity,
          [
            "dq",
            "family",
            "kind",
            "locator",
            "check",
            "coarse",
            "sheet",
            "medium",
          ],
          "finding identity",
        );
        assert(
          ["family", "kind", "locator", "check", "sheet"].every(
            (k) => typeof identity[k] === "string" && identity[k],
          ),
          "Incomplete finding identity",
        );
        assert(
          typeof identity.coarse === "boolean",
          "Finding coarseness missing",
        );
        assert(
          identity.kind === f.kind &&
            identity.dq === row.dq &&
            report.cases.includes(row.case),
          "Finding identity contradicts its observation",
        );
        const id = markerId(identity),
          scope = {
            case: row.case,
            sheet: identity.sheet,
            medium: identity.medium,
          },
          group = scopeId(id, scope);
        if (!groups.has(group))
          groups.set(group, {
            markerId: id,
            identity,
            scope,
            tokens: [],
            findings: [],
            occurrences: 0,
          });
        for (const [instanceIndex, i] of (f.instances ?? [f]).entries()) {
          const address = {
            markerId: id,
            scope,
            row: row.id,
            finding: findingIndex,
            instance: instanceIndex,
          };
          const token = hash(json({ reportSha256, address }));
          const merged = { ...f, ...i, instances: undefined };
          const multiplicity = f.instances ? 1 : (f.instanceCount ?? 1);
          const facts = {
            kind: f.kind,
            dq: identity.dq,
            check: identity.check,
            flow:
              row.flow ??
              /(?:left-to-right|top-to-bottom)$/.exec(row.case)?.[0] ??
              "flow-neutral",
            ...(f.fontPair &&
            identity.locator.startsWith(
              `font-pair/${f.fontPair}/${viewKind(row.viewScope)}/`,
            )
              ? {
                  column: identity.locator.slice(
                    `font-pair/${f.fontPair}/${viewKind(row.viewScope)}/`
                      .length,
                  ),
                }
              : {}),
            text: String(
              i.text ?? i.designation ?? f.text ?? f.designation ?? "",
            ),
            sourceLocator:
              i.sourceLocator ?? f.sourceLocator ?? identity.locator,
            view: row.viewScope ?? identity.sheet,
            medium: identity.medium,
            case: row.case,
          };
          const entry = {
            token,
            ...address,
            facts,
            multiplicity,
            physicalSheet: row.sheet,
            classification:
              row.classification === "policy-gap" ? "policy-gap" : "drawing",
            bbox: i.bbox ?? f.bbox,
          };
          assert(
            entry.classification ===
              (f.kind === "iso-cap-height-policy" ? "policy-gap" : "drawing"),
            "Report policy-gap classification is inconsistent",
          );
          instances.push(entry);
          const g = groups.get(group);
          g.tokens.push(token);
          g.findings.push(merged);
          g.occurrences += multiplicity;
        }
      }
  assert(
    new Set(instances.map((x) => x.token)).size === instances.length,
    "Duplicate instance address",
  );
  return {
    instances,
    byToken: new Map(instances.map((x) => [x.token, x])),
    groups,
  };
}
export function prepareRepin({
  report,
  reportSha256,
  registry,
  registrySha256,
  checkerSha256,
  decisions,
  baselines = new Map(),
  specs,
  cropHashes = new Map(),
}) {
  assert(
    report.evalsVersion === EVALS_VERSION,
    "Run a fresh full report with the current evals version",
  );
  assert(
    typeof checkerSha256 === "string" && checkerSha256,
    "Current checker bundle is required",
  );
  const checked = validateReport(report, registry, registrySha256, specs, {
    checkerSha256,
  });
  const inventory = instanceInventory(report, reportSha256),
    original = new Map(registry.markers.map((m) => [m.id, m]));
  const population = [...inventory.groups.values()].flatMap((g) => g.findings);
  const next = copy(registry),
    markers = new Map(next.markers.map((m) => [m.id, m]));
  const stale = new Map(
    checked.rows
      .filter((r) => r.expectation)
      .map((r) => [scopeId(r.expectation.marker, r.expectation.scope), r]),
  );
  const sourceClaims = new Map(),
    targetClaims = new Map(),
    staleWork = new Map(),
    targetWork = new Map(),
    metricWork = new Map(),
    definitions = new Map(),
    receipts = [],
    retired = [],
    pairWork = new Map();
  const fresh = decisions.flatMap((f) =>
    (f.entries ?? [])
      .filter((e) => ["new-defect", "scope-added"].includes(e.action))
      .flatMap((e) =>
        (e.instances ?? [])
          .map((t) => inventory.byToken.get(t))
          .filter(Boolean),
      ),
  );
  const recordReceipt = createRecordReceipt(receipts);
  const sheetRenames = sheetRenameMap(decisions, specs);
  const claimCrop = cropClaimTracker(cropHashes);
  assert(decisions.length, "Supply reviewed decisions");
  const claim = (map, key, description) => {
    assert(!map.has(key), `Conflicting/reused ${description}`);
    map.set(key, true);
  };
  const binding = {
    summarySha256: reportSha256,
    registrySha256,
    checkerSha256,
    corpusSha256: report.corpusSha256,
    evalsVersion: report.evalsVersion,
  };
  const ensureTarget = createTargetResolver(inventory, original, targetWork);
  const context = {
    report,
    reportSha256,
    registry,
    registrySha256,
    checkerSha256,
    decisions,
    baselines,
    specs,
    checked,
    inventory,
    original,
    population,
    next,
    markers,
    stale,
    sourceClaims,
    targetClaims,
    staleWork,
    targetWork,
    metricWork,
    definitions,
    receipts,
    retired,
    pairWork,
    fresh,
    recordReceipt,
    sheetRenames,
    claimCrop,
    claim,
    binding,
    ensureTarget,
    validateBaseline: (baseline) =>
      validateReport(baseline, registry, registrySha256, specs, {
        baseline: true,
      }),
    instanceInventory,
    reassess,
    DECISIONS_FORMAT,
  };
  for (const file of decisions) processDecisionFile(context, file);
  const candidates = moveCandidates(retired, fresh, sheetRenames, specs);
  const notMoves = checkNotMoves(
    candidates,
    decisions.flatMap((f) => f.notMove ?? []),
    claimCrop,
  );
  reconcileScopes(context);
  reconcileBounds(context);
  return finishRepin(context, notMoves);
}

export function reviewInventory(context) {
  const {
    report,
    reportSha256,
    registry,
    registrySha256,
    checkerSha256,
    specs,
    baselines = new Map(),
  } = context;
  const checked = validateReport(report, registry, registrySha256, specs, {
    checkerSha256,
  });
  const current = instanceInventory(report, reportSha256);
  const population = [...current.groups.values()].flatMap((g) => g.findings);
  return {
    format: "thermite-draw-repin-inventory/1.0",
    binding: {
      summarySha256: reportSha256,
      registrySha256,
      checkerSha256,
      corpusSha256: report.corpusSha256,
      evalsVersion: report.evalsVersion,
    },
    current: current.instances,
    markers: registry.markers,
    envelopes: [
      ...new Set([...current.groups.values()].map((g) => g.markerId)),
    ].flatMap((id) => {
      const groups = [...current.groups.values()].filter(
        (g) => g.markerId === id,
      );
      if (!groups.length) return [];
      const counts = groups.map((g) => g.occurrences);
      return [
        {
          markerId: id,
          count: [Math.min(...counts), Math.max(...counts)],
          bands: canonical(
            bands(
              groups.flatMap((g) => g.findings),
              population,
            ),
          ),
        },
      ];
    }),
    stale: checked.rows
      .filter((r) => r.expectation)
      .map((r) => ({
        markerId: r.expectation.marker,
        scope: r.expectation.scope,
        measured: measured(
          checked.rows,
          registry.markers.find((m) => m.id === r.expectation.marker),
          r.expectation.scope,
        ),
        reason: r.reason,
      })),
    drift: [...checked.drift, ...pairDrift(registry, current)],
    fontPairs: fontPairs(registry, current),
    baselines: [...baselines].map(([sha, r]) => {
      validateReport(r, registry, registrySha256, specs, { baseline: true });
      return { sha256: sha, instances: instanceInventory(r, sha).instances };
    }),
  };
}
