import { assertionNames, calledName } from "./test-helper-assertions.mjs";
import ts from "typescript";
import {
  helperAdmissions,
  guardedAssertion,
} from "./test-helper-admissions.mjs";
import { importedTestHelpers } from "./test-helper-graph.mjs";
function functionOf(node) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (ts.isFunctionLike(parent)) return parent;
  return null;
}
function assertion(node, names) {
  if (ts.isThrowStatement(node)) return true;
  if (!ts.isCallExpression(node)) return false;
  const text = node.expression.getText();
  if (names.has(calledName(node.expression))) return true;
  return /^(?:expect\b|assert\b|assert[A-Z]|check[A-Z]|verify[A-Z])/.test(text);
}
function selectsTests(node) {
  if (
    ts.isBindingElement(node) &&
    ["skip", "skipIf", "runIf", "only", "todo"].includes(
      (node.propertyName ?? node.name).getText(),
    )
  )
    return true;
  if (
    ts.isCallExpression(node) &&
    ["skip", "only", "todo", "process.exit", "Bun.exit"].includes(
      node.expression.getText(),
    )
  )
    return true;
  const name = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : null;
  if (!["skip", "skipIf", "runIf", "only", "todo"].includes(name)) return false;
  let callee = node;
  while (
    ts.isPropertyAccessExpression(callee.parent) &&
    callee.parent.expression === callee
  )
    callee = callee.parent;
  return (
    (ts.isCallExpression(callee.parent) &&
      callee.parent.expression === callee) ||
    (ts.isVariableDeclaration(node.parent) &&
      node.parent.initializer === node) ||
    /^(?:it|test|describe|suite)(?:\.|\[)/.test(node.getText())
  );
}
function rethrows(block) {
  const last = block.statements.at(-1);
  return !!last && ts.isThrowStatement(last);
}
const exits = (node) =>
  ts.isReturnStatement(node) ||
  ts.isBreakStatement(node) ||
  ts.isContinueStatement(node);
function bypasses(source, names) {
  const rows = [],
    assertions = new WeakMap();
  function visit(node) {
    const fn = functionOf(node);
    if (fn && exits(node) && !assertions.has(fn)) {
      const calls = [];
      function scan(n) {
        if (assertion(n, names)) calls.push(n.getStart());
        if (n === fn || !ts.isFunctionLike(n)) ts.forEachChild(n, scan);
      }
      scan(fn);
      assertions.set(fn, calls);
    }
    const laterAssert =
      fn &&
      exits(node) &&
      assertions.get(fn).some((position) => position > node.end);
    const emptyReturn =
      ts.isReturnStatement(node) &&
      (!node.expression ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "undefined") ||
        ts.isVoidExpression(node.expression));
    const skip = selectsTests(node);
    const emptyCatch = ts.isCatchClause(node) && !rethrows(node.block);
    const swallowed =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch" &&
      !node.arguments.every(
        (arg) =>
          ts.isFunctionLike(arg) &&
          arg.body &&
          ts.isBlock(arg.body) &&
          rethrows(arg.body),
      );
    if (
      skip ||
      emptyCatch ||
      swallowed ||
      emptyReturn ||
      // A conditional throw is a failure guard itself, not a skipped assertion
      // call. It still counts when detecting an earlier bypassing return.
      (ts.isCallExpression(node) &&
        assertion(node, names) &&
        guardedAssertion(node, fn)) ||
      (exits(node) && laterAssert)
    )
      rows.push({
        node,
        fn,
        kind: skip ? "skip/only/todo" : "assertion bypass",
      });
    ts.forEachChild(node, visit);
  }
  visit(source);
  return rows;
}
// Existing parser/visitor exits remain only in byte-equivalent AST functions.
// File + full function/enclosing-chain content and multiplicity authenticate them.
// New/changed helpers cannot introduce these exits, catches or skip constructs.
export function auditTestHelpers(current, base = new Map()) {
  const before = importedTestHelpers(base),
    errors = [],
    helpers = importedTestHelpers(current);
  const names = assertionNames(helpers),
    baseNames = assertionNames(before);
  for (const [file, source] of helpers) {
    const admitted = helperAdmissions(
      before.has(file) ? bypasses(before.get(file), baseNames) : [],
    );
    for (const row of bypasses(source, names))
      if (row.kind === "skip/only/todo" || !row.fn || !admitted(row.fn))
        errors.push(
          file +
            ":" +
            String(
              source.getLineAndCharacterOfPosition(row.node.getStart()).line +
                1,
            ) +
            ": " +
            row.kind,
        );
  }
  return { helpers: [...helpers.keys()].sort(), errors };
}
