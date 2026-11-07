import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs, rateLimitDiagnostic, terminalOutcome } from "./run.mjs";

const runner = join(dirname(fileURLToPath(import.meta.url)), "run.mjs");
const fakeSource = `
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
const config = JSON.parse(process.argv[2]);
const candidate = {format:'thermite-component-candidate/0.1', sourcePartId:config.mode === 'wrong-id' ? 'different' : config.id, decision:config.mode.startsWith('blocked') ? 'needs-evidence' : 'candidate', summary:'Synthetic local test', sources:[], unresolved:[], conformance:null, ...config.resultOverrides};
const prompt = readFileSync(0, 'utf8');
if (prompt !== 'Research ' + config.id + '\\n') throw new Error('Prompt stdin mismatch');
const trace = (event) => appendFileSync(config.trace, JSON.stringify({event, id:config.id, backend:config.backend, pid:process.pid}) + '\\n');
trace('start');
console.log(JSON.stringify({type:'progress', message:config.id}));
console.error('diagnostic for ' + config.id);
if (config.mode === 'descendant') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
  writeFileSync('descendant.pid', String(child.pid));
}
await new Promise(resolve => setTimeout(resolve, config.delay ?? 60));
while (config.waitForRelease && !existsSync('release-worker')) {
  await new Promise(resolve => setTimeout(resolve, 20));
}
if (config.mode === 'rate') {
  console.log(JSON.stringify({type:'turn.failed', error:{message:'HTTP 429 rate limit exceeded'}}));
  trace('end');
  process.exit(1);
}
if (config.mode === 'once' && !existsSync('first-attempt')) {
  writeFileSync('first-attempt', 'yes');
  writeFileSync('result.json', JSON.stringify({format:'thermite-component-candidate/0.1', sourcePartId:config.id, decision:'candidate'}));
  console.error('first attempt failed');
  trace('end');
  process.exit(1);
}
if (config.mode !== 'missing') {
  writeFileSync('result.json', config.mode === 'duplicate-result' ? JSON.stringify(candidate).replace('{', '{"summary":"duplicate",') : config.mode === 'bare-result' ? JSON.stringify({format:candidate.format, sourcePartId:candidate.sourcePartId, decision:candidate.decision}) : JSON.stringify(candidate));
  if (!config.mode.startsWith('blocked') && config.mode !== 'no-artifacts') {
    writeFileSync('type.json', config.mode === 'duplicate-type' ? '{"id":"first","id":"second"}' : JSON.stringify({format:'synthetic-test-only', id:config.id}));
  }
  if (config.mode !== 'no-artifacts' && config.mode !== 'blocked-no-research') {
    writeFileSync('research.md', config.mode === 'blocked-empty-research' ? '  \\n' : 'Synthetic evidence for ' + config.id + '\\n');
  }
}
for (const event of config.events ?? []) console.log(JSON.stringify(event));
trace('end');
`;

function fixture(t, definitions) {
  const batch = mkdtempSync(join(tmpdir(), "thermite-batch-test-"));
  const fake = join(batch, "fake.mjs");
  const trace = join(batch, "trace.jsonl");
  writeFileSync(fake, fakeSource);
  const jobs = definitions.map((definition, index) => {
    const config = {
      id: `part-${index}`,
      backend: "claude",
      mode: "candidate",
      ...definition,
      trace,
    };
    const directory = join(batch, config.id);
    mkdirSync(directory);
    const promptFile = join(directory, "prompt.txt");
    writeFileSync(promptFile, `Research ${config.id}\n`);
    return {
      id: config.id,
      backend: config.backend,
      directory,
      promptFile,
      command: [process.execPath, fake, JSON.stringify(config)],
    };
  });
  writeFileSync(
    join(batch, "queue.json"),
    JSON.stringify({ format: "thermite-component-queue/0.1", jobs }),
  );
  t.after(() => rmSync(batch, { recursive: true, force: true }));
  return {
    batch,
    jobs,
    trace,
    status: () => JSON.parse(readFileSync(join(batch, "status.json"), "utf8")),
  };
}

function launch(batch, args = []) {
  const child = spawn(process.execPath, [runner, "--batch", batch, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  return { child, done };
}

async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail("Timed out waiting for local test process");
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

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
  const f = fixture(t, [{ delay: 600 }]);
  const first = launch(f.batch);
  t.after(() => {
    if (first.child.exitCode === null) first.child.kill("SIGTERM");
  });
  await until(() => existsSync(f.trace));
  const duplicate = await launch(f.batch, ["--resume"]).done;
  assert.equal(duplicate.code, 2);
  assert.match(duplicate.stderr, /active runner/);
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
    const f = fixture(t, [{ mode: "descendant", delay: 10_000 }, {}]);
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
    const f = fixture(t, [{ delay: 10_000 }]);
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

test("live limits keep a zero-capacity queue alive and activate it after a valid edit", async (t) => {
  const f = fixture(t, [{ delay: 120 }, { delay: 120 }]);
  const limitsFile = join(f.batch, "limits.json");
  writeFileSync(limitsFile, JSON.stringify({ claude: 0, codex: 0 }));
  const running = launch(f.batch, [
    "--claude",
    "0",
    "--codex",
    "0",
    "--limits-file",
    limitsFile,
  ]);
  t.after(() => {
    if (running.child.exitCode === null) running.child.kill("SIGTERM");
  });
  await until(() => existsSync(join(f.batch, "status.json")));
  assert.equal(running.child.exitCode, null);
  assert.equal(existsSync(f.trace), false);
  writeFileSync(limitsFile, "{");
  await until(() => Boolean(f.status().limitsFile.warning));
  assert.deepEqual(f.status().concurrency, { claude: 0, codex: 0 });
  assert.equal(existsSync(f.trace), false);
  writeFileSync(limitsFile, JSON.stringify({ claude: 1, codex: 0 }));
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
  const f = fixture(t, [{ delay: 1100 }, { delay: 1700 }, {}, {}]);
  const limitsFile = join(f.batch, "limits.json");
  writeFileSync(limitsFile, JSON.stringify({ claude: 2, codex: 0 }));
  const running = launch(f.batch, ["--limits-file", limitsFile]);
  t.after(() => {
    if (running.child.exitCode === null) running.child.kill("SIGTERM");
  });
  await until(
    () =>
      existsSync(f.trace) &&
      readFileSync(f.trace, "utf8").trim().split("\n").length === 2,
  );
  writeFileSync(limitsFile, JSON.stringify({ claude: 1, codex: 0 }));
  await until(() => f.status().concurrency.claude === 1);
  writeFileSync(limitsFile, JSON.stringify({ claude: -1, codex: 3 }));
  await until(() => Boolean(f.status().limitsFile.warning));
  assert.deepEqual(f.status().concurrency, { claude: 1, codex: 0 });
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
    outcome.stderr.split("Ignoring invalid limits file").length - 1,
    1,
  );
});

test("raising live limits cannot clear a backend rate-limit pause", async (t) => {
  const f = fixture(t, [
    { mode: "rate" },
    {},
    { backend: "codex", waitForRelease: true },
  ]);
  const limitsFile = join(f.batch, "limits.json");
  writeFileSync(limitsFile, JSON.stringify({ claude: 1, codex: 1 }));
  const running = launch(f.batch, ["--limits-file", limitsFile]);
  t.after(() => {
    if (running.child.exitCode === null) running.child.kill("SIGTERM");
  });
  await until(
    () =>
      existsSync(join(f.batch, "status.json")) &&
      Boolean(f.status().pausedBackends.claude),
  );
  writeFileSync(limitsFile, JSON.stringify({ claude: 6, codex: 6 }));
  await until(() => f.status().concurrency.claude === 6);
  assert.equal(f.status().jobs[1].state, "queued");
  writeFileSync(join(f.jobs[2].directory, "release-worker"), "release");
  const outcome = await running.done;
  assert.equal(outcome.code, 1, outcome.stderr);
  assert.equal(f.status().jobs[1].attempts.length, 0);
  assert.equal(f.status().runner.state, "paused");
});
