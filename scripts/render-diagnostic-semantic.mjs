import ts from "typescript";

export const matchesCode = (text) => /^R00[1-6]$/u.test(text);
export function renderCodes(type) {
  const choices = type.isUnion() ? type.types : [type];
  return [
    ...new Set(
      choices
        .filter((t) => t.isStringLiteral() && matchesCode(t.value))
        .map((t) => t.value),
    ),
  ].sort();
}
export function codeType(checker, expression) {
  const type = checker.getTypeAtLocation(expression);
  const code = checker.getPropertyOfType(type, "code");
  return code ? checker.getTypeOfSymbolAtLocation(code, expression) : undefined;
}
export function owner(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    if (parent.name) return parent.name.getText();
    if (ts.isVariableDeclaration(parent.parent))
      return parent.parent.name.getText();
  }
  return "<module>";
}
export function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
export function unresolved(type) {
  return (type.isUnion() ? type.types : [type]).some(
    (t) =>
      !!(
        t.flags &
        (ts.TypeFlags.String |
          ts.TypeFlags.Any |
          ts.TypeFlags.Unknown |
          ts.TypeFlags.TemplateLiteral |
          ts.TypeFlags.TypeParameter)
      ),
  );
}
function propertyValue(checker, node) {
  const symbol = checker.getPropertyOfType(
    checker.getTypeAtLocation(node),
    "code",
  );
  const declaration = symbol?.valueDeclaration;
  if (declaration && ts.isShorthandPropertyAssignment(declaration))
    return {
      valueType: checker.getTypeOfSymbolAtLocation(
        checker.getShorthandAssignmentValueSymbol(declaration),
        declaration.name,
      ),
    };
  return declaration?.initializer;
}
export function siteCodes(checker, node, expression, path) {
  const type = ts.isObjectLiteralExpression(node)
    ? codeType(checker, node)
    : checker.getTypeAtLocation(node);
  const valueType = expression
    ? (expression.valueType ?? checker.getTypeAtLocation(expression))
    : type;
  const codes = [
    ...new Set([...renderCodes(type), ...renderCodes(valueType)]),
  ].sort();
  if (unresolved(valueType) && !renderCodes(valueType).length) {
    const line =
      node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line +
      1;
    throw Error(
      `unaudited dynamic R-code site: ${path}:${line} (${owner(node)}); code type ${checker.typeToString(valueType)} cannot be resolved. Audit and use an explicit literal union; arbitrary runtime factory identity is outside this static guard.`,
    );
  }
  return codes;
}
export function constructionSites(file, path, checker) {
  const sites = [];
  visit(file, (node) => {
    if (ts.isObjectLiteralExpression(node) && codeType(checker, node)) {
      const codes = siteCodes(
        checker,
        node,
        propertyValue(checker, node),
        path,
      );
      // Object spreads transporting an R-code are sites too, independently of message changes.
      if (codes.length)
        sites.push({
          node,
          path,
          owner: owner(node),
          kind: "constructor",
          codes,
        });
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ((ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === "code") ||
        (ts.isElementAccessExpression(node.left) &&
          node.left.argumentExpression &&
          checker
            .getTypeAtLocation(node.left.argumentExpression)
            .isStringLiteral() &&
          checker.getTypeAtLocation(node.left.argumentExpression).value ===
            "code"))
    ) {
      const codes = siteCodes(checker, node.left, node.right, path);
      if (codes.length)
        sites.push({
          node,
          path,
          owner: owner(node),
          kind: "assignment",
          codes,
        });
    }
    if (ts.isCallExpression(node)) {
      const codes = [
        ...new Set(
          node.arguments.flatMap((arg) =>
            renderCodes(checker.getTypeAtLocation(arg)),
          ),
        ),
      ].sort();
      if (codes.length)
        sites.push({
          node,
          path,
          owner: owner(node),
          kind: "code-argument",
          codes,
        });
    }
  });
  return sites;
}
