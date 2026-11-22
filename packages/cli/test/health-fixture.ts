import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import { measure } from "../../../scripts/health-ratchet.mjs";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
export const script = fileURLToPath(
  new URL("../../../scripts/health-ratchet.mjs", import.meta.url),
);
export const fn = (n: number, name = "existing") =>
  `function ${name}(value) {\n${"void value;\n".repeat(n - 2)}}\n`;
export function repo() {
  const root = mkdtempSync(join(tmpdir(), "health-r2-"));
  roots.push(root);
  git(root, "init", "--quiet");
  return root;
}
export function put(root: string, path: string, text: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}
export function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
}
export function metrics(root: string) {
  git(root, "add", "-A");
  return measure(root);
}
export function save(root: string, budget: unknown) {
  put(
    root,
    "scripts/health-budget.json",
    JSON.stringify(budget, null, 2) + "\n",
  );
}
export function commit(root: string, message = "fixture") {
  git(root, "add", "-A");
  git(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    message,
  );
  return git(root, "rev-parse", "HEAD");
}
export function run(
  root: string,
  args: string[] = [],
  extra: Record<string, string | undefined> = {},
) {
  const env = {
    ...process.env,
    GITHUB_BASE_REF: "",
    CI: undefined,
    GITHUB_ACTIONS: undefined,
    THERMITE_HEALTH_ALLOW_NO_BASE: undefined,
    ...extra,
  };
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}
