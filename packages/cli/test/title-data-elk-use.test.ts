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
const prelude = "\ninterface Ctx {enterWith(value:unknown):void}\n";
it.each([
  [
    "union with undefined",
    "type A=Ctx|undefined; function use(v:A){v?.enterWith({});} use(circuitInlineContext);",
  ],
  [
    "union with null and non-null use",
    "type A=Ctx|null; function use(v:A){v!.enterWith({});} use(circuitInlineContext);",
  ],
  [
    "union explicit generic argument",
    "type A=Ctx|undefined; function id<T>(v:T):T{return v;} id<A>(circuitInlineContext)?.enterWith({});",
  ],
  [
    "array alias",
    "type L=Ctx[]; const l:L=[circuitInlineContext]; l[0]!.enterWith({});",
  ],
  [
    "readonly array alias",
    "type L=readonly Ctx[]; const l:L=[circuitInlineContext]; l[0]!.enterWith({});",
  ],
  [
    "tuple alias",
    "type L=[Ctx]; const l:L=[circuitInlineContext]; l[0].enterWith({});",
  ],
  [
    "alias of instantiated alias",
    "type W<T>={c:T}; type WC=W<Ctx>; const w:WC={c:circuitInlineContext}; w.c.enterWith({});",
  ],
  [
    "type alias generic default",
    "type H<T=Ctx>={v:T}; const h:H={v:circuitInlineContext}; h.v.enterWith({});",
  ],
  [
    "interface generic default",
    "interface H<T=Ctx>{v:T} const h:H={v:circuitInlineContext}; h.v.enterWith({});",
  ],
  [
    "instantiation expression",
    "function id<T>(v:T):T{return v;} const idc=id<Ctx>; idc(circuitInlineContext).enterWith({});",
  ],
  [
    "heritage type argument",
    "class Box<T>{v?:T; set(x:T){this.v=x;return x;}} class CBox extends Box<Ctx>{} new CBox().set(circuitInlineContext).enterWith({});",
  ],
])("rejects reviewer M1 use-site retyping: %s", (_name, text) => {
  const input = source + prelude + text;
  expect(diagnostics(input).filter((d) => !baseline.has(d))).toEqual([]);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK denied member use: enterWith"),
    ]),
  );
});
it.each([
  ["literal element key", 'w.c["enterWith"]({});'],
  ["constant alias element key", 'const key="enterWith"; w.c[key]({});'],
  ["renamed binding", "const {enterWith:invoke}=w.c; invoke({});"],
  ["computed binding", 'const {["enterWith"]:invoke}=w.c; invoke({});'],
  ["rest binding", "const {...rest}=w.c; void rest;"],
  [
    "rest assignment",
    "let rest={enterWith(value:unknown){void value;}}; ({...rest}=w.c); void rest;",
  ],
  [
    "assignment destructuring",
    "let invoke:(value:unknown)=>void; ({enterWith:invoke}=w.c); invoke({});",
  ],
  [
    "shorthand assignment destructuring",
    "let enterWith:(value:unknown)=>void; ({enterWith}=w.c); enterWith({});",
  ],
  [
    "merged local declarations",
    "interface Ctx {enterWith(value:unknown):void} w.c.enterWith({});",
  ],
])("rejects denied-member selection: %s", (_name, text) => {
  const input =
    source +
    prelude +
    "type W<T>={c:T}; type WC=W<Ctx>; const w:WC={c:circuitInlineContext};\n" +
    text;
  expect(diagnostics(input).filter((d) => !baseline.has(d))).toEqual([]);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK denied member use: enterWith"),
    ]),
  );
});
it("keeps the real module and harmless local property use admitted", () => {
  expect(audit(source)).toEqual([]);
  expect(audit(source + "\nconst local={value:1}; local.value;\n")).toEqual([]);
});
