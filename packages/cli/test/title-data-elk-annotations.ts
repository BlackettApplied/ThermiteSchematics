import ts from "typescript";
import { permittedSymbol } from "./title-data-elk-globals.js";
import type { ElkPermissions } from "./title-data-elk-imports.js";
import { elkIssue } from "./title-data-elk-policy.js";

function externalValue(
  node: ts.Expression,
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): boolean {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return externalValue(node.expression, tree, checker, seen);
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  const target =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const declarations = target.declarations ?? [];
  if (declarations.some((declaration) => declaration.getSourceFile() !== tree))
    return true;
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  return (
    !!declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    !!(declaration.parent.flags & ts.NodeFlags.Const) &&
    !!declaration.initializer &&
    externalValue(declaration.initializer, tree, checker, seen)
  );
}

export function elkAnnotation(
  node: ts.Node,
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  permissions: ElkPermissions,
  issues: string[],
) {
  if (
    ts.isVariableDeclaration(node) &&
    node.type &&
    node.initializer &&
    ts.isVariableDeclarationList(node.parent) &&
    node.parent.flags & ts.NodeFlags.Const &&
    externalValue(node.initializer, tree, checker)
  ) {
    const input = checker.getTypeAtLocation(node.initializer);
    // Structural annotations can re-home a denied external member into a local
    // interface. Reject only that permission widening; identical external types
    // and interfaces exposing already-permitted members retain their admission.
    for (const member of checker.getPropertiesOfType(
      checker.getTypeFromTypeNode(node.type),
    ))
      if (
        permittedSymbol(member, tree, checker, permissions) &&
        !permittedSymbol(
          checker.getPropertyOfType(input, member.name),
          tree,
          checker,
          permissions,
        )
      )
        elkIssue(
          issues,
          "ELK annotation widens permitted member: " + member.name,
        );
  }
}
