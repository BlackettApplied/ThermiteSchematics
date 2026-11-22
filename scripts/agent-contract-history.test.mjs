import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  auditContractHistory,
  followHistory,
  contractInventory,
  CONTRACT_BASELINE,
} from "./agent-contract-history.mjs";
import {
  compareInstances,
  compareSchemas,
  compareExamples,
} from "./agent-contract-compare.mjs";
import { compareDeclarations } from "./agent-contract-declarations.mjs";

const roots = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const violations = (changes) =>
  changes.filter((change) => change.classification !== "additive");
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "agent-contract-history-"));
  roots.push(cwd);
  git(cwd, "init", "--quiet", "-b", "main");
  git(cwd, "config", "user.name", "Audit fixture");
  git(cwd, "config", "user.email", "fixture@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
  return cwd;
}
function commit(cwd, path, value) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), JSON.stringify(value));
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "fixture");
  return git(cwd, "rev-parse", "HEAD");
}

// Windows: 123–155 s; runtime grows with repository history. When 240 s headroom shrinks, re-measure; never just bump.
it("all recorded public agent contract surfaces are additive at every historical edge", () => {
  const audit = auditContractHistory();
  expect(
    audit.inventory.some((item) =>
      item.path.endsWith("agent-tool-result.schema.json"),
    ),
  ).toBe(true);
  expect(audit.inventory.some((item) => item.path.endsWith("AGENTS.md"))).toBe(
    true,
  );
  expect(audit.history.length).toBeGreaterThan(200);
  expect(audit.violations).toEqual([]);
}, 240000);

it.each([
  [{ a: "text", b: 2 }, { a: "text" }, "removal"],
  [{ old: "text" }, { renamed: "text" }, "rename"],
  [{ count: 2 }, { count: "2" }, "type-change"],
  [
    { format: "agent-tool-result/0.1" },
    { format: "other/0.1" },
    "meaning-change",
  ],
  [{ rows: [{ id: "1", value: true }] }, { rows: [{ id: "1" }] }, "removal"],
])(
  "rejects a non-additive instance mutation %#",
  (before, after, classification) => {
    expect(
      compareInstances(before, after).some(
        (change) => change.classification === classification,
      ),
    ).toBe(true);
  },
);

it("accepts added fields while distinguishing fixture values from protocol meanings", () => {
  expect(
    violations(
      compareInstances(
        { result: { uid: "a" } },
        { result: { uid: "b", source: {} } },
      ),
    ),
  ).toEqual([]);
  expect(
    violations(
      compareSchemas(
        { properties: { a: { type: "string" } } },
        { properties: { a: { type: "number" } } },
      ),
    ),
  ).not.toEqual([]);
  expect(
    violations(compareSchemas({ enum: ["a", "b"] }, { enum: ["a"] })),
  ).not.toEqual([]);
});

it("rejects a field lost from one record even while another record retains it", () => {
  const before = {
    rows: [
      { id: "a", value: true },
      { id: "b", value: true },
    ],
  };
  const after = { rows: [{ id: "a" }, { id: "b", value: true }] };
  expect(compareInstances(before, after)).toContainEqual({
    classification: "removal",
    path: "/rows/0/value",
  });
  expect(
    violations(
      compareInstances(before, { rows: [after.rows[1], after.rows[0]] }),
    ),
  ).not.toEqual([]);
  expect(
    violations(
      compareInstances(before, { rows: [{ value: true }, after.rows[1]] }),
    ),
  ).not.toEqual([]);
  expect(
    violations(
      compareInstances(before, { rows: [after.rows[1], { value: true }] }),
    ),
  ).not.toEqual([]);
  const identifiers = {
    rows: [
      { uid: "a", value: true },
      { uid: "b", value: true },
    ],
  };
  expect(
    violations(
      compareInstances(identifiers, {
        rows: [{ id: "a", value: true }, identifiers.rows[1]],
      }),
    ),
  ).not.toEqual([]);
  const diagnostic = {
    code: "E102",
    file: "wires.json",
    jsonPointer: "/0",
    uid: "a",
  };
  const inserted = { code: "I208", file: "wires.json", jsonPointer: "/0" };
  expect(
    violations(
      compareInstances(
        { diagnostics: [diagnostic] },
        { diagnostics: [inserted, diagnostic] },
      ),
    ),
  ).toEqual([]);
});

it("keeps request examples for each tool and the types and optionality of their fields", () => {
  expect(
    violations(
      compareExamples(
        [{ format: "agent-tool-request/0.1", query: {} }],
        [{ format: "agent-tool-request/0.1" }],
      ),
    ),
  ).not.toEqual([]);
  expect(
    violations(
      compareDeclarations(
        "export interface Request { uid: string }",
        "export interface Request { uid: number }",
      ),
    ),
  ).not.toEqual([]);
  expect(
    violations(
      compareDeclarations(
        "export interface Request { uid?: string }",
        "export interface Request { uid: string }",
      ),
    ),
  ).not.toEqual([]);
  expect(
    violations(
      compareDeclarations(
        "export type Result = A | B",
        "export type Result = A",
      ),
    ),
  ).not.toEqual([]);
  expect(
    violations(
      compareDeclarations(
        "export type Result = { a: string | number }",
        "export type Result = { a: string | boolean }",
      ),
    ),
  ).not.toEqual([]);
  expect(
    violations(
      compareDeclarations(
        "export interface Request { uid: string }",
        "export interface Request { uid: string; mandatory: string }",
      ),
    ),
  ).not.toEqual([]);
  const wrapper =
    "export type SourceAnnotated<T> = { [K in keyof T]: T[K] } & {source?: string}";
  expect(
    violations(
      compareDeclarations(wrapper, wrapper.replace("keyof T", "never")),
    ),
  ).not.toEqual([]);
});

it("detects a removed field even when a later commit restores it", () => {
  const cwd = fixture(),
    path = "packages/cli/test/goldens/control.json";
  const base = commit(cwd, path, { a: 1, b: "kept" });
  const removed = commit(cwd, path, { a: 1 });
  commit(cwd, path, { a: 1, b: "kept" });
  expect(auditContractHistory(cwd, "HEAD", base).violations).toContainEqual(
    expect.objectContaining({
      commit: removed,
      path: "/b",
      classification: "removal",
    }),
  );
});

it("rejects an uncommitted contract removal before it can be committed", () => {
  const cwd = fixture(),
    path = "packages/cli/test/goldens/control.json";
  const base = commit(cwd, path, { a: 1, b: "kept" });
  writeFileSync(join(cwd, path), JSON.stringify({ a: 1 }));
  expect(auditContractHistory(cwd, "HEAD", base).violations).toContainEqual(
    expect.objectContaining({
      commit: "WORKTREE",
      classification: "removal",
      path: "/b",
    }),
  );
});

it("follows renamed surfaces and catches a removal at the old path", () => {
  const cwd = fixture(),
    path = "packages/cli/test/goldens/old.json",
    next = path.replace("/old.json", "/new.json");
  const base = commit(cwd, path, { a: 1, b: "kept", c: "unchanged" });
  const removed = commit(cwd, path, { a: 1, c: "unchanged" });
  renameSync(join(cwd, path), join(cwd, next));
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "rename fixture");
  const history = followHistory(cwd, base, "HEAD", {
    path: next,
    kind: "instance",
  });
  expect(
    history.find((edge) => edge.commit === removed)?.changes,
  ).toContainEqual({ classification: "removal", path: "/b" });
  expect(
    history.at(-1).changes.some((change) => change.classification === "rename"),
  ).toBe(true);
});

it("also checks the side-parent contract when a merge loses its added field", () => {
  const cwd = fixture(),
    path = "packages/cli/test/goldens/control.json";
  const base = commit(cwd, path, { a: 1 });
  git(cwd, "checkout", "--quiet", "-b", "side");
  commit(cwd, path, { a: 1, side: "public" });
  git(cwd, "checkout", "--quiet", "main");
  commit(cwd, "unrelated.json", {});
  git(cwd, "merge", "--quiet", "--no-ff", "--no-commit", "side");
  writeFileSync(join(cwd, path), JSON.stringify({ a: 1 }));
  git(cwd, "add", "-A");
  git(cwd, "commit", "--quiet", "-m", "drop side field");
  expect(auditContractHistory(cwd, "HEAD", base).violations).toContainEqual(
    expect.objectContaining({ classification: "removal", path: "/side" }),
  );
});

it("audits transitive render/query/compiler declarations and the runtime validator", () => {
  const inventory = contractInventory(
    process.cwd(),
    CONTRACT_BASELINE.base,
    "HEAD",
  );
  for (const path of [
    "packages/render/src/types.ts",
    "packages/query/src/types.ts",
    "packages/compiler/src/compiler.ts",
    "packages/agent-tools/src/common/request-validation.ts",
  ])
    expect(
      inventory.some((entry) => entry.path === path),
      path,
    ).toBe(true);
  expect(
    violations(
      compareDeclarations(
        "export interface RenderSummary { netIds: readonly string[] }",
        "export interface RenderSummary { netIdList: readonly string[] }",
        new Set(["RenderSummary"]),
      ),
    ),
  ).toContainEqual(
    expect.objectContaining({
      classification: "removal",
      path: "/RenderSummary/netIds",
    }),
  );
  expect(
    violations(
      compareDeclarations(
        'export type ObjectSelector = {by: "uid"; value: string} | {by: "designation"; value: string}',
        'export type ObjectSelector = {by: "uid"; value: string}',
        new Set(["ObjectSelector"]),
      ),
    ),
  ).toContainEqual(
    expect.objectContaining({
      classification: "type-change",
      path: "/ObjectSelector",
    }),
  );
});

it("accepts a widened literal field union while rejecting a narrowed one", () => {
  const old = 'export interface Result { format: "one" | "two" }';
  const widened =
    'export interface Result { format: | "one" | "two" | "three" }';
  expect(violations(compareDeclarations(old, widened))).toEqual([]);
  expect(violations(compareDeclarations(widened, old))).not.toEqual([]);
});
