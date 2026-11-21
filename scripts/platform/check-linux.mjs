import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const platform =
  args[1] ?? `linux/${process.arch === "arm64" ? "arm64" : "amd64"}`;
if (
  (args.length !== 0 && (args.length !== 2 || args[0] !== "--platform")) ||
  !["linux/arm64", "linux/amd64"].includes(platform)
)
  throw new Error(
    "Usage: bun run check:linux [--platform linux/arm64|linux/amd64]",
  );
const temporary = await mkdtemp(
  join(await realpath(tmpdir()), "thermite-linux-"),
);
const source = join(temporary, "source");
const name = `thermite-linux-${process.pid}-${Date.now()}`;
const image = `${name}:check`;
const container = `${name}-package`;
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
try {
  // Only Git-tracked and unignored files enter Docker's build context. Cloning
  // preserves the source commit without copying local credentials or Git config.
  run("git", [
    "clone",
    "--quiet",
    "--no-local",
    "--single-branch",
    "--depth=1",
    "--no-tags",
    root,
    source,
  ]);
  const files = new Set(
    run(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        stdio: "pipe",
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
      },
    )
      .split("\0")
      .filter(Boolean),
  );
  // A staged deletion/rename disappears from the host index but is still in
  // HEAD. Remove those paths from the clone before applying working-tree bytes.
  const clonedFiles = run("git", ["ls-files", "-z"], {
    cwd: source,
    stdio: "pipe",
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const file of clonedFiles)
    if (!files.has(file)) await rm(join(source, file), { force: true });
  for (const file of files) {
    const input = join(root, file),
      output = join(source, file);
    let status;
    try {
      status = await lstat(input);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await rm(output, { force: true });
      continue;
    }
    if (!status.isFile() || status.nlink !== 1)
      throw new Error(`Nonordinary source input: ${file}`);
    await mkdir(dirname(output), { recursive: true });
    await cp(input, output);
  }
  run("docker", [
    "build",
    "--platform",
    platform,
    "-t",
    image,
    "-f",
    join(source, "scripts/platform/Dockerfile"),
    source,
  ]);
  // --init reaps worker descendants when process-group interruption is tested.
  // Full development checks include registry installation probes; package
  // acceptance is a separate container whose network is actually disabled.
  run("docker", ["run", "--rm", "--init", "--platform", platform, image]);
  run("docker", [
    "run",
    "--init",
    "--name",
    container,
    "--network=none",
    "--platform",
    platform,
    image,
    "bun",
    "run",
    "package:pack",
    "--preview",
  ]);
  const output = join(root, "release-out", "platform", name);
  await mkdir(output, { recursive: true });
  run("docker", ["cp", `${container}:/work/release-out/runtime/.`, output]);
  process.stdout.write(
    `Linux checks passed (${platform}); preview artifacts: ${output}\n`,
  );
} finally {
  for (const args of [
    ["rm", "-f", container],
    ["image", "rm", image],
  ]) {
    try {
      run("docker", args, { stdio: "ignore" });
    } catch {}
  }
  await rm(temporary, { recursive: true, force: true });
}
