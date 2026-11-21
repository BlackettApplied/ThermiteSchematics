import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { auditTitleDataSurface } from "./title-data-surface.js";
const path = "packages/render/src/layout/elk-runtime.ts";
const source = readFileSync(path, "utf8");
const audit = (text: string) =>
  auditTitleDataSurface(new Map([[path, text]]), true);
it("pins only the loader: current module and harmless outside edits pass", () => {
  expect(audit(source)).toEqual([]);
  expect(audit(source + "\nconst harmlessAuditControl = 1;\n")).toEqual([]);
  expect(audit(source.replaceAll("\n", "\r\n"))).toEqual([]);
});
it("rejects an edited loader even if the dynamic constructor disappears", () => {
  expect(
    audit(
      source.replace(
        "if (fauxWorker !== undefined) return fauxWorker;",
        "if (fauxWorker !== undefined) return fauxWorker;\n  void 1;",
      ),
    ),
  ).toEqual(
    expect.arrayContaining([expect.stringContaining("loader pin mismatch")]),
  );
  expect(audit(source.replace("new Function(", "SomeConstructor("))).toEqual(
    expect.arrayContaining([expect.stringContaining("loader pin mismatch")]),
  );
});
it.each([
  "const access = process.env.SECRET;",
  "const access = Bun.env.SECRET;",
  'readFileSync("/tmp/forbidden");',
  'import * as fs from "node:fs";',
  'import {platform} from "node:os"; platform();',
  'import {execFileSync} from "node:child_process"; execFileSync("git",["status"]);',
  'await fetch("https://example.invalid");',
  'await import("node:net");',
  'globalThis["fetch"]("https://example.invalid");',
])("statically rejects outside-loader access: %s", (text) => {
  expect(audit(source + "\n" + text)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability"),
    ]),
  );
});
it("audits the closed loader bindings outside the pinned text", () => {
  expect(
    audit(
      source.replace('"elkjs/lib/elk-worker.min.js"', '"node:child_process"'),
    ),
  ).not.toEqual([]);
  expect(audit(source + "\nfauxWorker = undefined;")).not.toEqual([]);
});

it.each([
  ["folded dynamic import", 'export const m = () => import("node:" + "fs");'],
  ["export star", 'export * from "node:fs";'],
  ["named export", 'export { statSync as x } from "node:fs";'],
])("round 2 rejects the %s review probe", (_name, text) => {
  expect(audit(source + "\n" + text)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability"),
    ]),
  );
});
it("round 2 rejects the constructor review probe", () => {
  expect(
    audit(source + '\nexport const leak = (() => {}).constructor("return 1");'),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining("dynamic code cannot be audited"),
    ]),
  );
});
it.each([
  'import("node:" + "fs");',
  'const SPEC = "node:" + "fs"; import(SPEC);',
  'require("node:" + "fs");',
  'require.resolve("node:" + "fs");',
  'createRequire(import.meta.url)("node:" + "fs");',
  'createRequire(import.meta.url).resolve("node:" + "fs");',
])("folds ELK capability loader specifiers: %s", (text) => {
  expect(audit(source + "\n" + text)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("forbidden ELK capability"),
    ]),
  );
});
it.each([
  "import(spec);",
  "require(spec);",
  "createRequire(import.meta.url)(spec);",
  "createRequire(import.meta.url).resolve(spec);",
])("fails closed on unresolved ELK loader specifiers: %s", (text) => {
  expect(audit(source + "\n" + text)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("unresolved ELK capability specifier"),
    ]),
  );
});
it.each([
  '(() => {})["constructor"]("return 1");',
  'new ((() => {}).constructor)("return 1");',
  'const Make = (() => {}).constructor; Make("return 1");',
  '(() => {})["con" + "structor"]("return 1");',
])(
  "rejects constructor invocation and aliases outside the loader: %s",
  (text) => {
    expect(audit(source + "\n" + text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("dynamic code cannot be audited"),
      ]),
    );
  },
);
it("rejects new loading forms outside the exact current static imports", () => {
  expect(
    audit(
      source + '\nexport * from "./elk-worker-budget.js"; import("elkjs");',
    ),
  ).not.toEqual([]);
});
it.each(["class { postMessage() {} }", "null", "{}"])(
  "round 2 rejects cache pre-seed by initializer: %s",
  (initializer) => {
    const tampered = source.replace(
      "let fauxWorker: ElkFauxWorkerConstructor | undefined;",
      "let fauxWorker: ElkFauxWorkerConstructor | undefined = " +
        initializer +
        ";",
    );
    expect(tampered).not.toBe(source);
    expect(audit(tampered)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("loader cache must start undefined"),
      ]),
    );
  },
);
it("permits only the canonical uninitialized loader cache", () => {
  expect(audit(source)).toEqual([]);
  expect(
    audit(
      source.replace(
        "let fauxWorker: ElkFauxWorkerConstructor | undefined;",
        "let fauxWorker: ElkFauxWorkerConstructor | undefined = undefined;",
      ),
    ),
  ).not.toEqual([]);
});
