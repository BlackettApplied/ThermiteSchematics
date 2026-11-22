import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { diagnosticInventory } from "./render-diagnostic-inventory.mjs";

const roots = [];
function fixture(source) {
  const root = mkdtempSync(join(tmpdir(), "diagnostic-semantic-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  mkdirSync(join(root, "packages/render/src"), { recursive: true });
  writeFileSync(join(root, "packages/render/src/planted.ts"), source);
  return root;
}
afterAll(() =>
  roots.forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const planted = `
declare const condition: boolean;
const CODE = "R004";
const code = "R005";
const TEMPLATE = { code: "R006" as const, message: "native" };
export function asserted() { return { code: "R003" as const }; }
export function ternary() { return { code: condition ? "R001" : "R002" }; }
export function identifier() { return { code: CODE }; }
export function shorthand() { return { code }; }
export function template() { return { code: \`R006\` }; }
export function computed() { return { ["code"]: "R006" }; }
export function parenthesized() { return { code: ("R006") }; }
export function mutation(e: {code: "R001" | "R006"}) { e.code = "R006"; }
export function spread() { return { ...TEMPLATE, message: "owner" }; }
export function enclosing() { (() => { throw Error("stop"); })(); return { code: "R004" as const }; }
const arrow = () => ({ code: "R002" as const });
export function arrowAlias() { return arrow(); }
export function targetType(e: {code: "R001" | "R007"}) { e.code = "R007"; }
export function anonymousFactoryUse() { return (() => ({ code: "R003" }))(); }
export function factory() { return { code: "R003", message: "native" }; }
const make = factory;
const table = { make: factory };
export function alias() { return make(); }
export function objectTable() { return table.make(); }
export function higherOrder() { return [factory].map((f) => f()); }
`;
let inventory;
beforeAll(() => {
  inventory = diagnosticInventory(fixture(planted));
});
it.each([
  "asserted",
  "ternary",
  "identifier",
  "shorthand",
  "template",
  "computed",
  "parenthesized",
  "mutation",
  "spread",
  "alias",
  "objectTable",
  "higherOrder",
])("census detects the unaudited %s plant", (name) => {
  expect(
    inventory.sites.some((site) => site.owner === name),
    name,
  ).toBe(true);
});
it("unresolved dynamic code refuses the guard instead of silently skipping a site", () => {
  const root = fixture(
    'export function dynamic(n: number) { return { code: `R00${n}`, message: "native" }; }',
  );
  expect(() => diagnosticInventory(root)).toThrow(
    /unaudited dynamic R-code site/u,
  );
});

it("semantic controls pin actual codes and factory provenance", () => {
  expect(
    inventory.sites.find((site) => site.owner === "ternary")?.codes,
  ).toEqual(["R001", "R002"]);
  for (const name of ["alias", "objectTable", "higherOrder"])
    expect(inventory.sites.find((site) => site.owner === name)).toMatchObject({
      kind: "factory-call",
      factory: "packages/render/src/planted.ts:factory",
      codes: ["R003"],
    });
  expect(
    inventory.sites.find((site) => site.owner === "spread")?.codes,
  ).toEqual(["R006"]);
});
it.each([
  "export function dynamic(code: string) { return { code }; }",
  "export function dynamic(e: {code: string}, code: string) { e.code = code; }",
])("dynamic identifier and assignment code types fail closed: %s", (source) => {
  expect(() => diagnosticInventory(fixture(source))).toThrow(
    /unaudited dynamic R-code site/u,
  );
});

it("an anonymous throw-only call is not attributed to its enclosing factory", () => {
  expect(
    inventory.sites.filter(
      (site) => site.owner === "enclosing" && site.kind === "factory-call",
    ),
  ).toEqual([]);
});
it("an arrow factory retains its own declaration identity through an alias", () => {
  expect(
    inventory.sites.find((site) => site.owner === "arrowAlias"),
  ).toMatchObject({
    kind: "factory-call",
    factory: "packages/render/src/planted.ts:arrow",
    codes: ["R002"],
  });
});

it("assignment target R-code types remain inventoried when the assigned value is outside R001–R006", () => {
  expect(
    inventory.sites.find((site) => site.owner === "targetType"),
  ).toMatchObject({ kind: "assignment", codes: ["R001"] });
});
it("anonymous diagnostic factory calls resolve to their own construction declaration", () => {
  expect(
    inventory.sites.filter(
      (site) =>
        site.owner === "anonymousFactoryUse" && site.kind === "factory-call",
    ),
  ).toEqual([expect.objectContaining({ codes: ["R003"] })]);
});
