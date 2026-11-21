import ts from "typescript";
import { ELK_IMPORTS, elkIssue } from "./title-data-elk-policy.js";

function loadingCall(
  node: ts.CallExpression,
  text: (node: ts.Expression | undefined) => string | undefined,
): boolean {
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isElementAccessExpression(callee)
        ? text(callee.argumentExpression)
        : undefined;
  return (
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    name === "require" ||
    name === "createRequire" ||
    (ts.isCallExpression(callee) && loadingCall(callee, text)) ||
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "resolve" &&
      ((ts.isCallExpression(callee.expression) &&
        loadingCall(callee.expression, text)) ||
        (ts.isIdentifier(callee.expression) &&
          callee.expression.text === "require")))
  );
}
function moduleForm(
  node: ts.Node,
  text: (node: ts.Expression | undefined) => string | undefined,
) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier
  )
    return {
      expression: node.moduleSpecifier,
      staticImport: ts.isImportDeclaration(node),
    };
  if (ts.isImportEqualsDeclaration(node))
    return {
      expression: ts.isExternalModuleReference(node.moduleReference)
        ? node.moduleReference.expression
        : undefined,
      staticImport: false,
    };
  if (ts.isImportTypeNode(node))
    return {
      expression:
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
          ? node.argument.literal
          : undefined,
      staticImport: false,
    };
  if (ts.isCallExpression(node) && loadingCall(node, text))
    return { expression: node.arguments[0], staticImport: false };
  return null;
}
export function elkModule(
  node: ts.Node,
  text: (node: ts.Expression | undefined) => string | undefined,
  issues: string[],
) {
  const form = moduleForm(node, text);
  if (form) {
    const value = text(form.expression);
    if (value === undefined)
      elkIssue(issues, "unresolved ELK capability specifier");
    else if (!ELK_IMPORTS.has(value) || !form.staticImport)
      elkIssue(
        issues,
        "forbidden ELK capability module form/specifier: " + value,
      );
  }
}
