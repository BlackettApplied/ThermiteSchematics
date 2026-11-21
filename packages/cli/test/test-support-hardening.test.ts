import { expect, it } from "vitest";
import { auditTestHelpers } from "../../../scripts/test-helper-audit.mjs";
const root = "packages/compiler/test/root.test.ts";
const helper = "packages/compiler/test/support.ts";
const fixture = (body: string) =>
  new Map([
    [root, 'import "./support.js";'],
    [helper, body],
  ]);
it("authenticates the enclosing chain of a legacy inner helper", () => {
  const inner = "function inner(){if(!parse())return; visit();}";
  const base = fixture("export function outer(){" + inner + " inner();}");
  expect(auditTestHelpers(base, base).errors).toEqual([]);
  const current = fixture(
    "export function outer(){" + inner + " if(enabled)inner();}",
  );
  expect(auditTestHelpers(current, base).errors).not.toEqual([]);
});
it("does not admit identical copies of a legacy helper in the same file", () => {
  const body = "function inner(){if(!parse())return; visit();}";
  const base = fixture("export function outer(){" + body + " inner();}");
  const current = fixture(
    "export function outer(){" +
      body +
      " inner();}" +
      "export function copied(){" +
      body +
      " inner();}",
  );
  expect(auditTestHelpers(current, base).errors).not.toEqual([]);
});
it.each([
  "if(enabled)expect(1).toBe(1);",
  "if(enabled){expect(1).toBe(1);}",
  "enabled || expect(1).toBe(1);",
  "enabled && expect(1).toBe(1);",
  "enabled ?? expect(1).toBe(1);",
  "enabled &&= expect(1).toBe(1);",
  "enabled ||= expect(1).toBe(1);",
  "enabled ??= expect(1).toBe(1);",
  "enabled ? expect(1).toBe(1) : void 0;",
  "expect?.(1).toBe(1);",
  "const step=()=>expect(1).toBe(1); step?.();",
  "const step=()=>expect(1).toBe(1); if(enabled)step();",
])("rejects a guarded assertion: %s", (body) => {
  const base = fixture("export function check(){expect(1).toBe(1);}");
  expect(
    auditTestHelpers(fixture("export function check(){" + body + "}"), base)
      .errors,
  ).not.toEqual([]);
});
it("retains unchanged legacy admissions and unconditional assertions", () => {
  const input = fixture(
    "export function outer(){function inner(){if(!parse())return; visit();} inner(); expect(1).toBe(1);}",
  );
  expect(auditTestHelpers(input, input).errors).toEqual([]);
  expect(
    auditTestHelpers(fixture("export function check(){expect(1).toBe(1);}"))
      .errors,
  ).toEqual([]);
});

it("consumes a same-chain admission only once for identical block-scoped copies", () => {
  const block = "{function inner(){if(!parse())return; visit();} inner();}";
  const base = fixture(block);
  expect(auditTestHelpers(base, base).errors).toEqual([]);
  expect(auditTestHelpers(fixture(block + block), base).errors).not.toEqual([]);
});

it("keeps a conditional throw as a rejecting guard rather than an assertion bypass", () => {
  expect(
    auditTestHelpers(fixture('if(!valid)throw Error("invalid");')).errors,
  ).toEqual([]);
});
