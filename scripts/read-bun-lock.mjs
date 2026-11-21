import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

// Bun's committed text lockfile permits trailing commas; it is not strict JSON.
export async function readBunLock(repositoryRoot) {
  const path = join(repositoryRoot, "bun.lock");
  return parseBunLockText(await readFile(path, "utf8"), path);
}

export function parseBunLockText(text, path = "bun.lock") {
  const { config, error } = ts.parseConfigFileTextToJson(path, text);
  if (error)
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  if (config?.lockfileVersion !== 1 || !config.workspaces || !config.packages)
    throw new Error("Unsupported Bun lockfile structure.");
  return config;
}

export function lockedPackage(lock, name) {
  const row = lock.packages[name];
  if (
    !Array.isArray(row) ||
    !row[0]?.startsWith(`${name}@`) ||
    typeof row[3] !== "string"
  )
    throw new Error(`Missing registry lock entry for ${name}.`);
  return {
    ...row[2],
    version: row[0].slice(name.length + 1),
    integrity: row[3],
  };
}
