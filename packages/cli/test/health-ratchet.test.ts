import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  createBudget,
  measure as measureRepository,
  acceptBudget,
  regressions,
  lowerBudget,
} from "../../../scripts/health-ratchet.mjs";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function track(root: string) {
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
}
function measure(root: string) {
  track(root);
  return measureRepository(root);
}
function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), "health-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  mkdirSync(join(root, "packages/example/src"), { recursive: true });
  mkdirSync(join(root, "packages/example/test"), { recursive: true });
  const file = join(root, "packages/example/src/example.ts");
  writeFileSync(file, source);
  return { root, file };
}
const script = fileURLToPath(
  new URL("../../../scripts/health-ratchet.mjs", import.meta.url),
);
function command(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
function saveBudget(root: string, budget: ReturnType<typeof createBudget>) {
  mkdirSync(join(root, "scripts"), { recursive: true });
  const path = join(root, "scripts/health-budget.json");
  writeFileSync(path, JSON.stringify(budget));
  return path;
}
function rejectsCommand(
  root: string,
  budget: ReturnType<typeof createBudget>,
  message: string,
) {
  track(root);
  const path = saveBudget(root, budget);
  const bytes = readFileSync(path, "utf8");
  for (const args of [[], ["--lower"]]) {
    const result = command(root, args);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("Raising a budget requires a manual edit");
    expect(readFileSync(path, "utf8")).toBe(bytes);
  }
}
function fn(name: string, lines: number) {
  return `function ${name}(value: string | undefined) {\n${"void value;\n".repeat(lines - 2)}}\n`;
}
const original =
  "function existing(value: string | undefined) {\n  return value;\n}\n";
const meaningful = `{
  const first = Number(value);
  const second = first + 2;
  const third = second * 3;
  if (third > 0) {
    return [first, second, third].join(":");
  }
  return String(third);
}`;
const fileThreshold = DEFAULT_THRESHOLDS.fileLines;
const functionThreshold = DEFAULT_THRESHOLDS.functionLines;

it("is deterministic and ignores comment/string lookalikes and ordinary test metrics", () => {
  const { root } = fixture(
    original + '// value! and it.skip("ignored")\nconst text = "test.skip";\n',
  );
  writeFileSync(
    join(root, "packages/example/test/example.test.ts"),
    "const value = input!;\n",
  );
  expect(measure(root)).toEqual(measure(root));
  expect(createBudget(measure(root)).nonNullAssertions).toEqual({});
});
it.each([
  [
    "new long function",
    original,
    original + fn("addedLongFunction", 212),
    `example.ts#addedLongFunction: function lines threshold ${functionThreshold} -> 212`,
  ],
  [
    "grown outlier function",
    fn("verifyRuntimeArchive", 549),
    fn("verifyRuntimeArchive", 552),
    "example.ts#verifyRuntimeArchive: function lines 549 -> 552",
  ],
  [
    "function threshold crossing",
    fn("existing", functionThreshold),
    fn("existing", functionThreshold + 1),
    `example.ts#existing: function lines threshold ${functionThreshold} -> ${functionThreshold + 1}`,
  ],
  [
    "grown outlier file",
    "// source\n".repeat(fileThreshold + 1),
    "// source\n".repeat(fileThreshold + 4),
    `example.ts: file lines ${fileThreshold + 1} -> ${fileThreshold + 4}`,
  ],
  [
    "file threshold crossing",
    "// source\n".repeat(fileThreshold),
    "// source\n".repeat(fileThreshold + 1),
    `example.ts: file lines threshold ${fileThreshold} -> ${fileThreshold + 1}`,
  ],
  [
    "non-null assertion",
    original,
    original.replace("return value;", "return value!;"),
    "example.ts: non-null assertions 0 -> 1",
  ],
])("rejects %s precisely in check and --lower", (_, before, after, message) => {
  const { root, file } = fixture(before);
  const budget = createBudget(measure(root));
  writeFileSync(file, after);
  expect(regressions(measure(root), budget).join("\n")).toContain(message);
  rejectsCommand(root, budget, message);
});
it("allows healthy function growth through the threshold without entries", () => {
  const { root, file } = fixture(original);
  const budget = createBudget(measure(root));
  writeFileSync(file, fn("existing", functionThreshold));
  expect(regressions(measure(root), budget)).toEqual([]);
  expect(createBudget(measure(root)).functions).toEqual({});
  expect(createBudget(measure(root)).files).toEqual({});
  saveBudget(root, budget);
  expect(command(root).status).toBe(0);
});
it("allows L1's 92 -> 107-line index.ts growth without a budget edit", () => {
  const { root } = fixture("");
  const directory = join(root, "packages/core-library/src");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "index.ts");
  writeFileSync(path, "// library\n".repeat(92));
  const budget = createBudget(measure(root));
  writeFileSync(path, "// library\n".repeat(107));
  expect(regressions(measure(root), budget)).toEqual([]);
  expect(lowerBudget(measure(root), budget).files).not.toHaveProperty(
    "packages/core-library/src/index.ts",
  );
  saveBudget(root, budget);
  expect(command(root).status).toBe(0);
});
it("rejects a new meaningful normalized duplicate across files", () => {
  const { root } = fixture(`function first(value: string) ${meaningful}\n`);
  const before = measure(root);
  expect(
    before.bodyTokens["packages/example/src/example.ts#first"],
  ).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.duplicateTokens);
  const budget = createBudget(before);
  writeFileSync(
    join(root, "packages/example/src/duplicate.ts"),
    `function second(value: string) ${meaningful.replace("const second", "/* trivia */ const second")}\n`,
  );
  const messages = regressions(measure(root), budget).join("\n");
  expect(messages).toContain("duplicate bodies 1 -> 2");
  expect(messages).toContain("example.ts#first");
  expect(messages).toContain("duplicate.ts#second");
  rejectsCommand(root, budget, "duplicate bodies 1 -> 2");
});
it("rejects growth of an existing meaningful duplicate group", () => {
  const { root, file } = fixture(
    `function first(value: string) ${meaningful}\nfunction second(value: string) ${meaningful}\n`,
  );
  const budget = createBudget(measure(root));
  writeFileSync(
    file,
    readFileSync(file, "utf8") +
      `function third(value: string) ${meaningful}\n`,
  );
  rejectsCommand(root, budget, "duplicate bodies 2 -> 3");
});
it("allows trivial duplicate bodies regardless of whitespace and comments", () => {
  const { root, file } = fixture("function first() { return 1; }\n");
  const budget = createBudget(measure(root));
  writeFileSync(
    file,
    "function first() { return 1; }\nfunction second() { /* trivia */\n\n return 1;\n}\n",
  );
  expect(regressions(measure(root), budget)).toEqual([]);
  expect(createBudget(measure(root)).duplicates).toEqual({});
  saveBudget(root, budget);
  expect(command(root).status).toBe(0);
});
it.each([
  DEFAULT_THRESHOLDS.duplicateTokens - 1,
  DEFAULT_THRESHOLDS.duplicateTokens,
])("applies the duplicate cutoff at %i normalized tokens", (tokens) => {
  const body = `{${";".repeat(tokens - 2)}}`;
  const { root, file } = fixture(`function first() ${body}\n`);
  const before = measure(root);
  expect(before.bodyTokens["packages/example/src/example.ts#first"]).toBe(
    tokens,
  );
  const budget = createBudget(before);
  writeFileSync(file, `function first() ${body}\nfunction second() ${body}\n`);
  expect(regressions(measure(root), budget).length > 0).toBe(
    tokens >= DEFAULT_THRESHOLDS.duplicateTokens,
  );
});
it.each([
  "it.skip('reason', () => {});",
  "test.skip.each([1])('case', () => {});",
  "describe['skip']('suite', () => {});",
  "test.todo('later');",
  "test('posix', {skip: process.platform === 'win32'}, () => {});",
  "test.skipIf(true)('case', () => {});",
  "test.runIf(false)('case', () => {});",
  "it.only('focused', () => {});",
  "describe.only('focused', () => {});",
  "it('ctx', (ctx) => { ctx.skip(); });",
  "it('ctx', (context) => { context.skip('reason'); });",
  "it('binding', ({ skip }) => { skip(); });",
  "it('alias', ({ skip: omit }) => { omit(); });",
  "it('nested', ({ skip }) => { queueMicrotask(() => skip()); });",
  "test('shorthand', { skip }, () => {});",
  "test('todo option', { todo }, () => {});",
])("rejects new suppression with zero as the default: %s", (source) => {
  const { root } = fixture(original);
  const budget = createBudget(measure(root));
  expect(budget.skippedTests).toEqual({});
  writeFileSync(join(root, "packages/example/test/example.test.ts"), source);
  rejectsCommand(root, budget, "example.test.ts: skipped tests 0 -> 1");
});
it("lowering removes sizes at the threshold and cannot restore an old allowance", () => {
  const { root, file } = fixture(
    fn("existing", functionThreshold + 10) +
      "// padding\n".repeat(fileThreshold + 1 - functionThreshold - 10),
  );
  const budget = createBudget(measure(root));
  writeFileSync(
    file,
    fn("existing", functionThreshold) +
      "// padding\n".repeat(fileThreshold - functionThreshold),
  );
  const path = saveBudget(root, budget);
  const result = command(root, ["--lower"]);
  expect(result.status, result.stderr).toBe(0);
  const lowered = JSON.parse(readFileSync(path, "utf8"));
  expect(lowered.files).toEqual({});
  expect(lowered.functions).toEqual({});
  expect(lowered.thresholds).toEqual(budget.thresholds);
  writeFileSync(file, fn("existing", functionThreshold + 1));
  rejectsCommand(
    root,
    lowered,
    `function lines threshold ${functionThreshold} -> ${functionThreshold + 1}`,
  );
});
it("lowering stores only nonzero counters and removes retired groups", () => {
  const { root, file } = fixture(
    `function first(value: string) ${meaningful}\nfunction second(value: string) ${meaningful}\nconst definite = value!;\n`,
  );
  const test = join(root, "packages/example/test/example.test.ts");
  writeFileSync(test, "it.skip('reason', () => {});\n");
  const budget = createBudget(measure(root));
  expect(Object.values(budget.nonNullAssertions)).toEqual([1]);
  expect(Object.values(budget.skippedTests)).toEqual([1]);
  writeFileSync(file, "");
  writeFileSync(test, "");
  const lowered = lowerBudget(measure(root), budget);
  expect(lowered.nonNullAssertions).toEqual({});
  expect(lowered.skippedTests).toEqual({});
  expect(lowered.duplicates).toEqual({});
});
it("budget keys are sorted and a second --lower is byte-identical", () => {
  const { root } = fixture(fn("zeta", 100) + fn("alpha", 90));
  const path = saveBudget(root, createBudget(measure(root)));
  expect(command(root, ["--lower"]).status).toBe(0);
  const bytes = readFileSync(path, "utf8");
  const budget = JSON.parse(bytes);
  for (const object of [
    budget,
    ...Object.values(budget).filter((value) => typeof value === "object"),
  ]) {
    expect(Object.keys(object as object)).toEqual(
      Object.keys(object as object).sort(),
    );
  }
  expect(command(root, ["--lower"]).status).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(bytes);
});
it("uses identical identities and metrics for CRLF and LF source", () => {
  const text =
    "const f = [1].map(\n  (x) => {\n    return ` value ${x} `;\n  },\n);\n";
  const { root, file } = fixture(text);
  const before = measure(root);
  writeFileSync(file, text.replaceAll("\n", "\r\n"));
  expect(measure(root)).toEqual(before);
});
it("normalization preserves literal contents", () => {
  const { root } = fixture(`function first(value: string) ${meaningful}\n`);
  writeFileSync(
    join(root, "packages/example/src/other.ts"),
    `function second(value: string) ${meaningful.replace('\":\"', '\";\"')}\n`,
  );
  expect(createBudget(measure(root)).duplicates).toEqual({});
});
it("rejects invalid threshold configuration", () => {
  const { root } = fixture(original);
  const budget = createBudget(measure(root));
  expect(() =>
    regressions(measure(root), {
      ...budget,
      thresholds: { ...budget.thresholds, functionLines: 0 },
    }),
  ).toThrow("Invalid health threshold: functionLines");
});

it("accept raises only current regressions, prints each raise and preserves every other value", () => {
  const { root, file } = fixture(
    fn("existing", 90) + "const checked = value!;\n",
  );
  const budget = createBudget(measure(root));
  budget.files["packages/example/src/retired.ts"] = 999;
  budget.functions["packages/example/src/retired.ts#old"] = 100;
  budget.skippedTests["retired.test.ts"] = 3;
  budget.duplicates["stale-group"] = 5;
  const code =
    fn("existing", 93) +
    `function first(value: string) ${meaningful}\nfunction second(value: string) ${meaningful}\n`;
  writeFileSync(
    file,
    code +
      "// pad\n".repeat(fileThreshold + 1 - code.trimEnd().split("\n").length),
  );
  writeFileSync(
    join(root, "packages/example/src/new.ts"),
    "const n = value!;\n",
  );
  writeFileSync(
    join(root, "packages/example/test/example.test.ts"),
    "it.only('focus', () => {});\n",
  );
  const current = measure(root);
  const messages = regressions(current, budget);
  expect(messages).toHaveLength(5);
  const updated = acceptBudget(current, budget);
  expect(regressions(current, updated)).toEqual([]);
  expect(updated.thresholds).toEqual(budget.thresholds);
  expect(updated.files["packages/example/src/retired.ts"]).toBe(999);
  expect(updated.functions["packages/example/src/retired.ts#old"]).toBe(100);
  expect(updated.nonNullAssertions["packages/example/src/example.ts"]).toBe(1);
  expect(updated.skippedTests["retired.test.ts"]).toBe(3);
  expect(updated.duplicates["stale-group"]).toBe(5);
  const path = saveBudget(root, budget);
  const result = command(root, ["--accept"]);
  expect(result.status, result.stderr).toBe(0);
  for (const message of messages) expect(result.stdout).toContain(message);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(updated);
  const bytes = readFileSync(path, "utf8");
  expect(command(root, ["--accept"]).status).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(bytes);
});
it("accept is a byte-preserving no-op when only improvements remain", () => {
  const { root, file } = fixture(fn("existing", 90));
  const budget = createBudget(measure(root));
  writeFileSync(file, original);
  track(root);
  const path = saveBudget(root, budget),
    bytes = readFileSync(path, "utf8");
  expect(command(root, ["--accept"]).status).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(bytes);
});
it("excludes generator-owned sources from every metric", () => {
  const { root } = fixture(original);
  const paths = [
    "packages/schema/src/generated/canonical-schemas.ts",
    "packages/schema/src/generated/device.ts",
    "packages/render/src/text-metrics-data.ts",
  ];
  for (const path of paths) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(
      join(root, path),
      fn("generated", 100) +
        "const bad = value!;\n" +
        "// generated\n".repeat(900),
    );
  }
  const metrics = measure(root);
  for (const path of paths) expect(metrics.files[path]).toBeUndefined();
  expect(createBudget(metrics).files).toEqual({});
  expect(createBudget(metrics).functions).toEqual({});
  expect(createBudget(metrics).nonNullAssertions).toEqual({});
});
it("ignores untracked and ignored files until they are added to the index", () => {
  const { root } = fixture(original);
  const budget = createBudget(measure(root));
  mkdirSync(join(root, "scripts/build"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "scripts/build/\n");
  writeFileSync(
    join(root, "scripts/build/ignored.ts"),
    "const bad = input!;\n",
  );
  writeFileSync(join(root, "scripts/untracked.ts"), "const bad = input!;\n");
  expect(regressions(measureRepository(root), budget)).toEqual([]);
  track(root);
  const metrics = measureRepository(root);
  expect(metrics.files["scripts/build/ignored.ts"]).toBeUndefined();
  expect(regressions(metrics, budget).join("\n")).toContain(
    "scripts/untracked.ts: non-null assertions 0 -> 1",
  );
});
it("reports a clear error outside a git checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "health-no-git-"));
  roots.push(root);
  expect(() => measureRepository(root)).toThrow(
    "Health ratchet requires a git checkout",
  );
  const result = command(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Health ratchet requires a git checkout");
});
it.each([
  "files",
  "functions",
  "nonNullAssertions",
  "skippedTests",
  "duplicates",
])("reports a clear error for a missing %s map", (map) => {
  const { root } = fixture(original);
  const budget = createBudget(measure(root));
  delete budget[map];
  expect(() => regressions(measure(root), budget)).toThrow(
    `Invalid health budget map: ${map}`,
  );
});
it("counts runtime skips in root-level tracked tests too", () => {
  const { root } = fixture(original);
  const budget = createBudget(measure(root));
  mkdirSync(join(root, "tools"));
  writeFileSync(
    join(root, "tools/x.test.ts"),
    "it('case', (ctx) => { ctx.skip(); });\n",
  );
  expect(regressions(measure(root), budget).join("\n")).toContain(
    "tools/x.test.ts: skipped tests 0 -> 1",
  );
});

it("warns without failing for untracked in-scope files and lists only those files", () => {
  const { root } = fixture(original);
  saveBudget(root, createBudget(measure(root)));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "packages/schema/src/generated"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "scripts/ignored.ts\n");
  writeFileSync(join(root, "scripts/ignored.ts"), "const n = value!;\n");
  writeFileSync(join(root, "scripts/new.ts"), fn("tooLong", 200));
  writeFileSync(
    join(root, "packages/example/src/new.ts"),
    "const n = value!;\n",
  );
  writeFileSync(
    join(root, "packages/schema/src/generated/new.ts"),
    fn("generated", 200),
  );
  writeFileSync(join(root, "notes.md"), "out of scope\n");
  const result = command(root);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain(
    "2 untracked in-scope files were not scanned",
  );
  expect(result.stderr).toContain("packages/example/src/new.ts");
  expect(result.stderr).toContain("scripts/new.ts");
  expect(result.stderr).toContain("git add -N");
  expect(result.stderr).not.toMatch(/ignored|generated|notes\.md/);
  track(root);
  const tracked = command(root);
  expect(tracked.status).toBe(1);
  expect(tracked.stderr).not.toContain("untracked in-scope");
  expect(tracked.stderr).toContain(
    "new.ts#tooLong: function lines threshold 70 -> 200",
  );
});
it("uses Git's empty prefix at a spaced root and rejects subdirectories", () => {
  const { root } = fixture(original);
  const spaced = join(root, "checkout with spaces");
  mkdirSync(spaced);
  execFileSync("git", ["init", "--quiet", spaced]);
  expect(measureRepository(spaced).files).toEqual({});
  const nested = join(root, "packages/example");
  expect(() => measureRepository(nested)).toThrow(
    "must run from the git checkout root",
  );
});
it("does not exclude hand-written files in other generated directories", () => {
  const { root } = fixture(original);
  const directory = join(root, "packages/example/src/generated");
  mkdirSync(directory);
  writeFileSync(join(directory, "manual.ts"), "const n = value!;\n");
  mkdirSync(join(root, "packages/example/test/generated"));
  writeFileSync(
    join(root, "packages/example/test/generated/case.test.ts"),
    "it.skip('reason', () => {});\n",
  );
  const budget = createBudget(measure(root));
  expect(
    budget.nonNullAssertions["packages/example/src/generated/manual.ts"],
  ).toBe(1);
  expect(
    budget.skippedTests["packages/example/test/generated/case.test.ts"],
  ).toBe(1);
});
