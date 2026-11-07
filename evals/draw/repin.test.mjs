import { it, expect } from "vitest";
import { checkerManifestHash } from "./checker-manifest.mjs";
import { readCheckers } from "./checker-manifest.mjs";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash, json } from "./support.mjs";
import { markerId } from "./locators.mjs";
import { units } from "./marker-scopes.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
import {
  DECISIONS_FORMAT,
  prepareRepin,
  instanceInventory,
  reassess,
  reviewInventory,
} from "./repin-core.mjs";
import {
  strictJsonBytes,
  strictJsonFile,
  reviewedCrop,
  loadRepinInputs,
  executeRepin,
  writeDraft,
} from "./repin-io.mjs";

import { drawingHash } from "./png-ink.mjs";
import { pngFixture } from "./png-fixture.mjs";
const specs = [{ id: "fixture-left-to-right", flow: "left-to-right" }];
const cid = specs[0].id,
  oldView = "view:io/PLC I/O schedule",
  newView = "view:io/I/O schedule";
const scope = (sheet = oldView, medium = "svg") => ({
  case: cid,
  sheet,
  medium,
});
const identity = (kind, locator, dq = "DQ-05", sheet = oldView) => ({
  dq,
  family: "fixture",
  kind,
  locator,
  check: "sheet",
  coarse: false,
  sheet,
  medium: "svg",
});
const marker = (i, extra = {}) => ({
  id: markerId(i),
  dq: i.dq,
  family: i.family,
  kind: i.kind,
  locator: i.locator,
  check: i.check,
  coarse: false,
  scopes: [{ cases: [cid], sheets: [i.sheet], media: [i.medium] }],
  bands: {},
  count: [1, 1],
  ...extra,
});
const finding = (i, text = "K1", extra = {}) => ({
  kind: i.kind,
  text,
  designation: text,
  element: "text-1",
  bbox: { x: 20, y: 40, w: 5, h: 2 },
  sourceLocator: "device/K1/text",
  identities: [i],
  ...extra,
});
function makeReport(registry, items, registrySha256) {
  const rows = Array.from({ length: 24 }, (_, i) => ({
    id: `${cid}/DQ-${String(i + 1).padStart(2, "0")}/sheet-1`,
    case: cid,
    dq: `DQ-${String(i + 1).padStart(2, "0")}`,
    sheet: 1,
    medium: "svg",
    viewScope: oldView,
    check: "sheet",
    status: "pass",
    evidence: { findings: [] },
  }));
  for (const [index, f] of items.entries())
    rows.push({
      id: `${cid}/${f.identities[0].dq}/item-${index}`,
      case: cid,
      dq: f.identities[0].dq,
      sheet: 1,
      medium: f.identities[0].medium,
      viewScope: f.identities[0].sheet,
      check: f.identities[0].check,
      status: "fail",
      ...(f.kind === "iso-cap-height-policy"
        ? { classification: "policy-gap" }
        : {}),
      evidence: { findings: [f] },
    });
  const report = {
    format: "thermite-draw-eval/1.0",
    mode: "strict",
    subset: "full",
    cases: [cid],
    corpusSha256: "seal-1",
    evalsVersion: "4.2",
    checkers: { "expectations.mjs": registrySha256 },
    results: rows,
  };
  report.checkerSha256 = checkerManifestHash(report.checkers);
  const a = reassess(report, registry, specs);
  return {
    ...report,
    results: a.rows,
    drift: a.drift,
    summary: a.summary,
    exitCode: a.exitCode,
  };
}
function fixture() {
  const a = identity("printed-function-key", "device/K1/text"),
    b = identity("printed-function-key", "device/K2/text"),
    d = identity(
      "pdf-svg-advance-difference",
      "font-pair/report/column",
      "DQ-21",
    );
  const policy = {
    ...identity("iso-cap-height-policy", "policy/Arial/svg", "DQ-02", "packet"),
    check: "iso-cap-height-policy",
    family: "font-policy",
  };
  const registry = {
    format: "thermite-draw-expectations/2.0",
    markers: [
      marker(a),
      marker(b),
      marker(d, { bands: { advanceRatio: [0.75, 1.2, 1.2, 1.35] } }),
      marker(policy, {
        count: [3, 3],
        bands: { capHeightMm: [0, 1.8, 1.8, 2.47] },
      }),
    ],
  };
  const registrySha256 = hash(serializeRegistry(registry));
  const old = makeReport(
    registry,
    [
      finding(a),
      finding(b, "K2"),
      finding(d, "ABC", { advanceRatio: 1.2 }),
      finding(policy, "H", { capHeightMm: 1.8, instanceCount: 3 }),
    ],
    registrySha256,
  );
  // No ordinary old-view row for DQ-05: a removed view is not a fixed defect.
  const moved = { ...a, sheet: newView },
    fresh = identity(
      "ambiguous-wire-label",
      "conductor/W9/text",
      "DQ-16",
      newView,
    );
  const current = makeReport(
    registry,
    [
      finding(moved),
      finding(fresh, "W9", { ownDistanceMm: 5 }),
      finding(d, "ABC", {
        advanceRatio: 1.25,
        instances: [
          {
            element: "a",
            text: "ABC",
            sourceLocator: "cell/a",
            advanceRatio: 1.25,
          },
          {
            element: "b",
            text: "DEF",
            sourceLocator: "cell/b",
            advanceRatio: 1.25,
          },
        ],
      }),
      finding(policy, "H", { capHeightMm: 1.8, instanceCount: 4 }),
    ],
    registrySha256,
  );
  const reportSha256 = hash(json(current)),
    baselineSha256 = hash(json(old)),
    before = instanceInventory(old, baselineSha256),
    after = instanceInventory(current, reportSha256);
  const oldToken = before.instances.find(
      (t) => t.markerId === markerId(a),
    ).token,
    newToken = after.instances.find(
      (t) => t.markerId === markerId(moved),
    ).token,
    freshTokens = after.instances
      .filter((t) => t.markerId === markerId(fresh))
      .map((t) => t.token);
  const crop = {
    path: "evals/out/draw-samples/review/crop.png",
    sha256: hash("crop"),
  };
  const entries = [
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "retire",
      markerId: markerId(b),
      scope: scope(),
      cause: "fixed",
      causeClass: "fixed-tag",
      note: "K2 no longer leaks a key",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "rename",
      from: { markerId: markerId(a), scope: scope() },
      to: { markerId: markerId(moved), scope: scope(newView) },
      pairs: [
        { from: oldToken, to: newToken, view: { from: oldView, to: newView } },
      ],
      causeClass: "report-title-rename",
      note: "Same instance, renamed view",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "new-defect",
      to: { markerId: markerId(fresh), scope: scope(newView) },
      instances: freshTokens,
      crop,
      causeClass: "new-wire-offset",
      note: "Reviewed real stroke gap",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "envelope-drift",
      markerId: markerId(d),
      metric: "advanceRatio",
      from: [0.75, 1.2, 1.2, 1.35],
      to: [1.2, 1.25, 1.25, 1.3],
      observed: [1.25, 1.25],
      coverage: "full",
      causeClass: "report-text-envelope",
      note: "Full measured range",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "envelope-drift",
      markerId: markerId(d),
      metric: "occurrences",
      from: [1, 1],
      to: [2, 2],
      observed: [2, 2],
      coverage: "full",
      causeClass: "report-text-envelope",
      note: "Both retained texts",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "envelope-drift",
      markerId: markerId(policy),
      metric: "occurrences",
      from: [3, 3],
      to: [4, 4],
      observed: [4, 4],
      coverage: "full",
      causeClass: "policy-count-drift",
      note: "Unchanged ISO policy, new count",
      classification: "policy-gap",
    },
  ];
  for (const e of entries) e.reviewed = true;
  const file = {
    format: DECISIONS_FORMAT,
    pr: "#fixture",
    summarySha256: reportSha256,
    registrySha256,
    checkerSha256: current.checkerSha256,
    corpusSha256: current.corpusSha256,
    evalsVersion: current.evalsVersion,
    baselineSha256,
    entries,
  };
  return {
    report: current,
    reportSha256,
    checkerSha256: current.checkerSha256,
    registry,
    registrySha256,
    decisions: [file],
    baselines: new Map([[baselineSha256, old]]),
    cropHashes: new Map([[crop.path, crop.sha256]]),
    specs,
    ids: {
      a: markerId(a),
      b: markerId(b),
      d: markerId(d),
      fresh: markerId(fresh),
      policy: markerId(policy),
    },
    before,
    after,
  };
}
it("applies a mixed delta without re-seeding unlisted marker fields", () => {
  const c = fixture(),
    before = json(c.registry),
    result = prepareRepin(c);
  expect(result.expected.exitCode).toBe(0);
  expect(result.expected.notMeasuredRetirements).toBe(0);
  expect(result.expected.drift).toEqual([]);
  expect(json(c.registry)).toBe(before);
  expect(result.registry.markers.find((m) => m.id === c.ids.b)).toBeUndefined();
  expect(units(result.registry.markers.find((m) => m.id === c.ids.a))).toEqual([
    scope(newView),
  ]);
  expect(
    result.registry.markers.find((m) => m.id === c.ids.d).bands.advanceRatio,
  ).toEqual([1.2, 1.25, 1.25, 1.3]);
});
it("merges disjoint lane files independently of file/entry order", () => {
  const c = fixture(),
    file = c.decisions[0];
  const a = { ...file, pr: "#one", entries: file.entries.slice(0, 3) },
    b = { ...file, pr: "#two", entries: file.entries.slice(3) };
  const x = prepareRepin({ ...c, decisions: [a, b] }),
    y = prepareRepin({ ...c, decisions: [b, a] });
  expect(serializeRegistry(x.registry)).toBe(serializeRegistry(y.registry));
});
const refusals = {
  "stale report hash": (c) => (c.decisions[0].summarySha256 = "wrong"),
  "stale registry hash": (c) => (c.decisions[0].registrySha256 = "wrong"),
  "stale corpus seal": (c) => (c.decisions[0].corpusSha256 = "wrong"),
  "stale evals version": (c) => (c.decisions[0].evalsVersion = "wrong"),
  "unsupported decisions format": (c) => (c.decisions[0].format = "old"),
  "unknown schema fields": (c) => (c.decisions[0].unreviewed = true),
  "missing cause": (c) => (c.decisions[0].entries[0].causeClass = ""),
  "missing rationale": (c) => (c.decisions[0].entries[0].note = ""),
  "unknown action": (c) => (c.decisions[0].entries[0].action = "regenerate"),
  "quick report": (c) => (c.report.subset = "quick"),
  "report-only replay": (c) => (c.report.mode = "replay"),
  "missing case": (c) => (c.report.cases = []),
  "missing check observation": (c) =>
    (c.report.results = c.report.results.filter((r) => r.dq !== "DQ-04")),
  "infrastructure error": (c) =>
    c.report.results.push({ id: "infra", status: "infrastructure-error" }),
  "stale report registry": (c) =>
    (c.report.checkers["expectations.mjs"] = "wrong"),
  "forged status": (c) => (c.report.results[0].status = "fail"),
  "unlisted finding": (c) => c.decisions[0].entries.splice(2, 1),
  "unlisted retirement": (c) => c.decisions[0].entries.splice(0, 1),
  "unlisted count drift": (c) => c.decisions[0].entries.splice(4, 1),
  "unlisted policy drift": (c) => c.decisions[0].entries.splice(5, 1),
  "wrong measured retirement cause": (c) =>
    (c.decisions[0].entries[0].cause = "not-measured"),
  "unknown retirement cause": (c) =>
    (c.decisions[0].entries[0].cause = "maybe"),
  "duplicate whole retirement": (c) =>
    c.decisions[0].entries.push(c.decisions[0].entries[0]),
  "missing baseline": (c) => c.baselines.clear(),
  "missing baseline hash": (c) => delete c.decisions[0].baselineSha256,
  "stale baseline registry": (c) =>
    (c.baselines.values().next().value.checkers["expectations.mjs"] = "wrong"),
  "unknown rename token": (c) =>
    (c.decisions[0].entries[1].pairs[0].from = "wrong"),
  "duplicate instance pair": (c) =>
    c.decisions[0].entries[1].pairs.push(c.decisions[0].entries[1].pairs[0]),
  "one-to-many source reuse": (c) =>
    c.decisions[0].entries[1].pairs.push({
      ...c.decisions[0].entries[1].pairs[0],
      to: c.decisions[0].entries[2].instances[0],
    }),
  "missing literal view mapping": (c) =>
    delete c.decisions[0].entries[1].pairs[0].view,
  "wrong literal view mapping": (c) =>
    (c.decisions[0].entries[1].pairs[0].view.to = "wrong"),
  "unused literal mapping": (c) =>
    (c.decisions[0].entries[1].pairs[0].sourceLocator = {
      from: "device/K1/text",
      to: "device/K1/text",
    }),
  "empty pairs": (c) => (c.decisions[0].entries[1].pairs = []),
  "missing crop": (c) => c.cropHashes.clear(),
  "wrong crop hash": (c) => (c.decisions[0].entries[2].crop.sha256 = "wrong"),
  "empty new instances": (c) => (c.decisions[0].entries[2].instances = []),
  "duplicate new instance": (c) =>
    c.decisions[0].entries[2].instances.push(
      c.decisions[0].entries[2].instances[0],
    ),
  "unknown new instance": (c) =>
    (c.decisions[0].entries[2].instances[0] = "wrong"),
  "old envelope mismatch": (c) => (c.decisions[0].entries[3].from[1] = 1.1),
  "new reference differs from observed": (c) =>
    (c.decisions[0].entries[3].to[1] = 1.24),
  "claimed observed values differ": (c) =>
    (c.decisions[0].entries[3].observed = [1.24, 1.24]),
  "partial scope drift": (c) =>
    (c.decisions[0].entries[3].coverage = "partial"),
  "unordered band": (c) =>
    (c.decisions[0].entries[3].to = [1.3, 1.25, 1.25, 1.35]),
  "nonfinite band": (c) => (c.decisions[0].entries[3].to[3] = Infinity),
  "fractional count": (c) => (c.decisions[0].entries[4].to = [1.5, 2]),
  "unknown metric": (c) => (c.decisions[0].entries[3].metric = "anything"),
  "policy gap called drawing": (c) =>
    (c.decisions[0].entries[5].classification = "drawing"),
  "missing policy acknowledgement": (c) =>
    delete c.decisions[0].entries[5].classification,
  "conflicting lane envelope": (c) =>
    c.decisions.push({
      ...c.decisions[0],
      pr: "#other",
      entries: [c.decisions[0].entries[3]],
    }),
  "conflicting lane scope": (c) =>
    c.decisions.push({
      ...c.decisions[0],
      pr: "#other",
      entries: [c.decisions[0].entries[1]],
    }),
};
for (const [name, mutate] of Object.entries(refusals))
  it("refuses " + name, () => {
    const c = fixture();
    mutate(c);
    expect(() => prepareRepin(c)).toThrow();
  });

it("emits inventory with bound instance facts and separate policy classification", () => {
  const c = fixture(),
    inv = reviewInventory(c);
  expect(inv.binding.summarySha256).toBe(c.reportSha256);
  expect(inv.current.some((t) => t.classification === "policy-gap")).toBe(true);
  expect(inv.stale).toHaveLength(2);
});
it.each([
  '{"a":1,"a":2}',
  '{"a":1,"\\u0061":2}',
  '{"nested":{"a":1,"a":2}}',
  '{"a":1,}',
  "/*x*/{}",
])("rejects ambiguous/invalid JSON %s", (s) =>
  expect(() => strictJsonBytes(Buffer.from(s))).toThrow(),
);
it("accepts repeated keys in distinct objects and escaped string punctuation", () =>
  expect(
    strictJsonBytes(
      Buffer.from('{"a":{"x":1},"b":{"x":2},"s":"{\\\"x\\\":1}"}'),
    ).b.x,
  ).toBe(2));
it("rejects malformed UTF-8", () =>
  expect(() => strictJsonBytes(Buffer.from([0xff]))).toThrow());

async function ioFixture() {
  const root = await mkdtemp(join(tmpdir(), "e3-repin-test-"));
  await mkdir(join(root, "evals/draw"), { recursive: true });
  await mkdir(join(root, "evals/out/draw-samples/review"), { recursive: true });
  const c = fixture(),
    png = pngFixture();
  const crop = c.decisions[0].entries[2].crop;
  crop.sha256 = hash(png);
  c.decisions[0].entries[2].drawingSha256 = drawingHash(png);
  c.cropHashes = new Map([[crop.path, crop.sha256]]);
  await writeFile(join(root, crop.path), png);
  const target = join(root, "evals/draw/expectations.mjs");
  await writeFile(target, serializeRegistry(c.registry));
  c.registryPath = target;
  return { root, c, target, preview: join(root, "evals/out/preview.mjs") };
}
it("preview is byte-identical to apply and unlisted data is preserved", async () => {
  const { root, c, target, preview } = await ioFixture();
  try {
    const before = await readFile(target);
    const p = await executeRepin({ root, inputs: c, previewPath: preview });
    expect(await readFile(target)).toEqual(before);
    const a = await executeRepin({
      root,
      inputs: c,
      previewPath: preview,
      apply: true,
    });
    expect(await readFile(target, "utf8")).toBe(
      await readFile(preview, "utf8"),
    );
    expect(a.text).toBe(p.text);
    expect(a.receipt.expected.exitCode).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses preview overwrite, tampered preview and missing preview before writing", async () => {
  const { root, c, target, preview } = await ioFixture();
  try {
    const old = await readFile(target);
    await executeRepin({ root, inputs: c, previewPath: preview });
    await expect(
      executeRepin({ root, inputs: c, previewPath: preview }),
    ).rejects.toThrow();
    await writeFile(preview, "tampered");
    await expect(
      executeRepin({ root, inputs: c, previewPath: preview, apply: true }),
    ).rejects.toThrow(/Preview/);
    await expect(
      executeRepin({
        root,
        inputs: c,
        previewPath: join(root, "evals/out/missing"),
        apply: true,
      }),
    ).rejects.toThrow();
    expect(await readFile(target)).toEqual(old);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses a changed registry and removes its apply lock", async () => {
  const { root, c, target, preview } = await ioFixture();
  try {
    await executeRepin({ root, inputs: c, previewPath: preview });
    await expect(
      executeRepin({
        root,
        inputs: c,
        previewPath: preview,
        apply: true,
        beforeCommit: () => writeFile(target, "other edit"),
      }),
    ).rejects.toThrow(/Registry changed/);
    expect(await readFile(target, "utf8")).toBe("other edit");
    await expect(readFile(target + ".repin.lock")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses conflicting apply locks", async () => {
  const { root, c, target, preview } = await ioFixture();
  try {
    await executeRepin({ root, inputs: c, previewPath: preview });
    await writeFile(target + ".repin.lock", "busy");
    await expect(
      executeRepin({ root, inputs: c, previewPath: preview, apply: true }),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses escaped crop/preview paths, crop tampering and unsupported images", async () => {
  const { root, c, preview } = await ioFixture();
  try {
    const crop = c.decisions[0].entries[2].crop;
    expect(await reviewedCrop(root, crop)).toBe(crop.sha256);
    await expect(
      reviewedCrop(root, { ...crop, path: "../outside.png" }),
    ).rejects.toThrow();
    await expect(
      reviewedCrop(root, { ...crop, sha256: "wrong" }),
    ).rejects.toThrow();
    await writeFile(join(root, crop.path), "not PNG");
    await expect(reviewedCrop(root, crop)).rejects.toThrow(/PNG/);
    await expect(
      executeRepin({
        root,
        inputs: c,
        previewPath: join(root, "elsewhere.mjs"),
      }),
    ).rejects.toThrow(/under/);
    await symlink(
      join(root, "evals/draw"),
      join(root, "evals/out/escape"),
      "junction",
    );
    await expect(
      executeRepin({
        root,
        inputs: c,
        previewPath: join(root, "evals/out/escape/preview.mjs"),
      }),
    ).rejects.toThrow(/under/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("loads raw hashes and rejects a tampered supplied baseline/decision JSON", async () => {
  const { root, c, target } = await ioFixture();
  try {
    const report = join(root, "report.json"),
      decision = join(root, "decision.json"),
      baseline = join(root, "baseline.json");
    await writeFile(report, json(c.report));
    await writeFile(decision, json(c.decisions[0]));
    await writeFile(baseline, json(c.baselines.values().next().value));
    const loaded = await loadRepinInputs({
      root,
      reportPath: report,
      decisionPaths: [decision],
      baselinePaths: [baseline],
      registryPath: target,
      registry: c.registry,
      specs,
    });
    expect(prepareRepin(loaded).expected.exitCode).toBe(0);
    await writeFile(decision, '{"entries":[],"entries":[]}');
    await expect(strictJsonFile(decision)).rejects.toThrow(/Duplicate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Re-sign controlled fixture reports after semantic mutations, so these tests
// reach the specific guard rather than failing an unrelated input binding.
function resign(c) {
  const priorOld = c.before.byToken,
    priorNew = c.after.byToken;
  c.registrySha256 = hash(serializeRegistry(c.registry));
  const old = c.baselines.values().next().value;
  for (const r of [old, c.report]) {
    r.checkers["expectations.mjs"] = c.registrySha256;
    r.checkerSha256 = checkerManifestHash(r.checkers);
    const a = reassess(r, c.registry, specs);
    r.results = a.rows;
    r.drift = a.drift;
    r.summary = a.summary;
    r.exitCode = a.exitCode;
  }
  c.checkerSha256 = c.report.checkerSha256;
  const oldSha = hash(json(old));
  c.reportSha256 = hash(json(c.report));
  c.baselines = new Map([[oldSha, old]]);
  c.before = instanceInventory(old, oldSha);
  c.after = instanceInventory(c.report, c.reportSha256);
  const key = (t) =>
    JSON.stringify([t.markerId, t.scope, t.row, t.finding, t.instance]);
  const remap = (token, map, now) =>
    now.find((x) => key(x) === key(map.get(token)))?.token ?? token;
  for (const f of c.decisions) {
    f.summarySha256 = c.reportSha256;
    f.registrySha256 = c.registrySha256;
    f.checkerSha256 = c.checkerSha256;
    f.baselineSha256 = oldSha;
    for (const e of f.entries) {
      for (const p of e.pairs ?? []) {
        p.from = remap(p.from, priorOld, c.before.instances);
        p.to = remap(p.to, priorNew, c.after.instances);
      }
      if (e.action === "new-defect")
        e.instances = e.instances.map((t) =>
          remap(t, priorNew, c.after.instances),
        );
    }
  }
  return c;
}
it("refuses per-instance text mismatch even when kind and scope match", () => {
  const c = fixture();
  c.report.results.find((r) =>
    r.evidence?.findings?.some(
      (f) =>
        f.identities?.[0]?.sheet === newView &&
        f.kind === "printed-function-key",
    ),
  ).evidence.findings[0].text = "different";
  resign(c);
  expect(() => prepareRepin(c)).toThrow(/text rename mapping/);
});
it("requires literal source-locator mappings for renamed report columns", () => {
  const c = fixture();
  const row = c.report.results.find((r) =>
    r.evidence?.findings?.some(
      (f) =>
        f.identities?.[0]?.sheet === newView &&
        f.kind === "printed-function-key",
    ),
  );
  row.evidence.findings[0].sourceLocator = "cell/io/K1/Mfr.";
  c.baselines
    .values()
    .next()
    .value.results.find((r) =>
      r.evidence?.findings?.some((f) => f.text === "K1"),
    ).evidence.findings[0].sourceLocator = "cell/io/K1/Manufacturer";
  resign(c);
  c.decisions[0].entries[1].columnMap = { from: "Manufacturer", to: "Mfr." };
  expect(() => prepareRepin(c)).toThrow(/sourceLocator/);
  c.decisions[0].entries[1].pairs[0].sourceLocator = {
    from: "cell/io/K1/Manufacturer",
    to: "cell/io/K1/Mfr.",
  };
  expect(prepareRepin(c).expected.exitCode).toBe(0);
});
it("accounts aggregate rename multisets, refusing half the pairs", () => {
  const c = fixture();
  c.registry.markers.find((m) => m.id === c.ids.a).count = [2, 2];
  for (const r of [c.report, c.baselines.values().next().value]) {
    const f = r.results
      .flatMap((r) => r.evidence?.findings ?? [])
      .find((f) => f.kind === "printed-function-key" && f.text === "K1");
    f.instances = [
      { text: "K1", sourceLocator: "device/K1/a" },
      { text: "K1", sourceLocator: "device/K1/b" },
    ];
  }
  resign(c);
  const e = c.decisions[0].entries[1];
  e.pairs = c.before.instances
    .filter((t) => t.markerId === c.ids.a)
    .map((a) => {
      const b = c.after.instances.find(
        (b) =>
          b.markerId === c.ids.a &&
          b.facts.sourceLocator === a.facts.sourceLocator,
      );
      return {
        from: a.token,
        to: b.token,
        view: { from: oldView, to: newView },
      };
    });
  expect(prepareRepin(c).expected.exitCode).toBe(0);
  e.pairs.pop();
  expect(() => prepareRepin(c)).toThrow(
    /Unlisted source instances|Unlisted target/,
  );
});
it("rejects partial coverage of a new aggregate finding", () => {
  const c = fixture();
  const f = c.report.results
    .flatMap((r) => r.evidence?.findings ?? [])
    .find((f) => f.kind === "ambiguous-wire-label");
  f.instances = [
    { text: "W9", sourceLocator: "wire/a", ownDistanceMm: 5 },
    { text: "W10", sourceLocator: "wire/b", ownDistanceMm: 5 },
  ];
  resign(c);
  expect(() => prepareRepin(c)).toThrow(/Unlisted target/);
  c.decisions[0].entries[2].instances = c.after.instances
    .filter((t) => t.markerId === c.ids.fresh)
    .map((t) => t.token);
  expect(prepareRepin(c).expected.exitCode).toBe(0);
});
it("refuses a new unexpected finding mixed with an expected finding in one row", () => {
  const c = fixture(),
    row = c.report.results.find((r) =>
      r.evidence?.findings?.some((f) => f.kind === "ambiguous-wire-label"),
    );
  const extra = copyFinding(row.evidence.findings[0]);
  extra.identities[0].locator = "conductor/W10/text";
  extra.text = "W10";
  row.evidence.findings.push(extra);
  resign(c);
  expect(() => prepareRepin(c)).toThrow(/Unlisted findings/);
});
function copyFinding(f) {
  return structuredClone(f);
}
it("measures intentional removal through the declared view rename", () => {
  const c = fixture();
  for (const r of c.report.results)
    if (!r.expectation && r.dq === "DQ-05") r.viewScope = newView;
  resign(c);
  c.decisions[0].entries[0].cause = "not-measured";
  expect(() => prepareRepin(c)).toThrow(/measurement availability/);
  c.decisions[0].entries[0].cause = "removed";
  const result = prepareRepin(c);
  expect(result.expected.outcomes.removals).toBe(1);
  expect(result.expected.outcomes.fixes).toBe(0);
});
it("refuses rename of a compact aggregate without full instance evidence", () => {
  const c = fixture();
  for (const r of [c.report, c.baselines.values().next().value]) {
    const f = r.results
      .flatMap((r) => r.evidence?.findings ?? [])
      .find((f) => f.text === "K1");
    f.instanceCount = 2;
  }
  c.registry.markers.find((m) => m.id === c.ids.a).count = [2, 2];
  resign(c);
  expect(() => prepareRepin(c)).toThrow(/Compact aggregates/);
});
it("refuses malformed scope selectors and unexplained policy classification", () => {
  const c = fixture();
  c.decisions[0].entries[1].to.scope.all = true;
  expect(() => prepareRepin(c)).toThrow(/scope/);
  const d = fixture();
  delete d.report.results.find((r) => r.classification === "policy-gap")
    .classification;
  expect(() => prepareRepin(d)).toThrow();
});
it("refuses a crop symlink outside the retained sample tree", async () => {
  const { root, c } = await ioFixture();
  try {
    const outsideDir = join(root, "outside");
    await mkdir(outsideDir);
    const outside = join(outsideDir, "crop.png");
    await writeFile(
      outside,
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        Buffer.from("image"),
      ]),
    );
    await symlink(
      outsideDir,
      join(root, "evals/out/draw-samples/review/escape"),
      "junction",
    );
    await expect(
      reviewedCrop(root, {
        path: "evals/out/draw-samples/review/escape/crop.png",
        sha256: hash(await readFile(outside)),
      }),
    ).rejects.toThrow(/under/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("does not normalize away recorded text differences in rename evidence", () => {
  const c = fixture();
  c.report.results
    .flatMap((r) => r.evidence?.findings ?? [])
    .find((f) => f.kind === "printed-function-key" && f.text === "K1").text =
    "K1  ";
  resign(c);
  expect(() => prepareRepin(c)).toThrow(/text rename mapping/);
});
it("rejects empty crop metadata even with no supplied crop hashes", () => {
  const c = fixture();
  c.decisions[0].entries[2].crop = {};
  c.cropHashes.clear();
  expect(() => prepareRepin(c)).toThrow(/Crop required/);
});
it("refuses historical target checker versions while allowing a bound older baseline", () => {
  const c = fixture();
  c.report.evalsVersion = "4.1";
  c.decisions[0].evalsVersion = "4.1";
  expect(() => prepareRepin(c)).toThrow(/current evals/);
  const d = fixture();
  d.baselines.values().next().value.evalsVersion = "4.1";
  resign(d);
  expect(prepareRepin(d).expected.exitCode).toBe(0);
});
it("refuses schema drift in instance identity and partial-scope report claims", () => {
  const c = fixture();
  c.report.results.find((r) =>
    r.evidence?.findings?.some((f) => f.kind === "ambiguous-wire-label"),
  ).evidence.findings[0].identities[0].kind = "other";
  expect(() => prepareRepin(c)).toThrow();
  const d = fixture();
  d.report.drift[0].partialScope = true;
  expect(() => prepareRepin(d)).toThrow(/drift/);
});
it("explicitly accounts leftover old aggregate instances without pretending a removed view was fixed", () => {
  const c = fixture();
  c.registry.markers.find((m) => m.id === c.ids.a).count = [2, 2];
  c.baselines
    .values()
    .next()
    .value.results.flatMap((r) => r.evidence?.findings ?? [])
    .find((f) => f.text === "K1").instances = [
    { text: "K1", sourceLocator: "device/K1/text" },
    { text: "obsolete", sourceLocator: "device/K1/old" },
  ];
  for (const row of c.report.results)
    if (!row.expectation && row.dq === "DQ-05") row.viewScope = newView;
  resign(c);
  c.decisions[0].entries[0].cause = "fixed";
  c.decisions[0].entries[1].pairs = [
    {
      from: c.before.instances.find(
        (t) => t.markerId === c.ids.a && t.facts.text === "K1",
      ).token,
      to: c.after.instances.find((t) => t.markerId === c.ids.a).token,
      view: { from: oldView, to: newView },
    },
  ];
  c.decisions[0].entries.push({
    reviewed: true,
    signOff: {
      kind: "agent",
      by: "Synthetic reviewer fixture (not an approval)",
    },
    action: "retire",
    markerId: c.ids.a,
    scope: scope(),
    instances: [
      c.before.instances.find((t) => t.facts.text === "obsolete").token,
    ],
    cause: "removed",
    classification: "drawing",
    causeClass: "removed-view-residual",
    note: "Intentional text removal measured through the declared view rename",
  });
  c.decisions[0].entries.push({
    reviewed: true,
    signOff: {
      kind: "agent",
      by: "Synthetic reviewer fixture (not an approval)",
    },
    action: "envelope-drift",
    markerId: c.ids.a,
    metric: "occurrences",
    from: [2, 2],
    to: [1, 1],
    observed: [1, 1],
    coverage: "full",
    classification: "drawing",
    causeClass: "fewer-instances",
    note: "Only the retained old text moves",
  });
  expect(prepareRepin(c).expected.exitCode).toBe(0);
  c.decisions[0].entries.at(-2).cause = "not-measured";
  expect(() => prepareRepin(c)).toThrow(/availability/);
});
it("refuses a registry symlink outside this workspace on apply", async () => {
  const { root, c, target, preview } = await ioFixture();
  try {
    await executeRepin({ root, inputs: c, previewPath: preview });
    const other = join(root, "other");
    await mkdir(other);
    await writeFile(join(other, "expectations.mjs"), await readFile(target));
    await rm(join(root, "evals/draw"), { recursive: true, force: true });
    await symlink(other, join(root, "evals/draw"), "junction");
    await expect(
      executeRepin({ root, inputs: c, previewPath: preview, apply: true }),
    ).rejects.toThrow(/canonical/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses an output base directory symlink outside the workspace", async () => {
  const { root, c } = await ioFixture();
  const outside = await mkdtemp(join(tmpdir(), "e3-outside-"));
  try {
    await rm(join(root, "evals/out"), { recursive: true, force: true });
    await symlink(outside, join(root, "evals/out"), "junction");
    await expect(
      executeRepin({
        root,
        inputs: c,
        previewPath: join(root, "evals/out/preview.mjs"),
      }),
    ).rejects.toThrow(/under/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
it("handles an expected and an approved unexpected finding in the same failed row, but rejects a third unlisted identity", () => {
  const c = fixture(),
    i = identity(
      "ambiguous-wire-label",
      "conductor/expected/text",
      "DQ-16",
      newView,
    ),
    m = marker(i);
  c.registry.markers.push(m);
  const f = finding(i, "expected", { ownDistanceMm: 4 });
  const old = c.baselines.values().next().value;
  old.results.push({
    id: cid + "/DQ-16/expected",
    case: cid,
    dq: "DQ-16",
    sheet: 1,
    medium: "svg",
    viewScope: newView,
    check: "sheet",
    status: "fail",
    evidence: { findings: [structuredClone(f)] },
  });
  const row = c.report.results.find((r) =>
    r.evidence?.findings?.some((f) => f.kind === "ambiguous-wire-label"),
  );
  row.evidence.findings.push(f);
  resign(c);
  expect(prepareRepin(c).expected.exitCode).toBe(0);
  const updated = c.report.results.find((r) => r.id === row.id);
  const extra = copyFinding(updated.evidence.findings[0]);
  extra.identities[0].locator = "conductor/unlisted/text";
  updated.evidence.findings.push(extra);
  resign(c);
  expect(() => prepareRepin(c)).toThrow(/Unlisted/);
});
it("derives an out-of-band envelope only from measurements and documented tolerance", () => {
  const c = fixture(),
    f = c.report.results
      .flatMap((r) => r.evidence?.findings ?? [])
      .find((f) => f.kind === "pdf-svg-advance-difference");
  for (const i of f.instances) i.advanceRatio = 1.5;
  resign(c);
  const e = c.decisions[0].entries[3];
  e.observed = [1.5, 1.5];
  e.to = [1.45, 1.5, 1.5, 1.55];
  expect(prepareRepin(c).expected.exitCode).toBe(0);
  c.decisions[0].entries.splice(3, 1);
  expect(() => prepareRepin(c)).toThrow(/Unlisted/);
});
it("refuses rename to a different defect kind or medium", () => {
  const c = fixture();
  c.decisions[0].entries[1].to = c.decisions[0].entries[2].to;
  c.decisions[0].entries[1].pairs[0].to =
    c.decisions[0].entries[2].instances[0];
  expect(() => prepareRepin(c)).toThrow(/kind changed/);
  const d = fixture(),
    row = d.report.results.find((r) =>
      r.evidence?.findings?.some(
        (f) => f.kind === "printed-function-key" && f.text === "K1",
      ),
    );
  row.medium = "pdf";
  row.evidence.findings[0].identities[0].medium = "pdf";
  resign(d);
  d.decisions[0].entries[1].to.scope.medium = "pdf";
  d.decisions[0].entries[1].pairs[0].to = d.after.instances.find(
    (t) => t.markerId === d.ids.a,
  ).token;
  expect(() => prepareRepin(d)).toThrow(/case or medium|Cannot prove move/);
});
it("does not alter policy/geometry summaries or scoring status to hide policy changes", () => {
  const c = fixture(),
    result = prepareRepin(c);
  expect(result.expected.policy.every((r) => r.status === "xfail")).toBe(true);
  expect(result.expected.summary["DQ-02"].xfail).toBe(0);
});
it("reassesses exported precision without inventing a one-quantum floating-point drift", () => {
  const c = fixture(),
    m = c.registry.markers.find((m) => m.id === c.ids.d);
  m.bands.advanceRatio = [0.75, 1.058, 1.058, 1.35];
  const f = c.report.results
    .flatMap((r) => r.evidence?.findings ?? [])
    .find((f) => f.kind === "pdf-svg-advance-difference");
  for (const i of f.instances) i.advanceRatio = 1.0573;
  resign(c);
  const exported = JSON.parse(json(c.report));
  expect(reassess(exported, c.registry, specs).drift).toEqual(exported.drift);
});
it("checks exact exported envelope values for metrics derived by subtraction", () => {
  const c = fixture();
  c.registry.markers.find((m) => m.id === c.ids.d).bands.strokeExcessMm = [
    0.07, 0.08, 0.08, 0.09,
  ];
  for (const r of [c.report, c.baselines.values().next().value]) {
    const f = r.results
      .flatMap((r) => r.evidence?.findings ?? [])
      .find((f) => f.kind === "pdf-svg-advance-difference");
    f.outlineMm = r === c.report ? 0.41 : 0.4;
    f.conductorMm = 0.32;
  }
  resign(c);
  c.decisions[0].entries.push({
    reviewed: true,
    signOff: {
      kind: "agent",
      by: "Synthetic reviewer fixture (not an approval)",
    },
    action: "envelope-drift",
    markerId: c.ids.d,
    metric: "strokeExcessMm",
    from: [0.07, 0.08, 0.08, 0.09],
    to: [0.08, 0.09, 0.09, 0.1],
    observed: [0.09, 0.09],
    coverage: "full",
    classification: "drawing",
    causeClass: "exact-subtraction",
    note: "0.41 minus 0.32 at exported precision",
  });
  expect(prepareRepin(c).expected.exitCode).toBe(0);
});
it("refuses unknown registry/identity fields that could otherwise overwrite unlisted data", () => {
  const c = fixture();
  c.registry.markers[0].unlisted = "must not disappear";
  expect(() => prepareRepin(c)).toThrow(/Unknown marker/);
  const d = fixture();
  d.report.results.find((r) =>
    r.evidence?.findings?.some((f) => f.kind === "printed-function-key"),
  ).evidence.findings[0].identities[0].bands = {};
  expect(() => prepareRepin(d)).toThrow(/Unknown finding identity/);
});
it("writes exclusive unreviewed drafts under ignored output without approving causes", async () => {
  const { root, c } = await ioFixture();
  try {
    const inventoryPath = join(root, "evals/out/inventory.json"),
      path = join(root, "evals/out/draft.json");
    await writeFile(inventoryPath, json(reviewInventory(c)));
    const draft = await writeDraft({
      root,
      inventoryPath,
      path,
      pr: "#synthetic",
    });
    expect(
      draft.entries.every((e) => e.reviewed === false && e.causeClass === ""),
    ).toBe(true);
    expect(() => prepareRepin({ ...c, decisions: [draft] })).toThrow(
      /Unreviewed/,
    );
    await expect(
      writeDraft({ root, inventoryPath, path, pr: "#synthetic" }),
    ).rejects.toThrow(/EEXIST/);
    await expect(
      writeDraft({
        root,
        inventoryPath,
        path: join(root, "outside.json"),
        pr: "#synthetic",
      }),
    ).rejects.toThrow(/under/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses a checker mutation inside the apply lock and releases the lock", async () => {
  const { root, c, target, preview } = await ioFixture();
  try {
    await executeRepin({ root, inputs: c, previewPath: preview });
    const prior = await readFile(target);
    await expect(
      executeRepin({
        root,
        inputs: c,
        previewPath: preview,
        apply: true,
        beforeCommit: () =>
          writeFile(join(root, "evals/draw/checks.mjs"), "edited during apply"),
      }),
    ).rejects.toThrow(/Checker bundle changed/);
    expect(await readFile(target)).toEqual(prior);
    await expect(readFile(target + ".repin.lock")).rejects.toThrow(/ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses reused crop bytes across a new defect and a text-changing move", () => {
  const c = fixture();
  const f = c.report.results.find((r) =>
    r.evidence?.findings?.some((f) => f.text === "K1"),
  ).evidence.findings[0];
  f.text = "K1 caption";
  resign(c);
  const e = c.decisions[0].entries[1];
  e.pairs[0].text = { from: "K1", to: "K1 caption" };
  e.crop = c.decisions[0].entries[2].crop;
  expect(() => prepareRepin(c)).toThrow(/distinct crop hash/);
  const fresh = { ...e.crop, path: "evals/out/draw-samples/another-name.png" };
  e.crop = fresh;
  c.cropHashes.set(fresh.path, fresh.sha256);
  expect(() => prepareRepin(c)).toThrow(/distinct crop hash/);
});
it("reports empty crop metadata and empty files accurately", async () => {
  const { root } = await ioFixture();
  try {
    await expect(reviewedCrop(root, { path: "", sha256: "" })).rejects.toThrow(
      /Crop required/,
    );
    const path = "evals/out/draw-samples/review/empty.png";
    await writeFile(join(root, path), "");
    await expect(
      reviewedCrop(root, { path, sha256: hash("") }),
    ).rejects.toThrow(/file is empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses identical real crop bytes even when supplied under different filenames", async () => {
  const { root, c, target, preview } = await ioFixture();
  try {
    c.report.results.find((r) =>
      r.evidence?.findings?.some((f) => f.text === "K1"),
    ).evidence.findings[0].text = "K1 caption";
    resign(c);
    const e = c.decisions[0].entries[1],
      crop = c.decisions[0].entries[2].crop;
    e.pairs[0].text = { from: "K1", to: "K1 caption" };
    e.drawingSha256 = c.decisions[0].entries[2].drawingSha256;
    e.crop = {
      ...crop,
      path: "evals/out/draw-samples/review/renamed-copy.png",
    };
    await writeFile(
      join(root, e.crop.path),
      await readFile(join(root, crop.path)),
    );
    const reportPath = join(root, "evals/out/report.json"),
      decision = join(root, "evals/out/decisions.json"),
      baselinePath = join(root, "evals/out/baseline.json");
    await writeFile(reportPath, json(c.report));
    await writeFile(decision, json(c.decisions[0]));
    await writeFile(baselinePath, json(c.baselines.values().next().value));
    const inputs = await loadRepinInputs({
      root,
      reportPath,
      decisionPaths: [decision],
      baselinePaths: [baselinePath],
      registryPath: target,
      registry: c.registry,
      specs,
    });
    await expect(
      executeRepin({ root, inputs, previewPath: preview }),
    ).rejects.toThrow(/distinct crop hash/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("binds comments and added/deleted modules recursively with portable paths", async () => {
  const { root } = await ioFixture();
  try {
    const draw = join(root, "evals/draw");
    await mkdir(join(draw, "nested/deeper"), { recursive: true });
    const path = join(draw, "nested/deeper/check.mjs");
    await writeFile(path, "// checker\n");
    const a = await readCheckers(draw);
    expect(a["nested/deeper/check.mjs"]).toBe(hash("// checker\n"));
    await writeFile(path, "// changed checker comment\n");
    const b = await readCheckers(draw);
    expect(checkerManifestHash(a)).not.toBe(checkerManifestHash(b));
    await rm(path);
    expect(checkerManifestHash(await readCheckers(draw))).not.toBe(
      checkerManifestHash(b),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("runtime move proof refuses a different source even with a literal mapping", () => {
  const c = fixture(),
    e = c.decisions[0].entries[1];
  c.report.results.find((r) =>
    r.id.endsWith("/item-0"),
  ).evidence.findings[0].sourceLocator = "device/K9/text";
  e.pairs[0].sourceLocator = { from: "device/K1/text", to: "device/K9/text" };
  resign(c);
  expect(() => prepareRepin(c)).toThrow(/source row or locator kind/);
});
it("removed cannot retire an unmeasured scope", () => {
  const c = fixture();
  c.report.results = c.report.results.filter(
    (r) => r.dq !== "DQ-05" || r.evidence.findings.length,
  );
  // Preserve DQ coverage on the moved view, but the old scope is unmeasured
  // when the only move declaration is removed (replace it with an addition).
  const e = c.decisions[0].entries[1];
  c.decisions[0].entries[1] = {
    ...c.decisions[0].entries[2],
    action: "scope-added",
    to: e.to,
    instances: e.pairs.map((p) => p.to),
    crop: undefined,
  };
  c.decisions[0].entries[0].cause = "removed";
  resign(c);
  c.decisions[0].entries[1].instances = c.after.instances
    .filter((x) => x.markerId === c.ids.a)
    .map((x) => x.token);
  c.decisions[0].entries.push({
    ...c.decisions[0].entries[0],
    markerId: c.ids.a,
    cause: "not-measured",
  });
  expect(() => prepareRepin(c)).toThrow(/measurement availability/);
});
function disguisedFixture() {
  const c = fixture(),
    e = c.decisions[0].entries[1],
    f = c.decisions[0].entries[2];
  const crop = {
    path: "evals/out/draw-samples/review/disguised.png",
    sha256: hash("disguised-crop"),
  };
  c.cropHashes.set(crop.path, crop.sha256);
  c.decisions[0].sheetRenames = [
    { case: cid, medium: "svg", from: oldView, to: newView },
  ];
  c.decisions[0].entries.splice(1, 1, {
    ...e,
    action: "retire",
    markerId: e.from.markerId,
    scope: e.from.scope,
    cause: "fixed",
  });
  const r = c.decisions[0].entries[1];
  delete r.from;
  delete r.to;
  delete r.pairs;
  c.decisions[0].entries.push({
    ...f,
    to: e.to,
    instances: e.pairs.map((p) => p.to),
    crop,
  });
  const b = c.baselines.values().next().value;
  b.results.find((r) =>
    r.id.endsWith("/item-1"),
  ).evidence.findings[0].sourceLocator = "device/K2/text";
  const target = c.report.results.find((r) => r.id.endsWith("/item-0")).evidence
    .findings[0];
  target.identities[0].locator = "device/K1/renamed-text";
  const id = markerId(target.identities[0]);
  resign(c);
  const fresh = c.decisions[0].entries.at(-1);
  fresh.to.markerId = id;
  fresh.instances = c.after.instances
    .filter((t) => t.markerId === id)
    .map((t) => t.token);
  c.disguisedId = id;
  return c;
}
it.each(["fixed", "removed"])(
  "refuses %s plus new-defect when a move is possible",
  (cause) => {
    const c = disguisedFixture();
    c.decisions[0].entries[1].cause = cause;
    expect(() => prepareRepin(c)).toThrow(/Retirement could be a move.*DQ-05/s);
  },
);
it("notMove is per pair, needs two distinct crops, and is reviewer judgment", () => {
  const c = disguisedFixture(),
    old = c.before.instances.find((x) => x.markerId === c.ids.a),
    now = c.after.instances.find((x) => x.markerId === c.disguisedId);
  const crops = [1, 2].map((i) => ({
    path: `evals/out/draw-samples/review/notmove-${i}.png`,
    sha256: hash("notmove" + i),
  }));
  for (const p of crops) c.cropHashes.set(p.path, p.sha256);
  c.decisions[0].notMove = [
    {
      from: old.token,
      to: now.token,
      reason: "Independent replacement, not the old label",
      crops,
    },
  ];
  const r = prepareRepin(c);
  expect(r.expected.reviewerJudged.notMove).toHaveLength(1);
  expect(r.expected.outcomes.notMove).toBe(1);
  expect(r.expected.outcomes.fixes).toBe(2);
  expect(
    r.receipts
      .filter((r) => r.action === "retire")
      .every((r) => r.toolProved.derivedBounds === undefined),
  ).toBe(true);
  c.decisions[0].notMove[0].crops = [crops[0], crops[0]];
  expect(() => prepareRepin(c)).toThrow(/distinct crop/);
  c.decisions[0].notMove[0].crops = crops;
  c.decisions[0].notMove[0].reason = "";
  expect(() => prepareRepin(c)).toThrow(/one-line reason/);
  c.decisions[0].notMove[0].reason = "Reviewed";
  c.decisions[0].notMove.push(c.decisions[0].notMove[0]);
  expect(() => prepareRepin(c)).toThrow(/Unused, duplicate/);
});
it("checker source symlinks are refused even if they point to a non-module", async () => {
  const root = await mkdtemp(join(tmpdir(), "draw-symlink-"));
  try {
    await writeFile(join(root, "source.txt"), "// source");
    await symlink(join(root, "source.txt"), join(root, "link.mjs"));
    await expect(readCheckers(root)).rejects.toThrow(/source symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("runtime refuses a column crossing without its literal column map", () => {
  const c = fixture(),
    e = c.decisions[0].entries[1],
    b = c.baselines.values().next().value;
  b.results.find((r) =>
    r.id.endsWith("/item-0"),
  ).evidence.findings[0].sourceLocator = 'cell/io/["PLC1","ai0"]/Signal';
  c.report.results.find((r) =>
    r.id.endsWith("/item-0"),
  ).evidence.findings[0].sourceLocator = 'cell/io/["PLC1","ai0"]/Device';
  e.pairs[0].sourceLocator = {
    from: 'cell/io/["PLC1","ai0"]/Signal',
    to: 'cell/io/["PLC1","ai0"]/Device',
  };
  resign(c);
  expect(() => prepareRepin(c)).toThrow(/column changed/);
  e.columnMap = { from: "Signal", to: "Device" };
  expect(prepareRepin(c).expected.exitCode).toBe(0);
});
it("unlisted drift refusal identifies the marker and metric", () => {
  const c = fixture();
  c.decisions[0].entries = c.decisions[0].entries.filter(
    (e) => !(e.markerId === c.ids.d && e.metric === "occurrences"),
  );
  try {
    prepareRepin(c);
    throw Error("Expected drift refusal");
  } catch (e) {
    expect(e.message).toContain(c.ids.d);
    expect(e.message).toContain("occurrences");
  }
});

it.each([1, 3])("notMove needs exactly two crops, not %i", (n) => {
  const c = disguisedFixture(),
    old = c.before.instances.find((x) => x.markerId === c.ids.a),
    now = c.after.instances.find((x) => x.markerId === c.disguisedId);
  const crops = Array.from({ length: n }, (_, i) => ({
    path: `evals/out/draw-samples/review/count-${i}.png`,
    sha256: hash(`count-${i}`),
  }));
  for (const p of crops) c.cropHashes.set(p.path, p.sha256);
  c.decisions[0].notMove = [
    {
      from: old.token,
      to: now.token,
      reason: "Independent replacement control",
      crops,
    },
  ];
  expect(() => prepareRepin(c)).toThrow("notMove requires two distinct crops");
});
it("blank crop paths get the crop error even with a valid hash", async () => {
  await expect(
    reviewedCrop("/nonexistent/root", { path: "   ", sha256: hash("valid") }),
  ).rejects.toThrow("Crop required: supply a non-empty file path and SHA-256");
});
function addedScopeDisguise(cause = "fixed") {
  const c = fixture(),
    e = c.decisions[0].entries[1];
  c.baselines
    .values()
    .next()
    .value.results.find((r) =>
      r.id.endsWith("/item-1"),
    ).evidence.findings[0].sourceLocator = "device/K2/text";
  c.decisions[0].sheetRenames = [
    { case: cid, medium: "svg", from: oldView, to: newView },
  ];
  c.decisions[0].entries.splice(
    1,
    1,
    {
      ...c.decisions[0].entries[0],
      markerId: e.from.markerId,
      scope: e.from.scope,
      cause,
    },
    {
      ...c.decisions[0].entries[0],
      action: "scope-added",
      to: e.to,
      instances: e.pairs.map((p) => p.to),
    },
  );
  const add = c.decisions[0].entries[2];
  delete add.markerId;
  delete add.scope;
  delete add.cause;
  resign(c);
  add.instances = c.after.instances
    .filter((x) => x.markerId === c.ids.a)
    .map((x) => x.token);
  return c;
}
it.each(["fixed", "removed"])(
  "refuses %s plus added scope for a same-identity move",
  (cause) => {
    const c = addedScopeDisguise(cause);
    expect(() => prepareRepin(c)).toThrow(/Retirement could be a move.*DQ-05/s);
  },
);
it.each([
  undefined,
  { by: "Reviewer" },
  { kind: "unknown", by: "Reviewer" },
  { kind: "agent", by: " " },
])("refuses missing or invalid signOff provenance: %j", (value) => {
  const c = fixture();
  c.decisions[0].entries[0].signOff = value;
  expect(() => prepareRepin(c)).toThrow(/signOff/);
});
it("labels agent review and permits a person countersignature without changing the decision", () => {
  const c = fixture(),
    e = c.decisions[0].entries[0],
    initial = structuredClone(e);
  const agent = prepareRepin(c);
  expect(
    agent.receipts
      .flatMap((r) => r.reviewerJudged.signOffs)
      .every((s) => s.kind === "agent" && s.label === "agent review"),
  ).toBe(true);
  e.counterSignOffs = [{ kind: "person", by: "Fixture person countersigner" }];
  const person = prepareRepin(c),
    r = person.receipts.find(
      (r) => r.action === "retire" && r.markerId === e.markerId,
    );
  expect(r.reviewerJudged.signOffs.map((s) => s.kind)).toEqual([
    "agent",
    "person",
  ]);
  const { counterSignOffs, ...unchanged } = e;
  expect(unchanged).toEqual(initial);
  expect(person.registry).toEqual(agent.registry);
  expect(agent.expected.outcomes.notMove).toBe(0);
});

it.each([
  { kind: "agent", by: "Other agent" },
  { kind: "person", by: "" },
  { kind: "unknown", by: "Name" },
])("refuses an invalid person countersignature: %j", (sign) => {
  const c = fixture();
  c.decisions[0].entries[0].counterSignOffs = [sign];
  expect(() => prepareRepin(c)).toThrow(/signOff|Countersignatures/);
});
