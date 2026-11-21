import ts from "typescript";
import { elkIssue } from "./title-data-elk-policy.js";

const stateNames = new Set(["fauxWorker", "WORKER_SPECIFIER"]);
export function elkStateDeclarations(tree: ts.SourceFile, issues: string[]) {
  const result = new Set<ts.Identifier>();
  const names: string[] = [];
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const list = statement.declarationList;
    for (const declaration of list.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !stateNames.has(declaration.name.text)
      )
        continue;
      const name = declaration.name.text,
        init = declaration.initializer;
      const valid =
        list.declarations.length === 1 &&
        (name === "fauxWorker"
          ? (list.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Let &&
            !init
          : (list.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Const &&
            init &&
            ts.isStringLiteral(init) &&
            init.text === "elkjs/lib/elk-worker.min.js");
      if (valid) {
        result.add(declaration.name);
        names.push(name);
      } else
        elkIssue(
          issues,
          name === "fauxWorker"
            ? "loader cache must start undefined in its canonical uninitialized declaration"
            : "worker specifier must remain a closed ELK resource",
        );
    }
  }
  for (const name of stateNames)
    if (names.filter((value) => value === name).length !== 1)
      elkIssue(issues, "expected one canonical ELK state declaration: " + name);
  return result;
}
export function elkStateReference(
  node: ts.Node,
  declarations: ReadonlySet<ts.Identifier>,
  issues: string[],
) {
  if (
    ts.isIdentifier(node) &&
    stateNames.has(node.text) &&
    !declarations.has(node)
  )
    elkIssue(
      issues,
      "ELK state reference outside its declaration: " + node.text,
    );
}
export function undefinedDeclaration(node: ts.Node, issues: string[]) {
  if (
    ts.isIdentifier(node) &&
    node.text === "undefined" &&
    node.parent &&
    "name" in node.parent &&
    node.parent.name === node &&
    !ts.isPropertyAccessExpression(node.parent)
  )
    elkIssue(issues, "declaration named undefined is forbidden");
}
