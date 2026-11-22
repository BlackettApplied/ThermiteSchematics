import {
  strictCoverageReason,
  policyStatusCounts,
  statusTable,
} from "./report-status.mjs";
import { summary } from "./assessment.mjs";
import { expect, it } from "vitest";
import { measurementCoverage } from "./measurement-coverage.mjs";
import { exitCode } from "./assessment.mjs";
import { netLabelRepetition } from "./checks.mjs";
import { netLabelFixture } from "./net-label-fixture.mjs";
const empty = () => ({ texts: [], shapes: [] });
const row = (suffix, status = "pass") => ({
  id: `case/DQ-19/${suffix}`,
  case: "case",
  dq: "DQ-19",
  sheet: 2,
  medium: "svg",
  status,
  evidence: { findingCount: status === "fail" ? 1 : 0, findings: [] },
});
it("r2.1 locator coverage uses row identity when the dependency row fails", () => {
  const dependency = row("dependencies-2", "fail"),
    locator = row("sheet-002"),
    unrelated = row("other");
  const audit = {
    notMeasured: [{ sheet: 2, row: "core", end: 1, reason: "missing caption" }],
    measurements: [
      {
        sheet: 2,
        row: "spare",
        end: 0,
        status: "not-applicable",
        nativeAbsence: "explicit-unterminated",
      },
    ],
  };
  for (const rows of [
    [dependency, unrelated, locator],
    [locator, dependency, unrelated],
  ]) {
    measurementCoverage(rows, empty(), audit, { number: 2 });
    expect(dependency.status).toBe("fail");
    expect(dependency.evidence.notMeasured).toBeUndefined();
    expect(dependency.evidence.nativeEndAbsences).toBeUndefined();
    expect(locator.status).toBe("not-measured");
    expect(locator.evidence.nativeEndAbsences).toHaveLength(1);
    expect(unrelated.status).toBe("pass");
  }
});
it("r2.2 strict mode rejects not-measured and report-only preserves the observation", () => {
  const rows = [row("sheet-002", "not-measured")];
  expect(exitCode(rows)).toBe(1);
  expect(exitCode(rows, true)).toBe(0);
  expect(exitCode([...rows, { status: "infrastructure-error" }])).toBe(2);
});
it("r2.5 a reversed polyline without a source anchor is not measured", () => {
  const { g, label, route } = netLabelFixture();
  g.texts = [label];
  route.points.reverse();
  route.ownedLandings = [];
  const rows = [
    {
      id: "case/DQ-17/sheet-002",
      dq: "DQ-17",
      status: "pass",
      evidence: { findings: [] },
    },
  ];
  measurementCoverage(rows, g, undefined, { number: 2 });
  expect(rows[0].status).toBe("not-measured");
  expect(rows[0].reason).toMatch(/direction|anchor/i);
  expect(netLabelRepetition(g)).toEqual([]);
});
it("r2.5 a multi-piece route measures the source half once over the whole source-ordered route", () => {
  const { g, label, route } = netLabelFixture();
  g.texts = [label];
  const first = {
    ...route,
    points: [
      { x: 10, y: 20 },
      { x: 40, y: 20 },
    ],
  };
  const second = {
    ...route,
    ownedLandings: [],
    points: [
      { x: 40, y: 20 },
      { x: 190, y: 20 },
    ],
  };
  g.shapes = [second, first];
  label.bbox = { x: 50, y: 17, w: 8, h: 3 };
  expect(netLabelRepetition(g)).toEqual([]);
  label.bbox = { x: 170, y: 17, w: 8, h: 3 };
  const failures = netLabelRepetition(g);
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({
    kind: "net-label-not-at-route-source",
    routeLength: 180,
  });
});

it("r2.2 Markdown and policy summaries expose not-measured with a strict reason", () => {
  const rows = [row("sheet-002", "not-measured")];
  expect(strictCoverageReason(rows)).toBeTypeOf("string");
  expect(strictCoverageReason(rows)).toMatch(/1 not-measured.*strict mode/i);
  expect(strictCoverageReason(rows, true)).toBeUndefined();
  const table = statusTable(summary(rows));
  expect(table[0]).toContain("Not measured");
  expect(table.find((s) => s.startsWith("| DQ-19 |"))).toBe(
    "| DQ-19 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |",
  );
  rows[0].classification = "policy-gap";
  expect(policyStatusCounts(rows)["not-measured"]).toBe(1);
});
