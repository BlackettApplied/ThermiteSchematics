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
  return program.getSemanticDiagnostics(tree).map((d) => ({
    code: d.code,
    text: JSON.stringify({
      code: d.code,
      start: d.start,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    }),
  }));
}
const baseline = new Set(diagnostics(source).map((d) => d.text));
const prelude =
  "\ninterface Ctx {enterWith(value:unknown):void}\n" +
  "type W<T>={c:T}; type WC=W<Ctx>; const w:WC={c:circuitInlineContext};\n";
it.each([
  [
    "reviewer nested object",
    "let e=(_v:unknown)=>{}; ({a:{enterWith:e}} = {a:w.c}); e.bind(w.c)({});",
  ],
  [
    "reviewer for-of named",
    "let e=(_v:unknown)=>{}; for ({enterWith:e} of [w.c]); e.bind(w.c)({});",
  ],
  [
    "reviewer for-of shorthand",
    "let enterWith=(_v:unknown)=>{}; for ({enterWith} of [w.c]); void enterWith;",
  ],
  ["reviewer for-of rest", "let r={}; for ({...r} of [w.c]); void r;"],
  [
    "reviewer array object",
    "let e=(_v:unknown)=>{}; [{enterWith:e}] = [w.c]; e.bind(w.c)({});",
  ],
  [
    "reviewer array rest object",
    "let e=(_v:unknown)=>{}; [...[{enterWith:e}]] = [w.c];",
  ],
  ["nested object rest", "let r={}; ({a:{...r}} = {a:w.c});"],
  ["nested array rest", "let r={}; [...[{...r}]] = [w.c];"],
  [
    "array rest offset",
    "let r={}; let first:unknown; [first,...[{...r}]] = [0,w.c]; void first;",
  ],
  [
    "nested array element offset",
    "let r={}; let first:unknown; [first,{...r}] = [0,w.c]; void first;",
  ],
  ["array index source", "let r={}; for ([{...r}] of [[w.c]]);"],
  [
    "for-of nested object and array",
    "let e=(_v:unknown)=>{}; function rows():{a:[Ctx]}[]{return [{a:[w.c]}];} for ({a:[{enterWith:e}]} of rows()); void e;",
  ],
  [
    "nullable source before default",
    "let r={}; function rows():{a?:Ctx}[]{return [{a:w.c}];} for ({a:{...r}={}} of rows());",
  ],
  [
    "assignment default",
    "let e=(_v:unknown)=>{}; ({a:{enterWith:e}=w.c} = {}); void e;",
  ],
  [
    "array default",
    "let e=(_v:unknown)=>{}; [{enterWith:e}=w.c] = []; void e;",
  ],
  [
    "default source with an empty target",
    "let r={}; ({a:{...r}={}} = {a:w.c});",
  ],
  ["default fallback with an empty source", "let r={}; ({a:{...r}=w.c} = {});"],
  ["object rest target", "let e=(_v:unknown)=>{}; ({...{enterWith:e}}=w.c);"],
])("rejects denied-member assignment pattern: %s", (_name, text) => {
  const input = source + prelude + text;
  expect(diagnostics(input).filter((d) => !baseline.has(d.text))).toEqual([]);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK denied member use: enterWith"),
    ]),
  );
});
it("audits a for-in pattern even though TypeScript also rejects that syntax", () => {
  const input =
    source +
    prelude +
    "let e=(_v:unknown)=>{}; for ({enterWith:e} in {}); void w; void e;";
  expect(
    diagnostics(input)
      .filter((d) => !baseline.has(d.text))
      .map((d) => d.code),
  ).toEqual([2491]);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK denied member use: enterWith"),
    ]),
  );
});
it("follows parenthesized patterns even though TypeScript also rejects them", () => {
  const input = source + prelude + "let r={}; (({a:{...r}}) = {a:w.c});";
  expect(
    diagnostics(input)
      .filter((d) => !baseline.has(d.text))
      .map((d) => d.code),
  ).toEqual([2364]);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK denied member use: enterWith"),
    ]),
  );
});
it("follows nested object-rest targets even though TypeScript also rejects them", () => {
  const input =
    source +
    prelude +
    "let e=(_v:unknown)=>{}; ({...{a:{enterWith:e}}}={a:w.c});";
  expect(
    diagnostics(input)
      .filter((d) => !baseline.has(d.text))
      .map((d) => d.code),
  ).toEqual([2501]);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK denied member use: enterWith"),
    ]),
  );
});
it("keeps the real module and harmless nested local patterns admitted", () => {
  const input =
    source +
    "\nlet value=0; let tail={}; " +
    "({a:{value}}={a:{value:1}}); " +
    "for ({a:{value}} of [{a:{value:1}}]); " +
    "[value,...[{...tail}]]=[0,{value:1}]; " +
    "void value; void tail;";
  expect(diagnostics(input).filter((d) => !baseline.has(d.text))).toEqual([]);
  expect(audit(source)).toEqual([]);
  expect(audit(input)).toEqual([]);
});
it("treats object and array values outside assignment targets as values", () => {
  const input =
    source +
    "\nconst value={enterWith(v:unknown){void v;}}; " +
    "const list=[{enterWith:value}]; let target={}; target={enterWith:value}; void list; void target;";
  expect(diagnostics(input).filter((d) => !baseline.has(d.text))).toEqual([]);
  expect(audit(input)).toEqual([]);
});

it("records the runtime-only member limit without admitting augmentation", () => {
  const input =
    source +
    "\ninterface Ctx2 {getStore():unknown; _enable?():void; _propagate?():void; withScope?():void} " +
    "function f(v:Ctx2){v._enable?.(); v._propagate?.(); v.withScope?.();} f(circuitInlineContext);";
  expect(diagnostics(input).filter((d) => !baseline.has(d.text))).toEqual([]);
  expect(audit(input)).toEqual([]);
  expect(
    audit(
      source +
        '\ndeclare module "node:async_hooks" {interface AsyncLocalStorage<T> {probe():T}}',
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining(
        "ambient declarations are outside the ELK allowlist",
      ),
    ]),
  );
});

it("retains non-null source resolution for nullable object-rest targets", () => {
  const input =
    source +
    prelude +
    "\nfunction take(value:Ctx|null){let r={}; ({...r}=value);} take(w.c);";
  expect(
    diagnostics(input)
      .filter((d) => !baseline.has(d.text))
      .map((d) => d.code),
  ).toEqual([]);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK denied member use: enterWith"),
    ]),
  );
});
