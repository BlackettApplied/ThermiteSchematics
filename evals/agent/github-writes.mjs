import { posix } from "node:path";
import { canonicalUrl } from "./github-canonical.mjs";
import { interpreterText } from "./interpreter-text.mjs";
import { argvWithoutOutputRedirects } from "./shell-redirection.mjs";
import { shellParts } from "./shell-parts.mjs";
import { gitOperation } from "./repository-command.mjs";

// These are mutation verbs, independent of any tool result. Shell text that
// looks like an argument to a data tool does not establish a command.
const ghWrites = {
  issue: [
    "create",
    "comment",
    "edit",
    "close",
    "reopen",
    "delete",
    "lock",
    "unlock",
    "transfer",
    "pin",
    "unpin",
  ],
  pr: [
    "create",
    "comment",
    "edit",
    "close",
    "reopen",
    "merge",
    "review",
    "ready",
    "update-branch",
    "lock",
    "unlock",
  ],
  release: ["create", "edit", "delete", "upload", "delete-asset"],
  repo: ["create", "delete", "edit", "fork", "rename", "archive", "unarchive"],
  gist: ["create", "delete", "edit", "rename"],
  label: ["create", "edit", "delete", "clone"],
  workflow: ["run", "enable", "disable"],
  secret: ["set", "delete"],
  variable: ["set", "delete"],
};
const dataLong = {
  gh: ["field", "raw-field", "input"],
  curl: [
    "data",
    "data-raw",
    "data-binary",
    "data-urlencode",
    "data-ascii",
    "json",
    "form",
    "form-string",
    "upload-file",
  ],
  wget: ["post-data", "post-file", "body-data", "body-file"],
};
const valueLong = {
  gh: ["header", "hostname", "jq", "template", "cache"],
  curl: [
    "header",
    "output",
    "dump-header",
    "write-out",
    "user",
    "user-agent",
    "referer",
    "max-time",
    "retry",
    "retry-delay",
    "retry-max-time",
    "connect-timeout",
    "cookie",
    "cookie-jar",
    "proxy",
  ],
  wget: [
    "header",
    "output-document",
    "output-file",
    "user",
    "password",
    "user-agent",
    "referer",
    "timeout",
    "tries",
  ],
};
const dataShort = { gh: "fF", curl: "dFT", wget: "" };
const valueShort = { gh: "Hqt", curl: "HowDuAebcxm", wget: "OoUt" };

function githubTarget(value) {
  if (!value) return false;
  const input = /^https?:/i.test(value) ? value : "https://" + value;
  const { url, valid } = canonicalUrl(input);
  return (
    valid &&
    ["github.com", "api.github.com", "uploads.github.com"].includes(
      url?.hostname,
    )
  );
}

function githubRemote(value) {
  if (githubTarget(value)) return true;
  const input = /^git@github\.com:/i.test(value)
    ? value.replace(":", "/")
    : value.replace(/^ssh:\/\//i, "");
  return githubTarget(input);
}

function mutationArguments(words, client, start) {
  let mutation = false,
    explicitMethod,
    fields = false,
    target = false;
  const method = (value) => {
    if (client === "gh") explicitMethod = value?.toUpperCase();
    else mutation ||= /^(?:POST|PATCH|PUT|DELETE)$/i.test(value ?? "");
  };
  for (let i = start; i < words.length; i++) {
    const word = words[i];
    if (word === "--") {
      target ||= words.slice(i + 1).some(githubTarget);
      break;
    }
    if (word.startsWith("--")) {
      const [key, ...attached] = word.slice(2).split("=");
      const next = () => (attached.length ? attached.join("=") : words[++i]);
      if (key === (client === "curl" ? "request" : "method")) method(next());
      else if (dataLong[client].includes(key)) {
        if (client === "gh" && key !== "input") fields = true;
        else mutation = true;
        next();
      } else if (key === "url" && client === "curl") {
        target = githubTarget(next()) || target;
      } else if (valueLong[client].includes(key)) next();
    } else if (word.startsWith("-") && word.length > 1) {
      for (let j = 1; j < word.length; j++) {
        const flag = word[j];
        const next = () => word.slice(j + 1) || words[++i];
        if (flag === "X" && client !== "wget") {
          method(next());
          break;
        }
        if (dataShort[client].includes(flag)) {
          if (client === "gh") fields = true;
          else mutation = true;
          next();
          break;
        }
        if (valueShort[client].includes(flag)) {
          next();
          break;
        }
      }
    } else target ||= githubTarget(word);
  }
  return client === "gh"
    ? mutation || (explicitMethod ? explicitMethod !== "GET" : fields)
    : mutation && target;
}

function unwrapped(words) {
  let i = 0;
  for (;;) {
    if (/^[A-Za-z_]\w*=/.test(words[i] ?? "")) {
      i++;
      continue;
    }
    const prefix = posix.basename(words[i] ?? "");
    if (prefix === "command") {
      i++;
    } else if (prefix === "env") {
      i++;
      while (["-i", "--ignore-environment", "--"].includes(words[i])) i++;
    } else if (["sudo", "xargs"].includes(prefix)) {
      i++;
      while (words[i]?.startsWith("-")) {
        const flag = words[i++];
        if (flag === "--") break;
        if (
          ["-u", "-g", "-a", "-I", "-L", "-n", "-P", "-s", "-d"].includes(flag)
        )
          i++;
      }
    } else break;
  }
  return words.slice(i);
}

function directWrite(client, args) {
  if (["--help", "-h"].some((flag) => args.includes(flag))) return false;
  if (client === "gh") {
    if (["-R", "--repo"].includes(args[0])) args.splice(0, 2);
    else if (args[0]?.startsWith("--repo=")) args.shift();
    if (args[0] === "api") return mutationArguments(args, client, 1);
    return ghWrites[args[0]]?.includes(args[1]) ?? false;
  }
  if (client === "git") {
    const [verb, ...options] = gitOperation(args);
    return verb === "push" && options.some(githubRemote);
  }
  return (
    ["curl", "wget"].includes(client) && mutationArguments(args, client, 0)
  );
}

const shell = /^(?:bash|sh|zsh)$/;
const interpreter = /^(?:bun|node|python[\d.]*|ruby|perl|deno)$/;
const mutatingMethod = /^(?:post|patch|put|delete)$/i;

function literalInterpreterWrites(body) {
  const { code, input, strings } = interpreterText(body);
  let writes = 0;
  for (const [i, argument] of strings.entries()) {
    const prefix = code.slice(0, argument.start);
    if (
      /\b(?:subprocess\.(?:run|call|Popen|check_call|check_output)|spawn(?:Sync)?|exec(?:Sync)?|popen|system)\(\s*\[?\s*$/i.test(
        prefix,
      )
    ) {
      if (/\[\s*$/.test(prefix)) {
        const argv = [argument.value];
        let end = argument.end;
        for (const next of strings.slice(i + 1)) {
          if (!/^\s*,\s*$/.test(input.slice(end, next.start))) break;
          argv.push(next.value);
          end = next.end;
        }
        const [command, ...args] = unwrapped(argv);
        if (directWrite(posix.basename(command ?? ""), args)) writes++;
      } else writes += shellWritesIn(argument.value);
    } else if (githubTarget(argument.value)) {
      const previous = strings[i - 1];
      if (
        /\brequests\.(?:post|patch|put|delete)\(\s*$/i.test(prefix) ||
        (previous &&
          /\brequests\.request\(\s*""\s*,\s*$/i.test(prefix) &&
          mutatingMethod.test(previous.value)) ||
        (/\b(?:fetch|Request)\(\s*$/i.test(prefix) &&
          /^\s*,\s*(?:\{[^}]*?\bmethod\s*:|method\s*=)\s*(['"])(?:POST|PATCH|PUT|DELETE)\1/i.test(
            input.slice(argument.end),
          ))
      )
        writes++;
    }
  }
  return writes;
}

function shellWritesIn(body) {
  return (shellParts(body) ?? []).reduce(
    (total, part) => total + shellGitHubWrites(part.tokens, part.heredoc),
    0,
  );
}

export function shellGitHubWrites(tokens, heredoc) {
  const [head, ...args] = unwrapped(
    (argvWithoutOutputRedirects(tokens) ?? tokens ?? [])
      .filter((token) => !token.control)
      .map((token) => token.value),
  );
  const client = posix.basename(head ?? "");
  if (directWrite(client, args)) return 1;
  if (shell.test(client)) {
    const command = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
    if (command >= 0 && args[command + 1])
      return shellWritesIn(args[command + 1]);
    if (heredoc) return shellWritesIn(heredoc.body);
  }
  if (heredoc?.executed)
    return (
      shellWritesIn(heredoc.body) || literalInterpreterWrites(heredoc.body)
    );
  return heredoc && interpreter.test(client)
    ? literalInterpreterWrites(heredoc.body)
    : 0;
}
