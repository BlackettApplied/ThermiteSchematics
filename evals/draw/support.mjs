import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
export const hash = (x) => createHash("sha256").update(x).digest("hex");
export const round = (x) => Math.round(x * 1000) / 1000;
export function canonical(x) {
  if (typeof x === "number") {
    if (!Number.isFinite(x)) throw Error("Nonfinite measurement");
    return round(x);
  }
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === "object")
    return Object.fromEntries(
      Object.keys(x)
        .sort()
        .filter((k) => x[k] !== undefined)
        .map((k) => [k, canonical(x[k])]),
    );
  return x;
}
export const json = (x) => JSON.stringify(canonical(x), null, 2) + "\n";
export const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const activeChildren = new Set();
export const stopCommands = () => {
  for (const child of activeChildren) child.kill("SIGTERM");
};
export function command(cwd, executable, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren.add(child);
    let stdout = "",
      stderr = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      if (timedOut) reject(Error(`Timeout: ${args[0]}`));
      else resolve({ code, stdout, stderr });
    });
  });
}
export async function pool(items, action, limit = 2) {
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await action(items[i], i);
      }
    }),
  );
  return results;
}
export const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
