import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { normalizeTranscript } from "./transcript.mjs";
import { classifyAgent, automaticInfra } from "./attempts.mjs";
import { sha256 } from "./snapshot.mjs";
it("every versioned fixture retains its declared provenance hash", () => {
  const root = new URL("./fixtures/cli/", import.meta.url);
  const provenance = JSON.parse(
    readFileSync(new URL("provenance.json", root), "utf8"),
  );
  for (const entry of provenance.cases)
    expect(sha256(readFileSync(new URL(entry.file, root)))).toBe(entry.sha256);
  expect(provenance.claudeOAuthVerified).toBe(false);
});
const codex = new URL("./fixtures/cli/codex-0.164.0/", import.meta.url);
for (const file of readdirSync(codex).filter((f) => f.endsWith(".jsonl"))) {
  it(`captured Codex terminal template: ${file}`, () => {
    const n = normalizeTranscript(readFileSync(new URL(file, codex), "utf8"), {
      agent: "codex",
      cliVersion: "codex-cli 0.164.0",
    });
    const r = classifyAgent({ exit: 1 }, n);
    if (file === "content-filter.jsonl")
      expect(r).toMatchObject({ status: "complete", taskFailure: true });
    else {
      const kind = file.startsWith("usage")
        ? "quota"
        : file.startsWith("insufficient")
          ? "billing"
          : file.startsWith("rate")
            ? "rate-limit"
            : "network";
      expect(r).toMatchObject({
        status: ["quota", "billing"].includes(kind)
          ? "halted-infra"
          : "infrastructure-failure",
        infrastructureKind: kind,
      });
      expect(n.terminalTemplate).toBeTruthy();
    }
  });
}
it("unpinned or altered terminal sentences require adjudication; agent content is never matched", () => {
  const text = readFileSync(new URL("insufficient_quota.jsonl", codex), "utf8");
  for (const cliVersion of [
    undefined,
    "codex-cli 0.165.0",
    "codex-cli 0.164.0-stub",
  ]) {
    expect(
      classifyAgent(
        { exit: 1 },
        normalizeTranscript(text, { agent: "codex", cliVersion }),
      ).status,
    ).toBe("needs-adjudication");
  }
  const rows = JSON.parse(text.trim().split("\n").at(-1));
  rows.error.message += " Additional content";
  expect(
    classifyAgent(
      { exit: 1 },
      normalizeTranscript([rows], {
        agent: "codex",
        cliVersion: "codex-cli 0.164.0",
      }),
    ).status,
  ).toBe("needs-adjudication");
  const n = normalizeTranscript(
    [
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Quota exceeded. Check your plan and billing details.",
        },
      },
      { type: "turn.completed" },
    ],
    { agent: "codex", cliVersion: "codex-cli 0.164.0" },
  );
  expect(n.infrastructureError).toBeNull();
  expect(n.terminalTemplate).toBeNull();
});
for (const [file, halt] of [
  ["overloaded", false],
  ["account_on_hold", true],
  ["oauth_org_not_allowed", true],
  ["verification_required", true],
  ["cloud_credential_error", true],
  ["server-overload", false],
])
  it(`Claude enum/envelope ${file}`, () => {
    const n = normalizeTranscript(
      readFileSync(
        new URL(`./fixtures/cli/claude-2.1.280/${file}.jsonl`, import.meta.url),
        "utf8",
      ),
      { agent: "claude", cliVersion: "2.1.280 (Claude Code)" },
    );
    const r = classifyAgent({ exit: 1 }, n);
    expect(r.status).toBe(halt ? "halted-infra" : "infrastructure-failure");
    if (!halt) expect(automaticInfra(r)).toBe(true);
  });
it("Claude keeps the strongest pending cause and latest reset until progress", () => {
  const now = 1700000000000;
  const rows = [
    {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: now / 1000 + 10800 },
    },
    { type: "assistant", error: "rate_limit", message: { content: [] } },
    { type: "result", is_error: true, subtype: "error_during_execution" },
  ];
  expect(normalizeTranscript(rows, { now })).toMatchObject({
    infrastructureKind: "quota",
    retryAt: now + 10800000,
  });
  const withBilling = [
    { type: "assistant", error: "billing_error", message: { content: [] } },
    ...rows,
  ];
  expect(normalizeTranscript(withBilling, { now })).toMatchObject({
    infrastructureKind: "billing",
    retryAt: now + 10800000,
  });
  for (const using of [
    { isUsingOverage: true },
    { overageInUse: true },
    { overageStatus: "allowed" },
  ]) {
    const result = normalizeTranscript([
      {
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", ...using },
      },
      { type: "result", is_error: true, subtype: "error_max_turns" },
    ]);
    expect(classifyAgent({ exit: 1 }, result)).toMatchObject({
      status: "complete",
      taskFailure: true,
    });
  }
});

it("a structured terminal infra result cannot weaken a pending quota or billing cause", () => {
  const now = 1700000000000;
  for (const billing of [false, true]) {
    const n = normalizeTranscript(
      [
        ...(billing ? [{ type: "assistant", error: "billing_error" }] : []),
        {
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected", resetsAt: now / 1000 + 10800 },
        },
        {
          type: "result",
          is_error: true,
          subtype: "error_during_execution",
          error: { code: "rate_limit", retry_after: 60 },
        },
      ],
      { now },
    );
    expect(n.infrastructureKind).toBe(billing ? "billing" : "quota");
    expect(n.retryAt).toBe(now + 10800000);
  }
});

it("switching to accepted overage resolves a preceding quota before an agent failure", () => {
  const n = normalizeTranscript([
    { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
    {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        isUsingOverage: true,
        overageStatus: "allowed",
      },
    },
    { type: "result", is_error: true, subtype: "error_max_turns" },
  ]);
  expect(classifyAgent({ exit: 1 }, n)).toMatchObject({
    status: "complete",
    taskFailure: true,
  });
  expect(n.infrastructureError).toBeNull();
});

it("a final newline is not part of the captured template", () => {
  const row = {
    type: "turn.failed",
    error: {
      message: "Quota exceeded. Check your plan and billing details.\n",
    },
  };
  expect(
    classifyAgent(
      { exit: 1 },
      normalizeTranscript([row], {
        agent: "codex",
        cliVersion: "codex-cli 0.164.0",
      }),
    ).status,
  ).toBe("needs-adjudication");
});

it("schema-derived Claude quota/overage sequence fixtures retain their intended terminal cause", () => {
  for (const name of ["quota-sequence", "overage-sequence"]) {
    const n = normalizeTranscript(
      readFileSync(
        new URL(`./fixtures/cli/claude-2.1.280/${name}.jsonl`, import.meta.url),
        "utf8",
      ),
    );
    const r = classifyAgent({ exit: 1 }, n);
    expect(r.status).toBe(
      name === "quota-sequence" ? "halted-infra" : "complete",
    );
    expect(name === "quota-sequence" ? n.retryAt : r.taskFailure).toBe(
      name === "quota-sequence" ? 4102444800000 : true,
    );
  }
});
it("an unknown Claude error is not turned into a known agent outcome by its generic wrapper", () => {
  const n = normalizeTranscript([
    { type: "assistant", error: "unknown", message: { content: [] } },
    {
      type: "result",
      is_error: true,
      subtype: "error_during_execution",
      errors: ["Request stopped"],
    },
  ]);
  expect(classifyAgent({ exit: 1 }, n).status).toBe("needs-adjudication");
});
for (const subtype of ["success", "error_during_execution"]) {
  it(`bare Claude ${subtype}/is_error stays unscored, before or after progress`, () => {
    const wrapper = {
      type: "result",
      subtype,
      is_error: true,
      terminal_reason: "turn_setup_failed",
      errors: ["queryParams builder failed: synthetic startup failure"],
    };
    const progress = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Working" }] },
    };
    for (const rows of [
      [wrapper],
      [progress, wrapper],
      [{ type: "assistant", error: "invalid_request" }, progress, wrapper],
    ])
      expect(
        classifyAgent({ exit: 1 }, normalizeTranscript(rows)),
      ).toMatchObject({
        status: "needs-adjudication",
        taskFailure: false,
        haltBatch: true,
      });
  });
  it(`typed Claude invalid_request decides on either side of ${subtype}/is_error`, () => {
    const typed = {
      type: "assistant",
      error: "invalid_request",
      message: { content: [] },
    };
    const wrapper = {
      type: "result",
      subtype,
      is_error: true,
      errors: ["Request stopped"],
    };
    for (const rows of [
      [typed, wrapper],
      [wrapper, typed],
    ])
      expect(
        classifyAgent({ exit: 1 }, normalizeTranscript(rows)),
      ).toMatchObject({ status: "complete", taskFailure: true });
  });
}
it("a structured retry notice cannot classify a novel Codex terminal sentence", () => {
  const n = normalizeTranscript(
    [
      { type: "error", error: { code: "rate_limit_exceeded" } },
      {
        type: "turn.failed",
        error: { message: "A novel CLI terminal failure" },
      },
    ],
    { agent: "codex", cliVersion: "codex-cli 0.164.0" },
  );
  expect(classifyAgent({ exit: 1 }, n).status).toBe("needs-adjudication");
  expect(n.infrastructureError).toBeNull();
});
it("progress after an error result clears its terminal flag before a later CLI crash", () => {
  const n = normalizeTranscript([
    { type: "result", is_error: true, subtype: "error_during_execution" },
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "Recovered; continuing" }] },
    },
  ]);
  expect(classifyAgent({ exit: 2 }, n)).toMatchObject({
    status: "infrastructure-failure",
    infrastructureKind: "unstructured-exit",
  });
});
it("the known invalid_request enum survives a generic result wrapper", () => {
  const n = normalizeTranscript(
    readFileSync(
      new URL(
        "./fixtures/cli/claude-2.1.280/invalid_request-enum.jsonl",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(classifyAgent({ exit: 1 }, n)).toMatchObject({
    status: "complete",
    taskFailure: true,
  });
});
it("the real local HTTP 400 unknown envelope remains unscored", () => {
  const n = normalizeTranscript(
    readFileSync(
      new URL(
        "./fixtures/cli/claude-2.1.280/unknown-400.jsonl",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(classifyAgent({ exit: 1 }, n).status).toBe("needs-adjudication");
});
