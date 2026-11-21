import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  auditContractHistory,
  CONTRACT_BASELINE,
} from "./agent-contract-history.mjs";
import { compareValidator } from "./agent-contract-validator.mjs";

const roots = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture(path, text) {
  const root = mkdtempSync(join(tmpdir(), "contract-surface-"));
  roots.push(root);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet", "-b", "main");
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  git("add", "-A");
  git(
    "-c",
    "user.name=Audit fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  return { root, base: git("rev-parse", "HEAD") };
}
it.each([
  ["packages/render/src/types.ts", "netIds", "netIdList"],
  [
    "packages/query/src/types.ts",
    '| { readonly by: "designation"; readonly value: string }',
    "",
  ],
  ["packages/compiler/src/ir.ts", "name: string;", "renamed: string;"],
  [
    "packages/agent-tools/src/common/request-validation.ts",
    'typeof value !== "string"',
    'typeof value === "string"',
  ],
])("history refuses an altered public surface %s", (path, from, to) => {
  const old = readFileSync(path, "utf8");
  expect(old).toContain(from);
  const { root, base } = fixture(path, old);
  writeFileSync(join(root, path), old.replace(from, to));
  const audit = auditContractHistory(root, "HEAD", base);
  expect(
    audit.violations.some((v) => v.file === path && v.commit === "WORKTREE"),
  ).toBe(true);
});
it("validator normalization is limited to the additive allowed-value diagnostic argument", () => {
  const before =
    'export function validate() { return createA001Error(tool, field, "unsupported-value"); }';
  expect(
    compareValidator(
      before,
      before.replace('"unsupported-value")', '"unsupported-value", literals)'),
    ),
  ).toEqual([]);
  expect(
    compareValidator(
      before,
      before.replace('"unsupported-value"', '"wrong-type"'),
    ).some((c) => c.classification === "meaning-change"),
  ).toBe(true);
  expect(CONTRACT_BASELINE.validatorSources).toContain(
    "packages/agent-tools/src/common/request-validation.ts",
  );
});

it("literal-union additivity cannot silently widen a primitive field type", async () => {
  const { compareDeclarations } =
    await import("./agent-contract-declarations.mjs");
  const changes = compareDeclarations(
    "export interface Result { value: string }",
    "export interface Result { value: string | number }",
  );
  expect(changes).toContainEqual(
    expect.objectContaining({
      classification: "type-change",
      path: "/Result/value",
    }),
  );
});
