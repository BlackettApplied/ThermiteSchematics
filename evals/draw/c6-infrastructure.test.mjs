import { expect, it } from "vitest";
import { netLabelFixture } from "./net-label-fixture.mjs";
import { evaluateSheet, observation } from "./evaluate.mjs";
import {
  mediaIdentifiers,
  svgIdentifiers,
} from "./identifier-observations.mjs";
import {
  IdentifierMeasurementError,
  identifierContext,
} from "./identifier-errors.mjs";
import { missingMarkerRow } from "./marker-missing.mjs";
import { exitCode, assess } from "./assessment.mjs";
import { seed } from "./marker-authoring.mjs";
import { caseInfrastructure } from "./case-infrastructure.mjs";
const sheet = {
  number: 1,
  view: { format: "documentation-view/0.1", kind: "bom" },
  references: [],
  continuations: [],
};
const c = { id: "synthetic", flow: "left-to-right" },
  ir = { devices: [], functions: [], nets: [] };
const table = { kind: "bom", columns: [], rows: [] };
function geometry() {
  const { g } = netLabelFixture();
  g.reportRows = ["row"];
  g.reportCells = [];
  return g;
}
const evaluate = (tables) =>
  evaluateSheet(
    c,
    sheet,
    { sheets: [sheet] },
    geometry(),
    ir,
    [],
    [],
    [],
    tables,
  );
it("C6 identifier lookup failure retains all sheet observation IDs and other DQs", () => {
  const good = evaluate([table]),
    bad = evaluate([]);
  const failed = bad.find((r) =>
    r.id.endsWith("DQ-19/svg-identifier-infrastructure-1"),
  );
  expect(bad.filter((r) => r !== failed).map((r) => r.id)).toEqual(
    good.map((r) => r.id),
  );
  expect(bad).toHaveLength(good.length + 1);
  expect(failed).toMatchObject({
    sheet: 1,
    status: "infrastructure-error",
    instrumentation: "identifier",
  });
  expect(failed.reason).toContain("source table missing");
  expect(bad.filter((r) => r !== failed)).toEqual(
    good.filter((r) => r.id !== failed.id),
  );
  expect(exitCode(bad)).toBe(2);
});
it("C6 identifier geometry exceptions also become explicit infrastructure", () => {
  const g = geometry();
  delete g.reportCells;
  expect(
    svgIdentifiers(sheet, { sheets: [sheet] }, g, ir, [table], {}).extra,
  ).toMatchObject({
    status: "infrastructure-error",
    instrumentation: "identifier",
  });
});
it("C6 a PDF identifier extraction failure preserves the independent HTML observation", async () => {
  const g = geometry(),
    pdf = {
      getTextContent: async () => {
        throw Object.assign(Error("PDF extraction failed"), {
          name: "FormatError",
        });
      },
    };
  const rows = await mediaIdentifiers(
    c,
    sheet,
    { sheets: [sheet] },
    g,
    g,
    ir,
    [table],
    pdf,
    {},
    observation,
  );
  expect(rows.map((r) => [r.medium, r.status])).toEqual([
    ["html", "pass"],
    ["pdf", "infrastructure-error"],
  ]);
  expect(rows[1]).toMatchObject({ sheet: 1, instrumentation: "identifier" });
});
it("C6 native source lookup failure surfaces separately for both media", async () => {
  const g = geometry();
  const rows = await mediaIdentifiers(
    c,
    sheet,
    { sheets: [sheet] },
    g,
    g,
    ir,
    [],
    {},
    {},
    observation,
  );
  expect(rows).toHaveLength(2);
  expect(
    rows.every((r) => r.status === "infrastructure-error" && r.sheet === 1),
  ).toBe(true);
});
it("C6 failed identifier scopes receive neither repair credit nor unmet-pin cascades", () => {
  const marker = {
      id: "pin",
      dq: "DQ-19",
      check: "sheet",
      kind: "identifier-line-break",
      locator: "native",
    },
    unit = { case: "synthetic", sheet: "sheet:1", medium: "svg" },
    failed = { status: "infrastructure-error", instrumentation: "identifier" };
  expect(missingMarkerRow(marker, "key", unit, true, [failed]).status).toBe(
    "infrastructure-error",
  );
  expect(
    missingMarkerRow(marker, "key", unit, true, [], {
      instrumentation: "identifier",
    }).status,
  ).toBe("infrastructure-error");
  expect(missingMarkerRow(marker, "key", unit, true, []).status).toBe("fail");
});
it("C6 browser identifier errors retain their precise sheet and medium", () => {
  const e = identifierContext(
    new IdentifierMeasurementError("Identifier measurement: broken cell"),
    7,
    "html",
  );
  expect(e).toMatchObject({
    sheet: 7,
    medium: "html",
    instrumentation: "identifier",
  });
  const other = Error("unrelated");
  expect(identifierContext(other, 7, "html").sheet).toBeUndefined();
});
it.each([false, true])(
  "C6 real pin assessment preserves identifier infrastructure without cascading (case failure %s)",
  (caseFailure) => {
    const cid = "synthetic-left-to-right";
    const original = {
      id: `${cid}/DQ-19/sheet-001`,
      case: cid,
      dq: "DQ-19",
      sheet: 1,
      medium: "svg",
      status: "fail",
      check: "sheet",
      family: "fixture",
      evidence: {
        findings: [
          {
            kind: "identifier-line-break",
            element: "text",
            identities: [
              {
                dq: "DQ-19",
                family: "fixture",
                kind: "identifier-line-break",
                locator: "cell/bom/native",
                sheet: "sheet:1",
                medium: "svg",
                check: "sheet",
                coarse: false,
              },
            ],
          },
        ],
      },
    };
    const registry = seed(
      [original],
      [{ id: cid, project: "fixture", flow: "left-to-right" }],
    );
    const rows = caseFailure
      ? []
      : [
          {
            ...original,
            status: "infrastructure-error",
            instrumentation: "identifier",
            evidence: { findings: [] },
          },
        ];
    assess(rows, registry, new Set([cid]), {
      caseStates: {
        [cid]: caseFailure
          ? {
              status: "infrastructure",
              instrumentation: "identifier",
              sheets: [],
            }
          : { status: "rendered", sheets: [1] },
      },
    });
    expect(rows.every((r) => r.status === "infrastructure-error")).toBe(true);
    expect(rows.some((r) => r.expectation)).toBe(true);
    expect(exitCode(rows)).toBe(2);
  },
);
it("C6 fatal identifier geometry errors remain explicit sheet infrastructure in the case receipt", () => {
  const error = identifierContext(
      new IdentifierMeasurementError("Identifier measurement: broken geometry"),
      3,
      "svg",
    ),
    result = caseInfrastructure(
      error,
      { id: "synthetic" },
      [],
      "/checker",
      "/engine",
    );
  expect(result).toMatchObject({ instrumentation: "identifier", ok: false });
  expect(result.rows[0]).toMatchObject({
    sheet: 3,
    medium: "svg",
    status: "infrastructure-error",
  });
});
