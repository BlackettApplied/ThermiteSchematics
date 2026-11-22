import ts from "typescript";
import { appendedReasonMatches } from "./health-reasons.mjs";
export function typeAssertionNode(node) {
  return (
    (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
    !(
      ts.isTypeReferenceNode(node.type) &&
      ts.isIdentifier(node.type.typeName) &&
      node.type.typeName.text === "const"
    )
  );
}
// Reuse the parsed AST. No TypeScript Program, binding or type-check pass.
export function countTypeAssertions(source) {
  const start = performance.now();
  let count = 0;
  function visit(node) {
    if (typeAssertionNode(node)) count++;
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { count, milliseconds: performance.now() - start };
}
// Apply to every changed code file, a conservative superset of extractions and
// moves. A fresh exact reason is necessary provenance for a cast transfer;
// monotone allowance and verbatim-move checks remain independently mandatory.
export function typeAssertionRegressions(current, budget, reference) {
  if (!reference) return [];
  const errors = [];
  for (const [path, file] of Object.entries(current.files)) {
    const before = reference.metrics.files[path]?.typeAssertions ?? 0;
    const value = file.typeAssertions ?? 0;
    if (
      current.fileHashes[path] === reference.metrics.fileHashes[path] ||
      value <= before
    )
      continue;
    const identity = "typeAssertions:" + path;
    if (
      !appendedReasonMatches(
        budget.reasons[identity],
        reference.budget.reasons[identity],
        identity,
        before,
        value,
      )
    )
      errors.push(
        `Type assertion allowance requires exact reason appended in this change: ${path} ${before} -> ${value}`,
      );
  }
  return errors;
}
