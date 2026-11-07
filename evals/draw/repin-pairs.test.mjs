import { it, expect } from "vitest";
import {
  prepareRepin,
  reassess,
  reviewInventory,
  instanceInventory,
} from "./repin-core.mjs";
import { draftDecisions } from "./repin-draft.mjs";
import { markerId } from "./locators.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
import { expandRegistry } from "./marker-data.mjs";
import { checkerManifestHash } from "./checker-manifest.mjs";
import { hash, json } from "./support.mjs";
const cid = "pair-left-to-right",
  view = "view:io/I/O",
  fontPair = "Arial/NotoSans",
  specs = [{ id: cid, flow: "left-to-right" }];
function fixture(fresh = false) {
  const identity = (n) => ({
    dq: "DQ-21",
    family: "font-metrics",
    kind: "pdf-svg-advance-difference",
    locator: `font-pair/${fontPair}/io/${n}`,
    check: "sheet",
    coarse: false,
    sheet: view,
    medium: "svg",
  });
  const ids = ["A", "B"].map(identity);
  const reg = {
    format: "thermite-draw-expectations/2.0",
    markers: ids.map((i) => ({
      ...i,
      id: markerId(i),
      scopes: [{ cases: [cid], sheets: [view], media: ["svg"] }],
      count: [1, 1],
      bands: { advanceRatio: [0.95, 1, 1, 1.35] },
    })),
  };
  for (const m of reg.markers) {
    delete m.sheet;
    delete m.medium;
  }
  const source = serializeRegistry(reg)
    .replace(/^import .*;\n/m, "")
    .replace("export const expectations =", "return");
  const registry = new Function("expandRegistry", source)(expandRegistry),
    registrySha256 = hash(serializeRegistry(registry));
  const rows = Array.from({ length: 24 }, (_, n) => ({
    id: `pair/DQ-${n + 1}`,
    case: cid,
    dq: `DQ-${String(n + 1).padStart(2, "0")}`,
    check: "sheet",
    sheet: 1,
    viewScope: view,
    medium: "svg",
    status: "pass",
    evidence: { findings: [] },
  }));
  for (const [n, i] of [...ids, ...(fresh ? [identity("New")] : [])].entries())
    rows.push({
      id: `pair/item-${n}`,
      case: cid,
      dq: "DQ-21",
      check: "sheet",
      sheet: 1,
      viewScope: view,
      medium: "svg",
      status: "fail",
      evidence: {
        findings: [
          {
            kind: i.kind,
            fontPair,
            advanceRatio: n === 2 ? 1.1 : 1,
            sourceLocator: `header/io/${n}`,
            text: String(n),
            identities: [i],
          },
        ],
      },
    });
  const checkers = { "expectations.mjs": registrySha256 },
    report = {
      format: "thermite-draw-eval/1.0",
      mode: "strict",
      subset: "full",
      cases: [cid],
      corpusSha256: "seal",
      evalsVersion: "4.2",
      checkers,
      checkerSha256: checkerManifestHash(checkers),
      results: rows,
    };
  Object.assign(
    report,
    ((a) => ({
      results: a.rows,
      summary: a.summary,
      drift: a.drift,
      exitCode: a.exitCode,
    }))(reassess(report, registry, specs)),
  );
  const reportSha256 = hash(json(report)),
    inv = instanceInventory(report, reportSha256);
  const common = {
    reviewed: true,
    signOff: {
      kind: "agent",
      by: "Synthetic reviewer fixture (not an approval)",
    },
    causeClass: "pair-range",
    note: "Reviewed changed pair population",
    classification: "drawing",
    coverage: "full",
  };
  const decision = {
    ...common,
    action: "font-pair-drift",
    fontPair,
    from: [[0.95, 1.35]],
    to: [0.95, fresh ? 1.15 : 1.05],
    observed: [1, fresh ? 1.1 : 1],
  };
  const entries = [decision],
    cropHashes = new Map();
  if (fresh) {
    const g = [...inv.groups.values()].find(
      (g) => !registry.markers.some((m) => m.id === g.markerId),
    );
    const crop = {
      path: "evals/out/draw-samples/pair/new.png",
      sha256: hash("pair-crop"),
    };
    cropHashes.set(crop.path, crop.sha256);
    entries.push({
      ...common,
      action: "new-defect",
      to: { markerId: g.markerId, scope: g.scope },
      instances: g.tokens,
      crop,
    });
    delete entries[1].coverage;
  }
  return {
    report,
    reportSha256,
    registry,
    registrySha256,
    checkerSha256: report.checkerSha256,
    specs,
    cropHashes,
    decisions: [
      {
        format: "thermite-draw-decisions/1.0",
        pr: "#pair",
        summarySha256: reportSha256,
        registrySha256,
        checkerSha256: report.checkerSha256,
        corpusSha256: "seal",
        evalsVersion: "4.2",
        entries,
      },
    ],
  };
}
it("pair-range change puts every member in inventory drift even when local references are unchanged", () => {
  const c = fixture(),
    i = reviewInventory(c);
  expect(c.report.drift).toEqual([]);
  expect(i.drift.map((d) => d.marker).sort()).toEqual(
    c.registry.markers.map((m) => m.id).sort(),
  );
  expect(
    i.drift.every((d) => d.changes[0].metric === "advanceRatioBounds"),
  ).toBe(true);
  const draft = draftDecisions(i, { pr: "#pair" });
  expect(
    draft.entries.filter((e) => e.action === "font-pair-drift"),
  ).toHaveLength(1);
  expect(draft.entries.every((e) => e.reviewed === false)).toBe(true);
});
it("one pair decision expands copy-on-write with each member in the receipt", () => {
  const c = fixture(),
    before = json(c.registry);
  expect(c.registry.markers[0].bands).toBe(c.registry.markers[1].bands);
  const result = prepareRepin(c);
  expect(json(c.registry)).toBe(before);
  expect(result.registry.markers.map((m) => m.bands.advanceRatio)).toEqual([
    [0.95, 1, 1, 1.05],
    [0.95, 1, 1, 1.05],
  ]);
  expect(result.registry.markers[0].bands).not.toBe(
    result.registry.markers[1].bands,
  );
  expect(result.receipts[0].touched.sort()).toEqual(
    c.registry.markers.map((m) => m.id).sort(),
  );
});
it("refuses an unlisted pair range change instead of leaving stale or mixed bounds", () => {
  const c = fixture();
  c.decisions[0].entries = [];
  expect(() => prepareRepin(c)).toThrow(/Inconsistent font-pair advanceRatio/);
});
it.each(["from", "to", "observed"])("refuses non-derived pair %s", (key) => {
  const c = fixture();
  c.decisions[0].entries[0][key] = key === "from" ? [[0, 99]] : [0, 99];
  expect(() => prepareRepin(c)).toThrow(/full measured range/);
});
it("refuses conflicting pair decisions across files", () => {
  const c = fixture();
  c.decisions.push(structuredClone(c.decisions[0]));
  c.decisions[1].pr = "#other";
  expect(() => prepareRepin(c)).toThrow(/Conflicting.*font-pair/);
});
it("new-identity bounds use the complete pair population, not its own value", () => {
  const c = fixture(true),
    r = prepareRepin(c),
    m = r.registry.markers.find(
      (m) => !c.registry.markers.some((o) => o.id === m.id),
    );
  expect(m.bands.advanceRatio).toEqual([0.95, 1.1, 1.1, 1.15]);
  expect(
    r.receipts.find((r) => r.action === "font-pair-drift").touched,
  ).toHaveLength(3);
});
it("refuses an undrifted pair decision", () => {
  const c = fixture();
  for (const m of c.registry.markers)
    m.bands = { advanceRatio: [0.95, 1, 1, 1.05] };
  c.registrySha256 = hash(serializeRegistry(c.registry));
  c.report.checkers["expectations.mjs"] = c.registrySha256;
  c.report.checkerSha256 = checkerManifestHash(c.report.checkers);
  c.checkerSha256 = c.report.checkerSha256;
  c.reportSha256 = hash(json(c.report));
  Object.assign(c.decisions[0], {
    summarySha256: c.reportSha256,
    registrySha256: c.registrySha256,
    checkerSha256: c.checkerSha256,
  });
  expect(() => prepareRepin(c)).toThrow(/No pair drift/);
});
it("new identities cannot use per-marker bounds even when no pair decision is needed", () => {
  const c = fixture(true);
  for (const m of c.registry.markers)
    m.bands = { advanceRatio: [0.95, 1, 1, 1.15] };
  c.registrySha256 = hash(serializeRegistry(c.registry));
  c.report.checkers["expectations.mjs"] = c.registrySha256;
  c.report.checkerSha256 = checkerManifestHash(c.report.checkers);
  c.checkerSha256 = c.report.checkerSha256;
  const a = reassess(c.report, c.registry, specs);
  Object.assign(c.report, {
    results: a.rows,
    drift: a.drift,
    summary: a.summary,
    exitCode: a.exitCode,
  });
  c.reportSha256 = hash(json(c.report));
  const f = c.decisions[0];
  Object.assign(f, {
    summarySha256: c.reportSha256,
    registrySha256: c.registrySha256,
    checkerSha256: c.checkerSha256,
  });
  f.entries.shift();
  f.entries[0].instances = instanceInventory(c.report, c.reportSha256)
    .instances.filter((i) => i.markerId === f.entries[0].to.markerId)
    .map((i) => i.token);
  const r = prepareRepin(c);
  expect(
    r.registry.markers.find((m) => m.id === f.entries[0].to.markerId).bands
      .advanceRatio,
  ).toEqual([0.95, 1.1, 1.1, 1.15]);
});
it("local reference decisions bind the pre-pair band while the pair decision changes allowed bounds", () => {
  const c = fixture();
  const f = c.report.results.find((r) => r.id === "pair/item-0").evidence
    .findings[0];
  f.advanceRatio = 1.02;
  const a = reassess(c.report, c.registry, specs);
  Object.assign(c.report, {
    results: a.rows,
    drift: a.drift,
    summary: a.summary,
    exitCode: a.exitCode,
  });
  c.reportSha256 = hash(json(c.report));
  c.decisions[0].summarySha256 = c.reportSha256;
  Object.assign(c.decisions[0].entries[0], {
    to: [0.95, 1.07],
    observed: [1, 1.02],
  });
  c.decisions[0].entries.push({
    action: "envelope-drift",
    markerId: markerId(f.identities[0]),
    metric: "advanceRatio",
    from: [0.95, 1, 1, 1.35],
    to: [0.95, 1.02, 1.02, 1.07],
    observed: [1.02, 1.02],
    coverage: "full",
    reviewed: true,
    signOff: {
      kind: "agent",
      by: "Synthetic reviewer fixture (not an approval)",
    },
    causeClass: "reference-drift",
    classification: "drawing",
    note: "Same pair, changed local reference",
  });
  expect(prepareRepin(c).expected.exitCode).toBe(0);
});

it("inventory envelopes retain whole-pair bounds for every individual marker", () => {
  const i = reviewInventory(fixture(true));
  expect(i.envelopes).toHaveLength(3);
  for (const e of i.envelopes)
    expect([e.bands.advanceRatio[0], e.bands.advanceRatio[3]]).toEqual([
      0.95, 1.15,
    ]);
});
