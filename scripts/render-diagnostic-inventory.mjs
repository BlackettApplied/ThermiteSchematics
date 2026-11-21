import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import ts from "typescript";

import {
  codeType,
  constructionSites,
  owner,
  renderCodes,
  visit,
} from "./render-diagnostic-semantic.mjs";
import { classSites } from "./render-diagnostic-classes.mjs";
const slash = (path) => path.replaceAll("\\", "/");
function factoryKey(path, name) {
  return `${path}:${name}`;
}
function typedRenderError(checker, expression) {
  const type = codeType(checker, expression);
  return type !== undefined && renderCodes(type).length > 0;
}
function messageWrappers(file, path, checker) {
  const wrappers = new Set();
  visit(file, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const spreadsError = node.properties.some(
      (prop) =>
        ts.isSpreadAssignment(prop) &&
        (/\b(error|e)\b/u.test(prop.expression.getText(file)) ||
          typedRenderError(checker, prop.expression)),
    );
    if (
      spreadsError &&
      node.properties.some(
        (prop) =>
          ts.isPropertyAssignment(prop) &&
          ["message", "details"].includes(prop.name.getText(file)),
      )
    )
      wrappers.add(owner(node));
  });
  return [...wrappers].map((name) => ({ path, owner: name }));
}

/** Compiler-resolved calls include imported aliases; interfaces are not constructors. */
export function diagnosticInventory(root = resolve(".")) {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const paths = tracked.filter(
    (path) =>
      path.endsWith(".ts") &&
      (path.startsWith("packages/render/src/") ||
        path === "packages/cli/src/alpha.ts" ||
        path === "packages/cli/src/alpha-export-artifact.ts"),
  );
  const program = ts.createProgram(
    paths.map((path) => resolve(root, path)),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
    },
  );
  const checker = program.getTypeChecker(),
    files = paths.map((path) => ({
      path,
      file: program.getSourceFile(resolve(root, path)),
    }));
  const sites = files.flatMap(({ path, file }) =>
    constructionSites(file, path, checker),
  );
  const factories = new Map();
  for (const site of sites.filter((site) => site.kind === "constructor")) {
    for (const key of [
      factoryKey(site.path, site.owner),
      containingFunction(site.node),
    ]) {
      if (!key) continue;
      const codes = factories.get(key) ?? new Set();
      for (const code of site.codes) codes.add(code);
      factories.set(key, codes);
    }
  }
  sites.push(...factoryCalls(root, checker, files, factories));
  sites.push(...classSites(root, checker, files));
  return {
    sites: identifySites(sites),
    wrappers: files
      .flatMap(({ path, file }) => messageWrappers(file, path, checker))
      .sort((a, b) =>
        factoryKey(a.path, a.owner).localeCompare(factoryKey(b.path, b.owner)),
      ),
  };
}

function factoryCalls(root, checker, files, factories) {
  const sites = [];
  for (const { path, file } of files)
    visit(file, (node) => {
      if (!ts.isCallExpression(node)) return;
      const signature = checker.getResolvedSignature(node);
      const decl = signature?.declaration;
      if (!decl || !files.some(({ file }) => file === decl.getSourceFile()))
        return;
      const key = factoryKey(
        slash(relative(root, decl.getSourceFile().fileName)),
        decl.name?.getText() ??
          (ts.isVariableDeclaration(decl.parent)
            ? decl.parent.name.getText()
            : "<anonymous>"),
      );
      const resultType = checker.getReturnTypeOfSignature(signature);
      const code = checker.getPropertyOfType(resultType, "code");
      const inferred = code
        ? renderCodes(checker.getTypeOfSymbolAtLocation(code, node))
        : [];
      const codes =
        factories.get(decl) ??
        factories.get(key) ??
        (inferred.length ? new Set(inferred) : undefined);
      if (codes)
        sites.push({
          node,
          path,
          owner: owner(node),
          kind: "factory-call",
          factory: key,
          codes: [...codes].sort(),
        });
    });
  return sites;
}

function identifySites(sites) {
  const ordinals = new Map();
  return sites
    .map(({ node, ...site }) => {
      const key = `${site.path}:${site.owner}:${site.kind}`,
        ordinal = (ordinals.get(key) ?? 0) + 1;
      ordinals.set(key, ordinal);
      return {
        id: `${key}:${ordinal}`,
        ...site,
        line:
          node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
            .line + 1,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Declaration identity keeps anonymous factories distinct from their enclosing owner. */
function containingFunction(node) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (ts.isFunctionLike(parent)) return parent;
}
