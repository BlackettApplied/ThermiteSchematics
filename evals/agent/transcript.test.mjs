import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeTranscript } from "./transcript.mjs";
import { score } from "./score-log.mjs";
import { classifyAgent } from "./attempts.mjs";
it("captured Codex success envelope retains terminal usage and message", () => {
  const n = normalizeTranscript(
    readFileSync(
      new URL("./fixtures/events/codex-success.jsonl", import.meta.url),
      "utf8",
    ),
  );
  expect(n.finalMessage).toBe("OK");
  expect(n.totalToolCalls).toBe(0);
  expect(n.usage).toEqual({
    inputTokens: 14355,
    cachedInputTokens: 12288,
    outputTokens: 5,
    partial: false,
  });
  expect(classifyAgent({ exit: 0 }, n)).toMatchObject({
    status: "complete",
    taskFailure: false,
  });
  expect(n.retryCount).toBe(0);
});
for (const name of [
  "codex-retry",
  "claude-rate-limit",
  "claude-rate-notification",
])
  it(`completion fixture ${name} preserves the checker outcome`, () => {
    const n = normalizeTranscript(
      readFileSync(
        new URL(`./fixtures/events/${name}.jsonl`, import.meta.url),
        "utf8",
      ),
    );
    expect(classifyAgent({ exit: 0 }, n)).toMatchObject({
      status: "complete",
      taskFailure: false,
    });
    expect(n.retryCount).toBe(name === "claude-rate-notification" ? 0 : 1);
    expect(
      score({
        transcript: readFileSync(
          new URL(`./fixtures/events/${name}.jsonl`, import.meta.url),
          "utf8",
        ),
      }).retryCount,
    ).toBe(n.retryCount);
  });
for (const [name, kind] of [
  ["claude-terminal-rate-limit", "rate-limit"],
  ["claude-terminal-billing", "billing"],
  ["codex-terminal-error", "configuration"],
])
  it(`terminal fixture ${name} stays infrastructure`, () => {
    const n = normalizeTranscript(
      readFileSync(
        new URL(`./fixtures/events/${name}.jsonl`, import.meta.url),
        "utf8",
      ),
    );
    expect(classifyAgent({ exit: 1 }, n)).toMatchObject({
      status: kind === "billing" ? "halted-infra" : "infrastructure-failure",
      infrastructureKind: kind,
    });
    expect(n.retryCount).toBe(0);
    expect(n.successfulCompletion).toBe(false);
  });
it("killed Claude usage retains latest per-message counters and marks partial", () => {
  const message = (n) => ({
    type: "assistant",
    message: {
      id: "same",
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 90,
        output_tokens: n,
      },
      content: [],
    },
  });
  const result = normalizeTranscript([message(1), message(250)]);
  expect(result.usage).toEqual({
    inputTokens: 100,
    outputTokens: 250,
    cachedInputTokens: 90,
    partial: true,
  });
});
it("result includes auxiliary models and provider-reported cost", () => {
  const r = normalizeTranscript([
    {
      type: "result",
      subtype: "success",
      result: "done",
      total_cost_usd: 1.23,
      usage: {
        input_tokens: 10,
        output_tokens: 250,
        cache_read_input_tokens: 90,
      },
      modelUsage: {
        "claude-opus-4-6": {
          inputTokens: 10,
          outputTokens: 250,
          cacheReadInputTokens: 90,
        },
        "claude-haiku-4-5": { inputTokens: 500, outputTokens: 40 },
      },
    },
  ]);
  expect(r.usage).toEqual({
    inputTokens: 600,
    outputTokens: 290,
    cachedInputTokens: 90,
    partial: false,
  });
  expect(r.reportedCostUSD).toBe(1.23);
  expect(Object.keys(r.modelUsage)).toHaveLength(2);
});
it("noisy stdout stays usable with partial usage rather than throwing", () => {
  const r = normalizeTranscript(
    '{"type":"thread.started"}\nWARNING non-JSON\n',
  );
  expect(r.parseWarnings).toHaveLength(1);
  expect(r.usage.partial).toBe(true);
});
it("guide commands piped through head count once and own notes do not count", () => {
  const call = {
    argv: ["guide", "agent-requests"],
    exit: 0,
    phase: "agent",
    stdoutBytes: 4000,
    stderrBytes: 0,
  };
  const transcript = [
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "guide",
            name: "Bash",
            input: {
              command: "bun /rt/thermite.mjs guide agent-requests | head -80",
            },
          },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "guide",
            content: "x".repeat(4000),
          },
        ],
      },
    },
  ];
  expect(score({ calls: [call], transcript }).guideBytes).toBe(4000);
});
const cases = JSON.parse(
  readFileSync(
    new URL("./fixtures/source-reads.json", import.meta.url),
    "utf8",
  ),
);
for (const c of cases)
  it(`source-read transcript: ${c.form}`, () => {
    expect(
      score({
        transcript: c.events,
        engineRoots: c.engineRoots,
        context: "runtime",
      }).sourceReads,
    ).toBe(c.expected);
    expect(
      score({
        transcript: c.events,
        engineRoots: c.engineRoots,
        context: "source",
      }).sourceReads,
    ).toBe(0);
  });

it("provider identities use structured envelopes while domain prose stays a task failure", () => {
  for (const event of [
    {
      type: "assistant",
      error: "authentication_failed",
      message: { content: [] },
    },
    {
      type: "turn.failed",
      error: {
        codex_error_info: { http_connection_failed: { http_status_code: 401 } },
        message: "opaque provider failure",
      },
    },
    { type: "error", error: { type: "rate_limit_error" } },
  ])
    expect(normalizeTranscript([event]).infrastructureError).toBeTruthy();
  expect(
    normalizeTranscript([
      {
        type: "result",
        is_error: true,
        errors: ["Network wiring review failed with a connection gap"],
        result: "Could not complete",
      },
    ]).infrastructureError,
  ).toBeNull();
});

it("successful terminal completion survives a late nonterminal error notice", () => {
  const n = normalizeTranscript([
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    { type: "error", message: "late notice" },
  ]);
  expect(classifyAgent({ exit: 0 }, n)).toMatchObject({
    status: "complete",
    taskFailure: false,
  });
  expect(n.retryCount).toBe(0);
});
it("an unstructured notice without a terminal result does not hide a CLI crash", () => {
  const n = normalizeTranscript([
    { type: "error", message: "Reconnecting... 1/5" },
  ]);
  expect(classifyAgent({ exit: 2 }, n)).toMatchObject({
    status: "infrastructure-failure",
    infrastructureKind: "unstructured-exit",
  });
});
