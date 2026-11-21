import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { context, processRun } from "../../../scripts/docs-example-context.mjs";
import { repoShell } from "../../../scripts/docs-example-runner.mjs";
import { executeBoundTest } from "../../../scripts/docs-examples.mjs";

import { closeExampleProcesses } from "../../../scripts/docs-example-process.mjs";

const roots: string[] = [];
afterEach(async () => {
  await closeExampleProcesses();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function root() {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-doc-lifecycle-"),
  );
  roots.push(directory);
  return directory;
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
it("closes unused child stdin rather than leaving approval waiting for input", async () => {
  const result = await processRun(
    [
      "-e",
      'process.stdin.on("end", () => console.log("eof")); process.stdin.resume();',
    ],
    await root(),
    process.env,
    { timeoutMs: 1500 },
  );
  expect(result.code).toBe(0);
  expect(result.stdout.trim()).toBe("eof");
});
it("a child deadline rejects only after the child is dead", async () => {
  const error = await processRun(
    ["-e", "setInterval(() => {}, 1000)"],
    await root(),
    process.env,
    { timeoutMs: 50, label: "fixture command" },
  ).catch((e) => e);
  expect(error.message).toBe(
    "Example child exceeded 50 ms deadline: fixture command",
  );
  expect(error.childPid).toEqual(expect.any(Number));
  expect(alive(error.childPid)).toBe(false);
});
it("cleanup cancels and awaits a running child tree before removing its fixture", async () => {
  const c = await context(await root());
  let ready: (pids: { parent: number; descendant: number }) => void;
  const started = new Promise<{ parent: number; descendant: number }>(
    (resolve) => {
      ready = resolve;
    },
  );
  let output = "";
  const running = c.run(
    [
      "-e",
      'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); console.log(JSON.stringify({parent:process.pid,descendant:child.pid})); setInterval(()=>{},1000);',
    ],
    c.work,
    process.env,
    {
      onOutput: (text: string) => {
        output += text;
        if (output.includes("\n")) ready(JSON.parse(output));
      },
    },
  );
  const settled = running.catch((error: Error) => error);
  try {
    const pids = await Promise.race([
      started,
      running.then(() => {
        throw new Error("Child ended before readiness");
      }),
    ]);
    expect(alive(pids.parent)).toBe(true);
    expect(alive(pids.descendant)).toBe(true);
    await c.cleanup();
    expect((await settled).message).toContain("canceled during cleanup");
    await expect
      .poll(() => alive(pids.parent) || alive(pids.descendant), {
        timeout: 2000,
      })
      .toBe(false);
    await expect(stat(c.temporary)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await c.cleanup();
  }
});
it("watch deadline awaits termination before its temporary tree is removed", async () => {
  const directory = await root();
  await mkdir(join(directory, "examples"));
  await mkdir(join(directory, "scripts"));
  await writeFile(join(directory, "scripts/demo-change.mjs"), "");
  await writeFile(
    join(directory, "thermite.mjs"),
    "setInterval(() => {}, 1000);\n",
  );
  const c = await context(directory, { timeoutMs: 50 });
  try {
    const error = await repoShell(c, {
      file: "docs/review.md",
      body: "bun thermite.mjs watch --project . --input packet.json -o drawing.html",
    }).catch((e) => e);
    expect(error.message).toContain("deadline");
    expect(alive(error.childPid)).toBe(false);
    expect((await stat(c.temporary)).isDirectory()).toBe(true);
  } finally {
    await c.cleanup();
  }
  await expect(stat(c.temporary)).rejects.toMatchObject({ code: "ENOENT" });
});
it("bounds the standalone named-test subprocess as well as ordinary commands", async () => {
  const directory = await root();
  const error = await executeBoundTest(
    directory,
    { testFile: "absent.test.ts", testName: "never" },
    { file: "docs/test.md", hash: "a".repeat(64) },
    { timeoutMs: 1 },
  ).catch((e) => e);
  expect(error.message).toContain("deadline");
  expect(alive(error.childPid)).toBe(false);
});
