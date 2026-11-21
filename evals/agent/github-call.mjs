import {
  canonicalText,
  canonicalUrl,
  touchesGitHub,
} from "./github-canonical.mjs";
import { shellRequest } from "./github-shell.mjs";
import { issueSearch, issueUrl, jsonHeaders } from "./issue-lookup.mjs";
import { sourceScanInput } from "./source-scan-input.mjs";
import { readsLocalSource } from "./local-source.mjs";
import { githubEvidence, githubRequest } from "./github-tools.mjs";
import {
  decodedShellBody,
  shellParts,
  aggregateParts,
} from "./shell-parts.mjs";
import { shellGitHubWrites } from "./github-writes.mjs";
import { shellWords } from "./acquisition-command.mjs";
import { shellTool, githubFragment } from "./shell-network.mjs";
import { allowedLibraryUrl } from "./library-acquisition.mjs";
export { pathText } from "./local-source.mjs";
export const strings = (value) =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];

// Extract actual request arguments, never display text or fetch prompts.
function request(event, github, result, laterShell) {
  if (github)
    return (
      githubRequest(event) ?? {
        text: strings(event.input).join("\n"),
        network: true,
      }
    );
  const { name, input, lookupKind } = event;
  if (/^(?:webfetch|open_page)$/i.test(name) || lookupKind === "fetch")
    return {
      target: typeof input === "string" ? input : input?.url,
      headers: [],
      safe:
        typeof input === "string" ||
        (!!input &&
          Object.keys(input).every((key) => ["url", "prompt"].includes(key))),
      network: true,
    };
  if (/^(?:web_search|websearch|search)$/i.test(name))
    return {
      query:
        typeof input === "string"
          ? input
          : `${input?.repository_full_name ? `repo:${input.repository_full_name} ` : ""}${input?.query ?? ""}`,
    };
  const shell = shellTool(name);
  const values = strings(
    shell && input && typeof input === "object"
      ? (input.command ?? input.cmd)
      : input,
  );
  const text = sourceScanInput(
    name,
    values,
    result?.exit === 0 && values.length === 1 && result.command === values[0],
    laterShell,
  );
  if (shell) return { parts: shellParts(text, laterShell), text, shell: true };
  // Other tools can name source files/URLs, but do not acquire an exemption.
  return { text };
}
function classifySearch({ query, repoOnly, network }, github, engineRoots) {
  const { text, valid } = canonicalText(query);
  if (readsLocalSource(text, engineRoots)) return "source-read";
  if (valid && issueSearch(text, { repoOnly })) return "issue-lookup";
  return github || network || touchesGitHub(text) ? "source-read" : "other";
}
function shellWriteStatus(event, result) {
  if (
    result?.command ===
      (event.input?.command ?? event.input?.cmd ?? event.input) &&
    Number.isInteger(result?.exit)
  )
    return result.exit === 0 ? "completed" : "failed";
  if (typeof result?.toolError === "boolean")
    return result.toolError ? "failed" : "completed";
  return "unverified";
}
/**
 * V8 measures honest agents' natural source reading, not interpreter capability
 * and not a sandbox. Split static shell commands, classify each part here, and
 * aggregate source-read > issue/library lookup > other. Local scripts and
 * filesystem-only bodies are other unless they name a local engine path.
 * Unknown commands earn no exemption; source defaults require textual network
 * evidence, an unresolved GitHub fragment, or an unlisted/dynamic network target.
 * Repository download tools count like clones; literal interpreter GETs use
 * this same URL policy. Help and archives without --remote are local.
 * Opaque IPs, redirectors and deliberate obfuscation remain static-analysis
 * limits. Runtime egress logging is the separate adversarial control, owned by
 * helm and not implemented here. Obfuscated bypasses are follow-ups under the
 * stopping rule; honest-form and legitimate-lookup regressions remain blocking.
 */
export function classifyToolCall(
  event,
  { engineRoots = [], allowedLibraryPaths = [], result, laterShell = "" } = {},
) {
  const github = [event.name, event.server, event.tool].some(
    (value) => typeof value === "string" && /github/i.test(value),
  );
  if (!github && /^(?:write|todowrite|todo_list)$/i.test(event.name))
    return { class: "other" };
  if (github) {
    const proven = githubEvidence(event, result);
    if (proven) return proven;
  }
  const call = request(event, github, result, laterShell);
  if (call.shell) {
    const parts = call.parts ?? [{ text: call.text, tokens: null }];
    const attemptedWrites = [];
    const status =
      parts.length === 1 && !parts[0].heredoc
        ? shellWriteStatus(event, result)
        : "unverified";
    const outcomes = parts.map(({ text, tokens, heredoc }) => {
      const words =
        tokens ?? shellWords(decodedShellBody(text), { literal: true });
      const writes = shellGitHubWrites(words, heredoc);
      if (writes) {
        for (let i = 0; i < writes; i++) attemptedWrites.push(status);
        return { class: "source-read" };
      }
      return classifyRequest(
        shellRequest(text, tokens, heredoc),
        false,
        [],
        allowedLibraryPaths,
      );
    });
    const classified =
      readsLocalSource(call.text, engineRoots) || attemptedWrites.length
        ? { class: "source-read" }
        : aggregateParts(outcomes);
    return attemptedWrites.length
      ? { ...classified, attemptedWrites }
      : classified;
  }
  return classifyRequest(call, github, engineRoots, allowedLibraryPaths);
}
function classifyRequest(call, github, engineRoots, allowedLibraryPaths) {
  if (call.requests)
    return aggregateParts(
      call.requests.map((part) =>
        classifyRequest(part, github, engineRoots, allowedLibraryPaths),
      ),
    );
  if (Object.hasOwn(call, "query"))
    return { class: classifySearch(call, github, engineRoots) };
  const canonical = canonicalUrl(call.target);
  const text =
    call.text === undefined ? canonical.text : canonicalText(call.text).text;
  const local = readsLocalSource(call.text ?? call.target ?? "", engineRoots);
  const understood = call.safe && canonical.valid && canonical.url;
  if (!local && understood) {
    if (jsonHeaders(call.headers) && issueUrl(canonical.url))
      return { class: "issue-lookup" };
    if (
      jsonHeaders(call.headers, true) &&
      allowedLibraryUrl(canonical.url, allowedLibraryPaths, call.target)
    )
      return { class: "other", libraryAcquisition: true };
  }
  const source =
    local ||
    github ||
    (!call.localBody &&
      (touchesGitHub(text) ||
        touchesGitHub(canonical.url?.href ?? canonical.text) ||
        (call.shell && githubFragment(text)))) ||
    (call.shell && call.network);
  return { class: source ? "source-read" : "other" };
}
