import { constants, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export const captureSuffixes = [".out", ".err", ".counts"];

// Both the agent and protected flush start with a harness-created directory.
// The shim opens existing files relative to its descriptor after launch.
export function initAudit(
  directory,
  log = "shim.jsonl",
  errors = "shim-errors.jsonl",
) {
  mkdirSync(directory, { mode: 0o700 });
  for (const name of [
    log,
    errors,
    log + ".state.json",
    ...captureSuffixes.map((suffix) => log + ".capture" + suffix),
  ])
    writeFileSync(join(directory, name), "", { flag: "wx", mode: 0o600 });
}
export function openAuditFile(reader, path, flags = constants.O_RDWR) {
  return reader.openFile(basename(path), flags);
}
