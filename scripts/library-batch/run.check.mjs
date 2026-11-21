import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseArgs,
  rateLimitDiagnostic,
  runBatch,
  terminalOutcome,
} from "./run.mjs";
import {
  createChildProcessGroup,
  groupAlive,
  signalGroup,
} from "./process-group.mjs";
import { fixture, launch, until } from "./run-fixture.mjs";

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

test("owned POSIX groups fall back to the leader on EPERM without hiding permission failures", () => {
  const denied = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  const missing = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
  const unexpected = Object.assign(new Error("kill EIO"), { code: "EIO" });
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const leaderError of [null, missing, denied, unexpected]) {
      const calls = [];
      const options = {
        owned: true,
        platform: "darwin",
        kill(pid, value) {
          calls.push([pid, value]);
          if (pid < 0) throw denied;
          if (leaderError) throw leaderError;
        },
      };
      if (leaderError && leaderError !== missing)
        assert.throws(() => signalGroup(42, signal, options), leaderError);
      else assert.doesNotThrow(() => signalGroup(42, signal, options));
      assert.deepEqual(calls, [
        [-42, signal],
        [42, signal],
      ]);
    }
  }
  for (const options of [
    { platform: "darwin" },
    { owned: true, platform: "win32" },
  ]) {
    const calls = [];
    assert.throws(
      () =>
        signalGroup(42, "SIGTERM", {
          ...options,
          kill(pid) {
            calls.push(pid);
            throw denied;
          },
        }),
      denied,
    );
    assert.deepEqual(calls, [options.platform === "win32" ? 42 : -42]);
  }
  for (const error of [missing, unexpected]) {
    const call = () =>
      signalGroup(42, "SIGKILL", {
        owned: true,
        platform: "darwin",
        kill() {
          throw error;
        },
      });
    if (error === missing) assert.doesNotThrow(call);
    else assert.throws(call, error);
  }
});

test("owned zombie groups finish draining while unknown or denied groups remain alive", async () => {
  const denied = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  const missing = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
  for (const leaderError of [null, missing, denied]) {
    const calls = [];
    const options = {
      platform: "darwin",
      kill(pid, signal) {
        calls.push([pid, signal]);
        if (pid < 0) throw denied;
        if (leaderError) throw leaderError;
      },
    };
    assert.equal(
      groupAlive(42, { ...options, owned: true }),
      leaderError === denied,
    );
    assert.deepEqual(calls, [
      [-42, 0],
      [42, 0],
    ]);
    calls.length = 0;
    assert.equal(groupAlive(42, options), true);
    assert.deepEqual(calls, [[-42, 0]]);
    if (leaderError !== denied) {
      calls.length = 0;
      const group = createChildProcessGroup(42, options);
      await group.drain();
      assert.deepEqual(calls, [
        [-42, 0],
        [42, 0],
      ]);
      assert.deepEqual(group.errors, []);
      group.clear();
    }
  }
  const calls = [];
  assert.equal(
    groupAlive(42, {
      owned: true,
      platform: "darwin",
      kill(pid, signal) {
        calls.push([pid, signal]);
      },
    }),
    true,
  );
  // A reaped leader must not hide descendants that still accept group signals.
  assert.deepEqual(calls, [[-42, 0]]);
  assert.equal(
    groupAlive(42, {
      kill() {
        throw missing;
      },
    }),
    false,
  );
});

test("escalation timer reports unexpected signal errors through its awaited failure", async () => {
  const unexpected = Object.assign(new Error("synthetic kill EIO"), {
    code: "EIO",
  });
  const calls = [];
  const group = createChildProcessGroup(42, {
    platform: "darwin",
    kill(pid, signal) {
      calls.push([pid, signal]);
      if (signal === "SIGKILL") throw unexpected;
    },
  });
  try {
    const failure = assert.rejects(group.failure, unexpected);
    assert.doesNotThrow(() => group.stop());
    await failure;
    assert.deepEqual(calls, [
      [-42, "SIGTERM"],
      [-42, "SIGKILL"],
    ]);
    assert.deepEqual(group.errors, [unexpected]);
  } finally {
    group.clear();
  }
});

test("owned-group fallbacks record non-fatal notes when the leader is gone or the probe finishes", async () => {
  const denied = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  const missing = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
  for (const leaderError of [null, missing]) {
    const group = createChildProcessGroup(42, {
      platform: "darwin",
      kill(pid) {
        if (pid < 0) throw denied;
        if (leaderError) throw leaderError;
      },
    });
    try {
      await group.drain();
      assert.deepEqual(group.errors, []);
      assert.equal(group.notes.length, 1);
      assert.match(group.notes[0], /42.*probe.*EPERM.*leader.*finished/);
      if (leaderError) assert.match(group.notes[0], /ESRCH/);
      else assert.match(group.notes[0], /succeeded/);
    } finally {
      group.clear();
    }
  }
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const notes = [];
    assert.doesNotThrow(() =>
      signalGroup(42, signal, {
        owned: true,
        platform: "darwin",
        notes,
        kill(pid) {
          throw pid < 0 ? denied : missing;
        },
      }),
    );
    assert.equal(notes.length, 1);
    assert.match(notes[0], /42.*EPERM.*leader.*ESRCH/);
    assert.ok(notes[0].includes(signal));
  }
});

test("finished owned-group probe notes reach job and attempt diagnostics without changing outcomes", async (t) => {
  for (const leaderGone of [false, true]) {
    const f = fixture(t, [{}, { mode: "blocked" }, { mode: "missing" }]);
    const calls = [];
    const code = await runBatch(parseArgs(["--batch", f.batch]), {
      platform: "darwin",
      kill(pid, signal) {
        calls.push([pid, signal]);
        assert.equal(signal, 0);
        if (pid < 0)
          throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
        if (leaderGone)
          throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      },
    });
    assert.equal(code, 1);
    const records = f.status().jobs;
    assert.deepEqual(
      records.map((record) => record.state),
      ["completed", "needs-evidence", "failed"],
    );
    assert.equal(calls.length, 6);
    for (const record of records) {
      assert.match(
        record.diagnostics.join(" "),
        /probe.*EPERM.*leader.*finished/,
      );
      assert.deepEqual(record.attempts[0].diagnostics, record.diagnostics);
      assert.equal(record.attempts[0].state, record.state);
    }
    assert.equal(records[0].result.usable, true);
    assert.equal(records[1].result.usable, true);
    assert.match(records[2].diagnostics.join(" "), /result.json/);
    assert.equal(existsSync(join(f.batch, ".runner.lock.json")), false);
  }
});

test("signalling errors preserve every combination of timeout and interruption flags", async (t) => {
  for (const [timedOut, stopped, state] of [
    [false, false, "failed"],
    [false, true, "interrupted"],
    [true, true, "interrupted"],
    [true, false, "timed-out"],
  ]) {
    const f = fixture(t, [{ waitForRelease: timedOut }]);
    const unexpected = Object.assign(new Error("synthetic stop EIO"), {
      code: "EIO",
    });
    let interrupted = false;
    const code = await runBatch(
      parseArgs([
        "--batch",
        f.batch,
        "--timeout-minutes",
        timedOut ? "0.001" : "25",
      ]),
      {
        kill(pid, signal) {
          if (signal === 0) return;
          if (stopped && !interrupted) {
            interrupted = true;
            process.emit("SIGINT");
          }
          try {
            process.kill(pid, signal);
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
          throw unexpected;
        },
      },
    );
    assert.equal(code, stopped ? 130 : 1);
    const record = f.status().jobs[0];
    assert.equal(record.state, state, JSON.stringify({ timedOut, stopped }));
    assert.equal(record.attempts[0].state, state);
    assert.deepEqual(record.diagnostics, [unexpected.message]);
    assert.deepEqual(record.attempts[0].diagnostics, record.diagnostics);
    assert.equal(interrupted, stopped);
    await until(() => !processAlive(record.pid));
    assert.equal(existsSync(join(f.batch, ".runner.lock.json")), false);
  }
});

test("owned-group signal fallback notes survive the timed-out catch path", async (t) => {
  const f = fixture(t, [{ waitForRelease: true }]);
  const unexpected = Object.assign(new Error("synthetic escalation EIO"), {
    code: "EIO",
  });
  const code = await runBatch(
    parseArgs(["--batch", f.batch, "--timeout-minutes", "0.001"]),
    {
      platform: "darwin",
      kill(pid, signal) {
        if (signal === "SIGTERM")
          throw Object.assign(
            new Error(`kill ${pid < 0 ? "EPERM" : "ESRCH"}`),
            {
              code: pid < 0 ? "EPERM" : "ESRCH",
            },
          );
        try {
          process.kill(
            process.platform === "win32" ? Math.abs(pid) : pid,
            signal,
          );
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        if (signal === "SIGKILL") throw unexpected;
      },
    },
  );
  assert.equal(code, 1);
  const record = f.status().jobs[0];
  assert.ok(record.diagnostics.includes(unexpected.message));
  assert.match(record.diagnostics.join(" "), /SIGTERM.*EPERM.*leader.*ESRCH/);
  assert.equal(record.state, "timed-out");
  assert.equal(record.attempts[0].state, "timed-out");
  assert.deepEqual(record.attempts[0].diagnostics, record.diagnostics);
  await until(() => !processAlive(record.pid));
  assert.equal(existsSync(join(f.batch, ".runner.lock.json")), false);
});

test("cleanup escalation errors become failed-job diagnostics without escaping the runner", async (t) => {
  const f = fixture(t, [{}]);
  const unexpected = Object.assign(new Error("synthetic escalation EIO"), {
    code: "EIO",
  });
  const code = await runBatch(parseArgs(["--batch", f.batch]), {
    kill(pid, signal) {
      // Force final cleanup after normal completion, without either stop flag.
      if (signal === 0) return;
      if (signal === "SIGTERM") return;
      if (signal === "SIGKILL") throw unexpected;
    },
  });
  assert.equal(code, 1);
  assert.equal(f.status().jobs[0].state, "failed");
  assert.deepEqual(f.status().jobs[0].diagnostics, [unexpected.message]);
  await until(() => !processAlive(f.status().jobs[0].pid));
  assert.equal(existsSync(join(f.batch, ".runner.lock.json")), false);
});

test("argument validation and conservative rate-limit detection", () => {
  assert.equal(parseArgs(["--batch", "/tmp/test"]).timeoutMinutes, 25);
  assert.throws(() => parseArgs(["--batch", "relative"]), /absolute/);
  assert.throws(
    () => parseArgs(["--batch", "/tmp/test", "--claude", "1.5"]),
    /integer/,
  );
  assert.throws(
    () => parseArgs(["--batch", "/tmp/test", "--timeout-minutes", "0"]),
    /greater than zero/,
  );
  assert.equal(
    rateLimitDiagnostic(
      '{"type":"assistant","message":"The manual has a 429 page appendix and a quota section"}',
      "",
      0,
    ),
    null,
  );
  assert.equal(
    rateLimitDiagnostic("", "some research discusses rate limits", 0),
    null,
  );
  assert.match(
    rateLimitDiagnostic(
      '{"type":"result","is_error":true,"result":"You have reached your usage limit"}',
      "",
      0,
    ),
    /Backend error event/,
  );
  assert.match(
    rateLimitDiagnostic("", "API Error: quota exhausted", 1),
    /Backend stderr/,
  );
});

test("the latest terminal event controls failure and rate-limit classification", () => {
  const rate = { type: "error", message: "HTTP 429 rate limit exceeded" };
  const completed = { type: "turn.completed" };
  const failure = {
    type: "turn.failed",
    error: { message: "Backend request failed" },
  };
  const stream = (...events) =>
    events.map((event) => JSON.stringify(event)).join("\n");
  assert.equal(terminalOutcome(stream(rate, completed)).state, "completed");
  assert.equal(
    rateLimitDiagnostic(stream(rate, completed), "Earlier HTTP 429", 1),
    null,
  );
  assert.equal(terminalOutcome(stream(completed, failure)).state, "failed");
  assert.equal(
    rateLimitDiagnostic(stream(rate, failure), "Earlier HTTP 429", 1),
    null,
  );
  assert.match(rateLimitDiagnostic(stream(completed, rate), "", 0), /HTTP 429/);
  assert.equal(
    terminalOutcome(
      stream({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        result: "Maximum turns reached",
      }),
    ).state,
    "failed",
  );
  assert.equal(
    terminalOutcome(
      stream({
        type: "item.completed",
        item: { type: "command_execution", exit_code: 1 },
      }),
    ),
    null,
  );
});

test("strict candidate parsing enforces the complete schema and research for both decisions", async (t) => {
  const source = {
    id: "manual",
    url: "http://example.invalid/manual",
    title: "Synthetic manual",
    revision: "1",
    pages: "1",
    authority: "manufacturer",
    claims: ["Synthetic claim"],
    diagramReviewed: false,
  };
  const f = fixture(t, [
    { mode: "bare-result" },
    { mode: "duplicate-result" },
    { mode: "duplicate-type" },
    { mode: "blocked-no-research" },
    { mode: "blocked-empty-research" },
    { resultOverrides: { sources: [source] } },
    {
      resultOverrides: {
        conformance: {
          terminalKeys: ["1", "1"],
          requiredTerminalKeys: [],
          fixedLinks: [],
          renderKind: "circuit",
        },
      },
    },
    { resultOverrides: { unexpected: true } },
  ]);
  const outcome = await launch(f.batch, ["--claude", "4"]).done;
  assert.equal(outcome.code, 1, outcome.stderr);
  const records = f.status().jobs;
  assert.ok(records.every((record) => record.state === "failed"));
  assert.match(records[0].diagnostics.join(" "), /required.*summary/);
  assert.match(records[1].diagnostics.join(" "), /Duplicate object key/);
  assert.match(records[2].diagnostics.join(" "), /Duplicate object key/);
  assert.match(records[3].diagnostics.join(" "), /research.md/);
  assert.match(records[4].diagnostics.join(" "), /research.md.*empty/);
  assert.match(records[5].diagnostics.join(" "), /sources.*pattern/);
  assert.match(records[6].diagnostics.join(" "), /duplicate items/);
  assert.match(records[7].diagnostics.join(" "), /additional properties/);
});

test("exit-zero terminal errors fail while a recovered 429 permits later queued work", async (t) => {
  const f = fixture(t, [
    {
      events: [
        {
          type: "result",
          is_error: true,
          subtype: "error_max_turns",
          result: "Maximum turns reached",
        },
      ],
    },
    {
      backend: "codex",
      events: [
        { type: "error", message: "HTTP 429 rate limit exceeded" },
        { type: "turn.completed" },
      ],
    },
    { backend: "codex", events: [{ type: "turn.completed" }] },
    {
      backend: "codex",
      events: [
        { type: "turn.completed" },
        { type: "turn.failed", error: { message: "Request failed" } },
      ],
    },
  ]);
  const outcome = await launch(f.batch, ["--claude", "1", "--codex", "1"]).done;
  assert.equal(outcome.code, 1, outcome.stderr);
  assert.deepEqual(
    f.status().jobs.map((record) => record.state),
    ["failed", "completed", "completed", "failed"],
  );
  assert.deepEqual(f.status().pausedBackends, {});
  assert.ok(
    f
      .status()
      .jobs.every((record) => record.exitCode === 0 && record.result.usable),
  );
  assert.match(
    f.status().jobs[0].diagnostics.join(" "),
    /Maximum turns reached/,
  );
});

test("dry run validates jobs without starting workers or writing status", async (t) => {
  const f = fixture(t, [{}, { backend: "codex" }]);
  const outcome = await launch(f.batch, [
    "--claude",
    "6",
    "--codex",
    "6",
    "--dry-run",
  ]).done;
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.deepEqual(JSON.parse(outcome.stdout).concurrency, {
    claude: 6,
    codex: 6,
  });
  assert.equal(existsSync(f.trace), false);
  assert.equal(existsSync(join(f.batch, "status.json")), false);
  assert.equal(existsSync(join(f.batch, ".runner.lock.json")), false);
});

test("caps each backend, passes stdin, and keeps separate logs and candidate outcomes", async (t) => {
  const f = fixture(
    t,
    Array.from({ length: 9 }, (_, index) => ({
      backend: index < 5 ? "claude" : "codex",
      delay: 100,
    })),
  );
  const outcome = await launch(f.batch, ["--claude", "2", "--codex", "1"]).done;
  assert.equal(outcome.code, 0, outcome.stderr);
  const counts = { claude: 0, codex: 0 };
  const peaks = { claude: 0, codex: 0 };
  for (const event of readFileSync(f.trace, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse)) {
    counts[event.backend] += event.event === "start" ? 1 : -1;
    peaks[event.backend] = Math.max(
      peaks[event.backend],
      counts[event.backend],
    );
  }
  assert.deepEqual(peaks, { claude: 2, codex: 1 });
  assert.deepEqual(counts, { claude: 0, codex: 0 });
  const status = f.status();
  assert.equal(status.runner.state, "finished");
  assert.equal(status.automaticRetries, 0);
  for (const record of status.jobs) {
    assert.equal(record.state, "completed");
    assert.equal(record.exitCode, 0);
    assert.ok(record.pid > 0);
    assert.ok(record.startedAt && record.endedAt);
    assert.equal(record.attempts.length, 1);
    assert.match(readFileSync(record.stdoutFile, "utf8"), /"type":"progress"/);
    assert.doesNotMatch(readFileSync(record.stdoutFile, "utf8"), /diagnostic/);
    assert.match(readFileSync(record.stderrFile, "utf8"), /diagnostic/);
    assert.doesNotMatch(readFileSync(record.stderrFile, "utf8"), /progress/);
  }
});

test("process success alone is insufficient; blocked evidence is a retained result", async (t) => {
  const f = fixture(t, [
    { mode: "missing" },
    { mode: "wrong-id" },
    { mode: "blocked" },
    {},
  ]);
  const outcome = await launch(f.batch, ["--claude", "4"]).done;
  assert.equal(outcome.code, 1, outcome.stderr);
  assert.deepEqual(
    f.status().jobs.map((job) => job.state),
    ["failed", "failed", "needs-evidence", "completed"],
  );
  assert.match(f.status().jobs[0].diagnostics.join(" "), /result.json/);
  assert.match(f.status().jobs[1].diagnostics.join(" "), /sourcePartId/);
  const repeated = await launch(f.batch, ["--claude", "4", "--resume"]).done;
  assert.equal(repeated.code, 1, repeated.stderr);
  assert.deepEqual(
    f.status().jobs.map((job) => job.attempts.length),
    [2, 2, 1, 1],
  );
});

test("resume skips completed jobs and archives failed-attempt logs and files", async (t) => {
  const f = fixture(t, [{ mode: "once" }, {}, { mode: "blocked" }]);
  assert.equal((await launch(f.batch).done).code, 1);
  const rejected = await launch(f.batch).done;
  assert.equal(rejected.code, 2);
  assert.match(rejected.stderr, /--resume/);
  const second = await launch(f.batch, ["--resume"]).done;
  assert.equal(second.code, 0, second.stderr);
  const records = f.status().jobs;
  assert.deepEqual(
    records.map((job) => job.attempts.length),
    [2, 1, 1],
  );
  const firstAttempt = records[0].attempts[0];
  assert.equal(firstAttempt.state, "failed");
  assert.match(
    readFileSync(
      join(firstAttempt.archiveDirectory, "worker.stderr.log"),
      "utf8",
    ),
    /first attempt failed/,
  );
  assert.equal(
    existsSync(join(firstAttempt.archiveDirectory, "result.json")),
    true,
  );
  assert.equal((await launch(f.batch, ["--resume"]).done).code, 0);
  assert.deepEqual(
    f.status().jobs.map((job) => job.attempts.length),
    [2, 1, 1],
  );
});

test("candidate outputs require artifacts and cannot reuse an earlier attempt's files", async (t) => {
  const f = fixture(t, [{ mode: "no-artifacts" }, { mode: "missing" }]);
  writeFileSync(
    join(f.jobs[1].directory, "result.json"),
    JSON.stringify({
      format: "thermite-component-candidate/0.1",
      sourcePartId: f.jobs[1].id,
      decision: "candidate",
    }),
  );
  writeFileSync(join(f.jobs[1].directory, "type.json"), "{}");
  writeFileSync(join(f.jobs[1].directory, "research.md"), "Old evidence");
  const outcome = await launch(f.batch).done;
  assert.equal(outcome.code, 1, outcome.stderr);
  assert.deepEqual(
    f.status().jobs.map((job) => job.state),
    ["failed", "failed"],
  );
  assert.match(
    f.status().jobs[0].diagnostics.join(" "),
    /type.json.*research.md/,
  );
  assert.equal(existsSync(join(f.jobs[1].directory, "result.json")), false);
  assert.equal(readdirSync(join(f.jobs[1].directory, "attempts")).length, 1);
});

test("a missing executable becomes a failed job without blocking the rest of the queue", async (t) => {
  const f = fixture(t, [{}, {}]);
  f.jobs[0].command = [join(f.batch, "missing-executable")];
  writeFileSync(
    join(f.batch, "queue.json"),
    JSON.stringify({ format: "thermite-component-queue/0.1", jobs: f.jobs }),
  );
  const outcome = await launch(f.batch).done;
  assert.equal(outcome.code, 1, outcome.stderr);
  assert.deepEqual(
    f.status().jobs.map((job) => job.state),
    ["failed", "completed"],
  );
  assert.match(f.status().jobs[0].diagnostics.join(" "), /ENOENT/);
  assert.equal(f.status().jobs[0].exitCode, null);
});

test("rate limit pauses only the affected backend without automatically retrying", async (t) => {
  const f = fixture(t, [
    { mode: "rate" },
    {},
    { backend: "codex" },
    { backend: "codex" },
  ]);
  const outcome = await launch(f.batch, ["--claude", "1", "--codex", "1"]).done;
  assert.equal(outcome.code, 1, outcome.stderr);
  const status = f.status();
  assert.deepEqual(
    status.jobs.map((job) => job.state),
    ["rate-limited", "queued", "completed", "completed"],
  );
  assert.equal(status.jobs[0].attempts.length, 1);
  assert.equal(status.jobs[1].attempts.length, 0);
  assert.equal(status.runner.state, "paused");
  assert.equal(status.pausedBackends.claude.jobId, f.jobs[0].id);
  assert.equal(
    existsSync(join(f.jobs[1].directory, "worker.stdout.jsonl")),
    false,
  );
});

test("active runner lock rejects duplicate execution", async (t) => {
  const f = fixture(t, [{ waitForRelease: true }]);
  const first = launch(f.batch);
  t.after(() => {
    if (first.child.exitCode === null) first.child.kill("SIGTERM");
  });
  await until(() => existsSync(f.trace));
  const duplicate = await launch(f.batch, ["--resume"]).done;
  assert.equal(duplicate.code, 2);
  assert.match(duplicate.stderr, /active runner/);
  writeFileSync(join(f.jobs[0].directory, "release-worker"), "release");
  assert.equal((await first.done).code, 0);
  assert.equal(f.status().jobs[0].attempts.length, 1);
});

test("timeout records a distinct outcome and kills the worker", async (t) => {
  const f = fixture(t, [{ delay: 5000 }]);
  const outcome = await launch(f.batch, ["--timeout-minutes", "0.005"]).done;
  assert.equal(outcome.code, 1, outcome.stderr);
  const record = f.status().jobs[0];
  assert.equal(record.state, "timed-out");
  await until(() => !processAlive(record.pid));
  assert.equal(existsSync(join(f.batch, ".runner.lock.json")), false);
});

test(
  "interrupt terminates the worker process group and preserves interrupted status",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = fixture(t, [{ mode: "descendant", waitForRelease: true }, {}]);
    const running = launch(f.batch);
    t.after(() => {
      if (running.child.exitCode === null) running.child.kill("SIGTERM");
    });
    const descendantFile = join(f.jobs[0].directory, "descendant.pid");
    await until(() => existsSync(descendantFile));
    const descendant = Number(readFileSync(descendantFile, "utf8"));
    running.child.kill("SIGINT");
    const outcome = await running.done;
    assert.equal(outcome.code, 130, outcome.stderr);
    assert.deepEqual(
      f.status().jobs.map((job) => job.state),
      ["interrupted", "queued"],
    );
    await until(
      () => !processAlive(descendant) && !processAlive(f.status().jobs[0].pid),
    );
    assert.equal(existsSync(join(f.batch, ".runner.lock.json")), false);
  },
);

test(
  "resume refuses a live orphan after a runner crash",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = fixture(t, [{ waitForRelease: true }]);
    const running = launch(f.batch);
    await until(() => existsSync(f.trace));
    const pid = f.status().jobs[0].pid;
    t.after(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    });
    running.child.kill("SIGKILL");
    await running.done;
    const resumed = await launch(f.batch, ["--resume"]).done;
    assert.equal(resumed.code, 2);
    assert.match(resumed.stderr, /still has a live process/);
    assert.equal(f.status().jobs[0].attempts.length, 1);
    assert.equal(readdirSync(f.jobs[0].directory).includes("attempts"), false);
  },
);
