import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { git, ordering, regularInside, trackedChanges } from "../support.mjs";

const name = "compareTerminalView";

function target(statement) {
  const exported = statement.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
  if (!exported) return false;
  if (ts.isFunctionDeclaration(statement))
    return statement.name?.text === name && !!statement.body;
  if (!ts.isVariableStatement(statement)) return false;
  const [declaration, extra] = statement.declarationList.declarations;
  return (
    !!declaration &&
    !extra &&
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === name &&
    (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
    !!declaration.initializer
  );
}

function tokens(node, source) {
  const children = node.getChildren(source);
  if (children.length)
    return children
      .filter((child) => !ts.isJSDoc(child))
      .flatMap((child) => tokens(child, source));
  return ts.isStringLiteral(node)
    ? [[node.kind, node.text]]
    : [[node.kind, node.getText(source)]];
}

function addsDependency(node) {
  return (
    ts.isImportTypeNode(node) ||
    ts.isImportEqualsDeclaration(node) ||
    (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require") ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "require"))) ||
    !!ts.forEachChild(node, addsDependency)
  );
}

function structure(text) {
  const source = ts.createSourceFile(
    ordering,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  if (source.parseDiagnostics.length) return null;
  const declarations = source.statements.filter(target);
  if (declarations.length !== 1) return null;
  const [declaration] = declarations;
  if (
    declaration.modifiers.some(
      ({ kind }) => kind !== ts.SyntaxKind.ExportKeyword,
    ) ||
    addsDependency(declaration)
  )
    return null;
  return JSON.stringify({
    // TypeScript's directive comments are inputs to module resolution.
    directives: [
      source.referencedFiles,
      source.typeReferenceDirectives,
      source.libReferenceDirectives,
    ].map((references) => references.map(({ fileName }) => fileName)),
    statements: source.statements.map((statement) =>
      statement === declaration ? name : tokens(statement, source),
    ),
  });
}

export function confinedRepair(ctx, repository, revision) {
  const files = trackedChanges(ctx, repository, revision);
  if (
    files.length !== 1 ||
    files[0] !== ordering ||
    !regularInside(repository, ordering)
  )
    return false;
  const before = structure(
    git(ctx, repository, "show", revision + ":" + ordering),
  );
  const after = structure(readFileSync(join(repository, ordering), "utf8"));
  return before !== null && before === after;
}
