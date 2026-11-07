import { it, expect, vi } from "vitest";
import { normalizeTranscript } from "./transcript.mjs";
import { classifyAgent, planAttempt } from "./attempts.mjs";
import { infrastructureSignal } from "./event-errors.mjs";
import { runAttempts, runBatch } from "./run.mjs";
const classified = (rows, exit = 1) =>
  classifyAgent({ exit }, normalizeTranscript(rows));
const limit = () =>
  classified([
    { type: "turn.failed", error: { code: "usage_limit_exceeded" } },
  ]);
const complete = { status: "complete", outcome: { pass: true } };
it("the first unknown terminal cause halts dispatch and unresolved replay stays halted", async () => {
  const unknown = classified([
    { type: "result", is_error: true, subtype: "error_during_execution" },
  ]);
  for (const prior of [[], [{ ...unknown, attempt: 1 }]]) {
    const executed = [];
    const rows = await runBatch([1, 2, 3], {
      runTask: (task, control) =>
        runAttempts({
          prior,
          control,
          runAttempt: async (o) => {
            executed.push(task);
            return { ...o, ...unknown };
          },
        }),
    });
    expect(executed).toEqual(prior.length ? [] : [1]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("needs-adjudication");
  }
});

it("usage quotas halt all-tasks dispatch without consuming transient retries", async () => {
  const executed = [];
  const results = await runBatch([1, 2, 3, 4], {
    runTask: (task, control) =>
      runAttempts({
        control,
        retryDelayMs: 0,
        runAttempt: async (o) => {
          executed.push(task);
          return { ...o, ...limit() };
        },
      }),
  });
  expect(executed).toEqual([1]);
  expect(results[0].status).toBe("halted-infra");
  expect(planAttempt(results)).toMatchObject({ kind: "run", attempt: 2 });
});
it("saved billing halts reopen and never stop healthy siblings on resume", async () => {
  const prior = [
    {
      attempt: 1,
      status: "infrastructure-failure",
      infrastructureKind: "billing",
    },
  ];
  const started = [];
  const results = await runBatch([1, 2, 3], {
    concurrency: 2,
    runTask: (task, control) =>
      runAttempts({
        prior: task === 1 ? prior : [],
        control,
        retryDelayMs: 0,
        runAttempt: async (o) => {
          started.push(task);
          return { ...o, ...complete };
        },
      }),
  });
  expect(started.sort()).toEqual([1, 2, 3]);
  expect(results.every((r) => r.status === "complete")).toBe(true);
});
it("billing at concurrency two drains its sibling and starts nothing else", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const started = [],
    finished = [];
  const pending = runBatch([1, 2, 3], {
    concurrency: 2,
    runTask: async (task) => {
      started.push(task);
      if (task === 1) {
        await gate;
        return { status: "halted-infra", infrastructureKind: "billing" };
      }
      release();
      await new Promise((r) => setTimeout(r, 5));
      finished.push(task);
      return { ...complete, task };
    },
  });
  const results = await pending;
  expect(started).toEqual([1, 2]);
  expect(finished).toEqual([2]);
  expect(results).toHaveLength(2);
});
it("operator reopen resets exhausted counters and leaves old evidence intact", async () => {
  const prior = [1, 2, 3].map((attempt) => ({
    attempt,
    status: "infrastructure-failure",
    infrastructureKind: "rate-limit",
  }));
  const before = JSON.stringify(prior),
    seen = [];
  const result = await runAttempts({
    prior,
    reopenInfra: "all",
    retryDelayMs: 0,
    runAttempt: async (o) => {
      seen.push(o);
      return { ...o, ...complete };
    },
  });
  expect(seen).toHaveLength(1);
  expect(result.attempt).toBe(4);
  expect(result.reopenInfra).toMatchObject({
    request: "all",
    previousAutomaticFailures: 3,
  });
  expect(JSON.stringify(prior)).toBe(before);
});
it("reset and retry-after drive transient backoff; distant resets halt as quota", async () => {
  const now = 1700000000000;
  for (const detail of [
    { retry_after: 8 },
    { headers: { "retry-after": "8" } },
    { resetsAt: now / 1000 + 8 },
  ]) {
    const n = normalizeTranscript(
      [
        {
          type: "turn.failed",
          error: { code: "rate_limit_exceeded", ...detail },
        },
      ],
      { now },
    );
    expect(n.retryAt).toBe(now + 8000);
    expect(n.infrastructureKind).toBe("rate-limit");
    const waits = [];
    await runAttempts({
      prior: [
        {
          attempt: 1,
          status: "infrastructure-failure",
          infrastructureKind: "rate-limit",
          retryAt: n.retryAt,
        },
      ],
      now: () => now,
      wait: async (ms) => waits.push(ms),
      runAttempt: async (o) => ({ ...o, ...complete }),
    });
    expect(waits).toEqual([8000]);
  }
  expect(
    normalizeTranscript(
      [
        {
          type: "turn.failed",
          error: { code: "rate_limit_exceeded", retry_after: 901 },
        },
      ],
      { now },
    ).infrastructureKind,
  ).toBe("quota");
  expect(
    classified([
      { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
    ]).status,
  ).toBe("halted-infra");
});
it("recovered rate limits cannot replace a terminal max-turns failure", () => {
  const rows = [
    { type: "assistant", error: "rate_limit", message: { content: [] } },
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "Continuing" }] },
    },
    {
      type: "result",
      is_error: true,
      subtype: "error_max_turns",
      errors: ["Reached max turns"],
    },
  ];
  const n = normalizeTranscript(rows);
  expect(classifyAgent({ exit: 1 }, n)).toMatchObject({
    status: "complete",
    taskFailure: true,
  });
  expect(n.infrastructureError).toBeNull();
  expect(n.retryCount).toBe(1);
});
it("completed deliverables survive a nonzero shutdown exit as a warning", () => {
  expect(
    classified([{ type: "result", subtype: "success", result: "Done" }]),
  ).toMatchObject({
    status: "complete",
    taskFailure: false,
    exitAfterCompletion: true,
    warnings: [{ code: "exit-after-completion", exit: 1 }],
  });
});
it("invalid requests are infra only with structured model/auth subtypes", () => {
  for (const error of [
    { type: "invalid_request_error", code: "context_length_exceeded" },
    {
      type: "invalid_request_error",
      message: "model not found; authentication failed",
    },
    { type: "invalid_request_error" },
  ])
    expect(infrastructureSignal(error)).toBeNull();
  for (const error of [
    { type: "invalid_request_error", code: "model_not_found" },
    { type: "invalid_request_error", param: "model" },
  ])
    expect(infrastructureSignal(error)?.kind).toBe("configuration");
});
it("refused rechecks print the task and reason to stderr", async () => {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await runBatch(["T01"], {
      runTask: async () => {
        throw new Error("Task directory changed; use --force-recheck");
      },
    });
    expect(spy.mock.calls.flat().join("")).toMatch(
      /T01: checker-error: Task directory changed/,
    );
  } finally {
    spy.mockRestore();
  }
});

it("a reopened budget caps again, and resumed halts do not spend it", async () => {
  const old = [1, 2, 3].map((attempt) => ({
    attempt,
    status: "infrastructure-failure",
    infrastructureKind: "rate-limit",
  }));
  const seen = [];
  const exhausted = await runAttempts({
    prior: old,
    reopenInfra: "one-key",
    retryDelayMs: 0,
    runAttempt: async (o) => {
      const r = {
        ...o,
        status: "infrastructure-failure",
        infrastructureKind: "rate-limit",
      };
      seen.push(r);
      return r;
    },
  });
  expect(seen.map((r) => r.attempt)).toEqual([4, 5, 6]);
  expect(exhausted.retryExhausted).toBe(true);
  expect(seen.filter((r) => r.reopenInfra)).toHaveLength(1);
  expect(planAttempt([...old, ...seen]).kind).toBe("exhausted");
  const halted = [
    ...old.slice(0, 2),
    { attempt: 3, status: "halted-infra", infrastructureKind: "quota" },
  ];
  expect(planAttempt(halted)).toMatchObject({
    kind: "run",
    attempt: 4,
    reopenedHalt: true,
  });
  const calls = [];
  await runAttempts({
    prior: halted,
    retryDelayMs: 0,
    runAttempt: async (o) => {
      calls.push(o);
      return {
        ...o,
        status: "infrastructure-failure",
        infrastructureKind: "rate-limit",
      };
    },
  });
  expect(calls).toHaveLength(1);
});
it("terminal context errors override generic provider wrappers and recovered retries", () => {
  for (const error of [
    { type: "api_error", error: { code: "context_length_exceeded" } },
    { type: "invalid_request_error", codexErrorInfo: "contextWindowExceeded" },
  ]) {
    const n = normalizeTranscript([
      { type: "assistant", error: "rate_limit", message: { content: [] } },
      {
        type: "result",
        is_error: true,
        subtype: "error_during_execution",
        error,
      },
    ]);
    expect(classifyAgent({ exit: 1 }, n)).toMatchObject({
      status: "complete",
      taskFailure: true,
    });
  }
});
it("backoff doubles without hints and accepts dated and millisecond hints", async () => {
  const waits = [],
    seen = [];
  await runAttempts({
    wait: async (ms) => waits.push(ms),
    runAttempt: async (o) => {
      seen.push(o);
      return {
        ...o,
        status: "infrastructure-failure",
        infrastructureKind: "rate-limit",
      };
    },
  });
  expect(waits).toEqual([5000, 10000]);
  expect(seen).toHaveLength(3);
  const now = 1700000000000;
  for (const fields of [
    { retryAfterMs: 8000 },
    { reset_at: new Date(now + 8000).toISOString() },
    { headers: { "retry-after": new Date(now + 8000).toUTCString() } },
    { headers: { "x-ratelimit-reset-tokens": "8s" } },
  ]) {
    expect(
      normalizeTranscript(
        [
          {
            type: "turn.failed",
            error: { code: "rate_limit_exceeded", ...fields },
          },
        ],
        { now },
      ).retryAt,
    ).toBe(now + 8000);
  }
  expect(
    normalizeTranscript(
      [
        {
          type: "turn.failed",
          error: { code: "rate_limit_exceeded", retry_after: 900 },
        },
      ],
      { now },
    ).infrastructureKind,
  ).toBe("rate-limit");
});
it("retry metadata is honored on outer protocol envelopes", () => {
  const now = 1700000000000;
  for (const row of [
    { type: "error", code: "rate_limit_exceeded", retry_after: 8 },
    {
      type: "turn.failed",
      error: { code: "rate_limit_exceeded" },
      retry_after: 8,
    },
    {
      type: "assistant",
      error: "rate_limit",
      retry_after: 8,
      message: { content: [] },
    },
  ])
    expect(normalizeTranscript([row], { now })).toMatchObject({
      infrastructureKind: "rate-limit",
      retryAt: now + 8000,
    });
});
