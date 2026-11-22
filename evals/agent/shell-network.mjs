import { canonicalText } from "./github-canonical.mjs";
import { posix } from "node:path";
import { interpreterText } from "./interpreter-text.mjs";
import {
  repositoryAcquisition,
  localCommand,
  gitOperation,
} from "./repository-command.mjs";
const clients = new Set(["curl", "wget", "gh", "nc", "ssh", "scp", "rsync"]);
export const shellTool = (name) =>
  /^(?:command_execution|bash|shell|exec_command)$/i.test(name);
export function evidenceText(text) {
  return canonicalText(text).text.replace(/[\\'"+]/g, "");
}
export function githubFragment(text) {
  const normal = canonicalText(text).text;
  const compact = normal.replace(/[\s\\'"+]/g, "");
  return (
    /github\.(?:com|)|githubuser|raw\.git|(?:codeload|objects|user-images|gist)\.git/.test(
      compact,
    ) || /git[\s\\'"+]+hub/.test(normal)
  );
}
export function networkInvocation(text, words) {
  if (words?.length) {
    let i = 0;
    if (words[i] === "env") i++;
    while (/^[A-Za-z_]\w*=/.test(words[i] ?? "")) i++;
    if (words[i] === "command") {
      if (["-v", "-V"].includes(words[i + 1])) return false;
      i++;
    }
    const command = posix.basename(words[i] ?? ""),
      args = words.slice(i + 1);
    if (localCommand(words.slice(i))) return false;
    if (repositoryAcquisition(words.slice(i))) return true;
    if (command === "git") {
      const operation = gitOperation(args);
      return /^(?:clone|fetch|pull|ls-remote|archive)$/.test(
        operation[0] ?? "",
      );
    }
    if (["scp", "rsync"].includes(command))
      return args.some((arg) => /(?:\w@)?[^/\s:]+:|:\/\//.test(arg));
    if (
      clients.has(command) &&
      args.length === 1 &&
      ["--version", "--help", "-V"].includes(args[0])
    )
      return false;
    if (clients.has(command)) return true;
    if (/^(?:bun|node|python[\d.]*|ruby|perl|deno|(?:ba|z)?sh)$/.test(command))
      return false;
    if (
      [
        "echo",
        "printf",
        "cat",
        "sed",
        "rg",
        "grep",
        "jq",
        "head",
        "mkdir",
        "ls",
        "pwd",
        "command",
        "which",
        "type",
      ].includes(command)
    )
      return false;
  }
  const visible = evidenceText(text.replace(/\n/g, ";"));
  return (
    /(?:^|[;&|(])\s*(?:[A-Za-z_]\w*=[^\s]+\s+)*(?:\S*\/)?(?:curl|wget|gh|nc|ssh)\b/.test(
      visible,
    ) ||
    /\bgit\s+(?:clone|fetch|pull|ls-remote|archive)\b/.test(visible) ||
    /\b(?:scp|rsync)\s+[^\n]*[^\s/]+:[^\s]/.test(visible)
  );
}
// Evidence in executable bodies, not the ability of an interpreter to network.
export function interpreterBody(text, words) {
  const command = posix.basename(words?.[0] ?? "");
  const interpreter = /^(?:bun|node|python[\d.]*|ruby|perl|deno|(?:ba|z)?sh)$/;
  if (words && !interpreter.test(command)) return null;
  let body = words ? null : text;
  if (words) {
    if (command === "deno" && words[1] === "eval") body = words[2] ?? "";
    for (let i = 1; i < words.length && words[i].startsWith("-"); i++) {
      if (/^(?:-[a-z]*[ecp][a-z]*|--(?:eval|command|print))$/i.test(words[i])) {
        body = words[i + 1] ?? "";
        break;
      }
      if (/^--(?:eval|command|print)=/.test(words[i])) {
        body = words[i].slice(words[i].indexOf("=") + 1);
        break;
      }
    }
  }
  return body;
}
export function interpreterEvidence(text, words) {
  const body = interpreterBody(text, words);
  if (body === null) return false;
  const { code, module, child } = interpreterText(body);
  const api =
    /\bfetch\s*\(|\bhttps?\.(?:get|request|connect)\s*\(|\bnet\.connect\b|\bxmlhttprequest\b|\bwebsocket\b|\bbun\.connect\b|\burllib\b|\brequests\.(?:get|post|put|patch|delete|head|request|options|session)\s*\(|\bsocket\b/i.test(
      code,
    ) || module;
  if (child || networkInvocation(code, null)) return true;
  // Literal targets now use the shared GET classifier; unresolved executable
  // API calls keep the network default, including non-GitHub remote targets.
  return api;
}
