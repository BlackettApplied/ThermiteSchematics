import { signOffs } from "./repin-signoff.mjs";
import { supersededSuccessor } from "./repin-superseded.mjs";
import {
  fontPairs,
  pairDrift,
  applyPairDecision,
  assertPairBounds,
  checkColumnMap,
  moveCandidates,
  checkNotMoves,
} from "./repin-reconcile.mjs";
import { EVALS_VERSION } from "./version.mjs";
import { checkerManifestHash } from "./checker-manifest.mjs";
import {
  sheetRenameMap,
  renamedScope,
  proveMove,
  cropClaimTracker,
  sourceRow,
  moveError,
  viewKind,
} from "./repin-policy.mjs";
// Guarded deltas only. This module never imports or calls seed().
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { assess, observations, exitCode, summary } from "./assessment.mjs";
import { identityKey, markerId, checkKey } from "./locators.mjs";
import { units, unitKey, compressScopes } from "./marker-scopes.mjs";
import { measurements, envelope, bands } from "./marker-metrics.mjs";
import { hash, json, canonical } from "./support.mjs";

export const DECISIONS_FORMAT = "thermite-draw-decisions/1.0";
const copy = (x) => structuredClone(x);
const same = (a, b, message) => assert(equal(a, b), message);
const scopeId = (id, scope) => {
  keys(scope, ["case", "sheet", "medium"], "scope");
  assert(
    typeof scope.case === "string" &&
      typeof scope.sheet === "string" &&
      scope.case &&
      scope.sheet &&
      ["svg", "html", "pdf"].includes(scope.medium),
    "Invalid scope selector",
  );
  return JSON.stringify([id, unitKey(scope)]);
};
const keys = (x, allowed, where) => {
  assert(x && typeof x === "object" && !Array.isArray(x), `Invalid ${where}`);
  for (const k of Object.keys(x))
    assert(allowed.includes(k), `Unknown ${where} field: ${k}`);
};
const range = (x, n, where) => {
  assert(
    Array.isArray(x) &&
      x.length === n &&
      x.every((v) => Number.isFinite(v) && v >= 0),
    `Invalid ${where}`,
  );
  assert(
    x.every((v, i) => i === 0 || v >= x[i - 1]),
    `Unordered ${where}`,
  );
};
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
  checkerSha256,
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

  assert(
    report.format === "thermite-draw-eval/1.0",
    "Unsupported report format",
  );
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
  for (const c of report.cases)
    for (let n = 1; n <= 24; n++) {
      const spec = specs.find((s) => s.id === c);
      const partner =
        n === 11 && spec.sweep
          ? specs.find(
              (s) => s.flow === "top-to-bottom" && equal(s.sweep, spec.sweep),
            )
          : undefined;
      assert(
        report.results.some(
          (r) =>
            (r.case === c ||
              (partner && r.id === `${partner.id}/DQ-11/flow-comparison`)) &&
            r.dq === `DQ-${String(n).padStart(2, "0")}`,
        ),
        `Missing check observation: ${c}/DQ-${n}`,
      );
    }
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
    report.summary,
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
const measured = (rows, marker, scope) =>
  rows.some(
    (r) =>
      !r.expectation &&
      r.case === scope.case &&
      r.dq === marker.dq &&
      (r.check ?? checkKey(r)) === marker.check &&
      scope.medium ===
        (r.medium ??
          (r.id.includes("/html-")
            ? "html"
            : r.id.includes("/pdf-")
              ? "pdf"
              : "svg")) &&
      (scope.sheet === "packet" ||
        scope.sheet === r.viewScope ||
        scope.sheet === `sheet:${r.sheet}`) &&
      ["pass", "fail", "xfail"].includes(r.status),
  );
function classCheck(entry, kind) {
  assert(
    entry.classification ===
      (kind === "iso-cap-height-policy" ? "policy-gap" : "drawing"),
    "Explicit policy-gap/drawing classification required",
  );
}
function mapped(pair, field, a, b) {
  if (a === b) {
    assert(pair[field] === undefined, `Unused rename mapping: ${field}`);
    return;
  }
  same(
    pair[field],
    { from: a, to: b },
    `Literal ${field} rename mapping required`,
  );
}
function referenceFor(registry, inventory, id, metric) {
  const marker = registry.markers.find((m) => m.id === id);
  assert(marker, "Unknown envelope marker");
  const allowed = new Set(units(marker).map(unitKey));
  const groups = [...inventory.groups.values()].filter(
    (g) => g.markerId === id && allowed.has(unitKey(g.scope)),
  );
  assert(groups.length, "No measured envelope observations");
  if (metric === "occurrences")
    return envelope(groups.map((g) => ({ v: g.occurrences }))).v;
  const value = envelope(groups.flatMap((g) => g.findings.map(measurements)))[
    metric
  ];
  assert(value, `Unknown/unmeasured envelope metric: ${metric}`);
  return canonical(value);
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
  const checked = validateReport(
    report,
    registry,
    registrySha256,
    specs,
    checkerSha256,
  );
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
  const recordReceipt = (entry, r) =>
    receipts.push({
      ...r,
      toolProved: {
        ...(r.measuredScope ? { measuredScope: r.measuredScope } : {}),
        ...(r.moveProofs ? { move: r.moveProofs } : {}),
        ...(r.derived ? { derivedBounds: r.derived } : {}),
        ...(r.crop
          ? {
              cropSha256: r.crop.sha256,
              ...(entry.drawingSha256
                ? { drawingSha256: entry.drawingSha256 }
                : {}),
            }
          : {}),
        ...(r.successor ? { successor: r.successor } : {}),
      },
      reviewerJudged: {
        reviewed: entry.reviewed,
        signOffs: signOffs(entry),
        causeClass: entry.causeClass,
        note: entry.note,
        ...(entry.cause ? { cause: entry.cause } : {}),
        ...(entry.crop
          ? {
              crop: entry.crop,
              ...(entry.drawingSha256
                ? { drawingSha256: entry.drawingSha256 }
                : {}),
            }
          : {}),
        ...(entry.columnMap ? { columnMap: entry.columnMap } : {}),
        ...(entry.sharedSuccessorReason
          ? { sharedSuccessorReason: entry.sharedSuccessorReason }
          : {}),
      },
    });
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
  const ensureTarget = (ref) => {
    keys(ref, ["markerId", "scope"], "target");
    const key = scopeId(ref.markerId, ref.scope),
      g = inventory.groups.get(key);
    assert(g, "Target finding identity/scope not observed");
    const m = original.get(ref.markerId);
    assert(
      !m || !units(m).some((u) => unitKey(u) === unitKey(ref.scope)),
      "Target scope already pinned; use envelope drift for band changes",
    );
    if (!targetWork.has(key)) targetWork.set(key, { g, claims: new Set() });
    return targetWork.get(key);
  };
  for (const file of decisions) {
    keys(
      file,
      [
        "format",
        "pr",
        "summarySha256",
        "registrySha256",
        "checkerSha256",
        "corpusSha256",
        "evalsVersion",
        "baselineSha256",
        "entries",
        "sheetRenames",
        "notMove",
      ],
      "decisions file",
    );
    assert(file.format === DECISIONS_FORMAT, "Unsupported decisions format");
    assert(
      typeof file.pr === "string" && file.pr.trim(),
      "Name the merged PR/lane",
    );
    for (const [k, v] of Object.entries(binding))
      assert(file[k] === v, `Stale decisions binding: ${k}`);
    assert(Array.isArray(file.entries), "Entries must be an array");
    let baseline, oldInventory;
    if (file.baselineSha256 !== undefined) {
      baseline = baselines.get(file.baselineSha256);
      assert(baseline, "Bound baseline bytes/hash not supplied");
      validateReport(baseline, registry, registrySha256, specs);
    }
    const getOld = () => {
      if (oldInventory) return oldInventory;
      assert(
        file.baselineSha256,
        "Rename/instance retirement needs a hash-bound baseline",
      );
      baseline = baselines.get(file.baselineSha256);
      assert(baseline, "Baseline bytes/hash not supplied");
      validateReport(baseline, registry, registrySha256, specs);
      oldInventory = instanceInventory(baseline, file.baselineSha256);
      return oldInventory;
    };
    for (const entry of file.entries) {
      const common = [
        "action",
        "causeClass",
        "note",
        "classification",
        "reviewed",
        "signOff",
        "counterSignOffs",
        ...(entry.crop ? ["drawingSha256"] : []),
      ];
      assert(
        entry.reviewed === true,
        "Unreviewed draft entry; inspect it and set reviewed: true",
      );
      assert(
        typeof entry.causeClass === "string" &&
          entry.causeClass.trim() &&
          typeof entry.note === "string" &&
          entry.note.trim(),
        "Record cause class and review rationale",
      );
      signOffs(entry);
      if (["retire", "rename", "superseded"].includes(entry.action)) {
        const rename = entry.action === "rename",
          superseded = entry.action === "superseded";
        let successor;
        keys(
          entry,
          [
            ...common,
            ...(rename
              ? ["from", "to", "pairs", "crop", "columnMap"]
              : ["markerId", "scope", "cause", "instances"]),
            ...(superseded
              ? ["successor", "survivor", "sharedSuccessorReason"]
              : []),
          ],
          "decision",
        );
        const from = rename
          ? entry.from
          : { markerId: entry.markerId, scope: entry.scope };
        keys(from, ["markerId", "scope"], "source");
        const key = scopeId(from.markerId, from.scope),
          old = original.get(from.markerId),
          row = stale.get(key);
        assert(
          old && row,
          "Retirement/rename source must be a stale measured scope",
        );
        classCheck(entry, old.kind);
        if (!rename && !superseded) {
          assert(
            ["fixed", "removed", "not-measured"].includes(entry.cause),
            "Retirement cause must be fixed, removed or not-measured",
          );
          const isMeasured = measured(
            checked.rows,
            old,
            renamedScope(from.scope, sheetRenames),
          );
          assert(
            entry.cause !== "not-measured" ? isMeasured : !isMeasured,
            "Retirement cause contradicts measurement availability",
          );
        }
        if (superseded) {
          assert(
            measured(checked.rows, old, renamedScope(from.scope, sheetRenames)),
            "Superseded source must be measured; book an unmeasured scope as not-measured",
          );
          const before = getOld(),
            group = before.groups.get(key);
          assert(group, "Baseline has no superseded source instances");
          const source = (entry.instances ?? group.tokens).map((token) => {
            assert(
              group.tokens.includes(token),
              "Unknown superseded source instance",
            );
            return before.byToken.get(token);
          });
          successor = supersededSuccessor(
            file,
            entry,
            source,
            inventory,
            sheetRenames,
            specs,
            original,
          );
        }
        if (
          !rename &&
          (superseded || entry.cause !== "not-measured") &&
          fresh.some(
            (b) =>
              b.scope.case === from.scope.case &&
              b.scope.medium === from.scope.medium &&
              b.facts.kind === old.kind,
          )
        ) {
          const before = getOld(),
            g = before.groups.get(key);
          assert(g, "Baseline has no retirement instances");
          retired.push(
            ...(entry.instances ?? g.tokens).map((t) => {
              const a = before.byToken.get(t);
              assert(a && g.tokens.includes(t), "Unknown retirement instance");
              return a;
            }),
          );
        }
        if (!staleWork.has(key))
          staleWork.set(key, {
            from,
            baseline: undefined,
            claims: new Set(),
            whole: false,
          });
        const work = staleWork.get(key);
        assert(!work.whole, "Conflicting whole-scope retirement");
        if (!rename && !entry.instances) {
          assert(!work.claims.size, "Conflicting retirement/rename decisions");
          work.whole = true;
          recordReceipt(entry, {
            pr: file.pr,
            action: entry.action,
            ...from,
            cause: entry.cause,
            ...(superseded
              ? { successor }
              : { measuredScope: renamedScope(from.scope, sheetRenames) }),
          });
          continue;
        }
        const before = getOld(),
          g = before.groups.get(key);
        assert(g, "Baseline has no source instances");
        if (work.baseline)
          assert(
            work.baseline === file.baselineSha256,
            "Conflicting source baselines",
          );
        work.baseline = file.baselineSha256;
        work.tokens = new Set(g.tokens);
        if (rename) {
          const target = ensureTarget(entry.to);
          assert(
            target.g.identity.kind === old.kind,
            moveError("Rename defect kind changed"),
          );
          assert(
            Array.isArray(entry.pairs) && entry.pairs.length,
            "List individual rename pairs",
          );
          checkColumnMap(entry, before, inventory);
          const moveProofs = [];
          let changedText = false,
            changedHeader = false;
          for (const pair of entry.pairs) {
            keys(
              pair,
              ["from", "to", "sourceLocator", "view", "text"],
              "rename pair",
            );
            const a = before.byToken.get(pair.from),
              b = inventory.byToken.get(pair.to);
            assert(
              a &&
                b &&
                g.tokens.includes(pair.from) &&
                target.g.tokens.includes(pair.to),
              "Rename pair is not in its declared scopes",
            );
            moveProofs.push(
              proveMove(a, b, sheetRenames, specs, entry.columnMap),
            );
            changedText ||= a.facts.text !== b.facts.text;
            changedHeader ||=
              a.facts.text !== b.facts.text &&
              sourceRow(a.facts.sourceLocator)?.kind.startsWith("header/");
            assert(
              a.multiplicity === 1 && b.multiplicity === 1,
              "Compact aggregates need exported instances; cannot prove rename",
            );
            same(
              [a.facts.kind, a.facts.medium, a.facts.case],
              [b.facts.kind, b.facts.medium, b.facts.case],
              "Rename kind/text/medium/case mismatch",
            );
            mapped(pair, "text", a.facts.text, b.facts.text);
            mapped(
              pair,
              "sourceLocator",
              a.facts.sourceLocator,
              b.facts.sourceLocator,
            );
            mapped(pair, "view", a.facts.view, b.facts.view);
            claim(sourceClaims, pair.from, "source instance pair");
            claim(targetClaims, pair.to, "target instance pair");
            work.claims.add(pair.from);
            target.claims.add(pair.to);
          }
          if (changedText) claimCrop(entry.crop);
          else
            assert(
              entry.crop === undefined,
              "Unused crop on an unchanged-text move",
            );
          const id = entry.to.markerId;
          if (!markers.has(id)) {
            const i = target.g.identity,
              m = { ...copy(old), ...i, id, scopes: [] };
            delete m.medium;
            delete m.sheet;
            markers.set(id, m);
            next.markers.push(m);
            definitions.set(id, "rename");
          } else if (!original.has(id)) {
            const m = markers.get(id);
            if (definitions.get(id) === "new-defect") {
              m.bands = copy(old.bands);
              m.count = copy(old.count);
              definitions.set(id, "rename");
            } else {
              same(m.bands, old.bands, "Conflicting renamed marker bands");
              same(m.count, old.count, "Conflicting renamed marker counts");
            }
          }
          recordReceipt(entry, {
            pr: file.pr,
            action: "rename",
            from,
            to: entry.to,
            pairs: entry.pairs.length,
            changedText,
            changedHeader,
            ...(entry.crop ? { crop: entry.crop } : {}),
            ...(entry.columnMap ? { columnMap: entry.columnMap } : {}),
            moveProofs,
          });
        } else {
          assert(
            Array.isArray(entry.instances) && entry.instances.length,
            "Empty instance retirement",
          );
          for (const token of entry.instances) {
            assert(g.tokens.includes(token), "Unknown retirement instance");
            claim(sourceClaims, token, "retirement instance");
            work.claims.add(token);
          }
          recordReceipt(entry, {
            pr: file.pr,
            action: entry.action,
            ...from,
            cause: entry.cause,
            instances: entry.instances.length,
            ...(superseded
              ? { successor }
              : { measuredScope: renamedScope(from.scope, sheetRenames) }),
          });
        }
      } else if (["new-defect", "scope-added"].includes(entry.action)) {
        const addition = entry.action === "scope-added";
        keys(entry, [...common, "to", "instances", "crop"], "decision");
        const target = ensureTarget(entry.to);
        assert(
          addition
            ? original.has(entry.to.markerId)
            : !original.has(entry.to.markerId),
          addition
            ? "Scope addition requires an existing identity"
            : "Existing identity needs scope-added, not new-defect",
        );
        classCheck(entry, target.g.identity.kind);
        if (!addition || entry.crop !== undefined) {
          claimCrop(entry.crop);
        }
        assert(
          Array.isArray(entry.instances) && entry.instances.length,
          "List each new finding instance",
        );
        for (const token of entry.instances) {
          assert(
            target.g.tokens.includes(token),
            "Unknown new-defect instance",
          );
          claim(targetClaims, token, "new-defect instance");
          target.claims.add(token);
        }
        const id = entry.to.markerId;
        if (!markers.has(id)) {
          const i = target.g.identity,
            m = {
              id,
              dq: i.dq,
              family: i.family,
              kind: i.kind,
              locator: i.locator,
              check: i.check,
              coarse: !!i.coarse,
              scopes: [],
              bands: {},
              count: [1, 1],
            };
          markers.set(id, m);
          next.markers.push(m);
          definitions.set(id, "new-defect");
        }
        recordReceipt(entry, {
          pr: file.pr,
          action: entry.action,
          to: entry.to,
          instances: entry.instances.length,
          crop: entry.crop,
        });
      } else if (entry.action === "font-pair-drift") {
        keys(
          entry,
          [...common, "fontPair", "from", "to", "observed", "coverage"],
          "pair decision",
        );
        assert(
          entry.coverage === "full" && entry.classification === "drawing",
          "Full drawing pair decision required",
        );
        claim(pairWork, entry.fontPair, "font-pair decision");
        pairWork.set(entry.fontPair, { entry, pr: file.pr });
      } else if (entry.action === "envelope-drift") {
        keys(
          entry,
          [
            ...common,
            "markerId",
            "metric",
            "from",
            "to",
            "observed",
            "coverage",
          ],
          "decision",
        );
        assert(
          entry.coverage === "full",
          "Partial-scope envelopes cannot replace full references",
        );
        assert(
          !checked.drift.some(
            (d) => d.marker === entry.markerId && d.partialScope,
          ),
          "Partial-scope drift cannot replace full references",
        );
        claim(
          metricWork,
          JSON.stringify([entry.markerId, entry.metric]),
          "envelope metric decision",
        );
        range(entry.to, entry.metric === "occurrences" ? 2 : 4, "new envelope");
        range(entry.observed, 2, "observed envelope");
        if (entry.metric === "occurrences")
          assert(
            entry.to.every(Number.isInteger),
            "Count envelopes use integers",
          );
        recordReceipt(entry, { pr: file.pr, ...entry });
        metricWork.set(JSON.stringify([entry.markerId, entry.metric]), entry);
      } else assert.fail(`Unknown decision action: ${entry.action}`);
    }
  }
  const candidates = moveCandidates(retired, fresh, sheetRenames, specs);
  const notMoves = checkNotMoves(
    candidates,
    decisions.flatMap((f) => f.notMove ?? []),
    claimCrop,
  );
  for (const [key, work] of staleWork) {
    if (!work.whole)
      same(
        [...work.claims].sort(),
        [...work.tokens].sort(),
        "Unlisted source instances remain after rename/retirement",
      );
    const m = markers.get(work.from.markerId);
    m.scopes = compressScopes(
      units(m).filter((u) => unitKey(u) !== unitKey(work.from.scope)),
      specs,
    );
  }
  for (const { g, claims } of targetWork.values()) {
    same(
      [...claims].sort(),
      g.tokens.slice().sort(),
      "Unlisted target finding instances remain",
    );
    const m = markers.get(g.markerId);
    m.scopes = compressScopes([...units(m), g.scope], specs);
  }
  next.markers = next.markers.filter((m) => m.scopes.length);
  for (const [id, how] of definitions)
    if (how === "new-defect") {
      const m = markers.get(id),
        groups = [...inventory.groups.values()].filter(
          (g) =>
            g.markerId === id &&
            units(m).some((u) => unitKey(u) === unitKey(g.scope)),
        );
      m.bands = canonical(
        bands(
          groups.flatMap((g) => g.findings),
          population,
        ),
      );
      const counts = groups.map((g) => g.occurrences);
      m.count = [Math.min(...counts), Math.max(...counts)];
    }
  // Reconcile the explicitly listed scopes before comparing complete envelopes.
  // A moved header can retain its defect while literal body cells disappear.
  const beforePairBands = new Map(
    next.markers.map((m) => [m.id, copy(m.bands)]),
  );
  const resolvedDrift = [
    ...reassess(report, next, specs).drift,
    ...pairDrift(next, inventory),
  ];
  for (const { entry, pr } of pairWork.values()) {
    const pairEvidence = resolvedDrift.filter(
      (d) => d.pairDerived && d.fontPair === entry.fontPair,
    );
    assert(pairEvidence.length, `No pair drift evidence: ${entry.fontPair}`);
    const touched = applyPairDecision(next, inventory, entry, registry);
    same(
      pairEvidence.map((d) => d.marker).sort(),
      touched,
      "Pair drift must cover every touched marker",
    );
    recordReceipt(entry, {
      pr,
      action: "font-pair-drift",
      fontPair: entry.fontPair,
      touched,
      derived: { allowed: entry.to, observed: entry.observed },
    });
  }
  for (const entry of metricWork.values()) {
    assert(
      resolvedDrift.some(
        (d) =>
          d.marker === entry.markerId &&
          d.changes.some((c) => c.metric === entry.metric),
      ),
      `No drift for this marker/metric in the bound report after listed scope changes: ${entry.markerId}/${entry.metric}`,
    );
    const m = markers.get(entry.markerId);
    assert(
      m && next.markers.includes(m),
      "Envelope decision on an unknown/retired marker",
    );
    classCheck(entry, m.kind);
    const prior =
      entry.metric === "occurrences"
        ? m.count
        : beforePairBands.get(m.id)[entry.metric];
    same(entry.from, prior, "Envelope old value mismatch");
    const observed = referenceFor(
      next,
      inventory,
      entry.markerId,
      entry.metric,
    );
    same(
      entry.observed,
      observed,
      "Envelope observation differs from exact reviewed values",
    );
    same(
      entry.metric === "occurrences" ? entry.to : entry.to.slice(1, 3),
      observed,
      "New envelope reference must equal full observed range",
    );
    assert(!equal(entry.from, entry.to), "Unused unchanged envelope decision");
    if (entry.metric === "occurrences") m.count = copy(entry.to);
    else {
      const observedFindings = [...inventory.groups.values()]
        .filter(
          (g) =>
            g.markerId === m.id &&
            units(m).some((u) => unitKey(u) === unitKey(g.scope)),
        )
        .flatMap((g) => g.findings);
      const derived = canonical(
        bands(observedFindings, population)[entry.metric],
      );
      same(
        entry.to,
        derived,
        "Allowed bounds must equal the measured range plus documented tolerance",
      );
      m.bands = { ...m.bands, [entry.metric]: copy(entry.to) };
    }
  }
  assertPairBounds(next, inventory);
  for (const r of receipts.filter((r) => r.action === "envelope-drift"))
    r.toolProved.derivedBounds = {
      metric: r.metric,
      allowed: r.to,
      observed: r.observed,
    };
  next.markers.sort((a, b) => a.id.localeCompare(b.id));
  const projected = reassess(report, next, specs);
  assert(
    projected.exitCode === 0,
    `Unlisted findings/scopes remain: ${projected.rows
      .filter((r) => ["fail", "xpass"].includes(r.status))
      .map((r) => r.id)
      .join(", ")}`,
  );
  assert(
    !projected.drift.length,
    `Unlisted or incompletely reconciled envelope drift remains: ${projected.drift.map((d) => `${d.marker}: ${d.changes.map((c) => c.metric).join(", ")}`).join("; ")}`,
  );
  receipts.sort((a, b) => (json(a) < json(b) ? -1 : json(a) > json(b) ? 1 : 0));
  return {
    registry: next,
    receipts,
    expected: {
      exitCode: 0,
      drift: [],
      summary: projected.summary,
      policy: projected.rows
        .filter((r) => r.classification === "policy-gap")
        .map((r) => ({ id: r.id, status: r.status })),
      notMeasuredRetirements: receipts.filter(
        (r) => r.action === "retire" && r.cause === "not-measured",
      ).length,
      outcomes: {
        superseded: receipts.filter((r) => r.action === "superseded").length,
        supersededSurvivors: receipts.filter(
          (r) => r.action === "superseded" && r.successor?.form === "survivor",
        ).length,
        notMove: notMoves.length,
        fixes: receipts.filter(
          (r) => r.action === "retire" && r.cause === "fixed",
        ).length,
        moves: receipts.filter((r) => r.action === "rename").length,
        additions: receipts.filter((r) => r.action === "scope-added").length,
        newDefects: receipts.filter((r) => r.action === "new-defect").length,
        removals: receipts.filter(
          (r) => r.action === "retire" && r.cause === "removed",
        ).length,
        notMeasured: receipts.filter(
          (r) => r.action === "retire" && r.cause === "not-measured",
        ).length,
        changedHeaderMoves: receipts.filter(
          (r) => r.action === "rename" && r.changedHeader,
        ).length,
      },
      toolProved: {
        reportSha256,
        registrySha256,
        checkerSha256,
        sourceInstances: sourceClaims.size,
        targetInstances: targetClaims.size,
        fontPairs: fontPairs(next, inventory),
      },
      reviewerJudged: {
        signOff:
          "reviewed:true signs off crops and causes; each recorded sign-off kind identifies agent review or person review; identity and independence are not tool-proved",
        causesAndCrops: receipts.length,
        notMove: notMoves,
        scoreCredit: 0,
      },
    },
  };
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
  const checked = validateReport(
    report,
    registry,
    registrySha256,
    specs,
    checkerSha256,
  );
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
      validateReport(r, registry, registrySha256, specs);
      return { sha256: sha, instances: instanceInventory(r, sha).instances };
    }),
  };
}
