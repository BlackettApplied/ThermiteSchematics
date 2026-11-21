import { createHash } from "node:crypto";
import ts from "typescript";
import { elkIssue } from "./title-data-elk-policy.js";

// The sole existing outside-loader cast: pin its whole top-level declaration,
// then admit only its two assertion nodes, never a name/range-based substitute.
const CONSTRUCTOR_SHA256 =
  "4e480620eea7debb11879af0c8139aae0285baff1546d8a511dd43e37d039b26";
export function elkConstructorAssertions(tree: ts.SourceFile) {
  const matches = tree.statements.filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      createHash("sha256")
        .update(statement.getText(tree).replace(/\r\n?|[\u2028\u2029]/g, "\n"))
        .digest("hex") === CONSTRUCTOR_SHA256,
  );
  const allowed = new Set<ts.Node>();
  function visit(node: ts.Node) {
    if (ts.isAsExpression(node)) allowed.add(node);
    ts.forEachChild(node, visit);
  }
  if (matches.length === 1 && matches[0]) visit(matches[0]);
  return allowed;
}
export function elkTypeAssertion(
  node: ts.Node,
  allowed: ReadonlySet<ts.Node>,
  issues: string[],
) {
  if (
    (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
    !allowed.has(node)
  )
    elkIssue(issues, "forbidden ELK type assertion outside loader");
}
