import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function pathnameUses(path: string, text: string) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const uses: string[] = [];
  function visit(node: ts.Node) {
    const property =
      ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)
        ? (node.propertyName ?? node.name)
        : undefined;
    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === "pathname") ||
      (ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === "pathname") ||
      (property &&
        (ts.isIdentifier(property) || ts.isStringLiteral(property)) &&
        property.text === "pathname")
    )
      uses.push(node.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  return uses;
}

function sourceFiles(directory = root): string[] {
  // Include new source files without scanning ignored projects, dependencies,
  // generated output or copied checkouts. Git emits portable relative paths in
  // both clones and linked worktrees; NUL delimiters preserve spaces in names.
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: directory, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  return [...new Set(result.stdout.split("\0"))].filter(
    (path) => /\.[cm]?[jt]sx?$/.test(path) && existsSync(join(directory, path)),
  );
}

it("uses fileURLToPath for filesystem paths; pathname is reserved for HTTP URLs", () => {
  // These expressions inspect HTTP request paths or canonical HTTPS schema
  // IDs. File URLs must be passed to fs directly or decoded by node:url.
  const httpUses = [
    'evals/agent/capture-cli.mjs: new URL(req.url, "http://localhost").pathname',
    "evals/agent/issue-lookup.mjs: url.pathname",
    "evals/agent/issue-lookup.mjs: url.pathname",
    "evals/agent/library-acquisition.mjs: url.pathname",
    // The visual broker's virtual HTTPS origin, served from verified bytes.
    "evals/agent/visual-capture.mjs: url.pathname",
    "packages/schema/scripts/generate-types.mjs: url.pathname",
    "packages/schema/scripts/generate-types.mjs: new URL(id).pathname",
  ];
  const actual = sourceFiles().flatMap((path) =>
    pathnameUses(join(root, path), readFileSync(join(root, path), "utf8")).map(
      (use) => `${path}: ${use}`,
    ),
  );
  expect(
    actual.sort(),
    "Use fileURLToPath(url) instead of url.pathname for filesystem paths",
  ).toEqual(httpUses.sort());
});

it("catches multiline and bracket pathname access without matching comments or strings", () => {
  expect(
    pathnameUses(
      "synthetic.ts",
      `
    const first = new URL("./fixture/", import.meta.url)
      .pathname;
    const second = url["pathname"];
    // url.pathname
    const message = "url.pathname";
    const portable = fileURLToPath(new URL("./fixture/", import.meta.url));
  `,
    ),
  ).toEqual([
    'new URL("./fixture/", import.meta.url)\n      .pathname',
    'url["pathname"]',
  ]);
});

it("catches object destructuring declarations and parameters, including aliases", () => {
  expect(
    pathnameUses(
      "synthetic.ts",
      `
    const { pathname } = new URL("./fixture/", import.meta.url);
    const read = ({ pathname }) => pathname;
    const { pathname: alias } = url;
    const { "pathname": quoted } = url;
    const { other: pathname } = unrelated;
    const [pathname] = array;
  `,
    ),
  ).toEqual(["pathname", "pathname", "pathname: alias", '"pathname": quoted']);
});

it("parses JSX using the source file extension", () => {
  expect(
    pathnameUses(
      "synthetic.tsx",
      `
    const view = <div title="url.pathname">{url.pathname}</div>;
  `,
    ),
  ).toEqual(["url.pathname"]);
});

it("skips tracked source files deleted from the worktree", () => {
  const directory = mkdtempSync(join(tmpdir(), "thermite-path-inventory-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
  };
  try {
    git("init", "--quiet");
    writeFileSync(join(directory, "kept.ts"), "");
    writeFileSync(join(directory, "deleted.ts"), "");
    git("add", "--", "kept.ts", "deleted.ts");
    rmSync(join(directory, "deleted.ts"));
    expect(sourceFiles(directory)).toEqual(["kept.ts"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
