import ts from "typescript";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { auditTestHelpers } from "../../../scripts/test-helper-audit.mjs";
import { auditedCodeFile } from "../../../scripts/test-helper-graph.mjs";
import {
  historicalSources,
  readHistory,
} from "../../../scripts/health-history.mjs";
import { trackedSourcePaths } from "../../../scripts/health-measure.mjs";
import { auditDataFixture } from "../../../scripts/audit-scope.mjs";
const root = "packages/compiler/test/root.test.ts",
  helper = "packages/compiler/test/support.ts";
const fixture = (body: string) =>
  new Map([
    [root, 'import {check} from "./support.js"; it("runs",check);'],
    [helper, "export function check(){" + body + "}"],
  ]);
it.each([
  "try {expect(1).toBe(1);}catch{return;}",
  "if(process.env.BYPASS)return; expect(1).toBe(1);",
  "if(process.env.BYPASS)return true; expect(1).toBe(1);",
  'it.skip("hidden",()=>{});',
  'it["skip"]("hidden",()=>{});',
  "try{expect(1).toBe(1);}catch{}",
  "Promise.reject().catch(()=>{}); expect(1).toBe(1);",
])("rejects imported-helper assertion bypass: %s", (body) => {
  expect(
    auditTestHelpers(fixture(body), fixture("expect(1).toBe(1);")).errors,
  ).not.toEqual([]);
});
it("follows transitive support imports and allows genuine rethrow cleanup", () => {
  const input = fixture(
    "try{expect(1).toBe(1);}catch(error){cleanup();throw error;}",
  );
  input.set(root, 'import "./bridge.js";');
  input.set(
    "packages/compiler/test/bridge.ts",
    'export * from "./support.js";',
  );
  expect(auditTestHelpers(input).helpers).toContain(helper);
  expect(auditTestHelpers(input).errors).toEqual([]);
});
it("keeps existing benign parser/visitor exits only under identical function content", () => {
  const before = fixture("if(!parse())return; visit();");
  expect(auditTestHelpers(before, before).errors).toEqual([]);
  expect(
    auditTestHelpers(fixture("if(!parse())return; expect(1).toBe(1);"), before)
      .errors,
  ).not.toEqual([]);
});
it.each([
  "packages/cli/test/fixtures/health-package-smoke.ts.txt",
  "packages/cli/test/fixtures/health-view-spec.ts.txt",
  "packages/cli/test/fixtures/guide-tb2-publication.md.txt",
])("explicitly excludes historical data %s", (file) => {
  expect(auditDataFixture(file)).toBe(true);
  expect(auditedCodeFile(file)).toBe(false);
  const input = fixture("expect(1).toBe(1);");
  input.set(file, 'catch{return;} it.skip("data",()=>{});');
  expect(auditTestHelpers(input).errors).toEqual([]);
});
it("audits the actual tracked test-support import closure without changing the frozen runner", () => {
  const repo = resolve("."),
    history = readHistory(repo);
  expect(history).toBeDefined();
  const base = historicalSources(repo, history.revision);
  const files = new Map(
    trackedSourcePaths(repo)
      .filter(auditedCodeFile)
      .map((path) => [path, readFileSync(path, "utf8")]),
  );
  const result = auditTestHelpers(files, base);
  expect(result.helpers).toEqual(
    expect.arrayContaining([
      "packages/compiler/test/package-smoke-cli.ts",
      "packages/compiler/test/package-smoke-agent.ts",
      "packages/render/test/render-robustness-compile.ts",
      "packages/render/test/render-robustness-draft.ts",
    ]),
  );
  expect(result.errors).toEqual([]);
  for (const path of [
    "packages/compiler/test/package-smoke-cli.ts",
    "packages/render/test/render-robustness-compile.ts",
  ]) {
    const text = files.get(path);
    expect(text).toBeDefined();
    const tree = ts.createSourceFile(
      path,
      text ?? "",
      ts.ScriptTarget.Latest,
      true,
    );
    const fn = tree.statements.find(ts.isFunctionDeclaration);
    expect(fn?.body).toBeDefined();
    const start = (fn?.body?.getStart(tree) ?? 0) + 1;
    const tampered = new Map(files);
    tampered.set(
      path,
      (text ?? "").slice(0, start) +
        "\nif(process.env.AUDIT_BYPASS)return;\n" +
        (text ?? "").slice(start),
    );
    expect(auditTestHelpers(tampered, base).errors).toEqual(
      expect.arrayContaining([expect.stringContaining(path + ":")]),
    );
  }
});

it("finds aliased transitive assertion calls before conditional value returns", () => {
  const input = fixture("if(process.env.BYPASS)return true; step();");
  input.set(
    helper,
    'import {assertThing as step} from "./assertions.js";' + input.get(helper),
  );
  input.set(
    "packages/compiler/test/assertions.ts",
    "export function assertThing(){expect(1).toBe(1);}",
  );
  expect(auditTestHelpers(input).errors).not.toEqual([]);
});
it.each([
  'try{expect(1).toBe(1);}catch{console.log("swallowed");}',
  "Promise.reject().catch(()=>undefined); expect(1).toBe(1);",
])("rejects other swallowed assertions: %s", (body) => {
  expect(auditTestHelpers(fixture(body)).errors).not.toEqual([]);
});

it.each([
  "for(const value of [1]){if(process.env.BYPASS)continue; expect(value).toBe(1);}",
  'const {skip:hide}=context; hide("bypass");',
  "process.exit(0);",
])("rejects loop, context alias and process-exit bypass: %s", (body) => {
  expect(auditTestHelpers(fixture(body)).errors).not.toEqual([]);
});

it("rejects a conditional value return that bypasses a fixture rejection guard", () => {
  expect(
    auditTestHelpers(
      fixture(
        'const result=compile(); if(process.env.BYPASS)return result; if(!result.ok)throw Error("invalid fixture"); return result;',
      ),
    ).errors,
  ).not.toEqual([]);
});
