import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node CLI flags whose separate next token is a value rather than a new flag.
const EXEC_ARG_WITH_VALUE = new Set([
  "-r",
  "--require",
  "--import",
  "-C",
  "--conditions",
  "--loader",
  "--experimental-loader",
  "--input-type",
  "--redirect-warnings",
  "--title",
]);

function isEvalOrPrintInvocation(execArgv) {
  if (!Array.isArray(execArgv)) return false;
  for (let index = 0; index < execArgv.length; index++) {
    const arg = execArgv[index];
    if (typeof arg !== "string") continue;
    if (arg === "--") break;
    if (EXEC_ARG_WITH_VALUE.has(arg)) {
      index++;
      continue;
    }
    if (
      arg === "-e" ||
      arg === "--eval" ||
      arg.startsWith("--eval=") ||
      arg === "-p" ||
      arg === "--print" ||
      arg.startsWith("--print=") ||
      /^-[^-]*[ep]/.test(arg)
    )
      return true;
  }
  return false;
}

export function isMainModule(
  meta,
  argv1 = process.argv[1],
  execArgv = process.execArgv,
) {
  if (typeof meta?.main === "boolean") return meta.main;
  if (meta?.main !== undefined) return false;
  if (typeof argv1 !== "string" || !argv1 || isEvalOrPrintInvocation(execArgv))
    return false;
  try {
    return realpathSync(fileURLToPath(meta.url)) === realpathSync(argv1);
  } catch {
    return false;
  }
}
