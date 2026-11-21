import { expect, it } from "vitest";
import {
  createBudget,
  regressions,
  acceptBudget,
  lowerBudget,
  historyRegressions,
} from "../../../scripts/health-ratchet.mjs";
import {
  allowanceMatches,
  lineAdditions,
} from "../../../scripts/health-continuity.mjs";
import { repo, put, metrics, fn } from "./health-fixture.js";

const shapes = [
  {
    path: "evals/draw/run.mjs",
    outer: "pool callback",
    inner: "retainingCase callback",
    lines: 508,
    opening: "[0].pool(async () => {",
    call: 'return retainingCase("before", async () => {',
  },
  {
    path: "packages/render/src/symbols/mappings.ts",
    outer: "projectDeviceTypeSymbolMappings",
    inner: "flatMap callback",
    lines: 347,
    opening: "function projectDeviceTypeSymbolMappings() {",
    call: "return [0].flatMap(value => {",
  },
];
it("still excludes a non-grandfathered nested helper when every outer-only token line changes", () => {
  const root = repo(),
    path = "packages/example/test/guard.test.ts",
    outer = `${path}#outer`;
  const text = `function outer() {\n${fn(86, "helper")}${"\n".repeat(312)}}\n`;
  put(root, path, text);
  const base = metrics(root),
    budget = createBudget(base);
  put(
    root,
    path,
    text
      .replace("helper(value)", "helper(rewritten)")
      .replace("\n\n", '\nvoid "new outer line";\n'),
  );
  const current = metrics(root),
    reference = { budget, metrics: base },
    matches = allowanceMatches(current, budget, reference);
  expect(matches.functions[outer]).toMatchObject({ id: outer, added: 2 });
  expect(matches.functions[`${outer}/helper`]).toBeUndefined();
  expect(() => lowerBudget(current, budget, reference)).not.toThrow();
});
function fixture(shape: (typeof shapes)[number]) {
  const root = repo(),
    outer = `${shape.path}#${shape.outer}`,
    inner = `${outer}/${shape.inner}`;
  const text = [
    shape.opening,
    ...Array.from({ length: 4 }, (_, n) => `void "outer ${n}";`),
    shape.call,
    ...Array.from({ length: shape.lines - 2 }, (_, n) => `void "inner ${n}";`),
    "});",
    shape.outer === "pool callback" ? "});" : "}",
    "",
  ].join("\n");
  put(root, shape.path, text);
  const base = metrics(root),
    budget = createBudget(base);
  expect(base.functions[outer]).toBe(shape.lines + 6);
  expect(base.functions[inner]).toBe(shape.lines);
  const edited = text
    .replaceAll('"outer ', '"rewritten outer ')
    .replace('"before"', '"after"')
    .replace("return [0]", "return [1]");
  put(root, shape.path, edited);
  return {
    root,
    shape,
    outer,
    inner,
    text,
    edited,
    base,
    budget,
    reference: { budget, metrics: base },
  };
}
it.each(shapes)(
  "keeps both grandfathered $outer/$inner allowances after every outer-only line changes",
  (shape) => {
    const { root, outer, inner, base, budget, reference } = fixture(shape),
      current = metrics(root);
    expect(current.bodyHashes[inner]).toBe(base.bodyHashes[inner]);
    expect(
      lineAdditions(base.bodyLines[outer], current.bodyLines[outer]).added,
    ).toBe(5);
    const matches = allowanceMatches(current, budget, reference);
    expect(matches.functions[inner]).toMatchObject({
      id: inner,
      added: 0,
      exact: true,
    });
    expect(matches.functions[outer]).toMatchObject({ id: outer, added: 5 });
    const next = lowerBudget(current, budget, reference);
    expect(historyRegressions(current, next, budget, base)).toEqual([]);
  },
);
for (const shape of shapes) {
  it.each(["outer", "inner"])(
    `cannot grow the %s body in ${shape.path}`,
    (which) => {
      const { root, edited, outer, inner, budget, reference } = fixture(shape);
      put(
        root,
        shape.path,
        edited.replace(
          which === "outer" ? shape.opening : 'void "inner 0";',
          (which === "outer" ? shape.opening : 'void "inner 0";') +
            '\nvoid "growth";',
        ),
      );
      const current = metrics(root),
        errors = regressions(current, budget, reference).join("\n");
      expect(errors).toContain(
        `${outer}: functions ceiling ${shape.lines + 6} -> ${shape.lines + 7}`,
      );
      if (which === "inner")
        expect(errors).toContain(
          `${inner}: functions ceiling ${shape.lines} -> ${shape.lines + 1}`,
        );
      expect(() =>
        acceptBudget(current, budget, "cannot waive growth", reference),
      ).toThrow("ceiling");
    },
  );
  it(`cannot redirect the nested allowance to unrelated non-nested content in ${shape.path}`, () => {
    const { root, edited, inner, budget, reference } = fixture(shape),
      key = `${shape.path}#impostor`;
    put(
      root,
      shape.path,
      edited +
        fn(shape.lines, "impostor").replaceAll(
          "void value;",
          'void "unrelated";',
        ),
    );
    const current = metrics(root),
      forged = structuredClone(budget);
    forged.locations.functions[inner] = key;
    forged.fingerprints.functions[inner] = current.bodyHashes[key];
    const matches = allowanceMatches(current, forged, reference);
    // The owner exception must preserve the real nested body while refusing
    // the redirected locator. Before #273 the real body loses its allowance.
    expect(matches.functions[inner]).toMatchObject({ id: inner, exact: true });
    expect(matches.functions[key]).toBeUndefined();
    expect(regressions(current, forged, reference).join("\n")).toContain(
      `${key}: functions ceiling 300 -> ${shape.lines} (new or unmatched content)`,
    );
  });
  it.each([70, 71])(
    `preserves the %i added-line boundary for nested bodies in ${shape.path}`,
    (added) => {
      const { root, text, inner, base, budget, reference } = fixture(shape);
      let changed = text;
      for (let n = 0; n < added; n++)
        changed = changed.replace(`"inner ${n}"`, `"replacement ${n}"`);
      put(root, shape.path, changed);
      const current = metrics(root);
      expect(
        lineAdditions(base.bodyLines[inner], current.bodyLines[inner]).added,
      ).toBe(added);
      if (added === 70)
        expect(() => lowerBudget(current, budget, reference)).not.toThrow();
      else
        expect(() => lowerBudget(current, budget, reference)).toThrow(
          "new or unmatched content",
        );
    },
  );
  it(`retires the nested record at the cap and leaves no tombstone on deletion in ${shape.path}`, () => {
    const { root, edited, inner, base, budget, reference } = fixture(shape);
    const lines = edited
      .split("\n")
      .filter(
        (line) =>
          !Array.from(
            { length: shape.lines - 300 },
            (_, n) => `void "inner ${n}";`,
          ).includes(line),
      );
    put(root, shape.path, lines.join("\n"));
    const current = metrics(root),
      next = lowerBudget(current, budget, reference);
    expect(current.functions[inner]).toBe(300);
    expect(next.grandfathered.functions[inner]).toBeUndefined();
    expect(next.locations.functions[inner]).toBeUndefined();
    expect(historyRegressions(current, next, budget, base)).toEqual([]);
    put(root, shape.path, "");
    const empty = lowerBudget(metrics(root), next, {
      budget: next,
      metrics: current,
    });
    expect(empty.grandfathered.functions).toEqual({});
    expect(empty.locations.functions).toEqual({});
  });
}

it("resolves enclosing callback ownership after positional ~3 to ~4 renames", () => {
  const root = repo(),
    path = "packages/example/src/callbacks.ts";
  const prefix = "[0].map(() => 0);\n".repeat(2);
  const outer = path + "#map callback~3";
  const inner = path + "#map callback/map callback";
  const original =
    '[0].map(() => {\nvoid "old outer";\n' +
    "[0].map(() => {\n" +
    Array.from({ length: 310 }, (_, n) => 'void "nested ' + n + '";').join(
      "\n",
    ) +
    "\n});\n});\n";
  put(root, path, prefix + original);
  const base = metrics(root),
    budget = createBudget(base);
  put(
    root,
    path,
    prefix +
      "[0].map(() => 0);\n" +
      original
        .replace("old outer", "new outer")
        .replaceAll("[0].map", "[1].map"),
  );
  const current = metrics(root),
    reference = { budget, metrics: base };
  const matches = allowanceMatches(current, budget, reference);
  expect(matches.functions[inner]).toMatchObject({ id: inner, exact: true });
  expect(matches.functions[path + "#map callback~4"]).toMatchObject({
    id: outer,
  });
  expect(() => lowerBudget(current, budget, reference)).not.toThrow();
});
