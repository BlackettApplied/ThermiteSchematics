import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { freshEnvironment, assertIsolation } from "./launch.mjs";
import {
  seedCodexAuth,
  preflightAuth,
  secretValues,
  redactSecrets,
} from "./auth.mjs";
const secret = "synthetic-auth-credential-123456789";
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "eval-auth-unit-")),
    project = join(root, "project");
  mkdirSync(project);
  return {
    root,
    project,
    env: freshEnvironment(
      join(root, "isolated"),
      { PATH: process.env.PATH, CODEX_API_KEY: secret, UNWANTED_MEMORY: "x" },
      { engineRoots: ["/engine"] },
    ),
  };
};
it("auth allowlist preserves CODEX_API_KEY, excludes config, and removes checkout PATH entries", () => {
  const w = fixture();
  try {
    expect(w.env.CODEX_API_KEY).toBe(secret);
    expect(w.env.UNWANTED_MEMORY).toBeUndefined();
    const engine = join(w.root, "engine"),
      checkoutBin = join(engine, "node_modules", ".bin"),
      externalBin = join(w.root, "external-bin");
    mkdirSync(checkoutBin, { recursive: true });
    mkdirSync(externalBin);
    const env = freshEnvironment(
      join(w.root, "fresh"),
      { PATH: [checkoutBin, externalBin].join(delimiter) },
      { engineRoots: [engine] },
    );
    expect(env.PATH).toBe(externalBin);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
it("auth-only CODEX_HOME permits exactly auth.json", () => {
  const w = fixture();
  try {
    const path = join(w.root, "original.json"),
      before = JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: secret,
          refresh_token: "synthetic-refresh-token",
        },
        last_refresh: new Date().toISOString(),
      });
    writeFileSync(path, before);
    expect(seedCodexAuth(w.env, path)).toBe(true);
    expect(
      assertIsolation(w.project, w.env, { codexAuth: true }).asserted,
    ).toBe(true);
    writeFileSync(
      join(w.env.CODEX_HOME, "config.toml"),
      "instructions='forbidden'",
    );
    expect(() =>
      assertIsolation(w.project, w.env, { codexAuth: true }),
    ).toThrow();
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
const authNow = Date.parse("2026-01-20T01:00:00Z"),
  scheduledRefresh = 8 * 24 * 60 * 60_000,
  runTimeout = 15 * 60_000;
const accessToken = (expires) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: expires / 1000 })).toString("base64url")}.synthetic-signature`;

it.each([
  ["missing refresh date", undefined, secret],
  ["invalid refresh date", "invalid", secret],
  ["future refresh date", new Date(authNow + 60_000).toISOString(), secret],
  [
    "scheduled refresh during the run",
    new Date(authNow - scheduledRefresh + runTimeout).toISOString(),
    secret,
  ],
  [
    "access token expires during the run",
    new Date(authNow).toISOString(),
    accessToken(authNow + runTimeout),
  ],
  [
    "access token expires in the setup margin",
    new Date(authNow).toISOString(),
    accessToken(authNow + runTimeout + 8 * 60_000),
  ],
])(
  "auth seeding refuses %s before copying ChatGPT credentials",
  (label, last_refresh, access_token) => {
    const w = fixture();
    try {
      const path = join(w.root, "original.json");
      writeFileSync(
        path,
        JSON.stringify({
          auth_mode: "chatgpt",
          last_refresh,
          tokens: { access_token },
        }),
      );
      expect(() =>
        seedCodexAuth(w.env, path, { timeoutMs: runTimeout, now: authNow }),
      ).toThrow(/run your own Codex installation/i);
      expect(existsSync(join(w.env.CODEX_HOME, "auth.json"))).toBe(false);
    } finally {
      rmSync(w.root, { recursive: true, force: true });
    }
  },
);
it("auth seeding accepts a ChatGPT login fresh for the run", () => {
  const w = fixture();
  try {
    const path = join(w.root, "original.json");
    writeFileSync(
      path,
      JSON.stringify({
        last_refresh: new Date(authNow).toISOString(),
        tokens: { access_token: accessToken(authNow + 60 * 60_000) },
      }),
    );
    expect(
      seedCodexAuth(w.env, path, { timeoutMs: runTimeout, now: authNow }),
    ).toBe(true);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
it("auth rejects instruction data", () => {
  const w = fixture();
  try {
    const path = join(w.root, "auth.json");
    writeFileSync(
      path,
      JSON.stringify({ OPENAI_API_KEY: secret, instructions: "not auth" }),
    );
    expect(() => seedCodexAuth(w.env, path)).toThrow(/non-auth/);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
it("pre-flight exercises both recipes with no model command and never retains secret streams", async () => {
  const w = fixture();
  try {
    const code = `const fs=require('fs'),p=require('path');if(process.argv.includes('--with-api-key')){fs.writeFileSync(p.join(process.env.CODEX_HOME,'auth.json'),JSON.stringify({OPENAI_API_KEY:fs.readFileSync(0,'utf8')}));console.log('secret '+process.env.CODEX_API_KEY);}else if(process.argv.includes('auth'))console.log(JSON.stringify({loggedIn:!!process.env.CLAUDE_CODE_OAUTH_TOKEN,token:process.env.CLAUDE_CODE_OAUTH_TOKEN}));else{console.error('key '+process.env.CODEX_API_KEY);process.exitCode=fs.existsSync(p.join(process.env.CODEX_HOME,'auth.json'))?0:1;}`;
    const options = { binary: process.execPath, prefix: ["-e", code, "--"] };
    expect(await preflightAuth("codex", w.env, options)).toEqual({
      ok: true,
      agent: "codex",
      billing: "api",
      reason: null,
    });
    expect(existsSync(join(w.env.CODEX_HOME, "auth.json"))).toBe(true);
    w.env.CLAUDE_CODE_OAUTH_TOKEN = secret;
    const status = await preflightAuth("claude", w.env, options);
    expect(status.ok).toBe(true);
    expect(status.billing).toBe("subscription-oauth");
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(redactSecrets(`error ${secret}`, secretValues(w.env))).not.toContain(
      secret,
    );
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
