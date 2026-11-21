import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  createBudget,
  acceptBudget,
  lowerBudget,
  historyRegressions,
} from "../../../scripts/health-ratchet.mjs";
import {
  allowanceMatches,
  lineAdditions,
} from "../../../scripts/health-continuity.mjs";
import {
  repo,
  put,
  metrics,
  save,
  commit,
  git,
  run,
  fn,
} from "./health-fixture.js";

function source(path: string) {
  // Historical 0779e76 input keeps the original over-cap attacks unchanged.
  const target =
    path === "packages/compiler/test/package-smoke.test.ts"
      ? new URL("./fixtures/health-package-smoke.ts.txt", import.meta.url)
      : path === "packages/render/src/view-spec.ts"
        ? new URL("./fixtures/health-view-spec.ts.txt", import.meta.url)
        : new URL("../../../" + path, import.meta.url);
  return readFileSync(target, "utf8");
}
it("keeps normalizeSchematicView after the review's one-blank-line edit instead of matching rejectRoot", () => {
  const root = repo(),
    path = "packages/render/src/view-spec.ts",
    id = `${path}#normalizeSchematicView`;
  const original = source(path);
  put(root, path, original);
  const base = metrics(root),
    budget = createBudget(base),
    [start, end] = base.bodyRanges[id];
  put(
    root,
    path,
    original.slice(0, start) +
      original
        .slice(start, end)
        .replace(/\n[ \t]*\n/, '\nvoid "one new line";\n') +
      original.slice(end),
  );
  const current = metrics(root),
    reference = { budget, metrics: base };
  expect(current.functions[id]).toBe(354);
  expect(lineAdditions(base.bodyLines[id], current.bodyLines[id]).added).toBe(
    1,
  );
  expect(current.functions[`${id}/rejectRoot`]).toBeGreaterThan(70);
  expect(
    allowanceMatches(current, budget, reference).functions[id],
  ).toMatchObject({
    id,
    added: 1,
  });
  const next = lowerBudget(current, budget, reference);
  expect(historyRegressions(current, next, budget, base)).toEqual([]);
});
it("excludes a nested candidate even when its shared-line count ties its outer body", () => {
  const root = repo(),
    path = "packages/example/test/nesting.test.ts",
    id = `${path}#outer`;
  const original = `function outer() {\n${fn(86, "nested")}${"\n".repeat(312)}}\n`;
  put(root, path, original);
  const base = metrics(root),
    budget = createBudget(base);
  put(root, path, original.replace("\n\n", '\nvoid "added";\n'));
  const current = metrics(root),
    reference = { budget, metrics: base };
  expect(current.functions[id]).toBe(400);
  const matches = allowanceMatches(current, budget, reference);
  expect(matches.functions[id]).toMatchObject({ id, added: 1 });
  expect(matches.functions[`${id}/nested`]).toBeUndefined();
  expect(
    historyRegressions(
      current,
      lowerBudget(current, budget, reference),
      budget,
      base,
    ),
  ).toEqual([]);
});
it("keeps the real package-smoke +46 shrink rather than its fewer-added-line sibling", () => {
  const root = repo(),
    path = "packages/compiler/test/package-smoke.test.ts",
    id = `${path}#describe callback/it callback`;
  const original = source(path),
    parsed = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true);
  put(root, path, original);
  const base = metrics(root),
    budget = createBudget(base),
    [start, end] = base.bodyRanges[id];
  let body: ts.Block | undefined;
  function find(node: ts.Node) {
    if (
      ts.isFunctionLike(node) &&
      node.getStart(parsed) === start &&
      node.end === end &&
      node.body &&
      ts.isBlock(node.body)
    )
      body = node.body;
    ts.forEachChild(node, find);
  }
  find(parsed);
  expect(body).toBeDefined();
  const firstLine = parsed.getLineAndCharacterOfPosition(
      body!.getStart(parsed),
    ).line,
    tryBody = body!.statements.find(ts.isTryStatement)!.tryBlock,
    kept = tryBody.statements.filter(
      (s) => parsed.getLineAndCharacterOfPosition(s.end).line - firstLine < 780,
    ),
    last = kept.at(-1)!.end;
  put(
    root,
    path,
    original.slice(0, last) +
      "\n" +
      'void "review new line";\n'.repeat(46) +
      original.slice(tryBody.end - 1),
  );
  const current = metrics(root),
    reference = { budget, metrics: base },
    sibling = `${id}~2`;
  const own = lineAdditions(base.bodyLines[id], current.bodyLines[id]),
    other = lineAdditions(base.bodyLines[id], current.bodyLines[sibling]);
  expect(own.added).toBe(46);
  expect(other.added).toBeLessThan(own.added);
  expect(other.common).toBeLessThan(own.common);
  expect(current.functions[id]).toBeGreaterThan(300);
  expect(current.functions[id]).toBeLessThan(1278);
  expect(
    allowanceMatches(current, budget, reference).functions[id],
  ).toMatchObject({ id, added: 46 });
  const next = lowerBudget(current, budget, reference);
  expect(historyRegressions(current, next, budget, base)).toEqual([]);
});
it("accept banks the renderPacket 217 to 212 rebase before accepting new TB2 entries", () => {
  const root = repo(),
    path = "packages/render/src/packet/sheets.ts",
    id = `${path}#renderPacket`;
  put(root, path, fn(217, "renderPacket"));
  const stale = createBudget(metrics(root));
  put(root, path, fn(212, "renderPacket"));
  const base = metrics(root),
    budget = createBudget(base);
  save(root, budget);
  git(root, "branch", "dev", commit(root));
  put(root, path, fn(212, "renderPacket") + fn(77, "newTB2Helper"));
  save(root, stale);
  const current = metrics(root),
    reference = { budget, metrics: base };
  expect(() => lowerBudget(current, stale, reference)).toThrow(
    "threshold 70 -> 77",
  );
  expect(() => acceptBudget(current, stale, undefined, reference)).toThrow(
    "requires --reason",
  );
  const result = run(root, ["--accept", "--reason", "TB2 merged on dev"]);
  expect(result.status, result.stderr).toBe(0);
  const next = JSON.parse(
    readFileSync(root + "/scripts/health-budget.json", "utf8"),
  );
  expect(next.functions[id]).toBe(212);
  expect(next.reasons[`functions:${id}`]).toBeUndefined();
  expect(next.functions[`${path}#newTB2Helper`]).toBe(77);
  expect(historyRegressions(current, next, budget, base)).toEqual([]);
  expect(run(root).status).toBe(0);
});
it("accept lowers a historical allowance without a reason and preserves its records", () => {
  const root = repo(),
    path = "packages/example/test/lower.test.ts",
    id = path + "#existing";
  put(root, path, fn(95));
  const base = metrics(root),
    budget = createBudget(base);
  budget.reasons["functions:" + id] = [
    {
      identity: "functions:" + id,
      from: 80,
      to: 95,
      reason: "historical growth",
    },
  ];
  put(root, path, fn(90));
  const current = metrics(root),
    next = acceptBudget(current, budget, undefined, { budget, metrics: base });
  expect(next.functions[id]).toBe(90);
  expect(next.reasons["functions:" + id]).toEqual(
    budget.reasons["functions:" + id],
  );
  expect(historyRegressions(current, next, budget, base)).toEqual([]);
});
