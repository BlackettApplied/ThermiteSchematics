import { expect, it } from "vitest";
import { createBudget, regressions } from "../../../scripts/health-ratchet.mjs";
import { repo, put, metrics, fn } from "./health-fixture.js";
it.each([
  "packages/render/fixtures/presentation-cases.ts",
  "packages/schema/scripts/generate-types.mjs",
  "libraries/pilot/examples/wiring/verify.mjs",
  "packages/new/bench/logic.ts",
  "tools/new-location.ts",
  "packages/cli/test/snapshots/helper.ts",
])("default-includes tracked code at %s", (path) => {
  const root = repo();
  put(root, path, fn(301));
  const current = metrics(root);
  expect(current.files[path].lines).toBe(301);
  expect(Object.values(current.functions)).toEqual([301]);
  const empty = createBudget({ files: {}, functions: {}, duplicates: {} });
  expect(regressions(current, empty).join("\n")).toContain(
    "ceiling 300 -> 301",
  );
});
it("measures fixture code sizes while retaining test-only assertion counter treatment", () => {
  const root = repo(),
    path = "packages/render/fixtures/presentation-cases.ts";
  put(root, path, "export function fixture(value) {\nreturn value!;\n}\n");
  const current = metrics(root);
  expect(current.files[path].lines).toBe(3);
  expect(current.files[path].nonNullAssertions).toBe(0);
  expect(current.functions[`${path}#fixture`]).toBe(3);
});
it.each(["\r\n", "\r", "\n", "\u2028", "\u2029"])(
  "counts %j line endings for file and arrow limits",
  (ending) => {
    const root = repo();
    put(
      root,
      "tools/long.py",
      Array(3001).fill("# line").join(ending) + ending,
    );
    put(
      root,
      "tools/arrow.mjs",
      ["const f = () => {", ...Array(299).fill("void 1;"), "};"].join(ending) +
        ending,
    );
    const current = metrics(root);
    expect(current.files["tools/long.py"].lines).toBe(3001);
    expect(current.functions["tools/arrow.mjs#f"]).toBe(301);
    const empty = createBudget({ files: {}, functions: {}, duplicates: {} });
    expect(regressions(current, empty).join("\n")).toContain(
      "files ceiling 3000 -> 3001",
    );
  },
);
it.each(["packages/cli/src/group.ts", "tools/script.mjs"])(
  "never excludes production suite callbacks in %s",
  (path) => {
    const root = repo();
    put(
      root,
      path,
      `registry.suite('x',()=>{\n${"void 1;\n".repeat(318)}});\n`,
    );
    expect(Object.values(metrics(root).functions)).toEqual([320]);
  },
);
it("exempts direct test grouping but not a then callback chained from describe", () => {
  const root = repo(),
    path = "packages/example/test/group.test.ts";
  put(
    root,
    path,
    `describe('a',()=>{}).then?.(()=>{\n${"void 1;\n".repeat(318)}});\ndescribe.only('direct',()=>{\n${"void 1;\n".repeat(400)}});\nsuite.each([1])('direct',()=>{\n${"void 1;\n".repeat(400)}});\n`,
  );
  expect(Object.values(metrics(root).functions)).toEqual([320]);
});
