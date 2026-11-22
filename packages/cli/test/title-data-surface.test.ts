import { expect, it } from "vitest";
import { auditTitleDataSurface } from "./title-data-surface.js";
const hidden = "packages/render/src/internal/title-data/parse.ts";
const hiddenSchema = "packages/schema/src/internal/title-data/schema.ts";
const fixture = (
  file: string,
  source: string,
  extra: [string, string][] = [],
) =>
  new Map([
    [hidden, "export const parse = 1;"],
    [hiddenSchema, "export const shape = 1;"],
    [file, source],
    ...extra,
  ]);
it.each([
  ['import {parse} from "./internal/title-data/parse.js";'],
  ['export * from "./internal/title-data/parse.js";'],
  ['await import("./internal/title-data/parse.js");'],
  ['require("./internal/title-data/parse.js");'],
  ['if(process.env.TB) await import("./internal/title-data/parse.js");'],
  ['const path="./internal/"+"title-data/parse.js"; await import(path);'],
  ["const path=process.env.TB_PATH; require(path);"],
])("refuses static/dynamic/require/env references: %s", (source) =>
  expect(
    auditTitleDataSurface(fixture("packages/render/src/index.ts", source)),
  ).not.toEqual([]),
);
it("follows public and internal barrels", () => {
  expect(
    auditTitleDataSurface(
      fixture(
        "packages/render/src/index.ts",
        'export * from "./internal/index.js";',
        [
          [
            "packages/render/src/internal/index.ts",
            'export * from "./title-data/parse.js";',
          ],
        ],
      ),
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining(
        "packages/render/src/index.ts: public module or barrel",
      ),
    ]),
  );
});
it.each([
  "packages/cli/src/internal/entry.ts",
  "packages/render/src/internal/entry.ts",
  "packages/schema/src/internal/entry.ts",
  "packages/query/src/internal/title-data/entry.ts",
])("narrows the exemption, including %s", (file) => {
  expect(
    auditTitleDataSurface(
      fixture(file, 'import "@thermite/render/internal/title-data/parse.js";'),
    ),
  ).not.toEqual([]);
});
it("catches env gates in the hidden directory and its dependencies", () => {
  expect(
    auditTitleDataSurface(
      new Map([
        [hidden, 'import "../../env.js";'],
        ["packages/render/src/env.ts", "export const enabled=process.env.TB;"],
      ]),
    ),
  ).not.toEqual([]);
  expect(
    auditTitleDataSurface(
      new Map([[hidden, 'export const enabled=process["env"].TB;']]),
    ),
  ).not.toEqual([]);
});
it("normalizes Windows paths and permits ordinary dynamic imports and unrelated env reads", () => {
  const files = fixture(
    "packages\\render\\src\\index.ts",
    'await import("./renderer.js"); const level=process.env.LOG_LEVEL;',
    [["packages/render/src/renderer.ts", "export const ready = true;"]],
  );
  expect(auditTitleDataSurface(files)).toEqual([]);
  expect(
    auditTitleDataSurface(
      new Map([
        [
          hidden,
          `import "../../../../schema/dist/internal/title-data/schema.js";`,
        ],
        [hiddenSchema, "export const shape = 1;"],
      ]),
    ),
  ).toEqual([]);
});

it("rejects shadowed and reassigned dynamic paths behind env gates", () => {
  for (const source of [
    'let path="./renderer.js"; if(process.env.TB) path="./internal/title-data/parse.js"; import(path);',
    'const path="./renderer.js"; function load(path:string){return import(path)}; load(process.env.TB_PATH);',
    'if(process.env.TB) require("./internal/"+"title-data/parse.js");',
  ])
    expect(
      auditTitleDataSurface(fixture("packages/render/src/index.ts", source)),
    ).not.toEqual([]);
});
it("keeps structural schema dependencies below render", () => {
  expect(
    auditTitleDataSurface(
      new Map([
        [hiddenSchema, 'import "../../../../render/dist/text-metrics.js";'],
        ["packages/render/src/text-metrics.ts", "export const glyph = true;"],
      ]),
    ),
  ).not.toEqual([]);
});

it.each([
  "/private/scratch/packages/render/dist/internal/title-data/parse.js",
  "C:\\scratch\\packages\\render\\dist\\internal\\title-data\\parse.js",
  "file:///private/scratch/packages/schema/dist/internal/title-data/presentation.js",
  "file:///private/scratch/packages/render/dist/internal/title%2Ddata/parse.js",
])("refuses hidden absolute and file URL imports %s", (path) => {
  expect(
    auditTitleDataSurface(
      fixture(
        "packages/render/src/index.ts",
        `if(process.env.TB) import(${JSON.stringify(path)});`,
      ),
    ),
  ).not.toEqual([]);
});
it.each([
  "const load=require; load(process.env.TB_MODULE);",
  'import {createRequire as makeLoader} from "node:module"; const load=makeLoader(import.meta.url); load(process.env.TB_MODULE);',
])("refuses indirect require env loaders %s", (source) =>
  expect(
    auditTitleDataSurface(fixture("packages/render/src/index.ts", source)),
  ).not.toEqual([]),
);

it("permits existing closed createRequire forms without exempting their files", () => {
  const source =
    'import {createRequire} from "node:module"; const WORKER="elkjs/lib/elk-worker.min.js"; const {deflate}=createRequire(import.meta.url)("pako"); createRequire(import.meta.url).resolve(WORKER);';
  expect(
    auditTitleDataSurface(fixture("packages/render/src/index.ts", source)),
  ).toEqual([]);
});
it("audits hidden references even behind an aliased loader", () => {
  const source =
    'const load = makeLoader(); if(process.env.TB) load("./internal/title-data/parse.js");';
  expect(
    auditTitleDataSurface(fixture("packages/render/src/index.ts", source)),
  ).not.toEqual([]);
});

it.each([
  'eval("import(\\"./internal/title-data/parse.js\\")")',
  "const run=eval; run(process.env.TB_CODE)",
  '(0, eval)("code")',
  'const make=Function; make("code")',
  'new Function("code")',
  'globalThis["eval"]("code")',
  'globalThis["ev"+"al"]("code")',
  'globalThis["Function"]("code")',
])("rejects dynamic code: %s", (source) => {
  expect(
    auditTitleDataSurface(
      fixture("packages/render/src/index.ts", source),
      true,
    ),
  ).not.toEqual([]);
});
it("resolves scoped dist barrels", () => {
  expect(
    auditTitleDataSurface(
      fixture(
        "packages/cli/src/index.ts",
        'import "@thermite/render/dist/bridge.js";',
        [
          [
            "packages/render/src/bridge.ts",
            'export * from "./internal/title-data/parse.js";',
          ],
        ],
      ),
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining("packages/cli/src/index.ts: public"),
    ]),
  );
});
it("permits only the unchanged pinned ELK constructor", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = "packages/render/src/layout/elk-runtime.ts";
  const source = await readFile(path, "utf8");
  expect(auditTitleDataSurface(new Map([[path, source]]), true)).toEqual([]);
  expect(
    auditTitleDataSurface(
      new Map([[path, source + '\nnew Function("code");']]),
      true,
    ),
  ).not.toEqual([]);
});
