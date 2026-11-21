import { generatedSvgInk } from "../src/device-legend/svg-ink.js";
import { expect, it } from "vitest";
import {
  createSelfLoopIr,
  createTerminalIr,
} from "../../query/test/fixtures.js";
import { documentationFixture } from "../../query/test/documentation-fixture.js";
import { buildDocumentation } from "@thermite/query";
import {
  MAX_GEOMETRY_CACHE_KEY_UNITS,
  MAX_GEOMETRY_CACHE_TOTAL_KEY_UNITS,
  renderCache,
  withRenderCache,
} from "../src/packet/render-cache.js";
import {
  navigationGeometry,
  cachedNavigationTree,
} from "../src/packet/navigation-walk.js";
import {
  MAX_NATIVE_TABLE_CACHE_ENTRIES,
  nativeDocumentTable,
  validateDocumentNeed,
} from "../src/packet/document-native.js";
import {
  factTable,
  indexedRowFacts,
  rowFacts,
} from "../src/packet/document-facts.js";
import type { DocumentNeedSeed } from "../src/packet/document-types.js";
import {
  documentMeasurements,
  printedDocumentRegion,
} from "../src/packet/document-visible.js";

const svgWithComment = (text: string) =>
  `<svg width="100" height="100" viewBox="0 0 100 100"><!--${text}--><rect width="10" height="10"/></svg>`;

it("bypasses geometry keys larger than the per-key bound", async () => {
  const large = svgWithComment("x".repeat(MAX_GEOMETRY_CACHE_KEY_UNITS));
  await withRenderCache(async () => {
    const small = svgWithComment("small"),
      measured = navigationGeometry(small);
    expect(navigationGeometry(small)).toBe(measured);
    const first = navigationGeometry(large),
      second = navigationGeometry(large);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(renderCache.getStore()?.entries.size).toBe(1);
  });
});

it("bounds the total retained geometry key units", async () => {
  const keySize = MAX_GEOMETRY_CACHE_KEY_UNITS - 256;
  const count = Math.ceil(MAX_GEOMETRY_CACHE_TOTAL_KEY_UNITS / keySize) + 2;
  await withRenderCache(async () => {
    let last = svgWithComment("");
    for (let i = 0; i < count; i++) {
      last = svgWithComment(`${i}:` + "x".repeat(keySize));
      navigationGeometry(last);
    }
    const first = navigationGeometry(last);
    expect(navigationGeometry(last)).toEqual(first);
    expect(navigationGeometry(last)).not.toBe(first);
    expect(renderCache.getStore()?.keyUnits).toBeLessThanOrEqual(
      MAX_GEOMETRY_CACHE_TOTAL_KEY_UNITS,
    );
  });
});

it("bounds native table entries across IRs within one render", async () => {
  const firstIr = createTerminalIr([
      { uid: "cache-a", designation: "A", terminalKeys: ["T"] },
    ]),
    secondIr = createTerminalIr([
      { uid: "cache-b", designation: "B", terminalKeys: ["T"] },
    ]);
  const references = Array.from(
    { length: MAX_NATIVE_TABLE_CACHE_ENTRIES + 1 },
    () => ({
      conductors: new Map<
        string,
        readonly [string | undefined, string | undefined]
      >(),
    }),
  );
  await withRenderCache(async () => {
    const tables = references.map((refs, index) =>
      nativeDocumentTable(
        index < MAX_NATIVE_TABLE_CACHE_ENTRIES / 2 ? firstIr : secondIr,
        "wires",
        "",
        refs,
      ),
    );
    expect(nativeDocumentTable(firstIr, "wires", "", references[0])).toBe(
      tables[0],
    );
    const overflow = nativeDocumentTable(
      secondIr,
      "wires",
      "",
      references.at(-1),
    );
    expect(overflow).toEqual(tables.at(-1));
    expect(overflow).not.toBe(tables.at(-1));
  });
});

it.each([64, 128])(
  "indexes native validation and fact-table endpoints once for %i wires",
  async (count) => {
    const ir = createSelfLoopIr(),
      wire = ir.wires[0];
    if (!wire) throw Error("Missing fixture wire");
    let reads = 0;
    ir.wires = Array.from({ length: count }, (_, i) => ({
      ...wire,
      uid: `wire-${i}`,
      get endpoints() {
        reads++;
        return wire.endpoints;
      },
    }));
    const first = ir.wires[0];
    if (!first) throw Error("Missing indexed wire");
    const need: DocumentNeedSeed = {
      noteId: "work-count",
      need: "conductor-incidence",
      requiredFacts: [
        {
          kind: "conductor-incidence",
          element: { kind: "wire", uid: first.uid },
          end: 0,
          terminal: wire.endpoints[0].terminal,
        },
      ],
      requiredColumns: ["identity", "endpoints", "status"],
      subject: "Synthetic loop",
      count: 1,
    };
    await withRenderCache(async () => {
      validateDocumentNeed(ir, need);
      const selected = factTable(ir, "wires", need.requiredFacts);
      expect(selected.rows.map((r) => r.key)).toEqual([first.uid]);
    });
    // Native query projections and index construction take a fixed number of
    // passes over the wires. Neither projection may re-enumerate per native row.
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(40 * count);
  },
);

it("shares incidence and core enumeration across row-fact users within the render", async () => {
  const ir = await documentationFixture(),
    table = buildDocumentation(ir, {
      format: "documentation-view-request/0.1",
      kind: "wires",
    });
  expect(ir.cables.length).toBeGreaterThan(0);
  const keys = table.rows.map((r) => r.key),
    expected = keys.map((key) => rowFacts(ir, table, key));
  let reads = 0;
  for (const type of ir.cableTypes) {
    const conductors = type.conductors;
    Object.defineProperty(type, "conductors", {
      enumerable: true,
      get() {
        reads++;
        return conductors;
      },
    });
  }
  await withRenderCache(async () => {
    const first = indexedRowFacts(ir),
      second = indexedRowFacts(ir);
    expect(keys.map((key) => first(table, key))).toEqual(expected);
    expect(keys.map((key) => second(table, key))).toEqual(expected);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(ir.cables.length);
  });
  const before = reads;
  await withRenderCache(async () =>
    indexedRowFacts(ir)(table, keys[0] ?? "missing"),
  );
  expect(reads - before).toBe(ir.cables.length);
});

it.each([
  ["", true],
  ['fill="none"', false],
  ['fill="transparent"', false],
  ['fill="white"', true],
  ['opacity="0"', false],
  ['visibility="hidden"', false],
] as const)(
  "shares cached and uncached later-rectangle coverage for %s",
  (attrs, covered) => {
    const geometry = navigationGeometry(
      `<svg width="100" height="100" viewBox="0 0 100 100"><g id="sheet-1-row" data-report-row="wire"><g data-report-column="1" data-column-name="Identity"><text x="10" y="15" font-size="2.6">W1</text></g></g><rect x="0" y="0" width="100" height="100" ${attrs}/></svg>`,
    );
    const row = {
      primitiveId: "row",
      nativeKey: "wire",
      rectMm: { x: 10, y: 10, w: 20, h: 10 },
      cells: ["W1"],
      printedCells: [["W1"]],
    };
    const ordinary = printedDocumentRegion(row, ["Identity"], geometry, 1),
      cached = printedDocumentRegion(
        row,
        ["Identity"],
        geometry,
        1,
        undefined,
        documentMeasurements(geometry),
      );
    expect(!!ordinary).toBe(!covered);
    expect(cached).toEqual(ordinary);
  },
);

it("keeps duplicate incidence order and the first matching native cable type", async () => {
  const loop = createSelfLoopIr(),
    wire = loop.wires[0];
  if (!wire) throw Error("Missing fixture wire");
  loop.wires.push({ ...wire });
  const loopTable = buildDocumentation(loop, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });
  await withRenderCache(async () => {
    expect(
      indexedRowFacts(loop)(loopTable, wire.uid).facts.map((fact) =>
        fact.kind === "conductor-incidence" ? fact.end : -1,
      ),
    ).toEqual([0, 1, 0, 1]);
  });
  const ir = await documentationFixture(),
    type = ir.cableTypes[0],
    cable = ir.cables[0];
  if (!type || !cable) throw Error("Missing fixture cable");
  const core = type.conductors[0];
  if (!core) throw Error("Missing fixture core");
  ir.cableTypes.push({ ...type, conductors: [] });
  const table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });
  await withRenderCache(async () => {
    const facts = indexedRowFacts(ir)(
      table,
      JSON.stringify([cable.uid, core.id]),
    ).facts;
    expect(
      facts.some(
        (fact) =>
          fact.kind === "core-inventory" && fact.conductorId === core.id,
      ),
    ).toBe(true);
  });
});

it("reuses an immutable parsed tree while producing fresh ink measurements", async () => {
  const svg =
    '<svg width="100" height="100" viewBox="0 0 100 100"><style>.line{stroke:black;fill:none}</style><g transform="translate(4 5)"><rect class="line" x="3" y="2" width="30" height="10"/><text x="5" y="8" font-size="2.6">W1</text></g></svg>';
  const expected = generatedSvgInk(svg);
  await withRenderCache(async () => {
    expect(cachedNavigationTree(svg)).toBeUndefined();
    navigationGeometry(svg);
    const tree = cachedNavigationTree(svg),
      before = JSON.stringify(tree);
    expect(tree).toBeDefined();
    const measured = generatedSvgInk(svg, 1, tree);
    expect(measured).toEqual(expected);
    expect(JSON.stringify(tree)).toBe(before);
    measured.texts.push({ x: 0, y: 0, w: 1, h: 1 });
    expect(generatedSvgInk(svg, 1, tree)).toEqual(expected);
  });
});

it("does not retain an incomplete incidence index after source enumeration fails", async () => {
  const ir = createSelfLoopIr(),
    wire = ir.wires[0];
  if (!wire) throw Error("Missing fixture wire");
  const table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });
  Object.defineProperty(wire, "endpoints", {
    get() {
      throw Error("Synthetic source read failure");
    },
  });
  await withRenderCache(async () => {
    const facts = indexedRowFacts(ir);
    for (let call = 0; call < 2; call++)
      expect(() => facts(table, wire.uid)).toThrow(
        "Synthetic source read failure",
      );
  });
});
