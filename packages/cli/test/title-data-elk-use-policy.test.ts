import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { elkProgram } from "./title-data-elk-program.js";
import { deniedMemberUse } from "./title-data-elk-use.js";
const file = "packages/render/src/layout/elk-runtime.ts";
const source = readFileSync(file, "utf8");
function selected(text: string) {
  const { tree, checker, program } = elkProgram(
    ts.createSourceFile(file, text, 99, true),
  );
  expect(program.getSyntacticDiagnostics(tree)).toEqual([]);
  const diagnostics = program.getSemanticDiagnostics(tree).map((d) =>
    JSON.stringify({
      code: d.code,
      start: d.start,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    }),
  );
  let symbol: ts.Symbol | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "getStore")
      symbol = checker.getSymbolAtLocation(node.name);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  expect(symbol).toBeDefined();
  return { symbol, tree, diagnostics };
}
const baseline = new Set(selected(source).diagnostics);
it("admits only the exact allowlisted external member even when its name is reserved", () => {
  const { symbol } = selected(source);
  expect(deniedMemberUse("getStore", symbol, new Set(["getStore"]))).toBe(
    false,
  );
});
it("rejects a reserved name re-homed into a local member", () => {
  const { symbol, tree, diagnostics } = selected(
    source +
      "\ninterface Local {getStore():unknown} const local:Local={getStore(){return 1}}; local.getStore();",
  );
  expect(diagnostics.filter((d) => !baseline.has(d))).toEqual([]);
  expect(symbol?.declarations?.every((d) => d.getSourceFile() === tree)).toBe(
    true,
  );
  expect(deniedMemberUse("getStore", symbol, new Set(["getStore"]))).toBe(true);
  expect(deniedMemberUse("getStore", symbol, new Set())).toBe(false);
});
it("rejects a merged member with both allowlisted and local declarations", () => {
  const { symbol, tree, diagnostics } = selected(
    source +
      '\ndeclare module "node:async_hooks" {interface AsyncLocalStorage<T> {getStore():T|undefined}} circuitInlineContext.getStore();',
  );
  expect(diagnostics.filter((d) => !baseline.has(d))).toEqual([]);
  expect(symbol?.declarations?.some((d) => d.getSourceFile() === tree)).toBe(
    true,
  );
  expect(symbol?.declarations?.some((d) => d.getSourceFile() !== tree)).toBe(
    true,
  );
  expect(deniedMemberUse("getStore", symbol, new Set(["getStore"]))).toBe(true);
});
it("fails closed when a reserved member cannot be resolved", () => {
  expect(deniedMemberUse("enterWith", undefined, new Set(["enterWith"]))).toBe(
    true,
  );
});
