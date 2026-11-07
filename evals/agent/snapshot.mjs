// Shared by the ported GI shim and the independent boundary checker.
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { join } from "node:path";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function snapshot(
  root,
  { documents = true, includeGit = !documents } = {},
) {
  const files = {},
    docs = {},
    invalidJsonFiles = [];
  const walk = (dir, prefix = "") => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git" && !includeGit) continue;
      const path = join(dir, name),
        key = prefix + name,
        stat = lstatSync(path);
      if (stat.isSymbolicLink())
        files[key] = sha256("symlink:" + readlinkSync(path));
      else if (stat.isDirectory()) {
        files[key + "/"] = "directory";
        walk(path, key + "/");
      } else if (stat.isFile()) {
        const bytes = readFileSync(path);
        files[key] = sha256(bytes);
        if (documents && name.endsWith(".json")) {
          try {
            docs[key] = JSON.parse(bytes);
          } catch {
            docs[key] = { $invalidJSON: true };
            invalidJsonFiles.push(key);
          }
        }
      } else files[key] = "special:" + stat.mode;
    }
  };
  if (root && existsSync(root)) walk(root);
  return {
    files,
    documents: docs,
    invalidJsonFiles,
    hash: sha256(JSON.stringify(files)),
  };
}
export function diff(before, after) {
  const a = before?.files ?? {},
    b = after?.files ?? {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((path) => a[path] !== b[path])
    .map((path) => ({
      path,
      change: !(path in a) ? "created" : !(path in b) ? "deleted" : "modified",
    }));
}
