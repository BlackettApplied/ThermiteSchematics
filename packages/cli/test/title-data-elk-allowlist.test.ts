import { expect, it } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { auditTitleDataSurface } from "./title-data-surface.js";
import { elkAllowlistStats } from "./title-data-elk-allowlist.js";
import { elkProgram } from "./title-data-elk-program.js";

const file = "packages/render/src/layout/elk-runtime.ts";
const source = readFileSync(file, "utf8");
const declaration = "let fauxWorker: ElkFauxWorkerConstructor | undefined;";
const audit = (text: string) =>
  auditTitleDataSurface(new Map([[file, text]]), true);

it.each([
  [
    "import equals",
    'import fsx = require("node:fs"); export const m = () => fsx.statSync("/");',
  ],
  [
    "constructor destructuring",
    'const { constructor: F } = () => {}; export const m = () => (F as any)("return 1")();',
  ],
  [
    "constructor parameter",
    'export const m = ({ constructor: F }: any) => F("return 1")();',
  ],
  [
    "computed binding",
    'const { ["con" + "structor"]: F } = () => {}; export const m = () => (F as any)("return 1")();',
  ],
  [
    "Reflect.get",
    'Reflect.get(Object.getPrototypeOf(() => {}), "constructor")("return 1")();',
  ],
  [
    "property descriptor",
    'Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor")!.value("return 1")();',
  ],
  ["global element", '(global as any)["pro" + "cess"].env.SECRET;'],
  [
    "Reflect global",
    'Reflect.get(Reflect.get(global, "pro" + "cess"), "env");',
  ],
  ["Bun global Worker", 'new Worker("data:text/javascript,void 0");'],
  [
    "joined key",
    'const K = ["con", "structor"].join(""); (() => {})[K]("return 1")();',
  ],
  ["for-of cache", "for (fauxWorker of [class {} as any]);"],
  ["for-in cache", "for (fauxWorker in {});"],
  ["array assignment", "[fauxWorker] = [class {} as any];"],
  ["object assignment", "({ fauxWorker } = { fauxWorker: class {} as any });"],
  ["state reference", "const copied = WORKER_SPECIFIER;"],
  [
    "state shadow",
    "function nested(fauxWorker: unknown) { return fauxWorker; }",
  ],
])("round 3 rejects the review r2 escape: %s", (_name, text) => {
  expect(audit(source + "\n" + text)).not.toEqual([]);
});

it.each([
  ["array declaration", "let [fauxWorker] = [class {} as any];"],
  [
    "object declaration",
    "let { fauxWorker } = { fauxWorker: class {} as any };",
  ],
  [
    "shadowed undefined",
    "const undefined = class {} as any; let fauxWorker: ElkFauxWorkerConstructor | undefined = undefined;",
  ],
])("round 3 rejects the review r2 cache escape: %s", (_name, text) => {
  const tampered = source.replace(declaration, text);
  expect(tampered).not.toBe(source);
  expect(audit(tampered)).not.toEqual([]);
});

it.each([
  'const k = ["fetch"].join(""); globalThis[k];',
  'const k = ["con", "structor"].join(""); (() => {})[k]("return 1");',
  'const k = ["property"].join(""); const { [k]: value } = {};',
])("round 3 fails closed on a nonconstant key: %s", (text) => {
  expect(audit(source + "\n" + text)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("unresolved ELK computed key"),
    ]),
  );
});

it("keeps the real module and harmless outside edits admitted", () => {
  expect(audit(source)).toEqual([]);
  expect(audit(source + "\nconst pure = 42; // changed comment\n")).toEqual([]);
  expect(
    audit(
      source + "\nconst global = { value: 1 }; const pure = global.value;\n",
    ),
  ).toEqual([]);
});

it.each([
  'import { statSync } from "node:fs";',
  'import { readFileSync as reader } from "node:fs";',
  'import * as fs from "node:fs";',
  'import fsx = require("node:fs");',
  'export { readFileSync } from "node:fs";',
  'import("./elk-work.js");',
])("admits only the existing bindings and loading forms: %s", (text) => {
  expect(audit(source + "\n" + text)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability"),
    ]),
  );
});
it.each([
  "global",
  "globalThis",
  "process",
  "Reflect",
  "Worker",
  "Function",
  "eval",
  "require",
  "Object",
  "Error",
  "Math",
  "Buffer",
])("checks external symbols rather than a global name denylist: %s", (name) => {
  expect(audit(source + "\nvoid " + name + ";")).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability identifier: " + name),
    ]),
  );
});
it.each([
  'const word = "constructor";',
  'const word = "__proto__";',
  'const word = "prototype";',
  'const { ["proto" + "type"]: value } = {};',
])("rejects reserved atoms in declarations, data and patterns: %s", (text) => {
  expect(audit(source + "\n" + text)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability key"),
    ]),
  );
});
it.each([
  'declare const Worker: any; new Worker("data:text/javascript,void 0");',
  "const hidden = (undefined: unknown) => undefined;",
])(
  "cannot disguise external globals with erased or shadowing declarations: %s",
  (text) => {
    expect(audit(source + "\n" + text)).not.toEqual([]);
  },
);
it("does not confuse local homonyms with external globals", () => {
  expect(audit(source + "\nconst Worker = class {}; new Worker();")).toEqual(
    [],
  );
});
it("admits only the current external member symbols", () => {
  expect(audit(source + "\nconst fn = () => {}; fn.call(null);")).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability identifier: call"),
    ]),
  );
  expect(audit(source + "\nconst fn = () => {}; fn.bind(null);")).toEqual([]);
});
it("folds computed keys with lexical symbol identity", () => {
  expect(
    audit(
      source +
        '\nconst K = "value"; const obj = {value: 1}; const pure = obj[K];',
    ),
  ).toEqual([]);
  expect(
    audit(
      source +
        '\nconst K = "value"; const obj = {value: 1}; function nested({K}: {K: string}) { return obj[K]; }',
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining("unresolved ELK computed key"),
    ]),
  );
});
it("uses one configured Program root and records its actual cost", () => {
  expect(audit(source)).toEqual([]);
  const stats = elkAllowlistStats();
  expect(stats.rootFiles).toBe(1);
  expect(stats.sourceFiles).toBeGreaterThan(1);
  expect(stats.milliseconds).toBeGreaterThanOrEqual(stats.programMilliseconds);
});
it("rejects Bun globals when their declarations are supplied externally", () => {
  const directory = mkdtempSync(join(tmpdir(), "elk-ambient-"));
  const path = join(directory, "bun-globals.d.ts");
  writeFileSync(
    path,
    "declare const Worker: {new(url: string): unknown}; declare const Bun: unknown;",
  );
  try {
    const input =
      "/// <reference path=" +
      JSON.stringify(path.replaceAll("\\", "/")) +
      "/>\n" +
      source +
      "\nvoid Worker; void Bun;";
    const { tree, checker } = elkProgram(
      ts.createSourceFile(file, input, ts.ScriptTarget.Latest, true),
    );
    const symbols: string[] = [];
    for (const statement of tree.statements.slice(-2))
      if (
        ts.isExpressionStatement(statement) &&
        ts.isVoidExpression(statement.expression)
      ) {
        const symbol = checker.getSymbolAtLocation(
          statement.expression.expression,
        );
        expect(symbol).toBeDefined();
        symbols.push(
          ...(symbol?.declarations ?? []).map((declaration) =>
            declaration.getSourceFile().fileName.replaceAll("\\", "/"),
          ),
        );
      }
    expect(symbols).toEqual([
      path.replaceAll("\\", "/"),
      path.replaceAll("\\", "/"),
    ]);
    expect(audit(input)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("forbidden ELK capability identifier: Worker"),
        expect.stringContaining("forbidden ELK capability identifier: Bun"),
      ]),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
