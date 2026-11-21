import { execFile } from "node:child_process";
// Buffered subprocesses with spawnSync-compatible results, without blocking
// sibling exit handling. Callers never print input (which may be credentials).
export function captureProcess(
  binary,
  args,
  { input, onChild, ...options } = {},
) {
  return new Promise((resolve) => {
    const child = execFile(
      binary,
      args,
      { encoding: "utf8", maxBuffer: 64 << 20, ...options },
      (error, stdout, stderr) =>
        resolve({
          status: error
            ? typeof error.code === "number"
              ? error.code
              : null
            : 0,
          signal: error?.signal ?? null,
          error: error && typeof error.code !== "number" ? error : null,
          stdout,
          stderr,
        }),
    );
    onChild?.(child);
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
