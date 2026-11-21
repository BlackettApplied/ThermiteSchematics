import { expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  contributorBuildOutputs,
  contributorSourceDigest,
} from "../../agent/contributor-bun.mjs";
import { normalizeTranscript } from "../../agent/transcript.mjs";
import { bun, focus, ordering } from "./support.mjs";
import {
  copy,
  fixture,
  observeIn,
  observer,
  put,
  root,
} from "./test-fixture.mjs";
import checkR02 from "./R02/check.mjs";
import { queryProof } from "./R02/query-proof.mjs";
import referenceR02 from "./R02/reference.mjs";

function runnable(f) {
  const dir = f.repository;
  for (const path of [
    "package.json",
    "scripts/test.mjs",
    "vitest.config.mjs",
    "thermite.mjs",
    "packages/cli/dist",
    "packages/cli/assets",
    "packages/query/dist",
    "packages/query/package.json",
    "packages/query/src",
    "packages/query/test",
    "examples/motor-starter",
  ])
    copy(dir, path);
  const deps = join(dir, "node_modules");
  const link = (from, to) =>
    symlinkSync(from, to, process.platform === "win32" ? "junction" : "dir");
  // Reuse the test runner's installed modules in this short-lived probe, with
  // the query workspace pointing at the fixture so its emit reaches the CLI.
  for (const entry of readdirSync(join(root, "node_modules"))) {
    if (
      entry === "@thermite" ||
      entry.startsWith(".") ||
      existsSync(join(deps, entry))
    )
      continue;
    link(join(root, "node_modules", entry), join(deps, entry));
  }
  for (const name of ["vitest", "typescript", "elkjs"])
    copy(dir, "node_modules/" + name);
  mkdirSync(join(deps, "@thermite"));
  for (const name of readdirSync(join(root, "node_modules/@thermite"))) {
    link(
      join(name === "query" ? dir : root, "packages", name),
      join(deps, "@thermite", name),
    );
  }
}

it("runs the repo Vitest config through the shim and direct hook despite an untracked config", () => {
  const f = fixture(true);
  runnable(f);
  const runFocus = () => bun(f.ctx, f.repository, "scripts/test.mjs", focus);
  const plain = runFocus();
  expect(plain.exit, plain.stdout + plain.stderr).toBe(0);
  put(
    f.repository,
    "vitest.config.ts",
    'throw new Error("untracked config loaded");\n',
  );
  const unobserved = runFocus();
  expect(unobserved.exit).not.toBe(0);
  expect(unobserved.stderr).toContain("untracked config loaded");
  observer(f, "engine");
  const direct = runFocus();
  expect(direct.exit, direct.stdout + direct.stderr).toBe(0);
  const shim = observeIn(f, f.repository, "scripts/test.mjs", focus);
  expect(shim.exit, shim.stdout + shim.stderr).toBe(0);
});

function refreshBuildReceipt(f) {
  f.rows[1].sourceSha256 = contributorSourceDigest(f.repository);
  f.rows.at(-1).outputs = contributorBuildOutputs(f.repository);
  f.save();
}

const descending = "  right: TerminalView,\n  left: TerminalView,";

const fixes = [
  ["exact revert", (clean) => clean],
  [
    "negated seeded result, including negative zero for equality",
    (_clean, seed) =>
      seed.replace(
        /(export function compareTerminalView\([\s\S]+?return )\(/,
        "$1-(",
      ),
  ],
  [
    "argument swap",
    (_clean, seed) =>
      seed.replace(
        /export function compareTerminalView\([\s\S]+?(?=export function comparePotentialView)/,
        (declaration) =>
          declaration.replace(
            /compareText\(left\.([\w.]+), right\.([\w.]+)\)/g,
            (_call, left, right) => `compareText(right.${left}, left.${right})`,
          ),
      ),
  ],
  [
    "trailing comment",
    (clean) =>
      clean.replace(
        "export const compareAlias = compareText;",
        "export const compareAlias = compareText; // unchanged neighbor",
      ),
  ],
  [
    "function declaration rewrite",
    (clean) =>
      clean.replace(
        /export function compareTerminalView\([\s\S]+?(?=export function comparePotentialView)/,
        `export function compareTerminalView(a: TerminalView, b: TerminalView): number {
        const device = compareText(a.deviceDesignation, b.deviceDesignation);
        if (device !== 0) return device;
        return compareText(a.id.terminalKey, b.id.terminalKey) ||
          compareText(a.id.deviceUid, b.id.deviceUid);
      }\n\n`,
      ),
  ],
  [
    "extra blank line",
    (clean) =>
      clean.replace(
        "export function comparePotentialView",
        "\n\nexport function comparePotentialView",
      ),
  ],
  [
    "arrow rewrite",
    (clean) =>
      clean.replace(
        /export function compareTerminalView\(([\s\S]+?\): number) \{([\s\S]+?)\n\}/,
        "export const compareTerminalView = ($1 => {$2\n};",
      ),
  ],
];

it("accepts the review probe's five fixes, an arrow rewrite, and an untracked unimported note", () => {
  const f = fixture(true);
  const seed = readFileSync(join(f.repository, ordering), "utf8");
  expect(seed).toContain(descending);
  runnable(f);
  put(f.repository, "notes.txt", "Scratch diagnosis");
  const emit = (text) => {
    put(f.repository, ordering, text);
    put(
      f.repository,
      "packages/query/dist/ordering.js",
      ts.transpileModule(text, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    );
    refreshBuildReceipt(f);
  };
  for (const [name, fix] of fixes) {
    const text = fix(f.clean, seed);
    expect(text, name).not.toBe(seed);
    emit(text);
    expect(checkR02(f.ctx), name).toMatchObject({
      pass: true,
      checks: { confined: true, independentFocused: true, hidden: true },
    });
  }
  // K1 uses a single UID, so an incomplete repair can fix the visible output
  // while accidentally removing the fallback required elsewhere.
  emit(
    f.clean.replace("compareText(left.id.deviceUid, right.id.deviceUid)", "0"),
  );
  expect(checkR02(f.ctx)).toMatchObject({
    pass: false,
    checks: { confined: true, hidden: false },
  });
});

function miniatureSolution(f) {
  const projectFiles = {
    "tsconfig.json": {
      files: [],
      references: [{ path: "./packages/query" }, { path: "./downstream" }],
    },
    "packages/query/tsconfig.json": {
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        composite: true,
        rootDir: "src",
        outDir: "dist",
        types: ["node"],
        tsBuildInfoFile: "dist/fixture.tsbuildinfo",
      },
      include: ["src/**/*.ts"],
    },
    "downstream/tsconfig.json": {
      extends: "../tsconfig.base.json",
      compilerOptions: { composite: true, outDir: "dist", types: [] },
      files: ["consumer.ts"],
      references: [{ path: "../packages/query" }],
    },
  };
  copy(f.repository, "tsconfig.base.json");
  for (const [file, config] of Object.entries(projectFiles))
    put(f.repository, file, JSON.stringify(config));
  put(f.repository, "downstream/consumer.ts", "export const unrelated = 1;");
  const manifest = JSON.parse(
    readFileSync(join(f.repository, "package.json"), "utf8"),
  );
  manifest.scripts.build = "bun node_modules/typescript/lib/tsc.js -b";
  put(f.repository, "package.json", JSON.stringify(manifest));
}

it("observes a real R02 build, edit and incremental rebuild, with a seven-call reference", async () => {
  const f = fixture(true);
  const seed = readFileSync(join(f.repository, ordering), "utf8");
  runnable(f);
  put(f.repository, ordering, seed);
  miniatureSolution(f);
  observer(f, "engine");
  const first = Date.now();
  const diagnostics = [];
  // The first build uses TypeScript's solution builder API. The reference
  // runs the one command-line tsc -b as a real incremental rebuild.
  const config = join(f.repository, "tsconfig.json");
  const builder = ts.createSolutionBuilder(
    ts.createSolutionBuilderHost(ts.sys, undefined, (d) => diagnostics.push(d)),
    [config],
    {},
  );
  expect(
    builder.build(),
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => f.repository,
      getCanonicalFileName: (path) => path,
      getNewLine: () => "\n",
    }),
  ).toBe(0);
  const built = contributorBuildOutputs(f.repository);
  const broken = queryProof(f.ctx, f.repository);
  expect(
    JSON.parse(broken.inspect.stdout).object.terminals[0].id.terminalKey,
  ).toBe("A2");
  expect(broken.pass).toBe(false);
  f.rows.push({
    cwd: f.repository,
    kind: "build",
    exit: 0,
    started: first,
    outputs: built,
  });
  f.save();
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    await referenceR02(f.ctx);
  } finally {
    console.log = original;
  }
  expect(
    normalizeTranscript(lines.join("\n")).events.filter(
      ({ type }) => type === "tool",
    ),
  ).toHaveLength(7);
  expect(contributorBuildOutputs(f.repository)).not.toEqual(built);
  expect(contributorBuildOutputs(f.repository)[0]).toEqual(built[0]);
  expect(checkR02(f.ctx)).toMatchObject({
    pass: true,
    checks: { hidden: true, freshBuild: true },
  });
});
