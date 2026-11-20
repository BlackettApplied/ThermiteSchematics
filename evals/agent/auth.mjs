import assert from "node:assert/strict";
import { captureProcess } from "./process.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
export const credentialKeys = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
];
const codexRefreshIntervalMs = 8 * 24 * 60 * 60_000;
// Codex can refresh five minutes before expiry. Allow another five for setup.
const codexRefreshMarginMs = 10 * 60_000;

export function validateAuth(bytes) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error("Invalid auth JSON");
  }
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "Invalid auth file",
  );
  assert(
    Object.keys(value).every((k) =>
      ["auth_mode", "OPENAI_API_KEY", "tokens", "last_refresh"].includes(k),
    ),
    "Auth file contains non-auth fields",
  );
  assert(
    typeof value.OPENAI_API_KEY === "string" ||
      (value.tokens && typeof value.tokens.access_token === "string"),
    "Auth file has no credentials",
  );
  return value;
}
function accessTokenExpiry(token) {
  const parts = token?.split(".");
  if (parts?.length !== 3) return null;
  try {
    const expiry = JSON.parse(Buffer.from(parts[1], "base64url")).exp;
    return Number.isFinite(expiry) ? expiry * 1000 : null;
  } catch {
    return null;
  }
}
export function seedCodexAuth(
  env,
  source,
  { timeoutMs = 0, now = Date.now() } = {},
) {
  if (!source) return false;
  const bytes = readFileSync(resolve(source));
  const auth = validateAuth(bytes);
  const apiKeyMode =
    (auth.auth_mode ?? (auth.OPENAI_API_KEY ? "apikey" : "chatgpt")) ===
    "apikey";
  if (!apiKeyMode && typeof auth.tokens?.access_token === "string") {
    const lastRefresh =
        typeof auth.last_refresh === "string"
          ? Date.parse(auth.last_refresh)
          : NaN,
      expires = accessTokenExpiry(auth.tokens.access_token),
      horizon = now + timeoutMs + codexRefreshMarginMs;
    if (
      !Number.isFinite(lastRefresh) ||
      lastRefresh > now ||
      lastRefresh + codexRefreshIntervalMs <= horizon ||
      (expires !== null && expires <= horizon)
    )
      throw Object.assign(
        new Error(
          "Codex ChatGPT login may need a refresh during this run. Run your own Codex installation once to refresh the operator login. If it still fails this check, sign in again and retry.",
        ),
        { stage: "authentication" },
      );
  }
  writeFileSync(join(env.CODEX_HOME, "auth.json"), bytes, {
    mode: 0o600,
    flag: "wx",
  });
  return true;
}
export function secretValues(env) {
  const values = credentialKeys.map((key) => env[key]).filter(Boolean);
  try {
    const auth = JSON.parse(
      readFileSync(join(env.CODEX_HOME, "auth.json"), "utf8"),
    );
    if (auth.OPENAI_API_KEY) values.push(auth.OPENAI_API_KEY);
    for (const value of Object.values(auth.tokens ?? {}))
      if (typeof value === "string") values.push(value);
  } catch {}
  return values
    .filter((value) => value.length >= 8)
    .sort((a, b) => b.length - a.length);
}
export function redactSecrets(text, values) {
  let out = String(text);
  for (const value of values) out = out.replaceAll(value, "<credential>");
  return out;
}
export function redactAgentOutput(text, values) {
  return redactSecrets(text, values)
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+/g, "<credential>")
    .replace(/\b(?:sk-|rk-|sess-|rt_|at_)[\w-]{12,}/g, "<credential>");
}
export async function preflightAuth(
  agent,
  env,
  { binary = agent, prefix = [], capture = captureProcess } = {},
) {
  const key = env.CODEX_API_KEY ?? env.OPENAI_API_KEY;
  if (
    agent === "codex" &&
    key &&
    !existsSync(join(env.CODEX_HOME, "auth.json"))
  ) {
    // This is a local credential import, not a model request. Never retain its streams.
    const login = await capture(
      binary,
      [...prefix, "login", "--with-api-key"],
      {
        env,
        input: key,
        encoding: "utf8",
        timeout: 20000,
      },
    );
    if (login.status !== 0)
      return {
        ok: false,
        agent,
        billing: "api",
        reason: "credential-import-failed",
      };
  }
  const args = agent === "claude" ? ["auth", "status"] : ["login", "status"];
  const result = await capture(binary, [...prefix, ...args], {
    env,
    encoding: "utf8",
    timeout: 20000,
  });
  let ok = result.status === 0;
  if (agent === "claude")
    try {
      ok = ok && JSON.parse(result.stdout).loggedIn === true;
    } catch {
      ok = false;
    }
  let fileUsesApi = false;
  try {
    fileUsesApi = !!JSON.parse(
      readFileSync(join(env.CODEX_HOME, "auth.json"), "utf8"),
    ).OPENAI_API_KEY;
  } catch {}
  return {
    ok,
    agent,
    billing:
      agent === "claude"
        ? env.ANTHROPIC_API_KEY
          ? "api"
          : env.CLAUDE_CODE_OAUTH_TOKEN
            ? "subscription-oauth"
            : env.ANTHROPIC_AUTH_TOKEN
              ? "custom-auth-token"
              : "none"
        : key || fileUsesApi
          ? "api"
          : "chatgpt-login",
    reason: ok
      ? null
      : result.error?.code === "ENOENT"
        ? "cli-missing"
        : "not-authenticated",
  };
}
