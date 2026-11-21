import ts from "typescript";
import { permittedSymbol } from "./title-data-elk-globals.js";
import { elkIssue } from "./title-data-elk-policy.js";
import type { ElkPermissions } from "./title-data-elk-imports.js";

function bindingKey(
  node: ts.BindingElement,
  text: (node: ts.Expression | undefined) => string | undefined,
) {
  const name = node.propertyName ?? node.name;
  if (ts.isComputedPropertyName(name)) return text(name.expression);
  return ts.isIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

export function elkBindings(
  node: ts.Node,
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  permissions: ElkPermissions,
  text: (node: ts.Expression | undefined) => string | undefined,
  issues: string[],
) {
  if (
    ts.isExportSpecifier(node) &&
    !permittedSymbol(
      checker.getExportSpecifierLocalTargetSymbol(node),
      tree,
      checker,
      permissions,
    )
  )
    elkIssue(issues, "forbidden ELK capability export: " + node.name.text);
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    // Binding names declare new locals. Check the referenced source property,
    // including renamed/computed keys and parameter/nested binding patterns.
    const type = checker.getTypeAtLocation(node.parent);
    const key = bindingKey(node, text);
    const properties = node.dotDotDotToken
      ? checker.getPropertiesOfType(type)
      : key === undefined
        ? []
        : [checker.getPropertyOfType(type, key)];
    for (const property of properties)
      if (!permittedSymbol(property, tree, checker, permissions))
        elkIssue(
          issues,
          "forbidden ELK capability binding: " + (property?.name ?? key),
        );
  }
}
