import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs, runBatch } from "./run.mjs";
import { fixture, launch, until } from "./run-fixture.mjs";

function launchWithLimits(f, limits, args = []) {
  const limitsFile = join(f.batch, "limits.json");
  const edit = (value) => writeFileSync(limitsFile, value);
  edit(JSON.stringify(limits));
  const running = launch(f.batch, [...args, "--limits-file", limitsFile]);
  const release = (index) =>
    writeFileSync(join(f.jobs[index].directory, "release-worker"), "release");
  f.stopBeforeCleanup(async () => {
    if (running.outcome) return;
    // Release our fake workers before stopping an unfinished runner.
    for (const job of f.jobs) {
      writeFileSync(join(job.directory, "release-worker"), "release");
    }
    edit(JSON.stringify({ claude: 1, codex: 1 }));
    const stop = setTimeout(() => running.child.kill("SIGTERM"), 2000);
    try {
      await running.done;
    } finally {
      clearTimeout(stop);
    }
  });
  return {
    child: running.child,
    done: running.done,
    edit,
    release,
    waitFor: (description, predicate) =>
      until(() => {
        const outcome = running.outcome;
        if (outcome)
          assert.fail(
            `Runner exited (${outcome.code ?? outcome.signal}) before ${description}:\n${outcome.stderr}`,
          );
        let status;
        try {
          status = f.status();
        } catch (error) {
          if (error.code === "ENOENT") return false;
          throw error;
        }
        return predicate(status);
      }, description),
  };
}

test("live limits keep a zero-capacity queue alive and activate it after a valid edit", async (t) => {
  const f = fixture(t, [{ delay: 120 }, { delay: 120 }]);
  const running = launchWithLimits(f, { claude: 0, codex: 0 }, [
    "--claude",
    "0",
    "--codex",
    "0",
  ]);
  await running.waitFor("initial zero-capacity status", () => true);
  assert.equal(running.child.exitCode, null);
  assert.equal(existsSync(f.trace), false);
  running.edit("{");
  await running.waitFor("invalid JSON warning", (status) =>
    Boolean(status.limitsFile.warning),
  );
  assert.deepEqual(f.status().concurrency, { claude: 0, codex: 0 });
  assert.equal(existsSync(f.trace), false);
  running.edit(JSON.stringify({ claude: 1, codex: 0 }));
  const outcome = await running.done;
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.match(outcome.stderr, /Ignoring invalid limits file/);
  assert.deepEqual(f.status().concurrency, { claude: 1, codex: 0 });
  assert.equal(f.status().limitsFile.warning, null);
  const trace = readFileSync(f.trace, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    trace.map((event) => event.event),
    ["start", "end", "start", "end"],
  );
});

test("decreasing live limits drains workers, and invalid edits retain the last valid count", async (t) => {
  const f = fixture(t, [
    { waitForRelease: true },
    { waitForRelease: true },
    {},
    {},
  ]);
  const running = launchWithLimits(f, { claude: 2, codex: 0 });
  await running.waitFor("both initial jobs to spawn", (status) =>
    status.jobs.slice(0, 2).every((job) => job.pid && job.state === "running"),
  );
  running.edit(JSON.stringify({ claude: 1, codex: 0 }));
  await running.waitFor(
    "decreased capacity",
    (status) => status.concurrency.claude === 1,
  );
  running.release(0);
  await running.waitFor(
    "first job to drain",
    (status) => status.jobs[0].state === "completed",
  );
  running.edit(JSON.stringify({ claude: -1, codex: 3 }));
  await running.waitFor("invalid count warning", (status) =>
    status.limitsFile.warning?.message.includes("nonnegative integer"),
  );
  assert.deepEqual(f.status().concurrency, { claude: 1, codex: 0 });
  // Clearing the warning requires another limits reload, so worker 1 stays
  // blocked through a full scheduler pass with the freed slot.
  running.edit(JSON.stringify({ claude: 1, codex: 0 }));
  await running.waitFor(
    "invalid count warning to clear",
    (status) => status.limitsFile.warning === null,
  );
  running.release(1);
  const outcome = await running.done;
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.deepEqual(
    f.status().jobs.map((job) => job.state),
    ["completed", "completed", "completed", "completed"],
  );
  const trace = readFileSync(f.trace, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const thirdStart = trace.findIndex(
    (event) => event.event === "start" && event.id === f.jobs[2].id,
  );
  assert.ok(
    trace.slice(0, thirdStart).filter((event) => event.event === "end")
      .length === 2,
  );
  assert.deepEqual(
    trace.slice(thirdStart).map((event) => event.event),
    ["start", "end", "start", "end"],
  );
  assert.equal(
    outcome.stderr.split("Limits must contain claude and codex").length - 1,
    1,
  );
});

test("raising live limits cannot clear a backend rate-limit pause", async (t) => {
  const f = fixture(t, [
    { mode: "rate", waitForRelease: true },
    {},
    { backend: "codex", waitForRelease: true },
  ]);
  const running = launchWithLimits(f, { claude: 1, codex: 1 });
  await running.waitFor("both backends to spawn", (status) =>
    [0, 2].every(
      (index) =>
        status.jobs[index].pid && status.jobs[index].state === "running",
    ),
  );
  running.release(0);
  await running.waitFor("the Claude backend pause", (status) =>
    Boolean(status.pausedBackends.claude),
  );
  running.edit(JSON.stringify({ claude: 6, codex: 6 }));
  await running.waitFor(
    "increased capacity",
    (status) => status.concurrency.claude === 6,
  );
  assert.equal(f.status().jobs[1].state, "queued");
  running.release(2);
  const outcome = await running.done;
  assert.equal(outcome.code, 1, outcome.stderr);
  assert.equal(f.status().jobs[1].attempts.length, 0);
  assert.equal(f.status().runner.state, "paused");
});

test("a transient Windows sharing violation preserves atomic status updates", async (t) => {
  const f = fixture(t, [{}]);
  let blocked = false;
  const code = await runBatch(parseArgs(["--batch", f.batch]), {
    statusPlatform: "win32",
    renameStatus(source, destination) {
      if (!blocked && existsSync(destination)) {
        blocked = true;
        assert.equal(f.status().jobs[0].state, "queued");
        throw Object.assign(new Error("synthetic sharing violation"), {
          code: "EBUSY",
        });
      }
      renameSync(source, destination);
    },
  });
  assert.equal(blocked, true);
  assert.equal(code, 0);
  assert.equal(f.status().jobs[0].state, "completed");
  assert.equal(
    readdirSync(f.batch).some((entry) => entry.endsWith(".tmp")),
    false,
  );
});

for (const { name, statusPlatform, expectedAttempts } of [
  {
    name: "Windows status replacement stops after exhausting its retries",
    statusPlatform: "win32",
    expectedAttempts: 10,
  },
  {
    name: "non-Windows status replacement does not retry EPERM",
    statusPlatform: "linux",
    expectedAttempts: 1,
  },
]) {
  test(name, async (t) => {
    const f = fixture(t, [{}]);
    const statusPath = join(f.batch, "status.json");
    const failure = Object.assign(new Error("synthetic replacement failure"), {
      code: "EPERM",
    });
    let snapshot;
    let attempts = 0;
    await assert.rejects(
      runBatch(parseArgs(["--batch", f.batch]), {
        statusPlatform,
        renameStatus(source, destination) {
          if (snapshot === undefined) {
            renameSync(source, destination);
            snapshot = readFileSync(destination, "utf8");
            return;
          }
          attempts++;
          throw failure;
        },
      }),
      (error) => error === failure,
    );
    assert.equal(attempts, expectedAttempts);
    assert.equal(readFileSync(statusPath, "utf8"), snapshot);
    assert.equal(f.status().jobs[0].state, "queued");
    assert.equal(existsSync(f.trace), false);
    assert.equal(
      readdirSync(f.batch).some((entry) => entry.endsWith(".tmp")),
      false,
    );
  });
}
