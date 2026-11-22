import ts from "typescript";

const owner = "packages/render/src/text-metrics.ts";
const sourcePath = /^packages\/(?:render|cli)\/src\/.*\.[cm]?[jt]sx?$/u;
const metricMember =
  /^(?:measureText|getComputedTextLength|getSubStringLength|advanceWidth|xAdvance)$/u;
const localHelper =
  /^(?:measure(?:Printable)?Text|(?:text|glyph|char(?:acter)?|word|average)(?:Widths?|Advances?))$/iu;
const textName =
  /^(?:s|str|c|ch|text|value|label|caption|word|designation|glyph|char|string)$|(?:Text|Value|Label|Caption|Word|Designation|Glyph|Char|String)$/u;

function textSequence(node) {
  if (ts.isArrayLiteralExpression(node))
    return node.elements.length === 1 && ts.isSpreadElement(node.elements[0]);
  if (ts.isCallExpression(node))
    return (
      ts.isPropertyAccessExpression(node.expression) &&
      ["from", "split"].includes(node.expression.name.text) &&
      (node.expression.name.text === "from"
        ? node.expression.expression.getText() === "Array"
        : node.arguments[0]?.getText() === '""' ||
          node.arguments[0]?.getText() === "''")
    );
  return false;
}

function usesTextLength(node) {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "length")
    return false;
  const value = node.expression;
  return (
    textSequence(value) ||
    ((ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) &&
      textName.test(ts.isIdentifier(value) ? value.text : value.name.text))
  );
}

function lineHeight(node) {
  let parent = node.parent;
  while (parent && ts.isBinaryExpression(parent)) parent = parent.parent;
  return (
    parent &&
    ts.isPropertyAssignment(parent) &&
    parent.name.getText() === "height"
  );
}

function localMeasurement(node) {
  if (
    (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name) &&
    localHelper.test(node.name.text)
  )
    return true;
  if (ts.isPropertyAccessExpression(node))
    return metricMember.test(node.name.text);
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression)
  )
    return (
      node.expression.name.text === "reduce" &&
      textSequence(node.expression.expression) &&
      node.arguments.some(
        (argument) =>
          ts.isArrowFunction(argument) &&
          /(?:\b\d+\.\d+\b|\.test\(|\.codePointAt\()/u.test(argument.getText()),
      )
    );
  if (!ts.isBinaryExpression(node)) return false;
  return (
    node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
    !lineHeight(node) &&
    ((usesTextLength(node.left) && ts.isNumericLiteral(node.right)) ||
      (usesTextLength(node.right) && ts.isNumericLiteral(node.left)))
  );
}

export function textMetricRegressions(paths, read) {
  const errors = [];
  for (const path of paths) {
    if (path === owner || !sourcePath.test(path)) continue;
    const source = ts.createSourceFile(
      path,
      read(path),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      if (localMeasurement(node)) {
        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        errors.push(
          `${path}:${line + 1}: use the pinned text measurement in ${owner}`,
        );
      } else ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return errors;
}
