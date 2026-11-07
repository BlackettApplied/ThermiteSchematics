import { it, expect } from "vitest";
import { checkColumnMap } from "./repin-reconcile.mjs";
import { seed } from "./marker-authoring.mjs";
import { bands } from "./marker-metrics.mjs";
import {
  sourceRow,
  proveMove,
  sheetRenameMap,
  cropClaimTracker,
} from "./repin-policy.mjs";

const pair = "Arial/NotoSans";
function population() {
  return [1.0, 1.3].map((advanceRatio, n) => ({
    id: `fixture/DQ-21/${n}`,
    case: "fixture-left-to-right",
    dq: "DQ-21",
    check: "sheet",
    sheet: 1,
    status: "fail",
    evidence: {
      findings: [
        {
          kind: "pdf-svg-advance-difference",
          fontPair: pair,
          advanceRatio,
          identities: [
            {
              dq: "DQ-21",
              family: "font-metrics",
              kind: "pdf-svg-advance-difference",
              locator: `font-pair/${pair}/bom/column-${n}`,
              check: "sheet",
              coarse: false,
              sheet: "view:bom/BOM",
              medium: "svg",
            },
          ],
        },
      ],
    },
  }));
}
it("re-pin bounds reproduce seeded font-pair bounds for an unchanged population", () => {
  const rows = population(),
    full = rows.flatMap((r) => r.evidence.findings),
    registry = seed(rows, [
      { id: "fixture-left-to-right", flow: "left-to-right" },
    ]);
  for (const f of full) {
    const expected = registry.markers.find(
      (m) => m.locator === f.identities[0].locator,
    ).bands;
    expect(bands([f], full)).toEqual(expected);
    expect(expected.advanceRatio).toEqual([
      0.95,
      f.advanceRatio,
      f.advanceRatio,
      1.35,
    ]);
    expect(JSON.stringify(bands([f], full))).toBe(JSON.stringify(expected));
  }
});
it("keeps different font pairs out of the shared DQ-21 envelope", () => {
  const fs = population().flatMap((r) => r.evidence.findings);
  const other = { ...fs[0], fontPair: "Courier/Mono", advanceRatio: 2 };
  expect(bands([fs[0]], [...fs, other]).advanceRatio).toEqual([
    0.95, 1, 1, 1.35,
  ]);
});
it("refuses the repeated crop from the reviewer's mechanically completed D1 draft", () => {
  // Two actual new-defect records from r7/d1dry/d1-mech.json, reduced to the
  // crop/identity fields needed for this regression. Sign-off is mocked data.
  const crop = {
    path: "evals/out/draw-samples/r7/crop.png",
    sha256: "ed3ca566e86e02a78420bd32f79445bf53facabe34175b1fed297cd702ae023d",
  };
  const entries = [
    { action: "new-defect", markerId: "DQ-21/efbe748c900da91f", crop },
    { action: "new-defect", markerId: "DQ-21/80d9e7b2836a741e", crop },
  ];
  const claim = cropClaimTracker(new Map([[crop.path, crop.sha256]]));
  claim(entries[0].crop);
  expect(() => claim(entries[1].crop)).toThrow(/distinct crop hash/);
});
const cid = "fixture-left-to-right",
  specs = [{ id: cid, flow: "left-to-right" }];
const item = (sourceLocator = 'cell/io/["PLC1","di0"]/Module', extra = {}) => ({
  scope: { case: cid, medium: "svg", sheet: "view:io/I/O schedule" },
  physicalSheet: 4,
  facts: {
    case: cid,
    medium: "svg",
    flow: "left-to-right",
    dq: "DQ-21",
    check: "sheet",
    kind: "pdf-svg-advance-difference",
    view: "view:io/I/O schedule",
    sourceLocator,
    text: "Module",
    ...extra,
  },
});
it("keeps a semantic cell row including slash-bearing IDs and column labels", () => {
  expect(sourceRow('cell/cables/["CBL/A",["x/y"]]/Description / type')).toEqual(
    {
      kind: "cell/cables",
      row: 'cell/cables/["CBL/A",["x/y"]]',
      column: "Description / type",
    },
  );
  const a = item(),
    b = item('cell/io/["PLC1","di0"]/Device', { text: "Device" });
  expect(
    proveMove(a, b, new Map(), specs, { from: "Module", to: "Device" })
      .sourceRow,
  ).toBe('cell/io/["PLC1","di0"]');
});
it.each([
  ['cell/io/["PLC1","di1"]/Device', {}, "source row or locator kind changed"],
  ["header/io/Device", {}, "source row or locator kind changed"],
  [
    'cell/cables/["PLC1","di0"]/Device',
    {},
    "source row or locator kind changed",
  ],
  ["device/K2/text", {}, "source row or locator kind changed"],
  ['cell/io/["PLC1","di0"]/Device', { medium: "pdf" }, "medium changed"],
  ['cell/io/["PLC1","di0"]/Device', { flow: "top-to-bottom" }, "flow changed"],
  ['cell/io/["PLC1","di0"]/Device', { dq: "DQ-02" }, "dq changed"],
  ['cell/io/["PLC1","di0"]/Device', { check: "other" }, "check changed"],
  ['cell/io/["PLC1","di0"]/Device', { view: "view:bom/BOM" }, "view changed"],
])(
  "refuses an unrelated pair or fix/new defect disguised as a move: %s",
  (loc, extra, reason) => {
    expect(() =>
      proveMove(item(), item(loc, extra), new Map(), specs, {
        from: "Module",
        to: "Device",
      }),
    ).toThrow(reason);
  },
);
it("requires a declared physical sheet rename and rejects contradictory maps", () => {
  const a = item(),
    b = { ...item(), physicalSheet: 5 };
  expect(() => proveMove(a, b, new Map(), specs)).toThrow(/physical sheet/);
  const declaration = {
    case: cid,
    medium: "svg",
    from: "sheet:4",
    to: "sheet:5",
  };
  const map = sheetRenameMap([{ sheetRenames: [declaration] }], specs);
  expect(proveMove(a, b, map, specs).sheetRename).toBe(true);
  expect(() =>
    sheetRenameMap(
      [{ sheetRenames: [declaration, { ...declaration, to: "sheet:6" }] }],
      specs,
    ),
  ).toThrow(/Conflicting/);
});
it("never mistakes slash-bearing row IDs for renamed columns", () => {
  const a = item("cell/wires/W/1/Label"),
    b = item("cell/wires/W/2/Label");
  expect(() => proveMove(a, b, new Map(), specs)).toThrow(/source row/);
  expect(
    sourceRow("cell/wires/W/1/Description / type", "Description / type"),
  ).toEqual({
    kind: "cell/wires",
    row: "cell/wires/W/1",
    column: "Description / type",
  });
});
it("preserves logical view kind even with a declared scope mapping", () => {
  expect(() =>
    sheetRenameMap(
      [
        {
          sheetRenames: [
            {
              case: cid,
              medium: "svg",
              from: "view:io/Old",
              to: "view:bom/New",
            },
          ],
        },
      ],
      specs,
    ),
  ).toThrow(/view kind/);
});
it.each(["class/text.unclassified", "font-pair/Arial/drawing/labels"])(
  "refuses changed text with only an aggregate locator: %s",
  (locator) => {
    expect(() =>
      proveMove(
        item(locator),
        item(locator, { text: "Unrelated caption" }),
        new Map(),
        specs,
      ),
    ).toThrow(/lack a semantic source locator/);
    expect(() =>
      proveMove(item(locator), item(locator), new Map(), specs),
    ).not.toThrow();
  },
);

it("column maps are consistent and reject a still-observed old column", () => {
  const a = item(),
    b = item('cell/io/["PLC1","di0"]/Device'),
    entry = {
      columnMap: { from: "Module", to: "Device" },
      pairs: [{ from: "a", to: "b" }],
    };
  const before = { byToken: new Map([["a", a]]) },
    current = { byToken: new Map([["b", b]]), instances: [b] };
  expect(() => checkColumnMap(entry, before, current)).not.toThrow();
  current.instances.push(a);
  expect(() => checkColumnMap(entry, before, current)).toThrow(
    /old column still exists/,
  );
  current.instances = [b];
  entry.columnMap.from = "Direction";
  expect(() => checkColumnMap(entry, before, current)).toThrow(
    /inconsistent columnMap/,
  );
});

it("sheet scope proof is independent of view and physical-sheet proof", () => {
  const a = item(),
    b = item();
  b.scope = { ...b.scope, sheet: "sheet:4" };
  expect(() => proveMove(a, b, new Map(), specs)).toThrow(
    "sheet scope has no declared rename",
  );
});
it("view kind proof rejects even a supplied cross-kind map", () => {
  const a = item(),
    b = item(undefined, { view: "view:bom/BOM" });
  const map = new Map([
    [JSON.stringify([cid, "svg", a.facts.view]), b.facts.view],
  ]);
  expect(() => proveMove(a, b, map, specs)).toThrow("view changed");
});
