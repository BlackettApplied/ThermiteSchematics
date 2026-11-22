// Interpret protocol fields and embedded JSON envelopes, never prose keywords.
const canonical = (code) =>
  String(code ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
const groups = {
  billing: [
    "billing_error",
    "insufficient_quota",
    "billing_hard_limit_reached",
    "billing_not_active",
  ],
  "rate-limit": ["rate_limit", "rate_limit_error", "rate_limit_exceeded"],
  authentication: [
    "authentication_error",
    "authentication_failed",
    "unauthorized",
    "invalid_api_key",
    "permission_error",
    "oauth_org_not_allowed",
    "verification_required",
    "cloud_credential_error",
  ],
  quota: [
    "usage_limit_exceeded",
    "session_budget_exceeded",
    "quota_exceeded",
    "usage_limit_reached",
    "usage_not_included",
  ],
  configuration: [
    "account_on_hold",
    "model_not_found",
    "invalid_model",
    "unsupported_model",
    "model_not_supported",
  ],
  network: [
    "http_connection_failed",
    "http_connection_dropped",
    "http_request_timeout",
    "response_stream_disconnected",
    "response_stream_connection_failed",
    "response_too_many_failed_attempts",
    "stream_disconnected",
    "transport_error",
    "network_error",
    "econnreset",
    "econnrefused",
    "enotfound",
    "etimedout",
  ],
  provider: [
    "server_overloaded",
    "overloaded_error",
    "overloaded",
    "api_error",
    "server_error",
    "internal_server_error",
    "flex_unavailable",
  ],
};
// Retry hints are protocol data, never extracted from human-readable messages.
export function retryTimestamp(value, now = Date.now(), depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    try {
      return retryTimestamp(JSON.parse(value), now, depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object") return null;
  const times = [];
  const duration = (v) => {
    if (typeof v === "number" || /^\d+(?:\.\d+)?$/.test(String(v)))
      return Number(v) * 1000;
    if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(String(v)))
      return [...String(v).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce(
        (n, [, number, unit]) =>
          n + Number(number) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit],
        0,
      );
    return null;
  };
  for (const [raw, v] of Object.entries(value)) {
    const key = raw
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replaceAll("-", "_");
    let time = null;
    if (["retry_after_ms", "retry_after_milliseconds"].includes(key))
      time = now + Number(v);
    else if (["retry_after", "retry_after_seconds"].includes(key))
      time = duration(v) == null ? Date.parse(v) : now + duration(v);
    else if (
      [
        "resets_at",
        "reset_at",
        "reset",
        "rate_limit_reset_at",
        "overage_resets_at",
        "x_ratelimit_reset_requests",
        "x_ratelimit_reset_tokens",
      ].includes(key)
    ) {
      const n = Number(v);
      time = Number.isFinite(n)
        ? n * (n < 1e12 ? 1000 : 1)
        : duration(v) == null
          ? Date.parse(v)
          : now + duration(v);
    }
    if (Number.isFinite(time) && time > now) times.push(time);
    if ((v && typeof v === "object") || ["message", "error"].includes(key)) {
      const nested = retryTimestamp(v, now, depth + 1);
      if (nested) times.push(nested);
    }
  }
  return times.length ? Math.max(...times) : null;
}
function agentOutcomeError(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === "string") {
    try {
      return agentOutcomeError(JSON.parse(value), depth + 1);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value))
    return value.some((v) => agentOutcomeError(v, depth + 1));
  if (typeof value !== "object") return false;
  return (
    [
      value.code,
      value.type,
      typeof value.codex_error_info === "string"
        ? value.codex_error_info
        : null,
      typeof value.codexErrorInfo === "string" ? value.codexErrorInfo : null,
      ...Object.keys(
        value.codex_error_info ?? value.codexErrorInfo ?? {},
      ).filter((k) => !/^\d+$/.test(k)),
    ].some((c) =>
      [
        "context_length_exceeded",
        "context_window_exceeded",
        "prompt_too_long",
        "input_too_long",
        "request_too_large",
        "max_tokens_exceeded",
        "invalid_prompt",
      ].includes(canonical(c)),
    ) ||
    agentOutcomeError(value.error, depth + 1) ||
    agentOutcomeError(value.message, depth + 1)
  );
}
export function infrastructureSignal(value, depth = 0) {
  if (depth > 6 || value == null || agentOutcomeError(value)) return null;
  if (typeof value === "string") {
    try {
      return infrastructureSignal(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value))
    return (
      value.map((v) => infrastructureSignal(v, depth + 1)).find(Boolean) ?? null
    );
  if (typeof value !== "object") return null;
  const nested = infrastructureSignal(value.error, depth + 1);
  const info = value.codex_error_info ?? value.codexErrorInfo;
  const signals = [];
  if (nested) signals.push(nested);
  if (typeof info === "string")
    signals.push(infrastructureSignal({ code: info }, depth + 1));
  else if (info && typeof info === "object")
    for (const [code, data] of Object.entries(info))
      signals.push(
        infrastructureSignal(
          { code, ...(typeof data === "object" ? data : {}) },
          depth + 1,
        ),
      );
  for (const code of [value.code, value.type])
    if (code) {
      const key = canonical(code);
      for (const [kind, codes] of Object.entries(groups))
        if (codes.includes(key)) signals.push({ kind, code: String(code) });
    }
  // Billing/quota identity overrides a generic HTTP 429 or wrapper type.
  const identified = signals.filter(Boolean);
  const status =
    value.status ??
    value.status_code ??
    value.http_status_code ??
    value.httpStatusCode ??
    value.api_error_status;
  const billing = identified.find((s) => s.kind === "billing");
  if (billing) return billing;
  const quota = identified.find((s) => s.kind === "quota");
  if (quota) return quota;
  const rate = identified.find((s) => s.kind === "rate-limit");
  if (rate || status === 429)
    return rate ?? { kind: "rate-limit", code: "429" };
  if ([401, 403].includes(status))
    return (
      identified.find((s) => s.kind === "authentication") ?? {
        kind: "authentication",
        code: String(status),
      }
    );
  if (status === 529) return { kind: "provider", code: "overloaded" };
  if (identified.length) return identified[0];
  if (
    [value.type, value.code].some((code) =>
      ["invalid_request_error", "bad_request"].includes(canonical(code)),
    )
  ) {
    const subtype = canonical(value.subtype ?? value.reason ?? value.param);
    if (["model", "model_id", "model_name"].includes(subtype))
      return { kind: "configuration", code: subtype };
    if (
      ["auth", "authentication", "api_key", "authorization"].includes(subtype)
    )
      return { kind: "authentication", code: subtype };
    const typed = infrastructureSignal({ code: subtype }, depth + 1);
    if (typed && ["configuration", "authentication"].includes(typed.kind))
      return typed;
  }
  if ([408, 500, 502, 503, 504].includes(status))
    return { kind: "network", code: String(status) };
  // Codex exec may wrap a provider's JSON object in error.message.
  return infrastructureSignal(value.message, depth + 1);
}

export function knownAgentError(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (agentOutcomeError(value)) return true;
  if (typeof value === "string") {
    try {
      return knownAgentError(JSON.parse(value), depth + 1);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value))
    return value.some((v) => knownAgentError(v, depth + 1));
  if (typeof value !== "object") return false;
  const codes = [value.code, value.type, value.subtype];
  return (
    codes.some((c) =>
      [
        "invalid_request_error",
        "invalid_request",
        "bad_request",
        "max_output_tokens",
        "error_max_turns",
        "error_max_budget_usd",
        "reference_error",
      ].includes(canonical(c)),
    ) ||
    knownAgentError(value.error, depth + 1) ||
    knownAgentError(value.message, depth + 1)
  );
}
