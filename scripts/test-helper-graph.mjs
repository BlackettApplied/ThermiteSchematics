import ts from "typescript";
import { posix } from "node:path";
import { auditDataFixture } from "./audit-scope.mjs";
const support = (path) => /^packages\/[^/]+\/(?:test|tests)\//.test(path);
export const auditedCodeFile = (path) =>
  !auditDataFixture(path) && /\.[cm]?[jt]sx?$/.test(path);
function targetOf(file, specifier, files) {
  if (!specifier.startsWith(".")) return null;
  const path = posix.normalize(posix.join(posix.dirname(file), specifier));
  return (
    [
      path,
      path.replace(/\.[cm]?js$/, ".ts"),
      path + ".ts",
      path + "/index.ts",
    ].find((candidate) => files.has(candidate) && auditedCodeFile(candidate)) ??
    null
  );
}
function dependencies(file, source, files) {
  const result = [];
  function visit(node) {
    const value =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                node.expression.text === "require"))
          ? node.arguments[0]
          : null;
    if (value && ts.isStringLiteralLike(value)) {
      const target = targetOf(file, value.text, files);
      if (target && support(target)) result.push(target);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
export function importedTestHelpers(input) {
  const files = new Map([...input].filter(([path]) => auditedCodeFile(path))),
    roots = [...files.keys()].filter((path) => path.endsWith(".test.ts")),
    seen = new Set(),
    helpers = new Map();
  function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = ts.createSourceFile(
      file,
      files.get(file),
      ts.ScriptTarget.Latest,
      true,
    );
    if (source.parseDiagnostics.length)
      throw Error("Cannot parse audited helper: " + file);
    if (!file.endsWith(".test.ts")) helpers.set(file, source);
    for (const target of dependencies(file, source, files)) walk(target);
  }
  roots.forEach(walk);
  return helpers;
}
