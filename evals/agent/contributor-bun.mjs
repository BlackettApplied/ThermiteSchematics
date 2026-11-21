import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

export const ordering = "packages/query/src/ordering.ts";
const outputs = [
  ["packages/cli/dist/alpha.js", "packages/cli/src/alpha.ts"],
  ["packages/query/dist/ordering.js", ordering],
  ["packages/query/dist/ordering.d.ts", ordering],
];

// Bun's component walk can retain Windows 8.3 aliases from TEMP. The
// native filesystem lookup returns the final path that Git also reports.
const windows = process.platform === "win32";
export const contributorRealpath = windows ? realpathSync.native : realpathSync;

export function sameContributorPath(path, expected) {
  return (
    typeof path === "string" &&
    isAbsolute(path) &&
    relative(expected, path) === ""
  );
}

export function matchesContributorPath(path, expected) {
  return (
    sameContributorPath(path, expected) ||
    (windows &&
      typeof path === "string" &&
      isAbsolute(path) &&
      existsSync(path) &&
      sameContributorPath(contributorRealpath(path), expected))
  );
}

function fileEvidence(checkout, file) {
  const path = join(checkout, file);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || !sameContributorPath(contributorRealpath(path), path))
      return { file };
    return {
      file,
      modified: stat.mtimeMs,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { file };
  }
}

export function contributorBuildOutputs(checkout) {
  return outputs.map(([file, source]) => ({
    ...fileEvidence(checkout, file),
    input: fileEvidence(checkout, source),
  }));
}

export function contributorSourceDigest(checkout) {
  return fileEvidence(checkout, ordering).sha256;
}

function testResult(path) {
  try {
    const { numPassedTests, numTotalTests, numFailedTests, testResults } =
      JSON.parse(readFileSync(path, "utf8"));
    return {
      passed: numPassedTests,
      total: numTotalTests,
      failed: numFailedTests,
      files: testResults.map((test) => test.name),
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

const safeTestFlags = new Set([
  "--color",
  "--no-color",
  "--silent=true",
  "--silent=false",
  "--silent=passed-only",
]);

function uncreditedTest(cwd, arg) {
  return {
    cwd,
    kind: "focused",
    uncreditedReason: `Unsupported focused test argument: ${arg}`,
  };
}

function focusedInvocation(cwd, args, focused, isFocus) {
  const argv = ["scripts/test.mjs"];
  let hasFile = false;
  for (let index = args[0] === "--" ? 1 : 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-t" || arg === "--testNamePattern") {
      const pattern = args[index + 1];
      if (!pattern || pattern.startsWith("-")) return uncreditedTest(cwd, arg);
      argv.push(arg, pattern);
      index++;
    } else if (arg === "--silent") {
      // Vitest can otherwise consume the following filename as its value.
      argv.push("--silent=true");
    } else if (
      safeTestFlags.has(arg) ||
      (arg.startsWith("--testNamePattern=") && arg !== "--testNamePattern=")
    ) {
      argv.push(arg);
    } else if (!hasFile && isFocus(arg)) {
      argv.push(focused);
      hasFile = true;
    } else {
      return uncreditedTest(cwd, arg);
    }
  }
  if (!hasFile) return { cwd };
  argv.push("--config", "vitest.config.mjs");
  return { cwd, argv, kind: "focused" };
}

export function contributorInvocation(args, from, focused) {
  const argv = [...args];
  let cwd = from;
  if (argv[0] === "--cwd" && argv.length > 1) {
    cwd = resolve(from, argv[1]);
    argv.splice(0, 2);
  } else if (argv[0]?.startsWith("--cwd=")) {
    cwd = resolve(from, argv.shift().slice("--cwd=".length));
  }
  if (windows && existsSync(cwd)) cwd = contributorRealpath(cwd);
  if (argv.length === 2 && argv[0] === "run" && argv[1] === "build")
    return { cwd, argv, kind: "build" };
  if (
    argv.length === 2 &&
    ["install", "i"].includes(argv[0]) &&
    argv[1] === "--frozen-lockfile"
  )
    return { cwd, argv: ["install", "--frozen-lockfile"], kind: "install" };
  if (argv[0] === "run") argv.shift();
  if (
    argv[0] &&
    matchesContributorPath(resolve(cwd, argv[0]), join(cwd, "scripts/test.mjs"))
  ) {
    const isFocus = (arg) =>
      matchesContributorPath(resolve(cwd, arg), join(cwd, focused));
    const testArgs = argv.slice(1);
    if (testArgs.some(isFocus))
      return focusedInvocation(cwd, testArgs, focused, isFocus);
  }
  return { cwd };
}

function observe(argv, execute) {
  const config = JSON.parse(
    readFileSync(new URL("./contributor.json", import.meta.url), "utf8"),
  );
  const invocation = contributorInvocation(
    argv,
    contributorRealpath(process.cwd()),
    config.focused,
  );
  if (!invocation.kind || !sameContributorPath(invocation.cwd, config.checkout))
    return execute(argv, { env: process.env });
  const { cwd, kind, uncreditedReason } = invocation;
  const started = Date.now();
  const log = (details) =>
    appendFileSync(
      config.log,
      JSON.stringify({
        kind,
        argv: invocation.argv,
        requestedArgv: argv,
        cwd,
        started,
        ended: Date.now(),
        ...details,
      }) + "\n",
    );
  if (uncreditedReason) {
    const command = execute(argv, { env: process.env });
    log({ exit: command.status, signal: command.signal, uncreditedReason });
    return command;
  }
  const timing =
    kind === "focused" ? join(cwd, "coverage/test-timings.json") : null;
  if (timing) rmSync(timing, { force: true });
  const sourceSha256 = timing ? contributorSourceDigest(cwd) : undefined;
  const inputs =
    kind === "build"
      ? contributorBuildOutputs(cwd).map((file) => file.input.sha256)
      : null;
  const command = execute(invocation.argv, {
    cwd,
    env: timing ? { ...process.env, THERMITE_TEST_TIMINGS: "1" } : process.env,
  });
  log({
    exit: command.status,
    signal: command.signal,
    ...(timing && {
      tests: testResult(timing),
      sourceSha256:
        sourceSha256 === contributorSourceDigest(cwd) ? sourceSha256 : null,
    }),
    ...(inputs && {
      outputs: contributorBuildOutputs(cwd).filter(
        ({ input }, index) => input.sha256 === inputs[index],
      ),
    }),
  });
  return command;
}

export function observeContributorTest(argv, execute) {
  return observe(argv, (args, options) => execute(args.slice(1), options));
}

if (import.meta.main) {
  const command = observe(process.argv.slice(2), (argv, options) =>
    spawnSync(process.execPath, argv, {
      ...options,
      stdio: "inherit",
      // A test launched by the shim is already being observed.
      env: { ...options.env, THERMITE_CONTRIBUTOR_BUN: "" },
    }),
  );
  if (command.error) throw command.error;
  process.exitCode = command.status ?? 1;
}
