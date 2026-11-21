import { expect, it } from "vitest";
import { score } from "./score-log.mjs";
import { classifyToolCall } from "./github-call.mjs";
const approvedIssueLookup = (input, { search = false } = {}) =>
  classifyToolCall({ name: search ? "web_search" : "open_page", input })
    .class === "issue-lookup";
const metric = (command) =>
  score({
    engineRoots: ["/engine"],
    transcript: [
      {
        type: "item.completed",
        item: { id: "c", type: "command_execution", command, exit_code: 0 },
      },
    ],
  });
const metricQuery = (query) =>
  score({
    transcript: [
      {
        type: "item.started",
        item: { id: "s", type: "web_search", query: "" },
      },
      { type: "item.completed", item: { id: "s", type: "web_search", query } },
    ],
  });
it("keeps guide-required read-only issue context separate from source rescue", () => {
  for (const command of [
    `curl --fail 'https://api.github.com/repos/BlackettApplied/ThermiteSchematics/issues?state=open&per_page=100' -o issues.json`,
    `gh api --method GET 'repos/BlackettApplied/ThermiteSchematics/issues?state=open&per_page=100' > issues.json`,
    `gh api 'repos/3MUl0R/ThermiteSchematics/issues/367/comments'`,
  ]) {
    expect(metric(command).sourceReads, command).toBe(0);
    expect(metric(command).issueLookups).toHaveLength(1);
  }
  const transcript = [
    { type: "item.started", item: { id: "w", type: "web_search", query: "" } },
    {
      type: "item.completed",
      item: {
        id: "w",
        type: "web_search",
        action: {
          type: "open_page",
          url: "https://github.com/BlackettApplied/ThermiteSchematics/issues/367",
        },
      },
    },
  ];
  expect(score({ transcript }).sourceReads).toBe(0);
  expect(score({ transcript }).issueLookups).toHaveLength(1);
});
it("retains engine code, docs, clone/search and write-request negatives", () => {
  for (const command of [
    `curl 'https://api.github.com/repos/BlackettApplied/ThermiteSchematics/contents/packages/compiler/src/index.ts'`,
    `curl 'https://github.com/BlackettApplied/ThermiteSchematics/blob/dev/docs/modeling.md'`,
    `curl 'https://api.github.com/repos/BlackettApplied/ThermiteSchematics/issues/../contents/packages/query/src/index.ts'`,
    `gh api --method POST 'repos/BlackettApplied/ThermiteSchematics/issues'`,
    `curl -X PATCH 'https://api.github.com/repos/BlackettApplied/ThermiteSchematics/issues/367'`,
    `curl 'https://github.com/BlackettApplied/ThermiteSchematics/pull/372/files'`,
    `gh repo clone BlackettApplied/ThermiteSchematics`,
    `gh search code repo:BlackettApplied/ThermiteSchematics`,
    `gh api graphql -f 'query={repository(owner:"BlackettApplied",name:"ThermiteSchematics"){object(expression:"HEAD:packages/compiler/src/index.ts"){id}}}'`,
    `curl 'https://api.github.com/repos/BlackettApplied/ThermiteSchematics/issues' -o issues.json && cat /engine/source.ts`,
  ]) {
    expect(metric(command).sourceReads, command).toBe(1);
    expect(metric(command).issueLookups, command).toHaveLength(0);
  }
});

it("native searches distinguish issue-only context from code/repository queries", () => {
  const issue = metricQuery(
    "site:github.com/BlackettApplied/ThermiteSchematics/issues Thermite",
  );
  expect(issue.sourceReads).toBe(0);
  expect(issue.issueLookups).toHaveLength(1);
  for (const query of [
    "site:github.com/BlackettApplied/ThermiteSchematics/packages/compiler compileProject",
    "repo:BlackettApplied/ThermiteSchematics compileProject",
    "site:github.com/BlackettApplied/ThermiteSchematics/issues OR site:github.com/BlackettApplied/ThermiteSchematics/packages/compiler",
  ])
    expect(metricQuery(query).sourceReads, query).toBe(1);
});

const issueSite = "site:github.com/3MUl0R/ThermiteSchematics/issues";
it.each([
  [
    "reviewer raw",
    "https://raw.githubusercontent.com/3MUl0R/ThermiteSchematics/main/packages/compiler/src/index.ts",
  ],
  ["reviewer clone", "git@github.com:3MUl0R/ThermiteSchematics.git"],
  [
    "raw",
    "https://raw.githubusercontent.com/BlackettApplied/ThermiteSchematics/dev/packages/query/src/index.ts",
  ],
  ["raw host", "raw.githubusercontent.com"],
  [
    "blob",
    "https://github.com/BlackettApplied/ThermiteSchematics/blob/dev/docs/modeling.md",
  ],
  ["tree", "github.com/3MUl0R/ThermiteSchematics/tree/dev/packages"],
  ["commit", "https://github.com/3MUl0R/ThermiteSchematics/commit/fac3c43"],
  [
    "commits",
    "https://github.com/BlackettApplied/ThermiteSchematics/commits/dev",
  ],
  ["dot-git", "https://github.com/BlackettApplied/ThermiteSchematics.git"],
  ["git-at", "git@github.com:BlackettApplied/ThermiteSchematics.git"],
  ["other git-at host", "git@gitlab.example:review/source.git"],
  ["ssh clone", "ssh://git@github.com/3MUl0R/ThermiteSchematics"],
  ["git clone", "git://github.com/3MUl0R/ThermiteSchematics.git"],
  [
    "archive",
    "https://github.com/3MUl0R/ThermiteSchematics/archive/refs/heads/dev.tar.gz",
  ],
  [
    "zip",
    "https://codeload.github.com/BlackettApplied/ThermiteSchematics/zip/refs/heads/dev",
  ],
  ["mirror zip", "https://source.example/review/source.zip"],
  [
    "mirror tree",
    "sourcegraph.com/github.com/3MUl0R/ThermiteSchematics/-/tree/packages",
  ],
  ["repository qualifier", "repo:3MUl0R/ThermiteSchematics"],
  [
    "bare repository path",
    "3MUl0R/ThermiteSchematics/packages/query/src/index.ts",
  ],
  [
    "nested query URL",
    "https://github.com/3MUl0R/ThermiteSchematics/issues/367?source=https://raw.githubusercontent.com/3MUl0R/ThermiteSchematics/dev/packages/query/src/index.ts",
  ],
  [
    "nested fragment URL",
    "https://github.com/3MUl0R/ThermiteSchematics/issues/367#https://github.com/3MUl0R/ThermiteSchematics/tree/dev",
  ],
])(
  "issue-search exemption refuses %s repository references",
  (_form, reference) => {
    expect(
      approvedIssueLookup(`${issueSite} ${reference}`, { search: true }),
    ).toBe(false);
    const result = metricQuery(`${issueSite} ${reference}`);
    expect(result.sourceReads).toBe(1);
    expect(result.issueLookups).toHaveLength(0);
    expect(result.violations.filter((v) => v.rule === "V8")).toHaveLength(1);
  },
);

it.each([
  `${issueSite} Thermite`,
  "site:github.com/BlackettApplied/ThermiteSchematics/issues Thermite",
])("issue-only search stays an issue lookup: %s", (query) => {
  const result = metricQuery(query);
  expect(result.sourceReads).toBe(0);
  expect(result.issueLookups).toHaveLength(1);
});

it("a raw repository URL alone remains exactly one source read", () => {
  const result = metricQuery(
    "https://raw.githubusercontent.com/3MUl0R/ThermiteSchematics/main/packages/compiler/src/index.ts",
  );
  expect(result.sourceReads).toBe(1);
  expect(result.issueLookups).toHaveLength(0);
});
