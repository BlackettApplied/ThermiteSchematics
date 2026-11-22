import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  measure,
  createBudget,
  regressions,
  acceptBudget,
  lowerBudget,
  historyRegressions,
} from "../../../scripts/health-ratchet.mjs";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const script = fileURLToPath(
  new URL("../../../scripts/health-ratchet.mjs", import.meta.url),
);
const body = (lines: number, name = "existing") =>
  `function ${name}(value: string) {\n${"void value;\n".repeat(lines - 2)}}\n`;
function fixture(source = body(90)) {
  const root = mkdtempSync(join(tmpdir(), "health-history-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  mkdirSync(join(root, "packages/example/src"), { recursive: true });
  const file = join(root, "packages/example/src/example.ts");
  writeFileSync(file, source);
  return { root, file };
}
function metrics(root: string) {
  execFileSync("git", ["-C", root, "add", "-A"]);
  return measure(root);
}
function save(root: string, budget: ReturnType<typeof createBudget>) {
  mkdirSync(join(root, "scripts"), { recursive: true });
  const path = join(root, "scripts/health-budget.json");
  writeFileSync(path, JSON.stringify(budget));
  return path;
}
function command(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_BASE_REF: "",
      CI: undefined,
      GITHUB_ACTIONS: undefined,
      THERMITE_HEALTH_ALLOW_NO_BASE: "1",
    },
  });
}

it.each([
  "packages/example/src/arrow.ts",
  "packages/example/test/arrow.test.ts",
  "evals/draw/arrow.mjs",
  "scripts/arrow.mjs",
])("rejects new over-cap arrow bodies in %s, even with accept", (path) => {
  const { root } = fixture();
  const budget = createBudget(metrics(root));
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(
    join(root, path),
    `const arrow = () => {\n${"void 1;\n".repeat(299)}};\n`,
  );
  const current = metrics(root);
  expect(regressions(current, budget).join("\n")).toContain(
    "functions ceiling 300 -> 301",
  );
  expect(() => acceptBudget(current, budget, "cannot waive cap")).toThrow(
    "ceiling 300 -> 301",
  );
});
it("excludes describe/suite grouping but counts test bodies, hooks and helpers", () => {
  const { root } = fixture();
  const file = join(root, "packages/example/test/group.test.ts");
  mkdirSync(join(root, "packages/example/test"));
  writeFileSync(
    file,
    `describe('group', () => {\n${body(301)}\nbeforeEach(() => {\n${"void 1;\n".repeat(299)}});\nit('logic', () => {\n${"void 1;\n".repeat(299)}});\n});\nsuite.each([1])('suite', () => {\n${"void 1;\n".repeat(400)}});\n`,
  );
  const current = metrics(root),
    values = Object.entries(current.functions)
      .filter(([key]) => key.startsWith("packages/example/test/group.test.ts#"))
      .map(([, value]) => value);
  expect(values).toHaveLength(3);
  expect(values).toEqual([301, 301, 301]);
});
it("counts hand-written code even in goldens and excludes pure data/generated sources", () => {
  const { root } = fixture();
  for (const [path, source] of [
    [
      "packages/example/test/fixtures/data.ts",
      `export const data = [\n${"1,\n".repeat(3001)}];\n`,
    ],
    ["packages/example/test/fixtures/helper.ts", body(301)],
    ["packages/example/test/goldens/data.ts", body(301)],
    ["packages/schema/src/generated/data.ts", body(301)],
  ]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  expect(
    Object.keys(metrics(root).functions).filter((p) => p.includes("fixtures")),
  ).toEqual(["packages/example/test/fixtures/helper.ts#existing"]);
  expect(Object.keys(metrics(root).files)).not.toContain(
    "packages/example/test/fixtures/data.ts",
  );
});
it("keeps evals/agent at suppression-only treatment without scanning its harness sizes", () => {
  const { root } = fixture();
  mkdirSync(join(root, "evals/agent"), { recursive: true });
  writeFileSync(join(root, "evals/agent/run.mjs"), body(500));
  writeFileSync(
    join(root, "evals/agent/runner.test.mjs"),
    body(500) + "it.skip('frozen suppression', () => {});\n",
  );
  const current = metrics(root);
  expect(current.files["evals/agent/run.mjs"]).toBeUndefined();
  expect(current.files["evals/agent/runner.test.mjs"]).toEqual({
    skippedTests: 1,
  });
  expect(
    Object.keys(current.functions).some((p) => p.startsWith("evals/agent/")),
  ).toBe(false);
});
it("an exact reason cannot authorize an existing under-ceiling raise", () => {
  const { root, file } = fixture();
  const base = metrics(root),
    budget = createBudget(base);
  writeFileSync(file, body(95));
  const current = metrics(root);
  for (const reason of [undefined, "ordered helper extraction"])
    expect(() => acceptBudget(current, budget, reason)).toThrow("cannot rise");
  const next = createBudget(current);
  const identity = "functions:packages/example/src/example.ts#existing";
  next.reasons[identity] = [
    { identity, from: 90, to: 95, reason: "historical reason" },
  ];
  expect(historyRegressions(current, next, budget, base).join("\n")).toContain(
    "cannot rise",
  );
});
it.each(["fileLines", "functionLines", "nonNullAssertions", "skippedTests"])(
  "rejects a manual global %s ceiling raise against history",
  (key) => {
    const { root } = fixture();
    const base = metrics(root),
      budget = createBudget(base),
      next = structuredClone(budget);
    if (key === "fileLines" || key === "functionLines") {
      budget.ceilings[key]--;
      next.ceilings[key] = budget.ceilings[key] + 1;
    } else next.ceilings[key]++;
    expect(historyRegressions(base, next, budget, base).join("\n")).toContain(
      `ceilings.${key} cannot rise`,
    );
  },
);
it("global assertion and suppression ceilings cannot be accepted away", () => {
  const { root, file } = fixture();
  const budget = createBudget(metrics(root));
  writeFileSync(file, "const a = value!;\nit.skip('new', () => {});\n");
  const current = metrics(root);
  expect(() => acceptBudget(current, budget, "no waiver")).toThrow(
    "Global nonNullAssertions ceiling 0 -> 1",
  );
  expect(regressions(current, budget).join("\n")).toContain(
    "Global skippedTests ceiling 0 -> 1",
  );
});
it.each([301, 380])("cannot raise grandfathered functions from %i", (size) => {
  const { root, file } = fixture(body(size));
  const base = metrics(root),
    budget = createBudget(base);
  writeFileSync(file, body(size + 1));
  const current = metrics(root);
  expect(() => acceptBudget(current, budget, "no waiver")).toThrow(
    `ceiling ${size} -> ${size + 1}`,
  );
  const forged = createBudget(current);
  expect(
    historyRegressions(current, forged, budget, base).join("\n"),
  ).toContain("cannot rise or be forged");
});
it("grandfathered file budgets only fall", () => {
  const { root, file } = fixture("// data\n".repeat(3001));
  const base = metrics(root),
    budget = createBudget(base);
  writeFileSync(file, "// data\n".repeat(3002));
  const current = metrics(root);
  expect(() => acceptBudget(current, budget, "no waiver")).toThrow(
    "files ceiling 3001 -> 3002",
  );
});
it("a lowered grandfathered body cannot regain its old allowance", () => {
  const { root, file } = fixture(body(380));
  const budget = createBudget(metrics(root));
  writeFileSync(file, body(340));
  const base = metrics(root),
    lowered = lowerBudget(base, budget);
  writeFileSync(file, body(350));
  const current = metrics(root);
  expect(() => acceptBudget(current, lowered, "no waiver")).toThrow(
    "ceiling 340 -> 350",
  );
  expect(
    historyRegressions(current, createBudget(current), lowered, base).join(
      "\n",
    ),
  ).toContain("340 -> 350");
});
it("deletion retires the record; recreated under-cap logic passes", () => {
  const { root, file } = fixture(body(380));
  const before = metrics(root),
    budget = createBudget(before);
  writeFileSync(file, "");
  const empty = metrics(root),
    lowered = lowerBudget(empty, budget, { budget, metrics: before });
  expect(lowered.grandfathered.functions).toEqual({});
  writeFileSync(file, body(55));
  const current = metrics(root);
  expect(
    regressions(current, lowered, { budget: lowered, metrics: empty }),
  ).toEqual([]);
  expect(historyRegressions(current, lowered, lowered, empty)).toEqual([]);
  writeFileSync(file, body(301));
  expect(
    regressions(metrics(root), lowered, {
      budget: lowered,
      metrics: empty,
    }).join("\n"),
  ).toContain("ceiling 300 -> 301");
});
it("a cross-file move needs exact proof and transfers one stable allowance", () => {
  const { root, file } = fixture(body(380));
  const base = metrics(root),
    budget = createBudget(base);
  const oldKey = "packages/example/src/example.ts#existing",
    newKey = "packages/example/src/moved.ts#existing";
  renameSync(file, join(root, "packages/example/src/moved.ts"));
  const current = metrics(root);
  expect(
    historyRegressions(current, budget, budget, base).join("\n"),
  ).toContain("new or unmatched content");
  budget.moves[newKey] = {
    section: "functions",
    from: oldKey,
    sha256: base.bodyHashes[oldKey],
  };
  const next = lowerBudget(current, budget, { budget, metrics: base });
  expect(next.locations.functions[oldKey]).toBe(newKey);
  expect(historyRegressions(current, next, budget, base)).toEqual([]);
  next.moves[newKey].sha256 = "forged";
  expect(historyRegressions(current, next, budget, base).join("\n")).toContain(
    "new or unmatched content",
  );
});
it("CRLF cannot evade the arrow ceiling and retains identity hashes", () => {
  const { root, file } = fixture(body(301));
  const before = metrics(root);
  writeFileSync(file, body(301).replaceAll("\n", "\r\n"));
  expect(metrics(root)).toEqual(before);
  const budget = createBudget(before);
  writeFileSync(file, body(302).replaceAll("\n", "\r\n"));
  expect(() =>
    acceptBudget(metrics(root), budget, "CRLF is no waiver"),
  ).toThrow("ceiling 301 -> 302");
});
it("CLI refuses history reset/raise before writing, including accept and lower", () => {
  const { root, file } = fixture(body(380));
  const budget = createBudget(metrics(root)),
    path = save(root, budget);
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-qm",
    "baseline",
  ]);
  writeFileSync(file, body(390));
  const forged = createBudget(metrics(root));
  save(root, forged);
  const bytes = readFileSync(path, "utf8");
  for (const args of [[], ["--accept", "--reason", "forged"], ["--lower"]]) {
    const result = command(root, args);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("functions ceiling 380 -> 390");
    expect(readFileSync(path, "utf8")).toBe(bytes);
  }
  delete forged.grandfathered.functions[
    "packages/example/src/example.ts#existing"
  ];
  save(root, forged);
  expect(command(root).status).toBe(1);
});
it("a move proof cannot duplicate one grandfathered allowance into two bodies", () => {
  const { root, file } = fixture(body(380));
  const base = metrics(root),
    budget = createBudget(base);
  const oldKey = "packages/example/src/example.ts#existing";
  writeFileSync(file, "");
  for (const name of ["first", "second"])
    writeFileSync(join(root, `packages/example/src/${name}.ts`), body(380));
  const current = metrics(root),
    next = structuredClone(budget);
  for (const name of ["first", "second"])
    next.moves[`packages/example/src/${name}.ts#existing`] = {
      section: "functions",
      from: oldKey,
      sha256: base.bodyHashes[oldKey],
    };
  expect(historyRegressions(current, next, budget, base).join("\n")).toContain(
    "Move identity consumed more than once",
  );
});
