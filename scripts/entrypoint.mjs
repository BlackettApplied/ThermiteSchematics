import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainModule(meta, argv1 = process.argv[1]) {
  if (typeof meta?.main === "boolean") return meta.main;
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(meta.url)) === realpathSync(argv1);
  } catch {
    return false;
  }
}
