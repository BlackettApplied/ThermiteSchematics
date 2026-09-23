import { networkInterfaces } from "node:os";

export const runtimeTargets = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);
export const currentTarget = () => `${process.platform}-${process.arch}`;
export function assertRuntimePlatform() {
  if (
    globalThis.Bun?.version !== "1.4.2" ||
    !runtimeTargets.includes(currentTarget())
  )
    throw new Error(
      `Use Bun 1.4.2 on a supported runtime target (${runtimeTargets.join(", ")}).`,
    );
}

// macOS provides a per-process network sandbox. Linux acceptance can run in a
// Docker container with --network=none; inspect the actual interfaces, not an
// environment variable claiming isolation. Other hosts record no network guard.
export function consumerExecution() {
  if (process.platform === "darwin")
    return {
      command: "/usr/bin/sandbox-exec",
      prefix: [
        "-p",
        "(version 1)(allow default)(deny network*)",
        process.execPath,
      ],
      networkIsolation: "macos-sandbox",
    };
  const interfaces = Object.values(networkInterfaces()).flat().filter(Boolean);
  const loopbackOnly =
    interfaces.length > 0 && interfaces.every((entry) => entry.internal);
  return {
    command: process.execPath,
    prefix: [],
    networkIsolation:
      process.platform === "linux" && loopbackOnly
        ? "loopback-only-network-namespace"
        : "not-enforced",
  };
}
