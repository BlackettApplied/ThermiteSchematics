import ts from "typescript";
import { permittedSymbol } from "./title-data-elk-globals.js";
import { elkIssue } from "./title-data-elk-policy.js";
import type { ElkPermissions } from "./title-data-elk-imports.js";

export function deniedMemberNames(
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  permissions: ElkPermissions,
) {
  const names = new Set<string>();
  for (const [symbol, admitted] of permissions.aliases) {
    const declaration = symbol.declarations?.[0];
    if (admitted && declaration) {
      const target = checker.getAliasedSymbol(symbol);
      const types = [checker.getTypeOfSymbolAtLocation(symbol, declaration)];
      if (target.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class))
        types.push(checker.getDeclaredTypeOfSymbol(target));
      for (const type of types)
        for (const member of checker.getPropertiesOfType(type))
          if (!permittedSymbol(member, tree, checker, permissions))
            names.add(member.name);
    }
  }
  return names;
}

function slotTypes(node: ts.Node): readonly ts.TypeNode[] {
  let types: readonly ts.TypeNode[] = [];
  if (
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isFunctionLike(node)
  )
    types = node.type ? [node.type] : [];
  if (ts.isCallExpression(node) || ts.isNewExpression(node))
    types = node.typeArguments ?? [];
  return types;
}

// Structural typing can re-home a denied imported member into a local symbol.
// Check every annotated slot, independent of its initializer's syntax or flow.
// Conservatively reserve denied imported member names at these boundaries;
// nested type nodes cover arrays, object slots and destructured parameters.
export function elkSlotAudit(
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  permissions: ElkPermissions,
  issues: string[],
) {
  const denied = deniedMemberNames(tree, checker, permissions);
  const visited = new WeakSet<ts.Node>();
  function inspect(node: ts.Node) {
    if (!visited.has(node)) {
      visited.add(node);
      if (ts.isTypeNode(node))
        for (const member of checker.getPropertiesOfType(
          checker.getTypeFromTypeNode(node),
        ))
          if (
            denied.has(member.name) &&
            permittedSymbol(member, tree, checker, permissions)
          )
            elkIssue(
              issues,
              "ELK annotation widens permitted member: " + member.name,
            );
      ts.forEachChild(node, inspect);
    }
  }
  return (node: ts.Node) => slotTypes(node).forEach(inspect);
}
