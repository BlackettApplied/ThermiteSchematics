// Synthetic report/instance fixtures, adapted from the independent reviewer probes.
import { prepareRepin, reassess, instanceInventory } from "./repin-core.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
import { markerId } from "./locators.mjs";
import { hash, json } from "./support.mjs";
export const A = "probe-left-to-right",
  B = "probe-right-to-left";
const allSpecs = [
  { id: A, flow: "left-to-right" },
  { id: B, flow: "right-to-left" },
];
export const view = "view:io/I/O",
  view2 = "view:io/Next",
  gone = "view:io/Gone";
export const base = {
  reviewed: true,
  signOff: { kind: "agent", by: "Reviewer probe" },
  causeClass: "probe",
  note: "Reviewer probe",
  classification: "drawing",
};
export const it0 = (name, o = {}) => ({
  name,
  case: A,
  medium: "svg",
  sheet: view,
  kind: "printed-function-key",
  dq: "DQ-05",
  check: "sheet",
  text: "K1",
  src: "device/" + name + "/text",
  ...o,
});
const ident = (i) => ({
  dq: i.dq,
  family: "fixture",
  kind: i.kind,
  locator: "device/" + i.name,
  check: i.check,
  coarse: false,
  sheet: i.sheet,
  medium: i.medium,
});
export const mid = (i) => markerId(ident(i));
function make({
  registryItems,
  baselineItems,
  currentItems,
  measuredViews = [view, view2],
  cases = [A],
  media = ["svg"],
}) {
  const byMarker = new Map();
  for (const i of registryItems) {
    const id = mid(i);
    if (!byMarker.has(id))
      byMarker.set(id, {
        id,
        dq: i.dq,
        family: "fixture",
        kind: i.kind,
        locator: "device/" + i.name,
        check: i.check,
        coarse: false,
        scopes: [],
        bands: {},
        count: [1, 1],
      });
    const m = byMarker.get(id);
    const sc = { cases: [i.case], sheets: [i.sheet], media: [i.medium] };
    if (!m.scopes.some((s) => JSON.stringify(s) === JSON.stringify(sc)))
      m.scopes.push(sc);
    const n = registryItems.filter(
      (x) =>
        mid(x) === id &&
        x.sheet === i.sheet &&
        x.case === i.case &&
        x.medium === i.medium,
    ).length;
    m.count = [Math.min(m.count[0], n) || n, Math.max(m.count[1], n)];
  }
  const registry = {
      format: "thermite-draw-expectations/2.0",
      markers: [...byMarker.values()],
    },
    registrySha256 = hash(serializeRegistry(registry));
  const report = (items) => {
    const rows = [];
    for (const c of cases)
      for (const m of media)
        for (const v of measuredViews)
          for (let n = 1; n <= 24; n++)
            rows.push({
              id: `p/${c}/${m}/${v}/DQ-${n}`,
              case: c,
              dq: `DQ-${String(n).padStart(2, "0")}`,
              check: "sheet",
              sheet: 1,
              viewScope: v,
              medium: m,
              status: "pass",
              evidence: { findings: [] },
            });
    if (
      [...registryItems, ...currentItems].some(
        (i) => i.kind === "iso-cap-height-policy",
      )
    )
      for (const c of cases)
        for (const m of media)
          for (const v of measuredViews)
            rows.push({
              id: `p/${c}/${m}/${v}/iso`,
              case: c,
              dq: "DQ-02",
              check: "iso-cap-height-policy",
              sheet: 1,
              viewScope: v,
              medium: m,
              status: "pass",
              classification: "policy-gap",
              evidence: { findings: [] },
            });
    const groups = new Map();
    items.forEach((i) => {
      const k = JSON.stringify([i.case, i.medium, i.sheet, i.dq]);
      (groups.get(k) ?? groups.set(k, []).get(k)).push(i);
    });
    let n = 0;
    for (const list of groups.values()) {
      const i = list[0];
      rows.push({
        id: `p/item-${n++}`,
        case: i.case,
        dq: i.dq,
        check: i.check,
        sheet: 1,
        viewScope: i.sheet,
        medium: i.medium,
        status: "fail",
        ...(i.kind === "iso-cap-height-policy"
          ? { classification: "policy-gap" }
          : {}),
        evidence: {
          findings: list.map((x) => ({
            kind: x.kind,
            text: x.text,
            ...(x.kind === "iso-cap-height-policy" ? { capHeightMm: 1.8 } : {}),
            sourceLocator: x.src,
            identities: [ident(x)],
          })),
        },
      });
    }
    const checkers = { "expectations.mjs": registrySha256 };
    return (
      checkers,
      {
        format: "thermite-draw-eval/1.0",
        mode: "strict",
        subset: "full",
        cases,
        corpusSha256: "seal",
        evalsVersion: "4.2",
        checkers,
        checkerSha256: null,
        results: rows,
      }
    );
  };
  return { registry, registrySha256, report, baselineItems, currentItems };
}
import { checkerManifestHash } from "./checker-manifest.mjs";
export function assemble({
  registryItems,
  baselineItems = registryItems,
  currentItems,
  measuredViews,
  cases = [A],
  media,
  entries,
  sheetRenames,
  extraFile,
  notMove,
}) {
  const specs = allSpecs.filter((s) => cases.includes(s.id));
  const m = make({
    registryItems,
    baselineItems,
    currentItems,
    measuredViews,
    cases,
    media,
  });
  const finish = (items) => {
    const r = m.report(items);
    r.checkerSha256 = checkerManifestHash(r.checkers);
    const a = reassess(r, m.registry, specs);
    return {
      ...r,
      results: a.rows,
      summary: a.summary,
      drift: a.drift,
      exitCode: a.exitCode,
    };
  };
  const baseline = finish(baselineItems),
    current = finish(currentItems);
  const baselineSha256 = hash(json(baseline)),
    reportSha256 = hash(json(current));
  const inv = instanceInventory(current, reportSha256);
  const before = instanceInventory(baseline, baselineSha256);
  const cropHashes = new Map();
  let cropN = 0;
  const ref = (i) => {
    const g = [...inv.groups.values()].find(
      (g) =>
        g.markerId === mid(i) &&
        g.scope.sheet === i.sheet &&
        g.scope.case === i.case &&
        g.scope.medium === i.medium,
    );
    if (!g) throw new Error("no group for " + i.name);
    return g;
  };
  const crop = () => {
    const c = {
      path: `evals/out/draw-samples/p/${++cropN}.png`,
      sha256: hash("crop" + cropN),
    };
    cropHashes.set(c.path, c.sha256);
    return c;
  };
  const add = (i) => {
    const g = ref(i);
    return {
      ...base,
      classification:
        i.kind === "iso-cap-height-policy" ? "policy-gap" : "drawing",
      action: "new-defect",
      to: { markerId: g.markerId, scope: g.scope },
      instances: g.tokens,
      crop: crop(),
    };
  };
  const scopeAdd = (i) => {
    const g = ref(i);
    return {
      ...base,
      classification:
        i.kind === "iso-cap-height-policy" ? "policy-gap" : "drawing",
      action: "scope-added",
      to: { markerId: g.markerId, scope: g.scope },
      instances: g.tokens,
    };
  };
  const src = (i, extra) => ({
    ...base,
    classification:
      i.kind === "iso-cap-height-policy" ? "policy-gap" : "drawing",
    markerId: mid(i),
    scope: { case: i.case, sheet: i.sheet, medium: i.medium },
    ...extra,
  });
  const sup = (i, successor, extra = {}) =>
    src(i, {
      action: "superseded",
      cause: "Identity re-keyed; the defect persists",
      successor,
      ...extra,
    });
  const retire = (i, cause, extra = {}) =>
    src(i, { action: "retire", cause, ...extra });
  const es = entries({ add, scopeAdd, sup, retire, crop, ref, before, inv });
  const file = {
    format: "thermite-draw-decisions/1.0",
    pr: "#probe",
    summarySha256: reportSha256,
    registrySha256: m.registrySha256,
    checkerSha256: current.checkerSha256,
    corpusSha256: "seal",
    evalsVersion: "4.2",
    baselineSha256,
    entries: es,
    ...(sheetRenames ? { sheetRenames } : {}),
    ...(notMove ? { notMove: notMove({ crop, baseline, inv }) } : {}),
  };
  return {
    registry: m.registry,
    registrySha256: m.registrySha256,
    report: current,
    reportSha256,
    checkerSha256: current.checkerSha256,
    specs,
    decisions: [file],
    baselines: new Map([[baselineSha256, baseline]]),
    cropHashes,
    before,
    inv,
  };
}
