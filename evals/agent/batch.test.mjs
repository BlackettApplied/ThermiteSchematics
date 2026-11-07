import { it, expect } from "vitest";
import { runBatch, runAttempts } from "./run.mjs";
import { classifyAgent, selectAttempts, planAttempt } from "./attempts.mjs";
import { normalizeTranscript } from "./transcript.mjs";
import { evaluateChecker, CheckerInfrastructureError } from "./checker.mjs";
it("output exceptions are task failures; explicit checker infrastructure faults are retryable", async () => {
  expect(
    await evaluateChecker(() => {
      throw new TypeError("missing packet");
    }, {}),
  ).toMatchObject({
    pass: false,
    error: { kind: "task-failure", message: "missing packet" },
  });
  expect(
    await evaluateChecker(() => {
      throw new CheckerInfrastructureError("missing renderer installation");
    }, {}),
  ).toMatchObject({ pass: false, error: { kind: "checker-error" } });
  for (const error of [
    { type: "authentication_error" },
    { code: "stream_disconnected" },
    { status: 429 },
    { status: 429, type: "api_error" },
  ])
    expect(
      classifyAgent(
        { exit: 1 },
        normalizeTranscript([{ type: "turn.failed", error }]),
      ).status,
    ).toBe("infrastructure-failure");
});
it("first complete attempt counts even after a forced successful rerun", () => {
  const first = {
    task: "T05",
    context: "runtime",
    agent: "reference",
    arm: "A",
    seed: 1,
    attempt: 1,
    status: "complete",
    outcome: { pass: false },
  };
  const r = selectAttempts([
    first,
    { ...first, attempt: 2, outcome: { pass: true }, forceRerun: true },
  ]);
  expect(r.selected[0].outcome.pass).toBe(false);
  expect(planAttempt([first]).kind).toBe("skip");
  expect(planAttempt([first], true)).toMatchObject({
    kind: "run",
    attempt: 2,
    forceRerun: true,
  });
  expect(planAttempt([{ ...first, status: "checker-error" }])).toMatchObject({
    kind: "recheck",
    attempt: 1,
  });
});
it("domain error text never becomes an infrastructure signal", () => {
  const n = normalizeTranscript([
    {
      type: "result",
      is_error: true,
      subtype: "error_during_execution",
      result:
        "Could not finish the connection review: network output missing, HTTP 401 in source notes",
    },
  ]);
  expect(classifyAgent({ exit: 1 }, n)).toMatchObject({
    status: "needs-adjudication",
    taskFailure: false,
  });
  expect(n.infrastructureError).toBeNull();
});
it("completion after a transient row is decided by the checker", () => {
  for (const rows of [
    [
      { type: "error", message: "Reconnecting... 1/5 (stream disconnected)" },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ],
    [
      { type: "assistant", error: "rate_limit", message: { content: [] } },
      { type: "result", subtype: "success", is_error: false, result: "OK" },
    ],
  ]) {
    const n = normalizeTranscript(rows);
    expect(classifyAgent({ exit: 0 }, n)).toMatchObject({
      status: "complete",
      taskFailure: false,
    });
    expect(n.retryCount).toBe(1);
  }
});
it("automatic infra retries are capped across resumes and a recovered run completes", async () => {
  for (const kind of ["rate-limit", "unstructured-exit"]) {
    const seen = [];
    const result = await runAttempts({
      retryDelayMs: 0,
      runAttempt: async (o) => {
        const r = {
          ...o,
          status: "infrastructure-failure",
          infrastructureKind: kind,
          outcome: { pass: false },
        };
        seen.push(r);
        return r;
      },
    });
    expect(seen.map((r) => r.attempt)).toEqual([1, 2, 3]);
    expect(result.retryExhausted).toBe(true);
    let calls = 0;
    await runAttempts({
      prior: seen,
      retryDelayMs: 0,
      runAttempt: () => {
        calls++;
      },
    });
    expect(calls).toBe(0);
  }
  const seen = [];
  const result = await runAttempts({
    retryDelayMs: 0,
    runAttempt: async (o) => {
      seen.push(o);
      return {
        ...o,
        status: o.attempt === 1 ? "infrastructure-failure" : "complete",
        infrastructureKind: o.attempt === 1 ? "rate-limit" : null,
        outcome: { pass: o.attempt > 1 },
      };
    },
  });
  expect(seen).toHaveLength(2);
  expect(seen[1].automaticRetry).toBe(true);
  expect(result.outcome.pass).toBe(true);
});
it("billing never retries and stops dispatching the batch", async () => {
  let calls = 0;
  const result = await runBatch([1, 2, 3], {
    concurrency: 1,
    runTask: () =>
      runAttempts({
        retryDelayMs: 0,
        runAttempt: async (o) => {
          calls++;
          return {
            ...o,
            status: "infrastructure-failure",
            infrastructureKind: "billing",
            outcome: { pass: false },
          };
        },
      }),
  });
  expect(calls).toBe(1);
  expect(result).toHaveLength(1);
  expect(planAttempt(result)).toMatchObject({
    kind: "run",
    attempt: 2,
    reopenedHalt: true,
  });
});
it("billing stops a sibling from making its pending automatic retry", async () => {
  const calls = [];
  const results = await runBatch([1, 2, 3], {
    concurrency: 2,
    runTask: (task, control) =>
      runAttempts({
        control,
        retryDelayMs: 0,
        runAttempt: async (o) => {
          calls.push(task);
          await new Promise((r) => setTimeout(r, task === 1 ? 5 : 15));
          return {
            ...o,
            status: "infrastructure-failure",
            infrastructureKind: task === 1 ? "billing" : "rate-limit",
            outcome: { pass: false },
          };
        },
      }),
  });
  expect(calls).toEqual([1, 2]);
  expect(results).toHaveLength(2);
});
it("one throwing task does not abort or abandon sibling tasks", async () => {
  let active = 0,
    max = 0,
    finished = 0;
  const result = await runBatch([1, 2, 3, 4], {
    concurrency: 2,
    runTask: async (task) => {
      active++;
      max = Math.max(max, active);
      try {
        await new Promise((r) => setTimeout(r, 5));
        if (task === 1) throw new Error("malformed result");
        return { task, status: "complete", outcome: { pass: true } };
      } finally {
        active--;
        finished++;
      }
    },
  });
  expect(result).toHaveLength(4);
  expect(finished).toBe(4);
  expect(active).toBe(0);
  expect(max).toBe(2);
  expect(result.find((r) => r.task === 1).status).toBe("checker-error");
});
it("agent error results and timeouts are task failures, API and CLI crashes are infrastructure", () => {
  expect(classifyAgent({ exit: 1 }, { agentError: true })).toMatchObject({
    status: "complete",
    taskFailure: true,
  });
  expect(classifyAgent({ exit: null, timedOut: true }, {})).toMatchObject({
    status: "complete",
    taskFailure: true,
  });
  expect(
    classifyAgent({ exit: 1 }, { infrastructureError: "network" }).status,
  ).toBe("infrastructure-failure");
  expect(classifyAgent({ exit: null, signal: "SIGSEGV" }, {}).status).toBe(
    "infrastructure-failure",
  );
});

it("HTTP rate-limit status overrides a generic API wrapper while billing takes priority", () => {
  for (const error of [
    { status: 429, type: "api_error" },
    { message: JSON.stringify({ status: 429, error: { type: "api_error" } }) },
  ])
    expect(
      classifyAgent(
        { exit: 1 },
        normalizeTranscript([{ type: "turn.failed", error }]),
      ).infrastructureKind,
    ).toBe("rate-limit");
  expect(
    classifyAgent(
      { exit: 1 },
      normalizeTranscript([
        {
          type: "turn.failed",
          error: { status: 429, type: "api_error", code: "insufficient_quota" },
        },
      ]),
    ).infrastructureKind,
  ).toBe("billing");
});

it("operator interruption takes precedence over an already completed deliverable", () => {
  const n = normalizeTranscript([{ type: "turn.completed" }]);
  expect(classifyAgent({ exit: 0, operatorSignal: "SIGINT" }, n)).toMatchObject(
    { status: "interrupted", taskFailure: false },
  );
  expect(planAttempt([{ attempt: 1, status: "interrupted" }])).toMatchObject({
    kind: "run",
    attempt: 2,
  });
  expect(classifyAgent({ exit: null, notStarted: true }, n).status).toBe(
    "not-started",
  );
});
