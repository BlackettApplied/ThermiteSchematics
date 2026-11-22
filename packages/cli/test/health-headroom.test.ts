import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { measure, measureSources } from "../../../scripts/health-measure.mjs";
import { allowanceMatches } from "../../../scripts/health-continuity.mjs";
import { createBudget } from "../../../scripts/health-ratchet.mjs";
import { metrics, put, repo } from "./health-fixture.js";

const root = fileURLToPath(new URL("../../../", import.meta.url)),
  base = measure(root),
  budget = JSON.parse(
    readFileSync(root + "/scripts/health-budget.json", "utf8"),
  );

// Probe continuity separately from the decreasing size cap: insert 70/71 real
// AST-token lines, keeping every nested/sibling candidate in the measured file.
// These probes do not authorize the resulting size growth.
function probe(key: string, added: number, context = { root, base, budget }) {
  const { root, base, budget } = context;
  const path = key.split("#", 1)[0],
    original = readFileSync(root + "/" + path, "utf8"),
    parsed = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true),
    [start, end] = base.bodyRanges[key];
  let offset: number | undefined;
  function find(node: ts.Node) {
    if (
      ts.isFunctionLike(node) &&
      node.getStart(parsed) === start &&
      node.end === end &&
      node.body &&
      ts.isBlock(node.body)
    )
      offset = node.body.end - 1;
    ts.forEachChild(node, find);
  }
  find(parsed);
  expect(offset, key).toBeDefined();
  const text =
      original.slice(0, offset) +
      "\n" +
      Array.from(
        { length: added },
        (_, n) => `void "health headroom probe ${n}";\n`,
      ).join("") +
      original.slice(offset),
    measured = measureSources([path], () => text),
    current = { ...base };
  for (const field of [
    "files",
    "functions",
    "bodyRanges",
    "bodyHashes",
    "bodyLines",
    "fileHashes",
    "fileLines",
  ] as const)
    current[field] = {
      ...Object.fromEntries(
        Object.entries(base[field]).filter(
          ([k]) => k !== path && !k.startsWith(path + "#"),
        ),
      ),
      ...measured[field],
    };
  return allowanceMatches(current, budget, { budget, metrics: base }).functions[
    key
  ];
}
it.each(Object.keys(budget.grandfathered.functions))(
  "provides exactly 70 added-line continuity headroom: %s",
  (id) => {
    const key = budget.locations.functions[id];
    expect(probe(key, 70), id).toMatchObject({ id, added: 70 });
    expect(probe(key, 71)?.id, id).not.toBe(id);
  },
);

it("keeps the 70/71 boundary exercised with no live grandfathered bodies", () => {
  const root = repo(),
    path = "src/headroom.ts";
  put(
    root,
    path,
    `function retained() {\n${Array.from({ length: 320 }, (_, n) => `void "fixture ${n}";`).join("\n")}\n}\n`,
  );
  const base = metrics(root),
    budget = createBudget(base),
    [id] = Object.keys(budget.grandfathered.functions),
    key = budget.locations.functions[id],
    context = { root, base, budget };
  expect(base.functions[key]).toBeGreaterThan(300);
  expect(probe(key, 70, context), id).toMatchObject({ id, added: 70 });
  expect(probe(key, 71, context)?.id, id).not.toBe(id);
});
