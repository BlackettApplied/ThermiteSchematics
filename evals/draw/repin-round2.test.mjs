import { it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { checkerManifestHash, readCheckers } from "./checker-manifest.mjs";
import { draftDecisions } from "./repin-draft.mjs";
import { expandRegistry } from "./marker-data.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
import { markerId } from "./locators.mjs";
import { hash, json } from "./support.mjs";
import {
  prepareRepin,
  reassess,
  DECISIONS_FORMAT,
  instanceInventory,
  reviewInventory,
} from "./repin-core.mjs";

// Execute only the serializer's generated declarations, using the real loader.
function loadedRegistry(registry) {
  const source = serializeRegistry(registry)
    .replace(/^import .*;\n/m, "")
    .replace("export const expectations =", "return");
  return new Function("expandRegistry", source)(expandRegistry);
}
const specs = [{ id: "fixture-left-to-right", flow: "left-to-right" }];
const cid = specs[0].id,
  view = "view:io/I/O schedule";
const identity = (name) => ({
  dq: "DQ-21",
  family: "fixture",
  kind: "pdf-svg-advance-difference",
  locator: "font-pair/report/" + name,
  check: "sheet",
  coarse: false,
  sheet: view,
  medium: "svg",
});
function sharedFixture(a = 1.08, b = 1.05, both = false) {
  const ids = [identity("a"), identity("b")];
  const registry = loadedRegistry({
    format: "thermite-draw-expectations/2.0",
    markers: ids.map((i) => ({
      id: markerId(i),
      dq: i.dq,
      family: i.family,
      kind: i.kind,
      locator: i.locator,
      check: i.check,
      coarse: false,
      scopes: [{ cases: [cid], sheets: [view], media: ["svg"] }],
      bands: { advanceRatio: [1, 1.05, 1.05, 1.1] },
      count: [1, 1],
    })),
  });
  const registrySha256 = hash(serializeRegistry(registry));
  const rows = Array.from({ length: 24 }, (_, n) => ({
    id: `${cid}/DQ-${String(n + 1).padStart(2, "0")}/sheet-1`,
    case: cid,
    dq: `DQ-${String(n + 1).padStart(2, "0")}`,
    sheet: 1,
    medium: "svg",
    viewScope: view,
    check: "sheet",
    status: "pass",
    evidence: { findings: [] },
  }));
  ids.forEach((i, n) =>
    rows.push({
      id: `${cid}/DQ-21/item-${n}`,
      case: cid,
      dq: i.dq,
      sheet: 1,
      medium: "svg",
      viewScope: view,
      check: "sheet",
      status: "fail",
      evidence: {
        findings: [
          {
            kind: i.kind,
            text: "K1",
            sourceLocator: i.locator.replace(
              "font-pair/report/header/",
              "header/",
            ),
            advanceRatio: [a, b][n],
            identities: [i],
          },
        ],
      },
    }),
  );
  const report = {
    format: "thermite-draw-eval/1.0",
    mode: "strict",
    subset: "full",
    cases: [cid],
    corpusSha256: "seal",
    evalsVersion: "4.2",
    checkers: { "expectations.mjs": registrySha256 },
    results: rows,
  };
  report.checkerSha256 = checkerManifestHash(report.checkers);
  const assessed = reassess(report, registry, specs);
  Object.assign(report, {
    results: assessed.rows,
    summary: assessed.summary,
    drift: assessed.drift,
    exitCode: assessed.exitCode,
  });
  const reportSha256 = hash(json(report));
  const entries = ids.slice(0, both ? 2 : 1).map((i, n) => ({
    reviewed: true,
    signOff: {
      kind: "agent",
      by: "Synthetic reviewer fixture (not an approval)",
    },
    action: "envelope-drift",
    markerId: markerId(i),
    metric: "advanceRatio",
    from: [1, 1.05, 1.05, 1.1],
    to: [
      Math.round((Math.min(a, b) - 0.05) * 1000) / 1000,
      [a, b][n],
      [a, b][n],
      Math.round((Math.max(a, b) + 0.05) * 1000) / 1000,
    ],
    observed: [[a, b][n], [a, b][n]],
    coverage: "full",
    classification: "drawing",
    causeClass: "font-metric-change",
    note: "Inspected isolated scalar drift",
  }));
  return {
    registry,
    registrySha256,
    report,
    reportSha256,
    checkerSha256: report.checkerSha256,
    specs,
    decisions: [
      {
        format: DECISIONS_FORMAT,
        pr: "#R4",
        checkerSha256: report.checkerSha256,
        summarySha256: reportSha256,
        registrySha256,
        corpusSha256: "seal",
        evalsVersion: "4.2",
        entries,
      },
    ],
    ids,
  };
}
it("loads genuinely shared bands and edits exactly the named drifting marker", () => {
  const c = sharedFixture();
  expect(c.registry.markers[0].bands).toBe(c.registry.markers[1].bands);
  const result = prepareRepin(c);
  const changed = result.registry.markers.filter(
    (m) =>
      json(m.bands) !==
      json(c.registry.markers.find((x) => x.id === m.id).bands),
  );
  expect(changed.map((m) => m.id)).toEqual([markerId(c.ids[0])]);
});
it("refuses undeclared drift on a sibling sharing the same bands", () => {
  const c = sharedFixture(1.08, 1.08);
  expect(() => prepareRepin(c)).toThrow(/Unlisted/);
});
it("accepts independently declared drift on both sharing siblings", () => {
  const c = sharedFixture(1.08, 1.08, true);
  expect(prepareRepin(c).expected.exitCode).toBe(0);
});
it("refuses allowed max 99 on an undrifted shared marker", () => {
  const c = sharedFixture(1.05, 1.05);
  c.decisions[0].entries[0].observed = [1.05, 1.05];
  c.decisions[0].entries[0].to = [0, 1.05, 1.05, 99];
  expect(() => prepareRepin(c)).toThrow(/No drift/);
});
it("refuses a freely widened or narrowed allowed bound even when drift exists", () => {
  for (const to of [
    [0, 1.08, 1.08, 99],
    [1.04, 1.08, 1.08, 1.12],
  ]) {
    const c = sharedFixture();
    c.decisions[0].entries[0].to = to;
    expect(() => prepareRepin(c)).toThrow(/documented tolerance/);
  }
});
it("refuses every unreviewed or missing approval flag", () => {
  for (const flag of [false, undefined, "true", 1]) {
    const c = sharedFixture();
    c.decisions[0].entries[0].reviewed = flag;
    expect(() => prepareRepin(c)).toThrow(/Unreviewed/);
  }
});
it("validates an unused baseline binding", () => {
  const c = sharedFixture();
  c.decisions[0].baselineSha256 = hash("unused stale baseline");
  expect(() => prepareRepin(c)).toThrow(/baseline/);
});
it("binds the complete sorted checker inventory, refusing a stale value in each module", async () => {
  const current = await readCheckers(
    fileURLToPath(new URL("./", import.meta.url)),
  );
  expect(Object.keys(current).length).toBeGreaterThanOrEqual(41);
  expect(checkerManifestHash(current)).toBe(
    checkerManifestHash(Object.fromEntries(Object.entries(current).reverse())),
  );
  for (const name of Object.keys(current)) {
    const c = sharedFixture();
    c.report.checkers = { ...current, "expectations.mjs": c.registrySha256 };
    c.checkerSha256 = checkerManifestHash(c.report.checkers);
    c.report.checkerSha256 = c.checkerSha256;
    c.decisions[0].checkerSha256 = c.checkerSha256;
    c.report.checkers[name] = hash("stale");
    // Even rebinding the report's own claimed bundle cannot change local code.
    c.report.checkerSha256 = checkerManifestHash(c.report.checkers);
    expect(() => prepareRepin(c)).toThrow(/checker|registry/);
  }
  const c = sharedFixture();
  c.decisions[0].checkerSha256 = hash("stale decisions");
  expect(() => prepareRepin(c)).toThrow(/checkerSha256/);
});

function reportFor(registry, findings) {
  const rows = Array.from({ length: 24 }, (_, n) => ({
    id: `${cid}/DQ-${String(n + 1).padStart(2, "0")}/sheet-1`,
    case: cid,
    dq: `DQ-${String(n + 1).padStart(2, "0")}`,
    sheet: 1,
    medium: "svg",
    viewScope: view,
    check: "sheet",
    status: "pass",
    evidence: { findings: [] },
  }));
  findings.forEach((f, n) => {
    const i = f.identities[0];
    rows.push({
      id: `${cid}/${i.dq}/finding-${n}`,
      case: cid,
      dq: i.dq,
      sheet: i.sheet.startsWith("sheet:") ? Number(i.sheet.slice(6)) : 1,
      medium: i.medium,
      viewScope: i.sheet,
      check: i.check,
      status: "fail",
      evidence: { findings: [f] },
    });
  });
  const report = {
    format: "thermite-draw-eval/1.0",
    mode: "strict",
    subset: "full",
    cases: [cid],
    corpusSha256: "seal",
    evalsVersion: "4.2",
    checkers: { "expectations.mjs": hash(serializeRegistry(registry)) },
    results: rows,
  };
  report.checkerSha256 = checkerManifestHash(report.checkers);
  const a = reassess(report, registry, specs);
  return {
    ...report,
    results: a.rows,
    summary: a.summary,
    drift: a.drift,
    exitCode: a.exitCode,
  };
}
function d1Fixture() {
  const links = [
    ["Manufacturer", "Mfr."],
    ["Manufacturer", "Mfr."],
    ["Type", "Description / type"],
    ["Module", "Device"],
    ["Module", "Device"],
  ];
  const oldIds = links.map(([text], n) => identity(`header/${n}/${text}`)),
    newIds = links.map(([, text], n) => identity(`header/${n}/${text}`));
  const added = {
    ...identity("title/checked"),
    kind: "missing-title-field",
    dq: "DQ-18",
    sheet: "sheet:1",
  };
  const literal = {
    ...identity("null-policy/wires/Color / size/literal-placeholder"),
    kind: "report-null-placeholder",
    dq: "DQ-19",
  };
  const drift = identity("report/Designations");
  const mk = (i, count = [1, 1]) => ({
    id: markerId(i),
    dq: i.dq,
    family: i.family,
    kind: i.kind,
    locator: i.locator,
    check: i.check,
    coarse: false,
    scopes: [{ cases: [cid], sheets: [i.sheet], media: [i.medium] }],
    bands:
      i.kind === "pdf-svg-advance-difference"
        ? { advanceRatio: [1, 1.05, 1.05, 1.1] }
        : {},
    count,
  });
  const registry = loadedRegistry({
    format: "thermite-draw-expectations/2.0",
    markers: [
      ...oldIds.map((i, n) => mk(i, n === 0 ? [2, 2] : [1, 1])),
      mk(added),
      mk(literal),
      mk(drift),
    ],
  });
  const f = (i, text, more = {}) => ({
    kind: i.kind,
    text,
    sourceLocator: i.locator.replace("font-pair/report/header/", "header/"),
    identities: [i],
    ...(i.kind === "pdf-svg-advance-difference" ? { advanceRatio: 1.05 } : {}),
    ...more,
  });
  const oldFindings = oldIds.map((i, n) =>
    f(
      i,
      links[n][0],
      n === 0
        ? {
            instances: [
              {
                text: links[n][0],
                sourceLocator: i.locator.replace(
                  "font-pair/report/header/",
                  "header/",
                ),
                advanceRatio: 1.05,
              },
              {
                text: "Unspecified",
                sourceLocator: "bom/row-1/manufacturer",
                advanceRatio: 1.05,
              },
            ],
          }
        : {},
    ),
  );
  const baseline = reportFor(registry, [
    ...oldFindings,
    f(added, "checked"),
    f(literal, "Unspecified"),
    f(drift, "Designations"),
  ]);
  const report = reportFor(registry, [
    ...newIds.map((i, n) => f(i, links[n][1])),
    f(added, "checked"),
    f({ ...added, sheet: "sheet:21" }, "checked"),
    f(drift, "Designations", { advanceRatio: 1.08 }),
  ]);
  const baselineSha256 = hash(json(baseline)),
    reportSha256 = hash(json(report)),
    before = instanceInventory(baseline, baselineSha256),
    after = instanceInventory(report, reportSha256);
  const entries = [];
  const common = {
    reviewed: true,
    signOff: {
      kind: "agent",
      by: "Synthetic reviewer fixture (not an approval)",
    },
    causeClass: "D1-reviewed-cause",
    note: "Synthetic D1 handoff fit; no electrical source",
    classification: "drawing",
  };
  const target = (t) => ({ markerId: t.markerId, scope: t.scope });
  for (const [n, i] of oldIds.entries()) {
    const a = before.instances.find(
        (t) => t.markerId === markerId(i) && t.facts.text === links[n][0],
      ),
      b = after.instances.find((t) => t.markerId === markerId(newIds[n]));
    entries.push({
      ...common,
      action: "rename",
      crop: {
        path: `evals/out/draw-samples/fixture/header-${n}.png`,
        sha256: hash(`crop-${n}`),
      },
      from: target(a),
      to: target(b),
      pairs: [
        {
          from: a.token,
          to: b.token,
          text: { from: links[n][0], to: links[n][1] },
          sourceLocator: {
            from: a.facts.sourceLocator,
            to: b.facts.sourceLocator,
          },
        },
      ],
    });
    if (n === 0) {
      const blank = before.instances.find(
        (t) => t.markerId === markerId(i) && t.facts.text === "Unspecified",
      );
      entries.push({
        ...common,
        action: "retire",
        ...target(a),
        cause: "removed",
        instances: [blank.token],
      });
      entries.push({
        ...common,
        action: "envelope-drift",
        markerId: markerId(newIds[n]),
        metric: "occurrences",
        from: [2, 2],
        to: [1, 1],
        observed: [1, 1],
        coverage: "full",
      });
    }
  }
  const extra = after.instances.find(
    (t) => t.markerId === markerId(added) && t.scope.sheet === "sheet:21",
  );
  entries.push({
    ...common,
    action: "scope-added",
    to: target(extra),
    instances: [extra.token],
  });
  entries.push({
    ...common,
    action: "retire",
    markerId: markerId(literal),
    scope: { case: cid, sheet: view, medium: "svg" },
    cause: "fixed",
  });
  entries.push({
    ...common,
    action: "envelope-drift",
    markerId: markerId(drift),
    metric: "advanceRatio",
    from: [1, 1.05, 1.05, 1.1],
    to: [1, 1.08, 1.08, 1.13],
    observed: [1.08, 1.08],
    coverage: "full",
  });
  const registrySha256 = hash(serializeRegistry(registry));
  for (const e of entries.filter((e) => e.action === "rename")) {
    const p = e.pairs.find((p) => p.sourceLocator);
    if (p)
      e.columnMap = {
        from: p.sourceLocator.from.split("/").slice(2).join("/"),
        to: p.sourceLocator.to.split("/").slice(2).join("/"),
      };
  }
  return {
    registry,
    registrySha256,
    report,
    reportSha256,
    checkerSha256: report.checkerSha256,
    specs,
    cropHashes: new Map(
      links.map((_, n) => [
        `evals/out/draw-samples/fixture/header-${n}.png`,
        hash(`crop-${n}`),
      ]),
    ),
    baselines: new Map([[baselineSha256, baseline]]),
    decisions: [
      {
        format: DECISIONS_FORMAT,
        pr: "#D1-fit",
        summarySha256: reportSha256,
        registrySha256,
        checkerSha256: report.checkerSha256,
        corpusSha256: "seal",
        evalsVersion: "4.2",
        baselineSha256,
        entries,
      },
    ],
  };
}
it("expresses all D1 item classes without booking any of five changed-text moves as a fix", () => {
  const c = d1Fixture(),
    result = prepareRepin(c);
  expect(result.expected.exitCode).toBe(0);
  expect(result.expected.outcomes).toEqual({
    superseded: 0,
    supersededSurvivors: 0,
    notMove: 0,
    fixes: 1,
    moves: 5,
    additions: 1,
    newDefects: 0,
    removals: 1,
    notMeasured: 0,
    changedHeaderMoves: 5,
  });
  expect(
    result.receipts
      .filter((r) => r.action === "retire")
      .every((r) => r.markerId.includes("DQ-19") || r.instances === 1),
  ).toBe(true);
});
it("refuses missing, stale and unused literal text mappings on D1 moves", () => {
  for (const mutation of [
    (e) => delete e.pairs[0].text,
    (e) => (e.pairs[0].text.to = "wrong"),
  ]) {
    const c = d1Fixture();
    mutation(c.decisions[0].entries[0]);
    expect(() => prepareRepin(c)).toThrow(/text rename mapping/);
  }
  const c = sharedFixture();
  c.decisions[0].entries[0].text = { from: "K1", to: "K1" };
  expect(() => prepareRepin(c)).toThrow(/Unknown/);
});
it("drafts visibly unapproved entries without choosing causes, matching only unique exact facts", () => {
  const c = d1Fixture(),
    inventory = reviewInventory(c),
    draft = draftDecisions(inventory, { pr: "#D1" });
  expect(draft.entries.length).toBeGreaterThan(5);
  expect(
    draft.entries.every(
      (e) => e.reviewed === false && e.causeClass === "" && e.note === "",
    ),
  ).toBe(true);
  expect(
    draft.entries
      .filter((e) => e.action === "retire")
      .every((e) => e.cause === ""),
  ).toBe(true);
  expect(draft.entries.some((e) => e.action === "scope-added")).toBe(true);
  expect(() => prepareRepin({ ...c, decisions: [draft] })).toThrow(
    /Unreviewed/,
  );
  expect(json(draftDecisions(inventory, { pr: "#D1" }))).toBe(json(draft));
});
it("drafts exact same-text moves but leaves ambiguous facts for inspection", () => {
  const c = d1Fixture(),
    inventory = reviewInventory(c);
  const old = inventory.baselines[0].instances.find(
    (i) => i.facts.text === "Manufacturer",
  );
  const now = inventory.current.find((i) => i.facts.text === "Mfr.");
  now.facts = { ...old.facts, view: "renamed view" };
  const draft = draftDecisions(inventory, { pr: "#D1" });
  expect(draft.entries.some((e) => e.action === "rename")).toBe(true);
  inventory.current.push({ ...now, token: hash("duplicate facts") });
  expect(
    draftDecisions(inventory, { pr: "#D1" }).entries.some(
      (e) => e.action === "rename",
    ),
  ).toBe(false);
});

it("refuses per-marker DQ-21 narrowing against the complete font-pair population", () => {
  const c = sharedFixture();
  c.decisions[0].entries[0].to = [1.03, 1.08, 1.08, 1.13];
  expect(() => prepareRepin(c)).toThrow(/documented tolerance/);
});
