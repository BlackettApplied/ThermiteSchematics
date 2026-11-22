import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { shellWords } from "../../agent/acquisition-command.mjs";
import { decodedShellBody } from "../../agent/shell-parts.mjs";
import {
  contributorInvocation,
  sameContributorPath,
} from "../../agent/contributor-bun.mjs";
import { normalizeTranscript } from "../../agent/transcript.mjs";
import { focus } from "./support.mjs";

// Allow one command, optionally after cd. A pipeline or command list can
// exit successfully even when Bun failed, so it is not a receipt.
function invocation(command, project, repository) {
  if (typeof command !== "string") return null;
  const windows = process.platform === "win32";
  let tokens = shellWords(decodedShellBody(command), {
    literal: true,
    escapeBackslash: !windows,
  });
  if (!tokens) return null;
  let cwd;
  if (
    tokens[0]?.value === "cd" &&
    tokens[2]?.control &&
    tokens[2].value === "&&"
  ) {
    cwd = resolve(project, tokens[1].value);
    tokens = tokens.slice(3);
  }
  if (windows && tokens[0]?.control && tokens[0].value === "&")
    tokens = tokens.slice(1);
  if (tokens.some(({ control }) => control)) return null;
  const argv = tokens.map(({ value }) => value);
  const [executable, ...args] = argv;
  if (!executable || !/^bun(?:\.exe|\.cmd)?$/i.test(basename(executable)))
    return null;
  const bunCwd = args[0] === "--cwd" || args[0]?.startsWith("--cwd=");
  const from = cwd ?? (bunCwd ? project : repository);
  const result = contributorInvocation(args, from, focus);
  return result.kind &&
    !result.uncreditedReason &&
    sameContributorPath(result.cwd, repository)
    ? {
        kind: result.kind,
        direct: isAbsolute(executable),
        explicitCwd: cwd !== undefined || !!bunCwd,
      }
    : null;
}

export function transcriptInvocations(ctx, repository) {
  const transcript = join(ctx.evidence, "transcript.jsonl");
  if (!existsSync(transcript)) return [];
  const { events } = normalizeTranscript(readFileSync(transcript, "utf8"));
  const tools = new Map();
  const completed = [];
  for (const event of events) {
    if (event.type === "tool") tools.set(event.id, event);
    if (event.type !== "tool-result") continue;
    const tool = tools.get(event.id);
    const command =
      event.exit === 0
        ? event.command
        : tool?.name === "Bash" && event.toolError === false
          ? tool.input?.command
          : null;
    const match = invocation(command, ctx.project, repository);
    if (match) completed.push(match);
  }
  return completed;
}
