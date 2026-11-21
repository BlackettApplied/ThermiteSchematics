import ts from "typescript";
import { createHash } from "node:crypto";
function fingerprint(node) {
  const tokens = [];
  function visit(n) {
    const children = n.getChildren();
    if (children.length) children.forEach(visit);
    else tokens.push([n.kind, n.getText()]);
  }
  visit(node);
  return createHash("sha256").update(JSON.stringify(tokens)).digest("hex");
}
function chain(fn) {
  const hashes = [];
  for (let node = fn; node; node = node.parent)
    if (ts.isFunctionLike(node)) hashes.push(fingerprint(node));
  return hashes.join("/");
}
// Authenticate the whole enclosing chain and consume each base function once.
// Multiple bypass sites within one function share that function's decision.
export function helperAdmissions(rows) {
  const remaining = new Map(),
    seen = new Set(),
    decisions = new WeakMap();
  for (const row of rows)
    if (row.kind !== "skip/only/todo" && row.fn && !seen.has(row.fn)) {
      seen.add(row.fn);
      const key = chain(row.fn);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
  return (fn) => {
    if (!decisions.has(fn)) {
      const key = chain(fn),
        count = remaining.get(key) ?? 0;
      decisions.set(fn, count > 0);
      remaining.set(key, Math.max(0, count - 1));
    }
    return decisions.get(fn);
  };
}
export function guardedAssertion(node, fn) {
  let guarded = false;
  for (
    let child = node, parent = node.parent;
    parent && parent !== fn;
    child = parent, parent = parent.parent
  ) {
    if (ts.isIfStatement(parent) && parent.expression !== child) guarded = true;
    if (ts.isConditionalExpression(parent) && parent.condition !== child)
      guarded = true;
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === child &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken,
        ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken,
      ].includes(parent.operatorToken.kind)
    )
      guarded = true;
    if (parent.questionDotToken) guarded = true;
  }
  function optional(n) {
    if (n.questionDotToken) guarded = true;
    // Arguments execute after the assertion callee is selected; a nested
    // callback's own guards belong to its own assertion, not this one.
    if (ts.isCallExpression(n)) optional(n.expression);
    else if (
      ts.isPropertyAccessExpression(n) ||
      ts.isElementAccessExpression(n)
    )
      optional(n.expression);
  }
  optional(node);
  return guarded;
}
