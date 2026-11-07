import { expect, it, describe } from "vitest";
import { readFile } from "node:fs/promises";
import { assess, exitCode } from "./assessment.mjs";
import {
  seed,
  serializeRegistry,
  EXPECTATION_BUDGET,
} from "./marker-authoring.mjs";
import { svgLocators, attachIdentities } from "./locators.mjs";
import {
  compressCases,
  expand,
  compressSheets,
  expandSheets,
  units,
} from "./marker-scopes.mjs";
import { cases } from "./corpus.mjs";
import { expandRegistry } from "./marker-data.mjs";
const cid = "case-left-to-right",
  family = "fixture";
const specs = [
  { id: cid, project: family, flow: "left-to-right" },
  { id: "case-top-to-bottom", project: family, flow: "top-to-bottom" },
];
const rect = { x: 20, y: 30, w: 10, h: 3 };
function row(extra = {}) {
  const r = {
    id: `${cid}/DQ-02/sheet-001`,
    dq: "DQ-02",
    case: cid,
    sheet: 1,
    status: "fail",
    family,
    viewScope: "view:wires/Wires",
    check: "sheet",
    evidence: {
      findings: [
        {
          kind: "text-outside-cell",
          element: "text-1",
          designation: "W1",
          bbox: rect,
          overflowMm: 21.642,
          identities: [
            {
              dq: "DQ-02",
              family,
              kind: "text-outside-cell",
              locator: "cell/wires/W1/label",
              sheet: "view:wires/Wires",
              medium: "svg",
              check: "sheet",
              coarse: false,
            },
          ],
        },
      ],
    },
    ...extra,
  };
  return structuredClone(r);
}
const registry = () => seed([row()], specs),
  selected = () => new Set([cid]);
describe("defect identity matching", () => {
  it("ignores DOM ordinals, positions and wrapped fragments", () => {
    const r = row();
    r.evidence.findings[0].element = "text-999";
    r.evidence.findings[0].bbox.x = 180;
    const second = structuredClone(r.evidence.findings[0]);
    second.element = "text-1000";
    r.evidence.findings.push(second);
    const result = assess([r], registry(), selected());
    expect(r.status).toBe("xfail");
    expect(
      result.drift.some((d) =>
        d.changes.some((c) => c.metric === "occurrences"),
      ),
    ).toBe(true);
  });
  it("lists in-band drift without failing", () => {
    const r = row();
    r.evidence.findings[0].overflowMm += 0.04;
    const report = assess([r], registry(), selected());
    expect(r.status).toBe("xfail");
    expect(report.drift[0].withinBand).toBe(true);
    expect(report.drift[0].changes[0].metric).toBe("overflowMm");
  });
  it("fails a measurement outside its band and shows the delta", () => {
    const r = row();
    r.evidence.findings[0].overflowMm = 25;
    assess([r], registry(), selected());
    expect(r.status).toBe("fail");
    expect(
      r.evidence.findings[0].assessments[0].deltas[0].delta,
    ).toBeGreaterThan(3);
    expect(exitCode([r])).toBe(1);
  });
  it("fails a new source locator under a known check", () => {
    const r = row(),
      f = structuredClone(r.evidence.findings[0]);
    f.identities[0].locator = "cell/wires/W2/label";
    r.evidence.findings.push(f);
    assess([r], registry(), selected());
    expect(r.status).toBe("fail");
    expect(f.assessments[0].reason).toBe("new defect identity");
  });
  it("turns a fixed defect into an xpass; report-only never hides its status", () => {
    const r = row({ status: "pass" });
    r.evidence.findings = [];
    const rows = [r];
    assess(rows, registry(), selected());
    expect(rows.some((r) => r.status === "xpass")).toBe(true);
    expect(exitCode(rows)).toBe(1);
    expect(exitCode(rows, true)).toBe(0);
  });
  it("keeps a partial fix visible when one flow is fixed and the other still fails", () => {
    const a = row(),
      b = row({
        id: "case-top-to-bottom/DQ-02/sheet-001",
        case: "case-top-to-bottom",
      }),
      markers = seed([a, b], specs);
    expect(markers.markers).toHaveLength(1);
    a.status = "pass";
    a.evidence.findings = [];
    const rows = [a, b];
    assess(rows, markers, new Set(specs.map((c) => c.id)));
    expect(b.status).toBe("xfail");
    expect(rows.filter((r) => r.status === "xpass")).toHaveLength(1);
    expect(exitCode(rows)).toBe(1);
  });
  it("fails missing instrumentation and never swallows infrastructure", () => {
    const rows = [];
    assess(rows, registry(), selected());
    expect(rows[0].status).toBe("fail");
    const failed = [row({ status: "infrastructure-error" })];
    assess(failed, registry(), selected());
    expect(exitCode(failed, true)).toBe(2);
  });
  it("does not reinterpret a manual/unimplemented observation as fixed", () => {
    for (const status of ["manual", "not-implemented"]) {
      const rows = [row({ status })];
      assess(rows, registry(), selected());
      expect(rows.some((r) => r.status === "fail")).toBe(true);
    }
  });
  it("ignores unselected cases and rejects unknown scopes instead of expanding patterns", () => {
    const rows = [];
    assess(rows, registry(), new Set(["unselected"]));
    expect(rows).toEqual([]);
    const r = row({
      id: "case-top-to-bottom/DQ-02/sheet-001",
      case: "case-top-to-bottom",
    });
    assess([r], registry(), new Set([r.case]));
    expect(r.status).toBe("fail");
    expect(r.evidence.findings[0].assessments[0].reason).toBe(
      "new scope of pinned defect",
    );
  });
  it("treats an eliminated physical sheet as stale, not as a pass", () => {
    const r = row();
    r.evidence.findings[0].identities[0].sheet = "sheet:1";
    const m = seed([r], specs),
      rows = [];
    assess(rows, m, selected(), {
      caseStates: { [cid]: { status: "rendered", sheets: [] } },
    });
    expect(rows[0].status).toBe("xpass");
    expect(exitCode(rows)).toBe(1);
  });
});
describe("stable source locators and exact deduplication", () => {
  it("maps old interleaved report cells and R2 wrapped groups to the same source field", () => {
    const ir = {
        devices: [],
        wires: [{ uid: "u1", designation: "W-CTL-001" }],
      },
      view = { kind: "wires", title: "Wires" },
      table = [{ kind: "wires", columns: ["Wire / label", "From"] }];
    const old =
      '<svg><g data-report-row="u1"><rect/><text>WWW</text><text>WWW</text><rect/><text>PS1.+</text></g></svg>';
    const next =
      '<svg><g data-report-row="u1"><rect/><rect/><g data-report-column="1" data-column-name="Wire / label"><text>WW</text><text>WW</text><text>WW</text></g><g data-report-column="2" data-column-name="From"><text>PS1.+</text></g></g></svg>';
    const a = [...svgLocators(old, ir, view, table)]
        .filter(([id]) => id.startsWith("text-"))
        .map(([, x]) => x.locator),
      b = [...svgLocators(next, ir, view, table)]
        .filter(([id]) => id.startsWith("text-"))
        .map(([, x]) => x.locator);
    expect(new Set(a)).toEqual(new Set(b));
    expect(a[0]).toContain("cell/wires/W-CTL-001/Wire / label");
  });
  it("does not give a header identity to empty-table messages or footer text", () => {
    const view = { kind: "terminals", title: "Terminals" };
    const svg =
      '<svg><rect stroke="#9ba6b4"/><text>State</text><text>No matching records</text><text>Footer note</text></svg>';
    const index = svgLocators(svg, {}, view, [
      { kind: "terminals", columns: ["State"] },
    ]);
    expect(index.get("text-1").locator).toBe("header/terminals/State");
    expect(index.get("text-2").source).toBe(false);
    expect(index.get("text-3").source).toBe(false);
  });
  it("pins one font/column cause and retains source-field evidence", () => {
    const r = row();
    r.dq = "DQ-21";
    r.evidence.findings = [
      {
        kind: "pdf-svg-advance-difference",
        element: "text-0",
        bbox: rect,
        text: "A",
        deltaMm: 0.5,
        svgWidthMm: 10,
        fontPair: "Arial/Noto Sans Mono",
      },
    ];
    const map = new Map([
      [
        "text-0",
        { locator: "cell/wires/W1/label", source: true, column: "label" },
      ],
    ]);
    attachIdentities([r], map, { kind: "wires", title: "Wires" }, {}, family);
    expect(r.evidence.findings[0].identities[0].locator).toBe(
      "font-pair/Arial/Noto Sans Mono/wires/label",
    );
    expect(r.evidence.findings[0].sourceLocator).toBe("cell/wires/W1/label");
    expect(r.evidence.findings[0].identities[0].sheet).toBe("view:wires/Wires");
  });
  it("expands compressed flow/sweep selectors to exactly the pinned cases, never future cases", () => {
    const ids = cases()
        .filter((c) => c.sweep?.project === "motor-starter")
        .map((c) => c.id),
      patterns = compressCases(ids);
    expect(patterns).toHaveLength(1);
    expect(patterns.flatMap(expand).sort()).toEqual(ids.sort());
    expect(patterns[0]).not.toContain("*");
    expect(
      compressSheets(["sheet:1", "sheet:2", "sheet:3", "sheet:5"]),
    ).toEqual(["sheet:1-3", "sheet:5"]);
    expect(expandSheets("sheet:1-3")).toEqual([
      "sheet:1",
      "sheet:2",
      "sheet:3",
    ]);
    const subset = ids.filter((_, i) => i !== 3);
    expect(compressCases(subset).flatMap(expand).sort()).toEqual(subset.sort());
  });
  it("keeps IDs and existing storage references stable when adding a defect", () => {
    const a = registry();
    const decode = (source) =>
      new Function(
        "expandRegistry",
        source
          .replace(/^import .*;$/m, "")
          .replace("export const expectations", "const expectations") +
          "\nreturn expectations;",
      )(expandRegistry);
    expect(decode(serializeRegistry(a))).toEqual(a);
    const extra = structuredClone(a.markers[0]);
    extra.locator = "cell/wires/W2/label";
    const b = { ...a, markers: [extra, ...a.markers] };
    const before = serializeRegistry(a),
      after = serializeRegistry(b);
    const line = before.split("\n").find((l) => l.includes('"locator"'));
    expect(after.split("\n")).toContain(line);
    expect(
      decode(after).markers.find((m) => m.locator === a.markers[0].locator).id,
    ).toBe(a.markers[0].id);
  });
  it("fails a marker whose case was removed from the entire corpus", () => {
    expect(() =>
      assess([], registry(), new Set(), { allCases: new Set() }),
    ).toThrow(/Stale marker case/);
  });
  it("enforces the committed expectation-data budget", async () => {
    const text = serializeRegistry(registry());
    expect(Buffer.byteLength(text)).toBeLessThan(EXPECTATION_BUDGET);
    expect(
      (await readFile(new URL("./expectations.mjs", import.meta.url)))
        .byteLength,
    ).toBeLessThanOrEqual(EXPECTATION_BUDGET);
    expect(() =>
      serializeRegistry({
        markers: [
          { ...registry().markers[0], locator: "x".repeat(EXPECTATION_BUDGET) },
        ],
      }),
    ).toThrow(/exceed/);
  });
});

it("rejects changed shared definitions under an existing content ID", () => {
  expect(() => expandRegistry({ changed: [] }, {}, [])).toThrow(
    /new content ID/,
  );
});

it("keeps a source column locator when a legacy header wraps inside a word", () => {
  const svg =
    '<svg><rect stroke="#9ba6b4"/><text>Termi</text><text>nal</text><text>No matching records</text></svg>';
  const index = svgLocators(svg, {}, { kind: "terminals" }, [
    { kind: "terminals", columns: ["Terminal"] },
  ]);
  expect(index.get("text-1").locator).toBe("header/terminals/Terminal");
  expect(index.get("text-2").locator).toBe("header/terminals/Terminal");
  expect(index.get("text-3").source).toBe(false);
});

it("a text-only change in another reference cell stays one font/column cause", () => {
  const make = (name, ratio) => {
    const r = row();
    r.dq = "DQ-21";
    r.id = `${cid}/DQ-21/sheet-001`;
    r.evidence.findings = [
      {
        kind: "pdf-svg-advance-difference",
        element: "text-0",
        text: name,
        bbox: rect,
        fontPair: "Arial/Noto",
        advanceRatio: ratio,
        svgWidthMm: 10,
        pdfWidthMm: 10 * ratio,
      },
    ];
    attachIdentities(
      [r],
      new Map([
        [
          "text-0",
          {
            locator: `cell/references/${name}/Sheet / zone`,
            source: true,
            column: "Sheet / zone",
          },
        ],
      ]),
      { kind: "references", title: "References" },
      {},
      family,
    );
    return r;
  };
  const baseline = make("CB1", 1.07),
    markers = seed([baseline], specs),
    changed = make("RIO1", 1.08);
  assess([changed], markers, selected());
  expect(changed.status).toBe("xfail");
  expect(markers.markers).toHaveLength(1);
  expect(changed.evidence.findings[0].sourceLocator).toContain("RIO1");
});

it("pins null placeholders per report/column cause across every rewritten source cell", () => {
  const make = (suffix) => {
    const r = row({ dq: "DQ-19", id: `${cid}/DQ-19/sheet-001` });
    r.evidence.findings = Array.from({ length: 20 }, (_, i) => ({
      kind: "report-null-placeholder",
      element: "text-" + i,
      bbox: rect,
      text: "Unspecified",
      columnIndex: 3,
    }));
    const index = new Map(
      r.evidence.findings.map((f, i) => [
        f.element,
        {
          locator: `cell/network/${suffix + i}/Status`,
          source: true,
          column: "Status",
        },
      ]),
    );
    attachIdentities(
      [r],
      index,
      { kind: "network", title: "Network" },
      {},
      family,
    );
    return r;
  };
  const a = make("old"),
    registry = seed([a], specs);
  expect(registry.markers).toHaveLength(1);
  const b = make("rewritten");
  assess([b], registry, selected());
  expect(b.status).toBe("xfail");
});
it("reports a D1-style blank-cell fix as an xpass, and retires only those scopes", async () => {
  const { retireXpasses } = await import("./update-markers.mjs");
  const a = row(),
    registry = seed([a], specs),
    fixed = row({ status: "pass" });
  fixed.evidence.findings = [];
  const rows = [fixed];
  assess(rows, registry, selected());
  expect(exitCode(rows)).toBe(1);
  const next = retireXpasses(
    registry,
    { mode: "strict", subset: "full", results: rows },
    specs,
  );
  expect(next.registry.markers).toEqual([]);
  expect(registry.markers).toHaveLength(1);
  expect(() =>
    retireXpasses(
      registry,
      {
        mode: "strict",
        subset: "full",
        results: [...rows, { status: "fail" }],
      },
      specs,
    ),
  ).toThrow(/Resolve/);
});
it("does not use an SVG observation to pretend a missing PDF scope was measured", () => {
  const a = row();
  a.evidence.findings[0].identities[0].medium = "pdf";
  const registry = seed([a], specs);
  const onlySvg = row({ status: "pass", medium: "svg" });
  onlySvg.evidence.findings = [];
  const rows = [onlySvg];
  assess(rows, registry, selected());
  expect(
    rows.some((r) => r.status === "fail" && r.reason.includes("not measured")),
  ).toBe(true);
  expect(rows.some((r) => r.status === "xpass")).toBe(false);
});
it("keeps a placeholder cause through a consistent whole-table rewrite and exposes blank cells as an xpass", async () => {
  const { reports } = await import("./checks.mjs");
  const make = (prefix, value) => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      element: `text-${i}`,
      text: value,
      row: prefix + i,
      columnIndex: 0,
      cell: { x: 0, y: i * 4, w: 20, h: 4 },
      bbox: { x: 1, y: i * 4 + 1, w: 10, h: 2 },
    }));
    const table = { rows: items.map((t) => ({ key: t.row, cells: [value] })) };
    const fs = reports(
      { texts: items, reportRows: items.map((t) => t.row) },
      { view: { kind: "network" } },
      {},
      table,
    );
    const r = row({
      dq: "DQ-19",
      id: `${cid}/DQ-19/sheet-001`,
      status: fs.length ? "fail" : "pass",
      evidence: { findings: fs },
    });
    const index = new Map(
      items.map((t) => [
        t.element,
        {
          locator: `cell/network/${t.row}/Status`,
          source: true,
          column: "Status",
        },
      ]),
    );
    attachIdentities(
      [r],
      index,
      { kind: "network", title: "Network" },
      {},
      family,
    );
    return r;
  };
  const initial = make("old", "Unspecified"),
    registry = seed([initial], specs);
  expect(registry.markers).toHaveLength(1);
  const changed = make("new", "None");
  assess([changed], registry, selected());
  expect(changed.status).toBe("xfail");
  const fixed = make("new", ""),
    rows = [fixed];
  assess(rows, registry, selected());
  expect(
    rows.some(
      (r) =>
        r.status === "xpass" &&
        r.expectation.kind === "report-null-placeholder",
    ),
  ).toBe(true);
});
