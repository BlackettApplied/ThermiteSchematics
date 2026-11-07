import {
  infrastructureSignal,
  retryTimestamp,
  knownAgentError,
} from "./event-errors.mjs";
import { terminalProtocol } from "./cli-protocol.mjs";
// Normalize both CLI streams. Truncated/noisy runs retain lower-bound usage.
export function normalizeTranscript(
  input,
  { now = Date.now(), agent, cliVersion } = {},
) {
  const parseWarnings = [];
  const rows =
    typeof input === "string"
      ? input.split(/\r?\n/).flatMap((line, index) => {
          if (!line.trim()) return [];
          try {
            return [JSON.parse(line)];
          } catch {
            parseWarnings.push({ line: index + 1, kind: "non-json-event" });
            return [];
          }
        })
      : (input ?? []);
  const events = [],
    tools = new Set(),
    messages = new Map();
  let finalMessage = "",
    resultUsage = null,
    modelUsage = null,
    reportedCostUSD = null,
    hasCompletion = false,
    terminalError = false,
    agentError = false,
    infrastructureError = null;
  const codexUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const issues = [];
  let position = 0,
    lastSuccess = -1,
    successfulCompletion = false,
    infrastructureKind = null,
    retryAt = null,
    recoveredThrough = -1,
    needsAdjudication = false,
    terminalTemplate = null;
  const clearCause = () => {
    infrastructureError = null;
    infrastructureKind = null;
    retryAt = null;
    agentError = false;
    needsAdjudication = false;
    terminalTemplate = null;
  };
  const progress = () => {
    if (terminalError) {
      terminalError = false;
      hasCompletion = false;
    }
    recoveredThrough = position;
    clearCause();
  };
  const classifyError = (error, { replace = false, protocol = null } = {}) => {
    const signal =
      infrastructureSignal(error) ??
      (protocol && protocol.kind !== "agent" ? protocol : null);
    const isAgent =
      protocol?.kind === "agent" || (!signal && knownAgentError(error));
    if (replace || isAgent) clearCause();
    const nextReset = retryTimestamp(error, now);
    retryAt =
      retryAt && nextReset
        ? Math.max(retryAt, nextReset)
        : (retryAt ?? nextReset);
    const strength = (kind) =>
      ({ billing: 4, quota: 3, "rate-limit": 2 })[kind] ?? 1;
    if (signal) {
      const kind =
        signal.kind === "rate-limit" && retryAt - now > 15 * 60000
          ? "quota"
          : signal.kind;
      if (
        !infrastructureError ||
        strength(kind) >= strength(infrastructureKind)
      ) {
        infrastructureError = signal.code;
        infrastructureKind = kind;
      }
      agentError = false;
      needsAdjudication = false;
    } else if (!infrastructureError) {
      agentError = isAgent;
      needsAdjudication = !isAgent;
    }
    if (protocol)
      terminalTemplate = { id: protocol.id, version: protocol.version };
    issues.push({
      position,
      type: "retry",
      kind: signal?.kind ?? "unstructured",
      code: signal?.code ?? null,
    });
  };
  for (const row of rows) {
    position++;
    if (row.type === "turn.started") {
      progress();
      hasCompletion = false;
      successfulCompletion = false;
      terminalError = false;
    }
    const limitInfo = row.rate_limit_info ?? row.rateLimitInfo ?? {};
    const usingOverage =
      limitInfo.isUsingOverage === true ||
      limitInfo.overageInUse === true ||
      (limitInfo.isUsingOverage == null &&
        limitInfo.overageInUse == null &&
        ["allowed", "allowed_warning"].includes(limitInfo.overageStatus));
    if (
      ["rate_limit", "rate_limit_event"].includes(row.type) &&
      usingOverage &&
      ["quota", "rate-limit"].includes(infrastructureKind)
    )
      progress();
    if (
      ["rate_limit", "rate_limit_event"].includes(row.type) &&
      !["allowed", "allowed_warning"].includes(limitInfo.status) &&
      !usingOverage
    )
      classifyError({
        ...row,
        type:
          limitInfo.status === "rejected"
            ? "usage_limit_exceeded"
            : "rate_limit",
      });
    if (row.type === "assistant") {
      if (!row.error && row.message?.content?.length) progress();
      if (row.error)
        classifyError({
          ...row,
          error:
            typeof row.error === "string" ? { type: row.error } : row.error,
        });
      const id = row.message?.id ?? row.uuid ?? `message-${messages.size}`,
        u = row.message?.usage;
      if (u) {
        const old = messages.get(id) ?? {};
        messages.set(
          id,
          Object.fromEntries(
            [
              "input_tokens",
              "cache_creation_input_tokens",
              "cache_read_input_tokens",
              "output_tokens",
            ].map((k) => [k, Math.max(old[k] ?? 0, u[k] ?? 0)]),
          ),
        );
      }
      const text = [];
      for (const block of row.message?.content ?? []) {
        if (block.type === "tool_use" && !tools.has(block.id)) {
          tools.add(block.id);
          events.push({
            type: "tool",
            id: block.id,
            name: block.name,
            input: block.input,
            time: row.timestamp ?? null,
          });
        }
        if (block.type === "text") {
          text.push(block.text);
          events.push({ type: "message", text: block.text });
        }
      }
      if (text.length) finalMessage = text.join("\n");
    }
    if (
      row.type === "user" &&
      row.message?.content?.some((b) => b.type === "tool_result")
    )
      progress();
    if (row.type === "user")
      for (const block of row.message?.content ?? [])
        if (block.type === "tool_result")
          events.push({
            type: "tool-result",
            id: block.tool_use_id,
            output: block.content,
          });
    if (row.type === "result") {
      const typed = (value) => {
        if (typeof value === "string") {
          try {
            return typed(JSON.parse(value));
          } catch {
            return false;
          }
        }
        if (Array.isArray(value)) return value.some(typed);
        return (
          !!value &&
          typeof value === "object" &&
          (value.code ||
            value.type ||
            value.codex_error_info ||
            value.codexErrorInfo ||
            typed(value.error))
        );
      };
      const pending =
        (infrastructureError || needsAdjudication || agentError) &&
        ["success", "error_during_execution"].includes(row.subtype) &&
        !typed(row.error ?? row.errors)
          ? {
              infrastructureError,
              infrastructureKind,
              retryAt,
              needsAdjudication,
              agentError,
            }
          : null;
      const terminal = {
        ...row,
        error: row.errors?.length
          ? row.errors
          : (row.error ?? { type: row.subtype }),
      };
      // Another infra row stays in the same no-progress window. A specific
      // agent/unknown terminal identity still replaces the pending cause.
      if (!pending && !infrastructureSignal(terminal)) clearCause();
      hasCompletion = true;
      finalMessage = row.result ?? finalMessage;
      resultUsage = row.usage ?? null;
      modelUsage = row.modelUsage ?? null;
      reportedCostUSD = row.total_cost_usd ?? null;
      if (row.is_error || (row.subtype && row.subtype !== "success")) {
        terminalError = true;
        successfulCompletion = false;
        classifyError(terminal);
        if (!infrastructureError && pending) {
          infrastructureError = pending.infrastructureError;
          infrastructureKind = pending.infrastructureKind;
          retryAt = pending.retryAt;
          needsAdjudication = pending.needsAdjudication;
          agentError = pending.agentError;
        }
      } else {
        terminalError = false;
        successfulCompletion = true;
        lastSuccess = position;
        progress();
      }
    }
    if (["error", "turn.failed"].includes(row.type)) {
      if (row.type === "turn.failed") {
        terminalError = true;
        successfulCompletion = false;
        hasCompletion = false;
      }
      const protocol = terminalProtocol(row, { agent, cliVersion });
      classifyError(row, {
        // A novel terminal sentence needs its own adjudication; an earlier
        // structured retry notice cannot classify an unrecognized ending.
        replace:
          row.type === "turn.failed" && !protocol && !infrastructureSignal(row),
        protocol,
      });
    }
    if (["item.started", "item.completed"].includes(row.type)) {
      const item = row.item;
      if (item && item.type !== "error") progress();
      if (
        [
          "command_execution",
          "mcp_tool_call",
          "web_search",
          "file_change",
          "image_view",
          "collab_tool_call",
          "todo_list",
        ].includes(item?.type) &&
        !tools.has(item.id)
      ) {
        tools.add(item.id);
        events.push({
          type: "tool",
          id: item.id,
          name:
            item.type === "mcp_tool_call"
              ? `${item.server}.${item.tool}`
              : item.type,
          input: item.command ?? item.arguments ?? item.changes ?? item.query,
          time: row.timestamp ?? null,
        });
      }
      if (row.type === "item.completed") {
        if (item?.type === "command_execution")
          events.push({
            type: "tool-result",
            id: item.id,
            output: item.aggregated_output,
            exit: item.exit_code,
          });
        if (item?.type === "mcp_tool_call")
          events.push({
            type: "tool-result",
            id: item.id,
            output: item.result?.content ?? item.result ?? item.error,
          });
        if (item?.type === "agent_message") {
          finalMessage = item.text;
          events.push({ type: "message", text: item.text });
        }
      }
    }
    if (row.type === "turn.completed") {
      progress();
      hasCompletion = true;
      terminalError = false;
      successfulCompletion = true;
      lastSuccess = position;
      const u = row.usage ?? {};
      codexUsage.inputTokens += u.input_tokens ?? 0;
      codexUsage.outputTokens += u.output_tokens ?? 0;
      codexUsage.cachedInputTokens += u.cached_input_tokens ?? 0;
    }
  }
  const fromClaude = (u) => ({
    inputTokens:
      (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    cachedInputTokens: u.cache_read_input_tokens ?? 0,
  });
  let usage = { ...codexUsage };
  for (const u of messages.values()) {
    const n = fromClaude(u);
    for (const k of Object.keys(usage)) usage[k] += n[k];
  }
  if (resultUsage) usage = fromClaude(resultUsage);
  if (modelUsage && Object.keys(modelUsage).length) {
    usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    for (const u of Object.values(modelUsage)) {
      usage.inputTokens +=
        (u.inputTokens ?? 0) +
        (u.cacheCreationInputTokens ?? 0) +
        (u.cacheReadInputTokens ?? 0);
      usage.outputTokens += u.outputTokens ?? 0;
      usage.cachedInputTokens += u.cacheReadInputTokens ?? 0;
    }
  }
  usage.partial = !hasCompletion || parseWarnings.length > 0;
  return {
    events,
    usage,
    modelUsage,
    reportedCostUSD,
    parseWarnings,
    finalMessage,
    totalToolCalls: events.filter((e) => e.type === "tool").length,
    successfulCompletion,
    terminalError,
    retryCount: issues.filter(
      (e) => e.position < Math.max(lastSuccess, recoveredThrough),
    ).length,
    retryEvents: issues
      .filter((e) => e.position < Math.max(lastSuccess, recoveredThrough))
      .map(({ position, ...event }) => event),
    agentError: successfulCompletion ? false : agentError,
    infrastructureError: successfulCompletion ? null : infrastructureError,
    infrastructureKind: successfulCompletion ? null : infrastructureKind,
    retryAt: successfulCompletion ? null : retryAt,
    needsAdjudication:
      !successfulCompletion && terminalError && needsAdjudication,
    terminalTemplate,
  };
}
