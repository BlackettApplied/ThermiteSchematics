import ts from "typescript";
import { ELK_MEMBERS, elkIssue } from "./title-data-elk-policy.js";
import type { ElkPermissions } from "./title-data-elk-imports.js";

export function permittedExternalMember(symbol: ts.Symbol | undefined) {
  const rule = ELK_MEMBERS.get(symbol?.name ?? ""),
    declarations = symbol?.declarations ?? [];
  return (
    !!rule &&
    declarations.length > 0 &&
    declarations.every((declaration) => {
      const path = declaration.getSourceFile().fileName.replaceAll("\\", "/");
      const parent = declaration.parent;
      const name =
        ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)
          ? parent.name
          : undefined;
      return (
        path.endsWith("/node_modules/" + rule[0]) && name?.text === rule[1]
      );
    })
  );
}
export function permittedSymbol(
  symbol: ts.Symbol | undefined,
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  permissions: ElkPermissions,
): boolean {
  if (!symbol) return false;
  if (permissions.aliases.has(symbol))
    return permissions.aliases.get(symbol) === true;
  const target =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  if (permissions.targets.has(target))
    return permissions.targets.get(target) === true;
  const declarations = target.declarations ?? [];
  return (
    (declarations.length > 0 &&
      declarations.every(
        (declaration) => declaration.getSourceFile() === tree,
      )) ||
    permittedExternalMember(target)
  );
}
// A shorthand's property symbol belongs to this module; its value can still
// be a global or a loader-only import. Export names can hide aliases too.
function referencedSymbol(node: ts.Identifier, checker: ts.TypeChecker) {
  if (
    ts.isShorthandPropertyAssignment(node.parent) &&
    node.parent.name === node
  )
    return checker.getShorthandAssignmentValueSymbol(node.parent);
  if (ts.isExportSpecifier(node.parent))
    return checker.getExportSpecifierLocalTargetSymbol(node.parent);
  return checker.getSymbolAtLocation(node);
}
export function elkGlobal(
  node: ts.Node,
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  permissions: ElkPermissions,
  text: (node: ts.Expression | undefined) => string | undefined,
  issues: string[],
) {
  if (
    ts.isIdentifier(node) &&
    !permissions.names.has(node) &&
    !permittedSymbol(
      referencedSymbol(node, checker),
      tree,
      checker,
      permissions,
    )
  )
    elkIssue(issues, "forbidden ELK capability identifier: " + node.text);
  if (ts.isElementAccessExpression(node)) {
    const key = text(node.argumentExpression);
    if (
      key !== undefined &&
      !permittedSymbol(
        checker.getPropertyOfType(
          checker.getTypeAtLocation(node.expression),
          key,
        ),
        tree,
        checker,
        permissions,
      )
    )
      elkIssue(issues, "forbidden ELK capability member: " + key);
  }
  if (
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
  )
    elkIssue(issues, "ambient declarations are outside the ELK allowlist");
}
