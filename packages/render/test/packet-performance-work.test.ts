import { nativeDocumentTable } from "../src/packet/document-native.js";
import { navigationSnapshotDigest } from "../src/packet/navigation-identity.js";
import { svgSemanticId, decodeSvgSemanticId } from "../src/svg/escape.js";
import { navigationGeometry } from "../src/packet/navigation-walk.js";
import { withRenderCache } from "../src/packet/render-cache.js";
import {
  documentMeasurements,
  printedDocumentRegion,
} from "../src/packet/document-visible.js";
import { afterEach, expect, it, vi } from "vitest";
import { compileProject } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import {
  reportTokens,
  type ReportName,
} from "../src/packet/report-column-widths.js";
import { searchNavigationSlot } from "../src/packet/navigation-slot-search.js";
import { indexedRowFacts, rowFacts } from "../src/packet/document-facts.js";
import type { NavigationShape } from "../src/packet/navigation-types.js";

// Count actual primitive work, rather than elapsed time or an implementation counter.
afterEach(() => vi.restoreAllMocks());

it("computes navigation distance at most once per Cartesian candidate", () => {
  const obstacles = Array.from({ length: 50 }, (_, i) => ({
    x: 10 + i * 3.1,
    y: 10 + i * 2.7,
    w: 1,
    h: 1,
  }));
  const area = { x: 0, y: 0, w: 200, h: 200 },
    owner = { x: 95, y: 95, w: 10, h: 10 },
    shape: NavigationShape = {
      id: "work",
      mode: "self-located",
      inkMm: { x: 0, y: 0, w: 5, h: 3 },
      maximumForms: [],
      wrapWidthMm: 3,
    },
    distance = vi.spyOn(Math, "hypot");
  const result = searchNavigationSlot([shape], area, owner, obstacles);
  expect(result).toBeDefined();
  // Each obstacle contributes at most two x and y edges; four fixed edges per axis.
  expect(distance.mock.calls.length).toBeLessThanOrEqual(
    (4 + 2 * obstacles.length) ** 2,
  );
});

function countedNames(values: string[]) {
  let scans = 0;
  const names: ReportName[] = values.map((value) => ({
    get value() {
      scans++;
      return value;
    },
    kind: "designation",
  }));
  return { names, scans: () => scans };
}

function tokenWork(values: string[], cells: string[]) {
  const counted = countedNames(values);
  for (const cell of cells) reportTokens(cell, counted.names);
  // Building the index reads each name's UTF-16 characters once. Only actual
  // matches may read a name again; unrelated cells must not rescan all names.
  const limit =
    values.reduce((sum, value) => sum + 3 * value.length + 4, 0) +
    4 * cells.reduce((sum, cell) => sum + cell.length, 0);
  expect(counted.scans()).toBeLessThanOrEqual(limit);
  expect(reportTokens(values[0] ?? "", counted.names)).not.toEqual([]);
}

it("indexes the 300-device/1500-wire inventory without a name scan per cell", () => {
  const values = [
    ...Array.from({ length: 300 }, (_, i) => `D${i}`),
    ...Array.from({ length: 1500 }, (_, i) => `W${i}`),
  ];
  tokenWork(values, [...values, ...values, ...values.map((v) => `(${v}): T`)]);
});

it("indexes machine-demo protected names without scanning them for every report cell", async () => {
  const compiled = await compileProject("examples/machine-demo");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const ir = compiled.ir,
    values = [...ir.devices, ...ir.wires, ...ir.jumpers, ...ir.cables].map(
      (item) => item.designation,
    ),
    cells = ["bom", "wires", "cables", "terminals"].flatMap((kind) => {
      if (
        kind !== "bom" &&
        kind !== "wires" &&
        kind !== "cables" &&
        kind !== "terminals"
      )
        throw Error("Unexpected documentation kind");
      return buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind,
      }).rows.flatMap((row) => row.cells);
    });
  tokenWork(values, cells);
});

it("preserves overlap priority, duplicate-kind ties, boundaries and UTF-16 offsets", () => {
  const names: ReportName[] = [
    { value: "=A+B-C", kind: "designation" },
    { value: "A", kind: "location" },
    { value: "D1", kind: "location" },
    { value: "D1", kind: "designation" },
    { value: "\u{10400}1", kind: "designation" },
  ];
  const value = "=A+B-C D1 XD1 D12 (\u{10400}1)";
  const tokens = reportTokens(value, names);
  expect(
    tokens.map(({ value, kind, start, end }) => ({ value, kind, start, end })),
  ).toEqual([
    { value: "=A", kind: "designation", start: 0, end: 2 },
    { value: "+B", kind: "designation", start: 2, end: 4 },
    { value: "-C", kind: "designation", start: 4, end: 6 },
    { value: "D1", kind: "location", start: 7, end: 9 },
    { value: "\u{10400}1", kind: "designation", start: 19, end: 22 },
  ]);
  expect(reportTokens(value, names)).toEqual(tokens);
});

it("indexes source row facts without changing native row order or facts", async () => {
  const compiled = await compileProject("examples/machine-demo");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const facts = indexedRowFacts(compiled.ir);
  for (const kind of ["wires", "terminals", "network", "assemblies"] as const) {
    const table = buildDocumentation(compiled.ir, {
      format: "documentation-view-request/0.1",
      kind,
    });
    for (const row of table.rows)
      expect(facts(table, row.key)).toEqual(
        rowFacts(compiled.ir, table, row.key),
      );
    expect(facts(table, "missing-row")).toEqual(
      rowFacts(compiled.ir, table, "missing-row"),
    );
  }
});

it.each([false, true])(
  "keeps the painted document guard with an occluder=%s",
  (covered) => {
    const geometry = navigationGeometry(
      `<svg width="100" height="100" viewBox="0 0 100 100"><g id="sheet-1-row" data-report-row="wire"><g data-report-column="1" data-column-name="Identity"><text x="10" y="15" font-size="2.6">W1</text></g></g>${covered ? '<rect x="0" y="0" width="100" height="100" fill="white"/>' : ""}</svg>`,
    );
    const row = {
      primitiveId: "row",
      nativeKey: "wire",
      rectMm: { x: 10, y: 10, w: 20, h: 10 },
      cells: ["W1"],
      printedCells: [["W1"]],
    };
    const result = printedDocumentRegion(row, ["Identity"], geometry, 1);
    expect(!!result).toBe(!covered);
    const measurements = documentMeasurements(geometry);
    expect(
      printedDocumentRegion(
        row,
        ["Identity"],
        geometry,
        1,
        undefined,
        measurements,
      ),
    ).toEqual(result);
    expect(
      printedDocumentRegion(
        row,
        ["Identity"],
        geometry,
        1,
        undefined,
        measurements,
      ),
    ).toEqual(result);
  },
);

it("reuses exact SVG measurements only inside one render scope", async () => {
  const svg =
    '<svg width="100" height="100" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>';
  const outside = navigationGeometry(svg);
  const first = await withRenderCache(async () => {
    const measured = navigationGeometry(svg);
    await Promise.resolve();
    expect(navigationGeometry(svg)).toBe(measured);
    expect(
      navigationGeometry(svg.replace('width="10"', 'width="11"')),
    ).not.toBe(measured);
    return measured;
  });
  expect(first).toEqual(outside);
  expect(first).not.toBe(outside);
  await withRenderCache(async () => {
    expect(navigationGeometry(svg)).not.toBe(first);
  });
});

it("does not reuse source snapshots or native tables across edited inputs", async () => {
  const compiled = await compileProject("examples/machine-demo");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const ir = compiled.ir,
    wire = ir.wires[0];
  if (!wire) throw Error("Missing fixture wire");
  const firstReferences = {
      conductors: new Map([[wire.uid, ["01.A1", "02.B2"] as const]]),
    },
    secondReferences = {
      conductors: new Map([[wire.uid, ["03.C3", "04.D4"] as const]]),
    };
  const original = await withRenderCache(async () => {
    const first = nativeDocumentTable(ir, "wires", wire.uid, firstReferences),
      second = nativeDocumentTable(ir, "wires", wire.uid, secondReferences);
    expect(
      first?.rows.find((r) => r.key === wire.uid)?.cells.slice(5, 7),
    ).toEqual(["01.A1", "02.B2"]);
    expect(
      second?.rows.find((r) => r.key === wire.uid)?.cells.slice(5, 7),
    ).toEqual(["03.C3", "04.D4"]);
    expect(nativeDocumentTable(ir, "wires", wire.uid, firstReferences)).toBe(
      first,
    );
    const digest = navigationSnapshotDigest(ir);
    expect(navigationSnapshotDigest(ir)).toBe(digest);
    return { first, digest };
  });
  ir.project.name += " edited";
  await withRenderCache(async () => {
    expect(
      nativeDocumentTable(ir, "wires", wire.uid, firstReferences),
    ).not.toBe(original.first);
    expect(navigationSnapshotDigest(ir)).not.toBe(original.digest);
  });
});

it("retains the exact four-digit encoding of every UTF-16 code unit", () => {
  const value = Array.from({ length: 65536 }, (_, i) =>
    String.fromCharCode(i),
  ).join("");
  const expected = Array.from({ length: 65536 }, (_, i) =>
    i.toString(16).padStart(4, "0"),
  ).join("");
  const id = svgSemanticId("device", [value]);
  expect(id).toBe(`device-${expected}`);
  expect(decodeSvgSemanticId("device", id)).toEqual([value]);
});
