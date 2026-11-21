import ts from "typescript";
import { constantText } from "./title-data-constant.js";
import { elkIssue } from "./title-data-elk-policy.js";
const reserved = new Set(["constructor", "__proto__", "prototype"]);

export function elkText(checker: ts.TypeChecker) {
  const resolving = new Set<ts.Symbol>();
  const identifier = (node: ts.Identifier): string | undefined => {
    const symbol = checker.getSymbolAtLocation(node),
      declarations = symbol?.declarations ?? [];
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    let value: string | undefined;
    if (
      symbol &&
      !resolving.has(symbol) &&
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      ts.isIdentifier(declaration.name) &&
      declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const
    ) {
      resolving.add(symbol);
      value = constantText(declaration.initializer, identifier);
      resolving.delete(symbol);
    }
    return value;
  };
  return (node: ts.Expression | undefined) =>
    node ? constantText(node, identifier) : undefined;
}
export function elkKeys(
  node: ts.Node,
  text: (node: ts.Expression | undefined) => string | undefined,
  issues: string[],
) {
  const value = ts.isIdentifier(node)
    ? node.text
    : ts.isStringLiteralLike(node) ||
        ts.isBinaryExpression(node) ||
        ts.isTemplateExpression(node) ||
        ts.isParenthesizedExpression(node)
      ? text(node)
      : undefined;
  if (
    (value !== undefined && reserved.has(value)) ||
    ts.isConstructorDeclaration(node)
  )
    elkIssue(
      issues,
      "forbidden ELK capability key " + (value ?? "constructor"),
    );
  const key = ts.isElementAccessExpression(node)
    ? node.argumentExpression
    : ts.isComputedPropertyName(node)
      ? node.expression
      : null;
  if (
    key !== null &&
    !(key && ts.isNumericLiteral(key)) &&
    text(key) === undefined
  )
    elkIssue(issues, "unresolved ELK computed key");
}
