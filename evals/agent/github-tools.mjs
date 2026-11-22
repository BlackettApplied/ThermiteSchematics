import { isDeepStrictEqual } from "node:util";
import { fromMarkdown } from "mdast-util-from-markdown";
import { canonicalText, canonicalUrl } from "./github-canonical.mjs";
import { conversationQuery } from "./issue-lookup.mjs";

const fields = {
  fetch: ["url", "prompt"],
  search_issues: ["query", "repository_full_name", "sort", "order", "topn"],
  search_prs: [
    "query",
    "repository_full_name",
    "sort",
    "order",
    "topn",
    "state",
  ],
  issue_read: ["owner", "repo", "issue_number", "method", "page", "perPage"],
  pull_request_read: [
    "owner",
    "repo",
    "pullNumber",
    "method",
    "page",
    "perPage",
  ],
};
// This allowlist identifies reads for write accounting. It does not grant
// a source-read exemption (for example, search_code and get_file_contents).
const reads = new Set([
  ...Object.keys(fields),
  "get_file_contents",
  "get_repository",
  "get_commit",
  "list_branches",
  "list_commits",
  "list_issues",
  "list_pull_requests",
  "get_pull_request",
  "get_issue",
  "get_issue_comments",
  "get_pull_request_comments",
  "get_pull_request_files",
  "get_pull_request_diff",
  "get_pull_request_reviews",
  "get_release",
  "get_latest_release",
  "list_releases",
  "list_tags",
  "list_workflows",
  "list_workflow_runs",
  "get_workflow_run",
  "get_me",
  "search",
  "search_code",
  "search_repositories",
  "search_users",
  "search_commits",
  "search_branches",
  "search_pull_requests",
]);
const deniedMessage =
  "MCP tool call requires approval, but approval policy is never";

function namedOperation(event) {
  return /^codex_apps\.github\.(\w+)$/.exec(event.name ?? "")?.[1];
}
function connectorOperation(event) {
  const name = event.name ?? "";
  const operation = namedOperation(event);
  if (operation) return operation;
  if (
    (/^mcp__/i.test(name) &&
      /github/i.test(name.split("__").slice(1, -1).join("__"))) ||
    (event.mcp && /github/i.test(name)) ||
    /github/i.test(event.server ?? "")
  )
    return (event.tool ?? name.split("__").at(-1))
      .split(/[.:/]/)
      .at(-1)
      .toLowerCase();
  return null;
}
function matchingReceipt(event, receipt, operation) {
  return (
    receipt?.server === "codex_apps" &&
    receipt.tool === "github." + operation &&
    isDeepStrictEqual(receipt.arguments, event.input)
  );
}
function record(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value, keys) {
  return record(value) && Object.keys(value).every((key) => keys.includes(key));
}
const conversationFields = [
  "id",
  "url",
  "display_url",
  "title",
  "display_title",
  "issue_number",
  "body",
  "state",
  "user",
  "assignees",
  "labels",
  "milestone",
  "state_reason",
  "comments",
  "created_at",
  "updated_at",
  "closed_at",
];
const nullableText = [
  "state",
  "state_reason",
  "created_at",
  "updated_at",
  "closed_at",
  "display_title",
];
const absentMetadata = ["user", "assignees", "labels", "milestone", "comments"];

function containsSourceLink(value, linked = false) {
  const text = canonicalText(value).text.replaceAll("\\", "/");
  // A source locator must be a GitHub link. Bare file paths are prose.
  const links = text.matchAll(
    /(?:https?:\/*|(?<![\w./-])(?:\/\/)?)(?:[a-z0-9-]+\.)*(github\.com|githubusercontent\.com)(?=([/:?#][^\s<>"'`()\[\]{}]*))/gu,
  );
  for (const [, host, target] of links) {
    const directFile =
      host === "githubusercontent.com" || /\/contents(?:[/?#]|$)/u.test(target);
    if (
      directFile
        ? linked
        : /\/(?:blobs?|raw|tree|commits?|archive)\/|\.(?:diff|patch)\b/u.test(
            target,
          )
    )
      return true;
  }
  return false;
}

function containsSourceContent(value) {
  const lines = value.split(/\r\n?|\n/);
  const hasBlock = (node, topLevel) => {
    if (node.type === "code") {
      const { line, column } = node.position.start;
      return (
        /^\s*(?:```|~~~)/.test(lines[line - 1].slice(column - 1)) ||
        (topLevel && line > 1 && /^\s*$/.test(lines[line - 2]))
      );
    }
    if (
      ["link", "definition"].includes(node.type) &&
      containsSourceLink(node.url, true)
    )
      return true;
    return node.children?.some((child) =>
      hasBlock(child, node.type === "root"),
    );
  };
  return hasBlock(fromMarkdown(value), false) || containsSourceLink(value);
}

function conversationResult(issue, repository, pullOnly) {
  if (
    !onlyKeys(issue, conversationFields) ||
    typeof issue.title !== "string" ||
    !Number.isSafeInteger(issue.issue_number) ||
    issue.issue_number <= 0 ||
    (issue.body !== null && typeof issue.body !== "string") ||
    nullableText.some(
      (key) => issue[key] != null && typeof issue[key] !== "string",
    ) ||
    absentMetadata.some((key) => issue[key] != null) ||
    (issue.id != null && !Number.isSafeInteger(issue.id))
  )
    return false;
  const root = `https://github.com/${repository}`;
  const destinations = new Set([
    `${root}/pull/${issue.issue_number}`,
    ...(!pullOnly ? [`${root}/issues/${issue.issue_number}`] : []),
  ]);
  const primary = canonicalUrl(issue.url);
  const display = canonicalUrl(issue.display_url ?? issue.url);
  if (
    !primary.valid ||
    !display.valid ||
    !destinations.has(primary.url?.href) ||
    primary.url.href !== display.url?.href
  )
    return false;
  return !Object.values(issue).some(
    (value) => typeof value === "string" && containsSourceContent(value),
  );
}

// Structured receipts are supplied only by transcript normalization, never
// extracted from tool arguments or inferred from agent-authored messages.
export function githubEvidence(event, result) {
  const receipt = result?.mcp;
  const operation = connectorOperation(event);
  const matches = matchingReceipt(event, receipt, namedOperation(event));
  if (
    operation &&
    !reads.has(operation) &&
    !/^(?:get|list|search|read|fetch)_/.test(operation)
  ) {
    const denied =
      matches &&
      receipt.status === "failed" &&
      receipt.result == null &&
      onlyKeys(receipt.error, ["message"]) &&
      receipt.error.message === deniedMessage;
    return {
      class: denied ? "attempted-write" : "source-read",
      attemptedWrites: [
        denied
          ? "denied-before-execution"
          : matches && ["completed", "failed"].includes(receipt.status)
            ? receipt.status
            : result?.toolError === true
              ? "failed"
              : result?.toolError === false
                ? "completed"
                : "unverified",
      ],
    };
  }
  if (
    !namedOperation(event) ||
    !["search_issues", "search_prs"].includes(operation) ||
    (!event.mcp && !receipt)
  )
    return null;
  if (!matches) return { class: "source-read" };
  const input = event.input;
  if (
    !record(input) ||
    typeof input.query !== "string" ||
    (input.repository_full_name !== undefined &&
      typeof input.repository_full_name !== "string") ||
    (input.sort !== undefined &&
      ![
        "updated",
        "created",
        "comments",
        "best-match",
        "reactions",
        "interactions",
      ].includes(input.sort)) ||
    (input.order !== undefined && !["asc", "desc"].includes(input.order)) ||
    (input.state !== undefined &&
      !["all", "open", "closed"].includes(input.state)) ||
    (input.topn !== undefined &&
      (!Number.isSafeInteger(input.topn) || input.topn <= 0))
  )
    return { class: "source-read" };
  const query = githubRequest(event, true)?.query;
  const { text, valid } = canonicalText(query);
  const repository = valid && conversationQuery(text);
  const usable =
    receipt.status === "completed" &&
    receipt.error == null &&
    onlyKeys(receipt.result, ["content", "structured_content"]) &&
    Array.isArray(receipt.result.content) &&
    receipt.result.content.length === 1 &&
    onlyKeys(receipt.result.content[0], ["type", "text"]) &&
    receipt.result.content[0].type === "text" &&
    receipt.result.content[0].text === "Action completed." &&
    onlyKeys(receipt.result.structured_content, ["issues"]) &&
    Array.isArray(receipt.result.structured_content.issues);
  if (
    repository &&
    usable &&
    receipt.result.structured_content.issues.every((issue) =>
      conversationResult(issue, repository, operation === "search_prs"),
    )
  )
    return { class: "issue-lookup", evidence: "typed-conversation-result" };
  return { class: "source-read" };
}

// Fixed operations, never an exemption inferred from an arbitrary GitHub name.
export function githubRequest(event, typedEvidence = false) {
  const name =
      event.tool ?? event.name?.split("__").at(-1)?.split(/[.:/]/).at(-1),
    input = event.input;
  const operation = name?.toLowerCase();
  if (
    !Object.hasOwn(fields, operation ?? "") ||
    (operation === "search_prs" && !typedEvidence) ||
    !input ||
    typeof input !== "object" ||
    !Object.keys(input).every((key) => fields[operation].includes(key))
  )
    return null;
  if (operation === "fetch")
    return { target: input?.url, headers: [], safe: true, network: true };
  if (["search_issues", "search_prs"].includes(operation))
    return {
      query: `${input?.repository_full_name ? `repo:${input.repository_full_name} ` : ""}${input?.query ?? ""}`,
    };
  if (
    !["issue_read", "pull_request_read"].includes(operation) ||
    !["get", "get_comments"].includes(input?.method)
  )
    return null;
  const number =
    operation === "issue_read" ? input.issue_number : input.pullNumber;
  if (
    !/^[1-9][0-9]*$/.test(String(number)) ||
    !/^[a-z0-9-]+$/i.test(input.owner ?? "") ||
    !/^[a-z0-9_.-]+$/i.test(input.repo ?? "")
  )
    return null;
  const path =
    input.method === "get_comments" || operation === "issue_read"
      ? "issues"
      : "pulls";
  return {
    target: `https://api.github.com/repos/${input.owner}/${input.repo}/${path}/${number}${input.method === "get_comments" ? "/comments" : ""}`,
    headers: [],
    safe: true,
    network: true,
  };
}
