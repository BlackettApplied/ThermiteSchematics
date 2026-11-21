import { expect, it } from "vitest";
import {
  existsSync,
  readFileSync,
  lstatSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
} from "node:fs";
import { join, sep } from "node:path";
import {
  contributorBuildOutputs,
  contributorRealpath,
  contributorSourceDigest,
} from "../../agent/contributor-bun.mjs";
import { focus, git, ordering, seedQuery, setup } from "./support.mjs";
import { fixture, put, temp } from "./test-fixture.mjs";
import { completedWorkflow } from "./receipts.mjs";
import checkR01 from "./R01/check.mjs";
import checkR02 from "./R02/check.mjs";

it("R01 accepts a registered checkout with matching test and build receipts", () => {
  const f = fixture();
  const outcome = checkR01(f.ctx);
  const gitDirectories = () =>
    ["--show-toplevel", "--absolute-git-dir", "--git-common-dir"].map(
      (option) => [
        option,
        git(f.ctx, f.repository, "rev-parse", option).trimEnd(),
      ],
    );
  const evidence = outcome.pass
    ? undefined
    : JSON.stringify({
        checkout: f.repository,
        realpath: realpathSync(f.repository),
        nativeProject: contributorRealpath(f.ctx.project),
        gitDirectories: gitDirectories(),
        engineCommon: git(
          f.ctx,
          f.engine,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ).trimEnd(),
        listed: git(
          f.ctx,
          f.engine,
          "worktree",
          "list",
          "--porcelain",
          "-z",
        ).split("\0"),
      });
  expect(outcome, evidence).toMatchObject({
    pass: true,
    checks: { worktree: true },
  });
});

it("R01 accepts temp directory aliases and Git-style path separators in receipts", () => {
  const f = fixture();
  const fromTemp = join(f.ctx.project, "worktree");
  const fromGit = git(
    f.ctx,
    f.repository,
    "rev-parse",
    "--show-toplevel",
  ).trimEnd();
  expect(contributorRealpath(fromTemp)).toBe(contributorRealpath(fromGit));
  for (const row of f.rows) {
    row.cwd = fromTemp.split(sep).join("/");
    if (row.tests)
      row.tests.files = [join(fromTemp, focus).split(sep).join("/")];
  }
  f.save();
  expect(checkR01(f.ctx)).toMatchObject({
    pass: true,
    checks: { worktree: true, focused: true },
  });
});

it("R01 rejects a checkout with a stale Git worktree backlink", () => {
  const f = fixture();
  const admin = git(
    f.ctx,
    f.repository,
    "rev-parse",
    "--absolute-git-dir",
  ).trimEnd();
  put(admin, "gitdir", join(f.engine, ".git") + "\n");
  expect(checkR01(f.ctx)).toEqual({ pass: false, checks: { worktree: false } });
});

it("R01 reports an unregistered worktree after Git prunes its admin directory", () => {
  const f = fixture();
  const admin = git(
    f.ctx,
    f.repository,
    "rev-parse",
    "--absolute-git-dir",
  ).trimEnd();
  rmSync(admin, { recursive: true });
  expect(existsSync(join(f.repository, ".git"))).toBe(true);
  expect(checkR01(f.ctx)).toEqual({ pass: false, checks: { worktree: false } });
});

it("R01 accepts a matching build before the focused test, with or without an incremental rebuild", () => {
  const f = fixture();
  const [install, test, build] = f.rows;
  const latest = Math.max(...build.outputs.map((file) => file.modified)) + 1000;
  f.rows.splice(0, 3, install, build, {
    ...test,
    started: latest,
    ended: latest + 1,
  });
  f.save();
  expect(checkR01(f.ctx).pass).toBe(true);
  f.rows.push({ ...build, started: latest + 1 });
  f.save();
  expect(checkR01(f.ctx).pass).toBe(true);
});

it("R02 binds both the build and the passing test to the delivered repair", () => {
  const f = fixture(true);
  put(f.repository, ordering, f.clean);
  const [, test, build] = f.rows;
  build.outputs = contributorBuildOutputs(f.repository);
  const started =
    Math.max(...build.outputs.map(({ modified }) => modified)) + 1000;
  f.rows.splice(0, 3, build, { ...test, started, ended: started + 1 });
  f.save();
  expect(completedWorkflow(f.ctx, f.repository, { queryRepair: true })).toEqual(
    { focused: false, freshBuild: false },
  );
  f.rows[1].sourceSha256 = contributorSourceDigest(f.repository);
  f.save();
  expect(completedWorkflow(f.ctx, f.repository, { queryRepair: true })).toEqual(
    {
      focused: true,
      freshBuild: true,
    },
  );
  put(
    f.repository,
    ordering,
    f.clean.replace(
      "compareText(left.id.terminalKey, right.id.terminalKey)",
      "compareText(right.id.terminalKey, left.id.terminalKey)",
    ),
  );
  f.rows[1].sourceSha256 = contributorSourceDigest(f.repository);
  f.save();
  expect(completedWorkflow(f.ctx, f.repository, { queryRepair: true })).toEqual(
    { focused: true, freshBuild: false },
  );
});

it.each([
  [
    "skipped focused test",
    "focused",
    ({ rows, save }) => {
      rows[1].tests.passed--;
      save();
    },
  ],
  [
    "omitted focused test with a report",
    "focused",
    ({ rows, save }) => {
      rows.splice(1, 1);
      save();
    },
  ],
  [
    "symlinked node_modules",
    "ownInstall",
    ({ engine, repository }) => {
      rmSync(join(repository, "node_modules"), { recursive: true });
      symlinkSync(
        join(engine, "node_modules"),
        join(repository, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const link = join(repository, "node_modules");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(realpathSync(link)).toBe(
        realpathSync(join(engine, "node_modules")),
      );
    },
  ],
  [
    "stale build",
    "freshBuild",
    ({ repository, rows, save }) => {
      const file = join(
        repository,
        contributorBuildOutputs(repository)[0].file,
      );
      utimesSync(file, new Date(0), new Date(0));
      // The successful command also observed stale outputs. Matching hashes
      // alone cannot give them a fresh origin.
      rows[2].outputs = contributorBuildOutputs(repository);
      save();
    },
  ],
])("R01 rejects %s", (_name, key, change) => {
  const f = fixture();
  change(f);
  expect(checkR01(f.ctx)).toMatchObject({
    pass: false,
    checks: { [key]: false },
  });
});

it.each([
  [
    "weakened test",
    "confined",
    (f) => {
      put(f.repository, ordering, f.clean);
      put(
        f.repository,
        focus,
        'it("ascending", () => expect(true).toBe(true));\n',
      );
    },
  ],
  [
    "unrelated tracked edit",
    "confined",
    (f) => {
      put(f.repository, ordering, f.clean);
      put(f.repository, "README.md", "outside the repair\n");
    },
  ],
  [
    "wrong function",
    "confined",
    (f) => {
      const seed = readFileSync(join(f.repository, ordering), "utf8");
      put(
        f.repository,
        ordering,
        seed.replace(
          "function compareNumber(left: number, right: number): number {\n  return left < right ? -1 : left > right ? 1 : 0;",
          "function compareNumber(left: number, right: number): number {\n  return right < left ? -1 : right > left ? 1 : 0;",
        ),
      );
    },
  ],
  [
    "imported scratch code",
    "confined",
    (f) => {
      put(
        f.repository,
        "packages/query/src/scratch.js",
        "export const order = () => 0;",
      );
      put(
        f.repository,
        ordering,
        f.clean.replace(
          "export function compareTerminalView(",
          "import { order } from './scratch.js';\nexport function compareTerminalView(",
        ),
      );
    },
  ],
  [
    "scratch required inside the changed function",
    "confined",
    (f) => {
      put(
        f.repository,
        "packages/query/src/scratch.js",
        "export const order = () => 0;",
      );
      put(
        f.repository,
        ordering,
        f.clean.replace(
          "compareText(left.deviceDesignation, right.deviceDesignation) ||",
          'require("./scratch.js").order(left, right) ||',
        ),
      );
    },
  ],
  [
    "staged scratch code",
    "confined",
    (f) => {
      put(f.repository, ordering, f.clean);
      put(f.repository, "scratch.txt", "Tracked despite being a scratch file.");
      git(f.ctx, f.repository, "add", "scratch.txt");
    },
  ],
])("R02 rejects %s", (_name, key, change) => {
  const f = fixture(true);
  change(f);
  expect(checkR02(f.ctx)).toMatchObject({
    pass: false,
    checks: { [key]: false },
  });
});

it("rejects a runtime archive in place of a source checkout", () => {
  expect(() => setup({ runtime: temp() })).toThrow("--context source");
});

it.each([
  ["THERMITE_CONTRIBUTOR_BUN", "THERMITE_TEST_TIMINGS"],
  ["THERMITE_TEST_TIMINGS", "THERMITE_CONTRIBUTOR_BUN"],
])(
  "rejects a pinned source checkout missing %s support",
  (missing, present) => {
    const runtime = temp();
    const project = temp();
    put(runtime, ordering, "export {};\n");
    put(runtime, "scripts/test.mjs", `void process.env.${present};\n`);
    expect(() => setup({ runtime, project })).toThrow(
      `R tasks require a pinned --commit with ${missing} support in scripts/test.mjs`,
    );
    expect(existsSync(join(project, "engine"))).toBe(false);
  },
);

it("hides the clean runtime source and map files after applying the fixture seed", () => {
  const f = fixture(true);
  const runtime = temp();
  for (const path of [
    ordering,
    "packages/query/dist/ordering.js.map",
    "packages/query/dist/ordering.d.ts.map",
  ]) {
    put(runtime, path, "pristine fixture content");
  }
  put(f.repository, ordering, f.clean);
  put(runtime, "packages/query/dist/ordering.js", "compiled CLI support");
  seedQuery({ ...f.ctx, runtime }, f.repository);
  expect(readFileSync(join(f.repository, ordering), "utf8")).toContain(
    "  right: TerminalView,\n  left: TerminalView,",
  );
  expect(existsSync(join(runtime, ordering))).toBe(false);
  expect(readdirSync(join(runtime, "packages/query/dist"))).toEqual([
    "ordering.js",
  ]);
});
