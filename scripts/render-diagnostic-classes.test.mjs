import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { diagnosticInventory } from "./render-diagnostic-inventory.mjs";

const roots = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function inventory(source) {
  const root = mkdtempSync(join(tmpdir(), "diagnostic-class-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  mkdirSync(join(root, "packages/render/src"), { recursive: true });
  writeFileSync(join(root, "packages/render/src/planted.ts"), source);
  return diagnosticInventory(root);
}
it.each([
  'class E { code = "R002" as const }',
  'class E { code = "R002" }',
  'class E { ["code"] = "R002" as const }',
  'const E = class { code = "R002" as const };',
  'class E { code: "R002"; constructor() { this.code = "R002"; } }',
])(
  "detects class production and links its new expression: %s",
  (declaration) => {
    const result = inventory(
      `${declaration}\nexport function create() { return new E(); }`,
    );
    expect(
      result.sites.some(
        (s) => s.kind === "class-field" || s.kind === "assignment",
      ),
    ).toBe(true);
    expect(result.sites.find((s) => s.kind === "class-new")).toMatchObject({
      class: "packages/render/src/planted.ts:E",
      codes: ["R002"],
      owner: "create",
    });
  },
);
it("detects static R-code fields without treating ordinary instances as R-coded", () => {
  const result = inventory(
    'class E { static code = "R004" as const } new E();',
  );
  expect(result.sites).toContainEqual(
    expect.objectContaining({
      kind: "class-static-field",
      codes: ["R004"],
      class: "packages/render/src/planted.ts:E",
    }),
  );
  expect(result.sites.some((s) => s.kind === "class-new")).toBe(false);
});
it("links aliases and inherited class fields to new expressions", () => {
  const result = inventory(
    'class Base { code = "R006"; } class Child extends Base {} const Alias = Child; new Alias();',
  );
  expect(result.sites.find((s) => s.kind === "class-new")).toMatchObject({
    class: "packages/render/src/planted.ts:Child",
    codes: ["R006"],
  });
});
it.each([
  "declare const n: number; class E { code = `R00${n}`; } new E();",
  'class E { declare code: "R002"; } new E();',
  'class E { get code(): "R002" { return "R002"; } } new E();',
])(
  "refuses unresolved class production instead of skipping it: %s",
  (source) => {
    expect(() => inventory(source)).toThrow(
      /unaudited (?:dynamic )?(?:class )?R-code site/u,
    );
  },
);
it.each([
  'class E { code = "ordinary"; } new E();',
  'class E { static code = "E001" as const; } new E();',
  'class E { code: string; constructor() { this.code = "ordinary"; } } new E();',
  'class E { message = "R002"; } new E();',
])("ordinary non-R-code strings are not diagnostic sites: %s", (source) => {
  expect(inventory(source)).toEqual({ sites: [], wrappers: [] });
});

it("constructor assignments without a separate declaration still link the new expression", () => {
  const result = inventory(
    'class E { constructor() { this.code = "R002"; } } new E();',
  );
  expect(result.sites.find((s) => s.kind === "class-new")).toMatchObject({
    class: "packages/render/src/planted.ts:E",
    codes: ["R002"],
  });
});
it("a child ordinary field overrides inherited R-code production for its instances", () => {
  const result = inventory(
    'class Base { code = "R002"; } class Child extends Base { code = "ordinary"; } new Child();',
  );
  expect(result.sites.some((s) => s.kind === "class-field")).toBe(true);
  expect(result.sites.some((s) => s.kind === "class-new")).toBe(false);
});
it.each([
  'class E { #code = "R002"; } new E();',
  'const key = Symbol(); class E { [key] = "R002"; } new E();',
  'class E { code = "R007"; } new E();',
])(
  "private, symbol and non-target fields remain outside R001–R006: %s",
  (source) => {
    expect(inventory(source)).toEqual({ sites: [], wrappers: [] });
  },
);
it.each([
  'class E { constructor(public code: "R002") {} } new E("R002");',
  'declare const key: string; class E { [key] = "R002"; } new E();',
])(
  "opaque class-field production refuses rather than guessing: %s",
  (source) => {
    expect(() => inventory(source)).toThrow(/unaudited class R-code site/u);
  },
);

it("an unresolved constructor field name with an R-code value fails closed", () => {
  expect(() =>
    inventory(
      'declare const key: string; class E { constructor() { this[key] = "R002"; } } new E();',
    ),
  ).toThrow(/unaudited class R-code site/u);
});
