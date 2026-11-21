import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  createBudget,
  regressions,
  historyRegressions,
  acceptBudget,
  lowerBudget,
} from "../../../scripts/health-ratchet.mjs";
import {
  lineAdditions,
  allowanceMatches,
  exactMove,
} from "../../../scripts/health-continuity.mjs";
import {
  repo,
  put,
  git,
  metrics,
  save,
  commit,
  run,
  fn,
} from "./health-fixture.js";
const file = "packages/example/test/code.test.ts";
it("counts added normalized lines with multiplicities and accepts pure shrink", () => {
  expect(lineAdditions(["a", "b"], ["a", "x"])).toEqual({
    added: 1,
    common: 1,
  });
  expect(lineAdditions(["a", "a"], ["a", "a", "a"])).toEqual({
    added: 1,
    common: 2,
  });
  expect(lineAdditions(["a", "b", "c"], ["a"])).toEqual({
    added: 0,
    common: 1,
  });
  expect(lineAdditions([], [])).toEqual({ added: 0, common: 0 });
  expect(lineAdditions(undefined, ["a"]).added).toBe(Infinity);
});
function smokeBody() {
  const text = readFileSync(
    // Preserve the real over-cap regression input after its source is extracted.
    new URL("./fixtures/health-package-smoke.ts.txt", import.meta.url),
    "utf8",
  );
  const source = ts.createSourceFile(
    "smoke.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  let original: ts.Block | undefined;
  function find(node: ts.Node) {
    if (ts.isFunctionLike(node) && node.body) {
      const n =
        source.getLineAndCharacterOfPosition(node.end).line -
        source.getLineAndCharacterOfPosition(node.getStart(source)).line +
        1;
      if (n === 1278 && ts.isBlock(node.body)) original = node.body;
    }
    ts.forEachChild(node, find);
  }
  find(source);
  expect(original).toBeDefined();
  return { source, body: original! };
}
function smokePrefix(lines: number) {
  const { source, body } = smokeBody();
  const start = source.getLineAndCharacterOfPosition(
    body.getStart(source),
  ).line;
  const kept = body.statements.filter(
    (s) =>
      source.getLineAndCharacterOfPosition(s.end).line - start + 1 <= lines,
  );
  expect(kept.length).toBeGreaterThan(0);
  return source.text.slice(body.getStart(source), kept.at(-1)!.end);
}
const smokeSource = (body: string) =>
  `describe('packed',()=>{it('install together',async()=>${body});});\n`;
function smokeFixture() {
  const root = repo(),
    path = "packages/compiler/test/package-smoke.test.ts";
  const { source, body } = smokeBody();
  put(root, path, smokeSource(body.getText(source)));
  const base = metrics(root),
    budget = createBudget(base);
  save(root, budget);
  const sha = commit(root);
  git(root, "branch", "dev", sha);
  const id = Object.keys(budget.grandfathered.functions).find((k) =>
    k.endsWith("/it callback"),
  )!;
  return { root, path, id, base, budget };
}
it("rejects the review's unrelated 454-line replacement of the real package-smoke body", () => {
  const { root, path, id, base } = smokeFixture();
  put(
    root,
    path,
    `describe('packed',()=>{\nit('brand new unrelated over-cap logic',()=>{\n${"void 987654321;\n".repeat(452)}});\n});\n`,
  );
  const current = metrics(root);
  expect(current.functions[id]).toBe(454);
  expect(
    lineAdditions(base.bodyLines[id], current.bodyLines[id]).added,
  ).toBeGreaterThan(70);
  const result = run(root);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain(
    "ceiling 300 -> 454 (new or unmatched content)",
  );
});
it("accepts the review's pure 1278 to 420 shrink with zero added lines", () => {
  const { root, path, id, base } = smokeFixture();
  const prefix = smokePrefix(418);
  put(
    root,
    path,
    smokeSource(prefix + "\n".repeat(420 - prefix.split("\n").length) + "}"),
  );
  const current = metrics(root);
  expect(current.functions[id]).toBe(420);
  expect(lineAdditions(base.bodyLines[id], current.bodyLines[id]).added).toBe(
    0,
  );
  const result = run(root, ["--lower"]);
  expect(result.status, result.stderr).toBe(0);
  expect(
    JSON.parse(readFileSync(root + "/scripts/health-budget.json", "utf8"))
      .grandfathered.functions[id],
  ).toBe(420);
});
it("rejects the review's retained prefix plus 561 new replacement lines", () => {
  const { root, path, id, base } = smokeFixture();
  const prefix = smokePrefix(700);
  put(
    root,
    path,
    smokeSource(prefix + "\n" + "void 987654321;\n".repeat(561) + "}"),
  );
  const current = metrics(root);
  expect(current.functions[id]).toBeLessThan(1278);
  expect(current.functions[id]).toBeGreaterThan(300);
  expect(lineAdditions(base.bodyLines[id], current.bodyLines[id]).added).toBe(
    561,
  );
  const result = run(root, ["--lower"]);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain("new or unmatched content");
});
it.each([70, 71])(
  "continuity permits exactly 70 added lines, not %i when above 70",
  (added) => {
    const root = repo();
    put(root, file, fn(600));
    const base = metrics(root),
      budget = createBudget(base),
      id = `${file}#existing`;
    put(
      root,
      file,
      fn(600).replace(
        "void value;\n".repeat(added),
        "void 987654321;\n".repeat(added),
      ),
    );
    const current = metrics(root),
      reference = { budget, metrics: base };
    expect(lineAdditions(base.bodyLines[id], current.bodyLines[id]).added).toBe(
      added,
    );
    if (added === 70) {
      const next = lowerBudget(current, budget, reference);
      expect(historyRegressions(current, next, budget, base)).toEqual([]);
    } else {
      expect(() => lowerBudget(current, budget, reference)).toThrow(
        "new or unmatched content",
      );
      expect(() =>
        acceptBudget(current, budget, "cannot waive continuity", reference),
      ).toThrow("new or unmatched content");
    }
  },
);
it("chooses the best match first, one-to-one and independently of declaration order", () => {
  const root = repo();
  const alpha = fn(600, "alpha"),
    beta = fn(600, "beta").replace(
      "void value;\n".repeat(70),
      "void 222;\n".repeat(70),
    );
  put(root, file, alpha + beta);
  const base = metrics(root),
    budget = createBudget(base),
    reference = { budget, metrics: base };
  const edited = alpha.replace(
    "void value;\n".repeat(70),
    "void 333;\n".repeat(70),
  );
  put(root, file, beta + edited);
  const current = metrics(root),
    matches = allowanceMatches(current, budget, reference);
  expect(matches.functions[`${file}#beta`]).toMatchObject({
    id: `${file}#beta`,
    added: 0,
  });
  expect(matches.functions[`${file}#alpha`]).toMatchObject({
    id: `${file}#alpha`,
    added: 70,
  });
  put(root, file, edited + beta);
  expect(allowanceMatches(metrics(root), budget, reference)).toEqual(matches);
});
it("an earlier callback shifts its key while the same over-cap content keeps its allowance", () => {
  const root = repo();
  const small = "[1].map(x => x);\n",
    big = `[1].map(value=>{\n${"void value;\n".repeat(328)}return value;\n});\n`;
  put(root, file, small + big);
  const base = metrics(root),
    budget = createBudget(base),
    id = Object.keys(budget.grandfathered.functions)[0];
  put(root, file, small + small + big);
  const current = metrics(root),
    reference = { budget, metrics: base };
  const matches = allowanceMatches(current, budget, reference);
  const key = Object.keys(matches.functions).find(
    (k) => matches.functions[k].id === id,
  )!;
  expect(key).not.toBe(id);
  expect(matches.functions[key].added).toBe(0);
  expect(regressions(current, budget, reference)).toEqual([]);
  expect(historyRegressions(current, budget, budget, base)).toEqual([]);
  const next = lowerBudget(current, budget, reference);
  expect(next.locations.functions[id]).toBe(key);
  put(root, file, small + small + small + big);
  const again = metrics(root);
  expect(historyRegressions(again, next, next, current)).toEqual([]);
});
it("a fingerprint cannot be redirected to a sub-cap body for a future over-cap replacement", () => {
  const root = repo();
  put(
    root,
    file,
    fn(380, "large") + fn(200, "small").replaceAll("void value;", "void 1234;"),
  );
  const base = metrics(root),
    budget = createBudget(base),
    id = Object.keys(budget.grandfathered.functions)[0],
    next = structuredClone(budget);
  next.locations.functions[id] = file + "#small";
  next.fingerprints.functions[id] = base.bodyHashes[file + "#small"];
  expect(historyRegressions(base, next, budget, base).join("\n")).toContain(
    "Refresh grandfathered content fingerprint",
  );
  // Leaving an unmatched record after deletion must not preserve a future grant.
  put(root, file, fn(200, "small").replaceAll("void value;", "void 1234;"));
  const current = metrics(root);
  expect(historyRegressions(current, next, budget, base).join("\n")).toContain(
    "Retire unmatched or sub-cap",
  );
});
it("runThermite +5 lines is accepted with a reason after its sub-cap record retires", () => {
  const root = repo(),
    path = "packages/cli/src/alpha.ts";
  put(root, path, fn(380, "runThermite"));
  const original = metrics(root),
    budget = createBudget(original);
  put(root, path, fn(52, "runThermite"));
  const base = metrics(root),
    retired = lowerBudget(base, budget, { budget, metrics: original });
  expect(retired.grandfathered.functions).toEqual({});
  save(root, retired);
  const sha = commit(root);
  git(root, "branch", "dev", sha);
  put(root, path, fn(57, "runThermite"));
  const result = run(root, [
    "--accept",
    "--reason",
    "five lines under the normal threshold",
  ]);
  expect(result.status, result.stderr).toBe(0);
});
it("a retired sub-cap outlier cannot raise its ordinary allowance", () => {
  const root = repo();
  put(root, file, fn(380));
  const before = metrics(root),
    budget = createBudget(before);
  put(root, file, fn(200));
  const base = metrics(root),
    retired = lowerBudget(base, budget, { budget, metrics: before });
  put(root, file, fn(205));
  expect(retired.grandfathered.functions).toEqual({});
  expect(() =>
    acceptBudget(metrics(root), retired, "under-cap growth", {
      budget: retired,
      metrics: base,
    }),
  ).toThrow("cannot rise");
});
it("a stale index.ts 1369 reason cannot authorize 2869 or a hand-edited 2870 budget", () => {
  const root = repo(),
    path = "packages/cli/src/index.ts";
  put(root, path, "// lines\n".repeat(1334));
  const original = metrics(root),
    first = createBudget(original);
  expect(first.files[path]).toBe(1334);
  put(root, path, "// lines\n".repeat(1369));
  const base = metrics(root),
    budget = createBudget(base);
  // Authenticate a historical grant, not a grant made by the current policy.
  budget.reasons[`files:${path}`] = [
    {
      identity: `files:${path}`,
      from: 1334,
      to: 1369,
      reason: "original extraction",
    },
  ];
  expect(budget.reasons[`files:${path}`]).toEqual([
    {
      identity: `files:${path}`,
      from: 1334,
      to: 1369,
      reason: "original extraction",
    },
  ]);
  save(root, budget);
  const sha = commit(root);
  git(root, "branch", "dev", sha);
  put(root, path, "// lines\n".repeat(2869));
  const next = structuredClone(budget);
  next.files[path] = 2870;
  save(root, next);
  let result = run(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("1369 -> 2869 (budget 2870)");
  next.files[path] = 2869;
  save(root, next);
  result = run(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("needs exact reason");
  result = run(root, ["--accept", "--reason", "specific second raise"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("cannot rise");
  const current = JSON.parse(
    readFileSync(root + "/scripts/health-budget.json", "utf8"),
  );
  expect(current.reasons[`files:${path}`]).toEqual(
    budget.reasons[`files:${path}`],
  );
});
it("rejects copy plus edit of runSchematicCommand as a move, against either target", () => {
  const text = readFileSync(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  const source = ts.createSourceFile(
    "index.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const node = source.statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) && s.name?.text === "runSchematicCommand",
  )!;
  expect(node).toBeDefined();
  const root = repo(),
    from = "packages/cli/src/index.ts",
    to = "packages/cli/src/dup-copy.ts";
  const original = node.getText(source),
    offset = node.body!.getStart(source) - node.getStart(source) + 1;
  put(root, from, original);
  const base = metrics(root),
    budget = createBudget(base);
  put(
    root,
    from,
    original.slice(0, offset) + "void 0;" + original.slice(offset),
  );
  put(root, to, original);
  const current = metrics(root),
    next = structuredClone(budget),
    key = `${to}#runSchematicCommand`,
    old = `${from}#runSchematicCommand`;
  next.functions[key] = current.functions[key];
  next.moves[key] = {
    section: "functions",
    from: old,
    sha256: base.bodyHashes[old],
  };
  expect(current.functions[old]).toBe(base.functions[old]);
  expect(current.bodyHashes[old]).not.toBe(base.bodyHashes[old]);
  expect(exactMove("functions", key, next, base, current)).toBe(false);
  for (const target of ["dev", "release"])
    expect(
      historyRegressions(current, next, budget, base, target).join("\n"),
    ).toContain("Move proof requires absent source");
});
