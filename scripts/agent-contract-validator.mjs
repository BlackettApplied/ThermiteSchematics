import ts from "typescript";
import { compareDeclarations } from "./agent-contract-declarations.mjs";

/** The optional allowed-values argument enriches an existing diagnostic only. */
function normalizeAllowedValues(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText() === "createA001Error" &&
    node.arguments.length === 4 &&
    node.arguments[0].getText() === "tool" &&
    node.arguments[1].getText() === "field" &&
    ts.isStringLiteral(node.arguments[2]) &&
    node.arguments[2].text === "unsupported-value" &&
    node.arguments[3].getText() === "literals"
  )
    return ts.factory.updateCallExpression(
      node,
      node.expression,
      node.typeArguments,
      node.arguments.slice(0, 3),
    );
  return node;
}
function functions(source) {
  const file = ts.createSourceFile(
    "validator.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const printer = ts.createPrinter({ removeComments: true });
  const transformed = ts.transform(file, [
    (context) => {
      const visit = (node) =>
        ts.visitEachChild(normalizeAllowedValues(node), visit, context);
      return (node) => ts.visitNode(node, visit);
    },
  ]);
  const result = Object.fromEntries(
    transformed.transformed[0].statements
      .filter(ts.isFunctionDeclaration)
      .map((node) => [
        node.name?.text,
        printer.printNode(ts.EmitHint.Unspecified, node, file),
      ]),
  );
  transformed.dispose();
  return result;
}
/** Runtime validation is fail-closed: an altered old function needs semantic review. */
export function compareValidator(before, after) {
  const changes = compareDeclarations(before, after),
    old = functions(before),
    next = functions(after);
  for (const [name, text] of Object.entries(old))
    if (next[name] !== text)
      changes.push({
        classification: "meaning-change",
        path: `/${name}`,
        reason:
          "Runtime validator body changed; this static audit cannot prove acceptance-set additivity",
      });
  return changes;
}
