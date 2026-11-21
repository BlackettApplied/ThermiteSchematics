import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { auditTitleDataSurface } from "./title-data-surface.js";
import { elkProgram } from "./title-data-elk-program.js";
const file = "packages/render/src/layout/elk-runtime.ts";
const source = readFileSync(file, "utf8");
const audit = (text: string) =>
  auditTitleDataSurface(new Map([[file, text]]), true);
function diagnostics(text: string) {
  const { tree, program } = elkProgram(
    ts.createSourceFile(file, text, 99, true),
  );
  expect(program.getSyntacticDiagnostics(tree)).toEqual([]);
  return program.getSemanticDiagnostics(tree).map((d) =>
    JSON.stringify({
      code: d.code,
      start: d.start,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    }),
  );
}
const baseline = new Set(diagnostics(source));
it.each([
  [
    "generic argument",
    "function id<T>(value:T):T {return value;} id<Ctx>(circuitInlineContext).enterWith({});",
  ],
  [
    "parameter",
    "function run(value:Ctx){value.enterWith({});} run(circuitInlineContext);",
  ],
  [
    "default parameter",
    "function run(value:Ctx=circuitInlineContext){value.enterWith({});} run();",
  ],
  ["let", "let context:Ctx=circuitInlineContext; context.enterWith({});"],
  [
    "return type",
    "function context():Ctx{return circuitInlineContext;} context().enterWith({});",
  ],
  [
    "property",
    "const box:{context:Ctx}={context:circuitInlineContext}; box.context.enterWith({});",
  ],
  [
    "array",
    "const contexts:Ctx[]=[circuitInlineContext]; contexts[0]!.enterWith({});",
  ],
  [
    "class field",
    "class Box { context:Ctx=circuitInlineContext; } new Box().context.enterWith({});",
  ],
  [
    "const ternary",
    "const context:Ctx=1?circuitInlineContext:circuitInlineContext; context.enterWith({});",
  ],
  [
    "destructured parameter",
    "function run({context}:{context:Ctx}){context.enterWith({});} run({context:circuitInlineContext});",
  ],
])("rejects annotated-slot permission widening: %s", (_name, text) => {
  const input =
    source + "\ninterface Ctx {enterWith(value:unknown):void}\n" + text;
  expect(diagnostics(input).filter((d) => !baseline.has(d))).toEqual([]);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining(
        "ELK annotation widens permitted member: enterWith",
      ),
    ]),
  );
});
it("admits the real module and harmless local annotations", () => {
  expect(audit(source)).toEqual([]);
  expect(
    audit(
      source +
        "\n// harmless edit\nconst local: {value:number}={value:1}; local.value;\n",
    ),
  ).toEqual([]);
});
