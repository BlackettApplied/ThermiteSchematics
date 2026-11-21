import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { resolveBaseRevision } from "./checkout.mjs";
import { cleanupResource } from "./lifecycle.mjs";
import { entry, fixture, git, put, until } from "./test-fixture.mjs";

const fixtures = [];
const create = (timing = false, options) => {
  const f = fixture(timing, options);
  fixtures.push(f);
  return f;
};
afterEach(() => {
  for (const f of fixtures.splice(0))
    rmSync(f.temporary, { recursive: true, force: true });
});
function cli(args, env = {}, script = entry) {
  const child = spawn(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  return { child, closed };
}
test("defaults to the PR merge-base, rather than the advancing origin/dev tip", async () => {
  const f = create(false, { autocrlf: "true" });
  git(f.head, "checkout", "--detach", f.baseRevision);
  put(join(f.head, "dev.txt"), "merged independently\n");
  git(f.head, "add", ".");
  git(f.head, "commit", "-qm", "dev advanced");
  const dev = git(f.head, "rev-parse", "HEAD");
  git(f.head, "update-ref", "refs/remotes/origin/dev", dev);
  git(f.head, "checkout", "--detach", f.headRevision);
  expect(resolveBaseRevision(f.head)).toBe(f.baseRevision);
  expect(resolveBaseRevision(f.head, "origin/dev")).toBe(dev);
  const output = join(f.temporary, "report.json");
  const result = await cli(["--head-engine", f.head, "--output", output])
    .closed;
  // Tiny synthetic timings may be noisy; base selection must never be.
  expect([0, 1], result.stderr).toContain(result.code);
  expect(JSON.parse(readFileSync(output, "utf8")).baseRevision).toBe(
    f.baseRevision,
  );
});
test("rebuilds stale head and cached base before timing, and exits 3 for broken head", async () => {
  const f = create(),
    base = join(f.temporary, "cached");
  git(f.head, "worktree", "add", "--detach", base, f.baseRevision);
  execFileSync(process.execPath, ["run", "build"], {
    cwd: f.head,
    stdio: "ignore",
  });
  const broken =
    'export async function compileProject(){return {ok:false,diagnostics:["synthetic broken head"]}}\n';
  put(join(f.head, "packages/compiler/src/index.js"), broken);
  put(
    join(base, "packages/compiler/dist/index.js"),
    "throw Error('stale base dist');\n",
  );
  const order = join(f.temporary, "build-order.txt");
  const result = await cli(["--head-engine", f.head, "--base-engine", base], {
    PERF_BUILD_ORDER: order,
  }).closed;
  expect(result.code, result.stderr).toBe(3);
  expect(result.stderr).toContain("synthetic broken head");
  expect(
    readFileSync(join(f.head, "packages/compiler/dist/index.js"), "utf8"),
  ).toBe(broken);
  expect(
    readFileSync(join(base, "packages/compiler/dist/index.js"), "utf8"),
  ).not.toContain("stale base dist");
  expect(readFileSync(order, "utf8").trim().split("\n")).toEqual([
    "head",
    "cached",
  ]);
});
test("returns setup exit 2 for an invalid base revision", async () => {
  const f = create();
  expect(
    (await cli(["--head-engine", f.head, "--base-rev", "missing-ref"]).closed)
      .code,
  ).toBe(2);
});
test("classifies a head module-initialization defect as correctness exit 3", async () => {
  const f = create();
  put(
    join(f.head, "packages/compiler/src/index.js"),
    "throw Error('synthetic import failure');\n",
  );
  const result = await cli(["--head-engine", f.head]).closed;
  expect(result.code, result.stderr).toBe(3);
  expect(result.stderr).toContain("synthetic import failure");
});
test("a synthetic +25% duration exits 1 after two failed measurements per row", async () => {
  const f = create(true, { autocrlf: "true" });
  const source = join(f.head, "packages/compiler/src/index.js");
  put(
    source,
    readFileSync(source, "utf8").replace("perfStep=100", "perfStep=125"),
  );
  const output = join(f.temporary, "slowdown.json");
  const result = await cli(["--head-engine", f.head, "--output", output])
    .closed;
  expect(result.code, result.stderr).toBe(1);
  const report = JSON.parse(readFileSync(output, "utf8"));
  expect(
    report.comparisons[0].rows.every(
      (row) =>
        row.measurements.length === 2 &&
        row.measurements.every(
          (m) => m.baseMedianMs === 100 && m.headMedianMs === 125 && !m.pass,
        ),
    ),
  ).toBe(true);
  expect(
    git(f.head, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree ")),
  ).toHaveLength(1);
});
test("still rejects changed workload bytes with LF attributes and autocrlf enabled", async () => {
  const f = create(true, { autocrlf: "true" }),
    path = join(f.head, "examples/machine-demo/packet.request.json"),
    packet = JSON.parse(readFileSync(path, "utf8"));
  packet.views[0].changed = true;
  put(path, packet);
  const result = await cli(["--head-engine", f.head]).closed;
  expect(result.code, result.stderr).toBe(3);
  expect(result.stderr).toContain("workload differs from the PR base");
});
test("removes files and prunes a partial registration even when worktree remove fails", () => {
  const f = create(),
    temporary = join(f.temporary, "perf"),
    basePath = join(temporary, "base");
  git(f.head, "worktree", "add", "--detach", basePath, f.baseRevision);
  const calls = [];
  const failures = cleanupResource(
    { temporary, basePath },
    f.head,
    (root, ...args) => {
      calls.push(args);
      if (args[1] === "remove") throw new Error("synthetic remove failure");
      return git(root, ...args);
    },
  );
  expect(failures).toEqual(["synthetic remove failure"]);
  expect(existsSync(temporary)).toBe(false);
  expect(git(f.head, "worktree", "list", "--porcelain")).not.toContain(
    basePath,
  );
  expect(calls.at(-1)).toEqual(["worktree", "prune", "--expire=now"]);
});
test("still prunes when both worktree remove and directory removal throw", () => {
  const calls = [];
  const failures = cleanupResource(
    { temporary: "unused", basePath: "unused/base" },
    "repo",
    (_root, ...args) => {
      calls.push(args[1]);
      if (args[1] === "remove") throw new Error("remove");
    },
    () => {
      calls.push("rm");
      throw new Error("rm");
    },
  );
  expect(calls).toEqual(["remove", "rm", "prune"]);
  expect(failures).toEqual(["remove", "rm"]);
});
test.each([
  ["SIGINT", 130],
  ["SIGTERM", 143],
])(
  "%s during base build cleans its process and temporary worktree",
  async (signal, status) => {
    const f = create(),
      pause = join(f.temporary, "paused.json");
    const args = ["--head-engine", f.head];
    let run;
    if (process.platform === "win32") {
      // Windows process.kill force-terminates instead of delivering these events.
      // Exercise the same registered child-process handler by event delivery.
      const wrapper = join(f.temporary, "signal-wrapper.mjs");
      put(
        wrapper,
        `import {existsSync} from 'node:fs'; import {main} from ${JSON.stringify(new URL("../check-perf.mjs", import.meta.url).href)};
setInterval(()=>{if(existsSync(process.env.PERF_PAUSE_FILE))process.emit(${JSON.stringify(signal)});},10);
await main(process.argv.slice(2));`,
      );
      run = cli(args, { PERF_PAUSE_FILE: pause }, wrapper);
    } else run = cli(args, { PERF_PAUSE_FILE: pause });
    try {
      await until(() => existsSync(pause));
      const paused = JSON.parse(readFileSync(pause, "utf8"));
      if (process.platform !== "win32") run.child.kill(signal);
      const result = await run.closed;
      expect(result.code, result.stderr).toBe(status);
      await until(() => {
        try {
          process.kill(paused.pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      expect(existsSync(dirname(paused.base))).toBe(false);
      expect(git(f.head, "worktree", "list", "--porcelain")).not.toContain(
        paused.base,
      );
    } finally {
      // Let the registered handler clean a paused builder after any test failure.
      run.child.kill("SIGTERM");
      await run.closed;
    }
  },
);
