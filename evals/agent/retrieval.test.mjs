import { expect, it } from "vitest";
import { score } from "./score-log.mjs";

const calls = (...rows) =>
  rows.map((row) => ({ exit: 0, phase: "agent", ...row }));
const guide = (...args) => ({ argv: ["guide", ...args] });
const packet = (
  views = [{ format: "documentation-view-request/0.1", kind: "index" }],
) => ({
  argv: ["packet", "--input", "packet.request.json", "-o", "packet.pdf"],
  request: JSON.stringify({ format: "schematic-packet-request/0.1", views }),
});
const required = (
  before,
  topic = "views",
  equivalents = ["project-workflows"],
) => [{ topic, before, beforeCommand: "packet", equivalents }];
const get = (rows, before = "packet") =>
  score({ calls: calls(...rows), requiredTopics: required(before) })
    .retrieval[0];

it("ignores packet help and probes and credits a declared successful equivalent", () => {
  const row = get([
    { argv: ["packet", "--help"] },
    { argv: ["packet", "--input", "bad.json"], exit: 2 },
    { argv: ["packet"] },
    guide("project-workflows"),
    packet(),
  ]);
  expect(row).toMatchObject({
    retrieved: true,
    legacy: false,
    cutoffAt: 4,
    readAt: 3,
    via: "project-workflows",
  });
});

it("rejects late, failed, help-only and undeclared topic reads", () => {
  for (const rows of [
    [packet(), guide("project-workflows")],
    [{ ...guide("project-workflows"), exit: 1 }, packet()],
    [guide("project-workflows", "--help"), packet()],
    [guide("modeling"), packet()],
    [guide("project-workflows"), { argv: ["packet", "--help"] }],
  ])
    expect(get(rows).retrieved).toBe(false);
});

it("observes a source edit already made before a guide call", () => {
  const snap = {
    files: { "source.json": "sha256-old" },
    documents: {
      "system.json": { sources: ["source.json"] },
    },
    sourceFiles: ["source.json"],
  };
  const row = get(
    [
      {
        ...guide("project-workflows"),
        before: snap,
        directEditsSincePrevious: [{ path: "source.json", change: "modified" }],
      },
    ],
    "source-change",
  );
  expect(row).toMatchObject({ readAt: 0, cutoffAt: 0, retrieved: false });
});

it("uses the hookup action when drawn and marks a verified draft-only branch", () => {
  const requiredTopics = required("hookup", "views", ["signal-loops"]);
  const final = { files: { "issue.md": "sha256-draft" } };
  const read = guide("signal-loops");
  const hookup = packet([{ format: "signal-loop-view-request/0.1" }]);
  expect(
    score({ final, requiredTopics, calls: calls(read, packet(), hookup) })
      .retrieval[0],
  ).toMatchObject({ retrieved: true, applicability: "required", cutoffAt: 2 });
  expect(
    score({
      final,
      requiredTopics,
      calls: calls(read, packet()),
      taskOutcome: { checks: { issueOrHookup: true } },
    }).retrieval[0],
  ).toMatchObject({ retrieved: false, applicability: "draft-only" });
  expect(
    score({ final, requiredTopics, calls: calls(read) }).retrieval[0],
  ).toMatchObject({ retrieved: false, applicability: "required" });
});
