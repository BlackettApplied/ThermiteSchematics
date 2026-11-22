import ts from "typescript";
export function calledName(expression) {
  while (ts.isCallExpression(expression)) expression = expression.expression;
  return ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : null;
}
function functionName(node) {
  return (
    node.name?.getText() ??
    (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText() : null)
  );
}
function facts(source) {
  const functions = [],
    aliases = [];
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body) {
      const calls = [];
      function scan(child) {
        if (ts.isThrowStatement(child)) calls.push("assert");
        if (ts.isCallExpression(child))
          calls.push(calledName(child.expression));
        if (child === node || !ts.isFunctionLike(child))
          ts.forEachChild(child, scan);
      }
      scan(node);
      functions.push({ name: functionName(node), calls });
    }
    if (ts.isImportSpecifier(node))
      aliases.push([node.name.text, node.propertyName?.text ?? node.name.text]);
    if (
      ts.isImportClause(node) &&
      node.name &&
      ts.isStringLiteral(node.parent.moduleSpecifier) &&
      /^(?:node:)?assert(?:\/strict)?$/.test(node.parent.moduleSpecifier.text)
    )
      aliases.push([node.name.text, "assert"]);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { functions, aliases };
}
export function assertionNames(helpers) {
  const names = new Set(["expect", "assert", "fail", "throws", "rejects"]),
    rows = [...helpers.values()].map(facts);
  let previous = -1;
  while (previous !== names.size) {
    previous = names.size;
    for (const { functions, aliases } of rows) {
      for (const [alias, original] of aliases)
        if (names.has(original)) names.add(alias);
      for (const fn of functions)
        if (
          fn.name &&
          fn.calls.some(
            (name) =>
              names.has(name) ||
              /^(?:assert|check|verify)[A-Z]/.test(name ?? ""),
          )
        )
          names.add(fn.name);
    }
  }
  return names;
}
