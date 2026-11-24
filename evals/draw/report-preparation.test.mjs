import { expect, it } from "vitest";
import { assemble, view, it0 } from "./repin-fixture.mjs";
import { prepareRepin, reassess, reviewInventory } from "./repin-core.mjs";
import { hash, json } from "./support.mjs";

const fixture = () =>
  assemble({
    registryItems: [],
    currentItems: [],
    measuredViews: [view],
    entries: () => [],
  });
function assessed(c, report) {
  const a = reassess(report, c.registry, c.specs);
  Object.assign(report, {
    results: a.rows,
    summary: a.summary,
    drift: a.drift,
    exitCode: a.exitCode,
  });
}
function historical(c) {
  const report = structuredClone(c.report);
  report.evalsVersion = "5.3";
  for (const counts of Object.values(report.summary)) {
    delete counts["not-applicable"];
    delete counts["not-measured"];
  }
  c.baselines = new Map([[hash(json(report)), report]]);
  return report;
}
it.each(["pass", "not-applicable"])(
  "missing %s DQ-07 coverage refuses even with consistent counters",
  (status) => {
    const c = fixture();
    const r = c.report.results.find((r) => r.dq === "DQ-07");
    r.status = status;
    assessed(c, c.report);
    expect(() => reviewInventory(c)).not.toThrow();
    c.report.results = c.report.results.filter((row) => row.id !== r.id);
    assessed(c, c.report);
    expect(() => reviewInventory(c)).toThrow(
      /Missing check observation: .*DQ-7/,
    );
  },
);
it("an expectation row cannot replace a missing native check observation", () => {
  const c = assemble({
    registryItems: [it0("missing", { dq: "DQ-07" })],
    currentItems: [],
    measuredViews: [view],
    entries: () => [],
  });
  c.report.results = c.report.results.filter(
    (r) => r.dq !== "DQ-07" || r.expectation,
  );
  assessed(c, c.report);
  expect(c.report.results.some((r) => r.dq === "DQ-07" && r.expectation)).toBe(
    true,
  );
  expect(() => reviewInventory(c)).toThrow(/Missing check observation: .*DQ-7/);
});
it("reads only the two absent 5.3 counters as zero without changing historical bytes or pins", () => {
  const c = fixture(),
    baseline = historical(c),
    bytes = json(baseline);
  expect(reviewInventory(c).baselines).toHaveLength(1);
  expect(json(baseline)).toBe(bytes);
  expect(hash(bytes)).toBe([...c.baselines.keys()][0]);
});
it("the current target cannot opt into the historical summary reader", () => {
  const c = fixture();
  c.report.evalsVersion = "5.3";
  delete c.report.summary["DQ-07"]["not-applicable"];
  expect(() => reviewInventory(c)).toThrow(
    /Current report eval version is stale/,
  );
});
it.each(["thermite-draw-eval/1.0", "thermite-draw-eval/1.1"])(
  "accepts a bound %s baseline with a 1.1 target and refuses a 1.0 target",
  (format) => {
    const c = fixture();
    const baseline = { ...c.baselines.values().next().value, format };
    const sha256 = hash(json(baseline));
    c.baselines = new Map([[sha256, baseline]]);
    c.decisions[0].baselineSha256 = sha256;
    expect(c.report.format).toBe("thermite-draw-eval/1.1");
    expect(reviewInventory(c).baselines).toEqual([{ sha256, instances: [] }]);
    expect(prepareRepin(c).expected.exitCode).toBe(0);

    c.report.format = "thermite-draw-eval/1.0";
    c.reportSha256 = c.decisions[0].summarySha256 = hash(json(c.report));
    expect(() => reviewInventory(c)).toThrow(/Unsupported report format/);
    expect(() => prepareRepin(c)).toThrow(/Unsupported report format/);
  },
);
it.each([
  "4.1",
  "4.2",
  "4.9",
  "5.0",
  "5.2",
  "5.14",
  "5.15",
  "5.31",
  "5.32",
  "5.33",
  "5.35",
  "5.44",
])("preserves exact complete-summary baseline support for %s", (version) => {
  const c = fixture(),
    baseline = [...c.baselines.values()][0];
  baseline.evalsVersion = version;
  expect(() => reviewInventory(c)).not.toThrow();
  delete baseline.summary["DQ-07"]["not-applicable"];
  expect(() => reviewInventory(c)).toThrow(/summary does not match/);
});
it.each(["not-applicable", "not-measured"])(
  "missing nonzero historical %s counter refuses",
  (status) => {
    const c = fixture(),
      baseline = historical(c);
    baseline.results.find((r) => r.dq === "DQ-07").status = status;
    assessed(c, baseline);
    delete baseline.summary["DQ-07"][status];
    expect(() => reviewInventory(c)).toThrow(/summary does not match/);
  },
);
it.each(["pass", "manual", "not-implemented"])(
  "5.3 does not fill missing %s counters",
  (status) => {
    const c = fixture(),
      baseline = historical(c);
    delete baseline.summary["DQ-07"][status];
    expect(() => reviewInventory(c)).toThrow(/summary does not match/);
  },
);
it.each(["5.3.0", "5.999", "6.0", "unknown"])(
  "unknown summary version %s refuses",
  (version) => {
    const c = fixture(),
      baseline = historical(c);
    baseline.evalsVersion = version;
    expect(() => reviewInventory(c)).toThrow(
      /Unsupported report summary version/,
    );
  },
);
it.each(["not-applicable", "not-measured"])(
  "current summary missing even a zero %s counter refuses",
  (status) => {
    const c = fixture();
    delete c.report.summary["DQ-07"][status];
    expect(() => reviewInventory(c)).toThrow(/summary does not match/);
  },
);
