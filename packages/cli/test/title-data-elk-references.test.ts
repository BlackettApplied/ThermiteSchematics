import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { auditTitleDataSurface } from "./title-data-surface.js";
import { elkProgram } from "./title-data-elk-program.js";

const file = "packages/render/src/layout/elk-runtime.ts";
const source = readFileSync(file, "utf8");
const audit = (text: string) =>
  auditTitleDataSurface(new Map([[file, text]]), true);
function semantic(text: string) {
  const { tree, program } = elkProgram(
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
  );
  expect(program.getSyntacticDiagnostics(tree)).toEqual([]);
  return program.getSemanticDiagnostics(tree).map((diagnostic) =>
    JSON.stringify({
      code: diagnostic.code,
      start: diagnostic.start,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    }),
  );
}
// The one-root audit Program retains composite project settings. Authenticate
// its unchanged TS6307 project-list diagnostic, rather than filtering by code.
const baselineDiagnostics = new Set(semantic(source));
function clean(text: string) {
  expect(
    semantic(text).filter((item) => !baselineDiagnostics.has(item)),
  ).toEqual([]);
}

it.each([
  [
    "process builtin loader",
    'interface Loader { getBuiltinModule(id: string): unknown } const box = { process }; export const leak = () => (box.process as unknown as Loader).getBuiltinModule("node:child_process");',
    "process",
  ],
  [
    "loader-only readFileSync",
    'const fsBox = { readFileSync }; export const read = () => fsBox.readFileSync("/etc/hosts", "utf8");',
    "readFileSync",
  ],
  [
    "globalThis Worker",
    'interface W { Worker: new (u: string) => unknown } const wb = { globalThis }; export const leak = () => new (wb.globalThis as unknown as W).Worker("data:text/javascript,void 0");',
    "globalThis",
  ],
  [
    "Object defineProperty",
    'interface O { defineProperty(o: object, k: string, d: object): void } const ob = { Object, globalThis }; export const leak = () => (ob.Object as unknown as O).defineProperty(ob.globalThis, "Func" + "tion", {value: () => {}});',
    "Object",
  ],
])(
  "round 4 M1 rejects the real-module shorthand escape: %s",
  (_name, text, name) => {
    const input = source + "\n" + text;
    clean(input);
    expect(audit(input)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("forbidden ELK capability identifier: " + name),
      ]),
    );
  },
);

it.each([
  ["globalThis", "const box = { globalThis }; void box;"],
  ["Reflect", "const box = { Reflect }; void box;"],
  ["createRequire", "const box = { createRequire }; void box;"],
])("rejects other shorthand value captures: %s", (name, text) => {
  const input = source + "\n" + text;
  clean(input);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability identifier: " + name),
    ]),
  );
});

it.each([
  "const { enterWith } = circuitInlineContext; enterWith(circuitInlineContext.getStore()!);",
  "const { enterWith: enter } = circuitInlineContext; enter(circuitInlineContext.getStore()!);",
  'const { ["enterWith"]: enter } = circuitInlineContext; enter(circuitInlineContext.getStore()!);',
  "function capture({enterWith}: typeof circuitInlineContext) { enterWith(circuitInlineContext.getStore()!); } void capture;",
])("round 4 resolves destructured source members: %s", (text) => {
  const input = source + "\n" + text;
  clean(input);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability binding: enterWith"),
    ]),
  );
});

it.each([
  "export { readFileSync };",
  "export { readFileSync as read };",
  'export { readFileSync as "reader" };',
  'import { readFileSync as reader } from "node:fs"; export { reader as read };',
])("resolves export targets and imported aliases: %s", (text) => {
  const input = source + "\n" + text;
  clean(input);
  expect(audit(input)).not.toEqual([]);
});

it("keeps local bindings, allowed destructuring and allowed export renames", () => {
  const input =
    source +
    `
const process = { value: 1 }; const box = { process };
const { value: local } = process; const { getStore: store } = circuitInlineContext;
const { ["value"]: computed } = process;
void box; void store; void computed;
export { BundledElk as B }; export { local as renamed };
`;
  clean(input);
  expect(audit(input)).toEqual([]);
});

it.each([
  "(circuitInlineContext as unknown as Ctx).enterWith({quality: true});",
  "(<Ctx><unknown>circuitInlineContext).enterWith({quality: true});",
  "const number = 1 as const; void number;",
])("round 4 L1 rejects an assertion outside the loader: %s", (text) => {
  const input =
    source + "\nexport interface Ctx { enterWith(v: unknown): void }\n" + text;
  clean(input);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK type assertion outside loader"),
    ]),
  );
});

it.each([
  "const context: Ctx = circuitInlineContext; context.enterWith({quality: true});",
  "const alias = circuitInlineContext; const context: Ctx = alias; context.enterWith({quality: true});",
])("round 4 L1 rejects const member retyping: %s", (text) => {
  const input =
    source + "\ninterface Ctx { enterWith(v: unknown): void }\n" + text;
  clean(input);
  expect(audit(input)).toEqual(
    expect.arrayContaining([
      expect.stringContaining(
        "ELK annotation widens permitted member: enterWith",
      ),
    ]),
  );
});

it("admits annotations that preserve member permissions and satisfies", () => {
  const input =
    source +
    `
interface Context { getStore(): unknown }
const context: Context = circuitInlineContext; context.getStore();
const same: typeof circuitInlineContext = circuitInlineContext; same.getStore();
const checked = circuitInlineContext satisfies Context; checked.getStore();
const literal: {value: number} = {value: 1}; literal.value;
`;
  clean(input);
  expect(audit(input)).toEqual([]);
});

it("admits only the exact current ElkConstructor assertions", () => {
  expect(audit(source)).toEqual([]);
  const changed = source.replace(
    "BundledElk as unknown as new",
    "BundledElk as any as new",
  );
  expect(changed).not.toBe(source);
  clean(changed);
  expect(audit(changed)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK type assertion outside loader"),
    ]),
  );
});
