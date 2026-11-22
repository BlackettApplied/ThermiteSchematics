import { expect, it } from "vitest";
import { classifyToolCall } from "./github-call.mjs";
const approvedIssueLookup = (input, { search = false } = {}) =>
  classifyToolCall({ name: search ? "web_search" : "open_page", input })
    .class === "issue-lookup";
import { score } from "./score-log.mjs";
import { normalizeTranscript } from "./transcript.mjs";

const site = "site:github.com/3MUl0R/ThermiteSchematics/issues";
const repo = "repo:3MUl0R/ThermiteSchematics";
const url = "https://github.com/3MUl0R/ThermiteSchematics/issues/367";
const raw =
  "https://raw.githubusercontent.com/3MUl0R/ThermiteSchematics/dev/packages/compiler/src/index.ts";
const search = (query) => approvedIssueLookup(query, { search: true });
const metric = (item) =>
  score({
    transcript: [
      {
        type: "item.started",
        item: { id: "w", type: "web_search", query: "" },
      },
      {
        type: "item.completed",
        item: { id: "w", type: "web_search", ...item },
      },
    ],
  });
const encode = (input, levels) => {
  for (let i = 0; i < levels; i++) input = encodeURIComponent(input);
  return input;
};

it.each([
  "site:github.com/3MUl0R/ThermiteSchematics/issues OR https:raw%2Egithubusercontent%2Ecom/3MUl0R/%54hermiteSchematics/dev/packages/compiler/src/index.ts",
  'site:github.com/3MUl0R/ThermiteSchematics/issues OR inurl:blob "compileProject"',
])("refuses the exact r3 review query: %s", (query) => {
  expect(search(query)).toBe(false);
  expect(metric({ query }).sourceReads).toBe(1);
  expect(metric({ query }).issueLookups).toHaveLength(0);
});

it.each([
  raw,
  raw.toUpperCase(),
  raw.replaceAll(".", "\uff0e"),
  encode(raw, 1),
  encode(raw, 2),
  encode(raw, 12),
  `OR ${raw}`,
  `or ${raw}`,
  `\uff2f\uff32 ${raw}`,
  `${encode("OR", 2)} ${encode(raw, 2)}`,
  `| ${raw}`,
  `${encode("|", 2)} ${raw}`,
  'inurl:blob "compileProject"',
  `intitle:${raw}`,
  "path:packages/compiler",
  "filename:index.ts",
  "extension:ts",
  "filetype:ts",
  "in:code",
  "is:open",
  "AND Thermite",
  "NOT Thermite",
  '"raw.githubusercontent.com"',
  '"packages/compiler"',
  "packages\\compiler",
  '"safe""phrase"',
  '"unterminated phrase',
  '""',
  "raw%252Egithubusercontent%252Ecom",
  "site:raw.githubusercontent.com/3MUl0R/ThermiteSchematics",
  "repo:someone/other is:issue",
  "Thermite%",
  "Thermite%ff",
  "Thermite%252fcompiler",
])("rejects every non-allowlisted query token: %s", (suffix) => {
  const query = `${site} ${suffix}`;
  expect(search(query)).toBe(false);
  expect(metric({ query }).sourceReads).toBe(1);
  expect(metric({ query }).issueLookups).toHaveLength(0);
});

it.each([
  `${site}/367 Thermite`,
  `${site} ${url}`,
  `${site} ${url}?state=open`,
  url,
  `${repo} Thermite`,
  "is:issue Thermite",
  `${site} is:pr Thermite`,
  "in:title,body,comments Thermite",
  "Thermite compileProject",
  "",
])(
  "does not grant a search exemption without the exact scope grammar: %s",
  (query) => {
    expect(search(query)).toBe(false);
    expect(metric({ query }).issueLookups).toHaveLength(0);
  },
);

it.each([
  `${site} Thermite`,
  `${site} "compileProject failure"`,
  `${site} 'OL1 aux contact'`,
  `${site} moteur Überlast 24V motor-starter query_ordering`,
  `${repo} is:issue Thermite`,
  `${repo} is:pr in:title,body,comments "motor starter"`,
  `Thermite ${site}`,
  `  ${site.toUpperCase()}\t"MOTOR   STARTER"  `,
  encode(`${site} Thermite`, 2),
  encode(`${site} Thermite`, 12),
  `${site.replaceAll(".", "\uff0e").replaceAll(":", "\uff1a")} Thermite`,
])("accepts only normalized issue scope plus plain tokens: %s", (query) => {
  expect(search(query)).toBe(true);
  const result = metric({ query });
  expect(result.sourceReads).toBe(0);
  expect(result.issueLookups).toHaveLength(1);
});

it.each([
  url,
  url.toUpperCase(),
  encode(url, 2),
  url.replaceAll(".", "\uff0e"),
  "https://github.com/BlackettApplied/ThermiteSchematics/issues",
  "https://github.com/3MUl0R/ThermiteSchematics/pull/372",
  "https://api.github.com/repos/3MUl0R/ThermiteSchematics/issues/367/comments",
  "https://api.github.com/repos/3MUl0R/ThermiteSchematics/pulls/372",
  "https://api.github.com/repos/BlackettApplied/ThermiteSchematics/issues?state=all&per_page=100&page=2&sort=updated&direction=desc",
  `${url}#issuecomment-123`,
])(
  "allows only fetched issue/PR paths and fixed metadata filters: %s",
  (target) => {
    expect(approvedIssueLookup(target)).toBe(true);
    const result = metric({ action: { type: "open_page", url: target } });
    expect(result.sourceReads).toBe(0);
    expect(result.issueLookups).toHaveLength(1);
  },
);

it.each([
  raw,
  "https://github.com/3MUl0R/ThermiteSchematics/blob/dev/packages/compiler/src/index.ts",
  "https://github.com/3MUl0R/ThermiteSchematics/tree/dev",
  "https://github.com/3MUl0R/ThermiteSchematics/commit/fac3c43",
  "https://github.com/3MUl0R/ThermiteSchematics.git",
  "git@github.com:3MUl0R/ThermiteSchematics.git",
  "https://github.com/3MUl0R/ThermiteSchematics/archive/dev.zip",
  "https://api.github.com/repos/3MUl0R/ThermiteSchematics/contents/packages/compiler/src/index.ts",
  "https://github.com/3MUl0R/ThermiteSchematics/pull/372/files",
  "https://github.com/3MUl0R/ThermiteSchematics/issues/367/../../blob/dev/index.ts",
  "https://github.com.evil.example/3MUl0R/ThermiteSchematics/issues/367",
  "https://api.github.com.evil.example/repos/3MUl0R/ThermiteSchematics/issues",
  "https://github.com:8443/3MUl0R/ThermiteSchematics/issues",
  "https://someone@github.com/3MUl0R/ThermiteSchematics/issues",
  "ftp://github.com/3MUl0R/ThermiteSchematics/issues",
  `${url}?raw`,
  `${url}?plain=1`,
  `${url}?raw=0`,
  `${url}?source=${raw}`,
  `${url}?state=open&per_page=100/../../blob`,
  `${url}?state=open&state=all`,
  `${url}?constructor=created`,
  `${url}?per_page=101`,
  `${url}#${raw}`,
  `${url}#issuecomment-123/../../blob`,
  `${url}?state=${encode("open/../blob", 2)}`,
  encode(raw, 2),
  raw.toUpperCase(),
  raw.replaceAll(".", "\uff0e"),
  "https://github.com/%ff/issues",
  "not a URL",
])(
  "refuses fetched non-issue targets or path-bearing parameters: %s",
  (target) => {
    expect(approvedIssueLookup(target)).toBe(false);
    expect(
      metric({ action: { type: "open_page", url: target } }).issueLookups,
    ).toHaveLength(0);
  },
);

it("uses the actual typed web action instead of its display query", () => {
  const fetched = metric({
    query: url,
    action: { type: "open_page", url: raw },
  });
  expect(fetched.sourceReads).toBe(1);
  expect(fetched.issueLookups).toHaveLength(0);
  const queried = metric({
    query: `${site} Thermite`,
    action: { type: "search", query: `${site} OR inurl:blob` },
  });
  expect(queried.sourceReads).toBe(1);
  expect(queried.issueLookups).toHaveLength(0);
  const direct = metric({ query: url });
  expect(direct.sourceReads).toBe(1);
  expect(direct.issueLookups).toHaveLength(0);
  const opened = metric({ action: { type: "open_page", url } });
  expect(opened.sourceReads).toBe(0);
  expect(opened.issueLookups).toHaveLength(1);
});

it("retains the fetch marker across empty starts without duplicating calls", () => {
  const transcript = [
    {
      type: "item.started",
      item: {
        id: "w",
        type: "web_search",
        query: "",
        action: { type: "other" },
      },
    },
    {
      type: "item.completed",
      item: {
        id: "w",
        type: "web_search",
        query: url,
        action: { type: "open_page", url },
      },
    },
  ];
  const normalized = normalizeTranscript(transcript);
  expect(normalized.events.filter((e) => e.type === "tool")).toMatchObject([
    { input: url, lookupKind: "fetch" },
  ]);
  expect(normalized.totalToolCalls).toBe(1);
});

it.each([null, undefined, 123, {}, "%", "%ff"])(
  "invalid lookup input is refusal, never an error: %j",
  (input) => {
    expect(approvedIssueLookup(input)).toBe(false);
    expect(approvedIssueLookup(input, { search: true })).toBe(false);
  },
);
