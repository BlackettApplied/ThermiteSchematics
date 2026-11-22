import ts from "typescript";

/** Pure, single-exit folding; unresolved parts leave the result unknown. */
export function constantText(
  node: ts.Expression,
  identifier?: (node: ts.Identifier) => string | undefined,
): string | undefined {
  let result: string | undefined;
  if (ts.isStringLiteralLike(node)) result = node.text;
  else if (ts.isIdentifier(node)) result = identifier?.(node);
  else if (ts.isParenthesizedExpression(node))
    result = constantText(node.expression, identifier);
  else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const a = constantText(node.left, identifier),
      b = constantText(node.right, identifier);
    if (a !== undefined && b !== undefined) result = a + b;
  } else if (ts.isTemplateExpression(node)) {
    let complete = true,
      rendered = node.head.text;
    for (const span of node.templateSpans) {
      const value = constantText(span.expression, identifier);
      if (value === undefined) complete = false;
      else rendered += value + span.literal.text;
    }
    if (complete) result = rendered;
  }
  return result;
}
