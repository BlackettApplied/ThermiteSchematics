import assert from "node:assert/strict";
import { captureProcess } from "./process.mjs";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { sha256 } from "./snapshot.mjs";
export const credentialKeys = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
];
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
export function seedCodexAuth(env, source) {
  if (!source) return null;
  const path = resolve(source),
    bytes = readFileSync(path);
  validateAuth(bytes);
  writeFileSync(join(env.CODEX_HOME, "auth.json"), bytes, {
    mode: 0o600,
    flag: "wx",
  });
  return { path, hash: sha256(bytes) };
}
export function refreshCodexAuth(seed, env) {
  if (!seed) return { changed: false };
  const path = join(env.CODEX_HOME, "auth.json");
  if (!existsSync(path)) return { changed: false };
  const bytes = readFileSync(path);
  validateAuth(bytes);
  if (sha256(bytes) === seed.hash) return { changed: false };
  assert(
    sha256(readFileSync(seed.path)) === seed.hash,
    "Auth write-back conflict; original changed during run",
  );
  const backup = seed.path + `.backup-${Date.now()}-${process.pid}`;
  writeFileSync(backup, readFileSync(seed.path), { mode: 0o600, flag: "wx" });
  const temporary = seed.path + `.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, seed.path);
  return { changed: true, backupCreated: true };
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
