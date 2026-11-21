import { literalShellBody, shellWords } from "./acquisition-command.mjs";
import { jsonHeaders } from "./issue-lookup.mjs";
import { argvWithoutOutputRedirects } from "./shell-redirection.mjs";
import { posix } from "node:path";
import { localCommand } from "./repository-command.mjs";
import { interpreterFetches } from "./interpreter-fetch.mjs";
import {
  networkInvocation,
  interpreterEvidence,
  interpreterBody,
  githubFragment,
} from "./shell-network.mjs";
const conversationFields = new Set([
  "title",
  "body",
  "comments",
  "author",
  "url",
  "number",
  "state",
  "labels",
  "assignees",
  "createdAt",
  "updatedAt",
  "closedAt",
  "milestone",
  "isDraft",
]);

// Short flags are client-specific: curl -H sets a header, wget -H spans hosts.
const fetchOptions = {
  curl: {
    short: {
      s: "flag",
      S: "flag",
      f: "flag",
      L: "flag",
      w: "write-out",
      o: "output",
      D: "side-output",
      H: "header",
      X: "method",
      I: "head",
    },
    long: {
      silent: "flag",
      "show-error": "flag",
      fail: "flag",
      location: "flag",
      compressed: "flag",
      "retry-all-errors": "flag",
      "retry-connrefused": "flag",
      retry: "integer",
      "retry-delay": "integer",
      "retry-max-time": "integer",
      "max-time": "seconds",
      "write-out": "write-out",
      output: "output",
      "dump-header": "side-output",
      header: "header",
      request: "method",
      head: "head",
    },
  },
  wget: {
    short: { q: "flag", S: "flag", O: "output" },
    long: {
      quiet: "flag",
      "server-response": "flag",
      "output-document": "output",
      header: "header",
      method: "method",
    },
  },
  gh: {
    short: {
      H: "header",
      X: "method",
      q: "side-output",
      f: "field",
      F: "typed-field",
    },
    long: {
      header: "header",
      method: "method",
      "raw-field": "field",
      field: "typed-field",
      jq: "side-output",
      paginate: "flag",
    },
  },
};
function optionValue(kind, value, count) {
  if (!value) return null;
  switch (kind) {
    case "header":
      return { count, header: value };
    case "output":
      return { count, output: value };
    case "side-output":
      return { count };
    case "write-out":
      return value.startsWith("@") ? null : { count };
    case "method":
      return value === "GET" ? { count, explicitGet: true } : null;
    case "typed-field":
      if (/=@/.test(value)) return null;
      return { count, field: value };
    case "field":
      return { count, field: value };
    case "integer":
      return /^\d+$/.test(value) && Number.isFinite(Number(value))
        ? { count }
        : null;
    case "seconds":
      return /^(?:\d+|\d*\.\d+)$/.test(value) && Number.isFinite(Number(value))
        ? { count }
        : null;
    default:
      // HEAD is an explicit non-GET request, even alongside -X GET.
      return null;
  }
}
function option(words, index, { short, long }) {
  const value = words[index],
    next = words[index + 1];
  if (value.startsWith("--")) {
    const equals = value.indexOf("=");
    const key = value.slice(2, equals < 0 ? undefined : equals);
    if (!Object.hasOwn(long, key)) return null;
    const kind = long[key];
    if (kind === "flag") return equals < 0 ? { count: 1 } : null;
    return equals < 0
      ? optionValue(kind, next, 2)
      : optionValue(kind, value.slice(equals + 1), 1);
  }
  if (!value.startsWith("-") || value.length < 2) return null;
  for (let i = 1; i < value.length; i++) {
    const kind = short[value[i]];
    if (!kind) return null;
    if (kind === "flag") continue;
    const attached = value.slice(i + 1);
    return attached
      ? optionValue(kind, attached, 1)
      : optionValue(kind, next, 2);
  }
  return { count: 1 };
}
function issueView(words) {
  if (
    words[0] !== "gh" ||
    !["issue", "pr"].includes(words[1]) ||
    words[2] !== "view"
  )
    return null;
  let repo, number, target;
  for (let i = 3; i < words.length; i++) {
    const word = words[i];
    if (["-R", "--repo"].includes(word)) {
      if (repo) return null;
      repo = words[++i];
    } else if (word.startsWith("--repo=")) {
      if (repo) return null;
      repo = word.slice(7);
    } else if (word === "--json" || word.startsWith("--json=")) {
      const fields = (word === "--json" ? words[++i] : word.slice(7))?.split(
        ",",
      );
      if (
        !fields?.length ||
        !fields.every((field) => conversationFields.has(field))
      )
        return null;
    } else if (["--jq", "-q"].includes(word)) {
      if (words[++i] === undefined) return null;
    } else if (word === "--comments") continue;
    else if (/^https?:\/\//i.test(word) && !target && !number) target = word;
    else if (/^[1-9][0-9]*$/.test(word) && !number && !target) number = word;
    else return null;
  }
  if (target) return repo ? null : target;
  return repo && number
    ? `https://github.com/${repo}/${words[1] === "pr" ? "pull" : "issues"}/${number}`
    : null;
}
function hasBraceExpansion(literal) {
  // Quoting and escaping protect shell punctuation. Keep those spans apart
  // so adjacent unquoted dots cannot form a range across a protected span.
  const unquoted = literal.replace(
    /\\[\s\S]|'[^']*'|"(?:\\[\s\S]|[^"\\])*"/g,
    " ",
  );
  const groups = [];
  for (const mark of unquoted.match(/\.\.|[{},]/g) ?? []) {
    if (mark === "{") {
      groups.push(false);
    } else if (mark === "}") {
      if (groups.pop()) return true;
    } else if (groups.length) {
      groups[groups.length - 1] = true;
    }
  }
  return false;
}
function fetchArguments(words, tokens) {
  if (tokens.some(({ literal }) => hasBraceExpansion(literal))) return null;
  const client = words[0],
    headers = [],
    fields = [];
  let target,
    output,
    explicitGet = false;
  for (let i = client === "gh" ? 2 : 1; i < words.length;) {
    const word = words[i];
    if (
      !target &&
      (/^https?:/i.test(word) ||
        (client === "gh" &&
          (word.startsWith("repos/") || word === "search/issues")))
    ) {
      target = word;
      i++;
      continue;
    }
    const parsed = option(words, i, fetchOptions[client]);
    if (!parsed) return null;
    if (parsed.header !== undefined) headers.push(parsed.header);
    if (parsed.explicitGet) explicitGet = true;
    if (parsed.field !== undefined) fields.push(parsed.field);
    if (parsed.output !== undefined) {
      if (output !== undefined) return null;
      output = parsed.output;
    }
    i += parsed.count;
  }
  // curl expands braces and ranges even when the shell quotes the URL.
  if (!target || /[{}[\]*$]/.test(target)) return null;
  if (target === "search/issues") {
    if (
      !explicitGet ||
      fields.length !== 1 ||
      !fields[0].startsWith("q=") ||
      !jsonHeaders(headers)
    )
      return null;
    return { query: fields[0].slice(2), repoOnly: true, headers, output };
  }
  if (fields.length) {
    if (
      !explicitGet ||
      !target.startsWith("repos/") ||
      !fields.every((field) => /^[a-z_]+=[a-z0-9]+$/i.test(field))
    )
      return null;
    target += (target.includes("?") ? "&" : "?") + fields.join("&");
  }
  if (target.startsWith("repos/")) target = `https://api.github.com/${target}`;
  return { target, headers, output };
}
export function shellRequest(
  input,
  tokens = shellWords(literalShellBody(input), { literal: true }),
  heredoc,
) {
  const text = input;
  if (heredoc) {
    const words = tokens?.map((t) => t.value);
    const command = posix.basename(words?.[0] ?? "");
    const interpreter =
      /^(?:bun|node|python[\d.]*|ruby|perl|deno|(?:ba|z)?sh)$/.test(command) &&
      (!words[1] || words[1] === "-" || words[1].startsWith("-"));
    const code = interpreter || heredoc.executed;
    const expansion = !heredoc.quoted && /`|\$\(/.test(heredoc.body);
    const requests = code && !expansion && interpreterFetches(heredoc.body);
    if (requests && !networkInvocation(text, words)) return { requests };
    const network =
      networkInvocation(text, words) ||
      (code &&
        interpreterEvidence(heredoc.body, ["bun", "-e", heredoc.body])) ||
      (heredoc.executed && githubFragment(heredoc.body)) ||
      (expansion &&
        (networkInvocation(heredoc.body, null) ||
          githubFragment(heredoc.body)));
    return { text, network, shell: true, safe: false, localBody: !network };
  }
  const argv = argvWithoutOutputRedirects(tokens);
  const words = (argv ?? tokens)?.map((t) => t.value);
  const network = networkInvocation(text, words),
    api = interpreterEvidence(text, words);
  const refused = { text, network: network || api, shell: true, safe: false };
  if (!argv) return refused;
  const head = [...words];
  head[0] = posix.basename(head[0] ?? "");
  const dynamic = argv.some(
    (t) => !/^(['"]).*\1$/.test(t.literal) && /\$/.test(t.literal),
  );
  // Data variables in a jq expression are literal argv, not target expansion.
  if (dynamic) return refused;
  if (localCommand(head)) return { localBody: true, shell: true };
  const requests = interpreterFetches(interpreterBody(text, words));
  if (requests) return { requests };
  const view = issueView(head);
  if (view)
    return {
      text,
      target: view,
      headers: [],
      safe: true,
      shell: true,
      network: true,
    };
  if (
    !["curl", "wget"].includes(head[0]) &&
    !(head[0] === "gh" && head[1] === "api")
  ) {
    // File tools and local scripts do not fetch source by merely naming data.
    const command = head[0];
    const dataTool =
      /^(?:echo|printf|cat|sed|rg|grep|jq|head|tail|mkdir|ls|pwd|command|which|type|cp|mv|rm|touch|wc|sort|uname)$/.test(
        command,
      );
    const interpreter = interpreterBody(text, words) !== null;
    return {
      ...refused,
      network: network || api,
      localBody:
        !network && !api && (dataTool || interpreter || !githubFragment(text)),
    };
  }
  const fetch = fetchArguments(head, argv);
  if (!fetch) return refused;
  return { text, ...fetch, safe: true, shell: true, network: true };
}
