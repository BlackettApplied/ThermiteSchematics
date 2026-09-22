import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { findNodeAtLocation, parseTree } from "jsonc-parser";

import {
  RELEASE_ARTIFACT,
  REPOSITORY_ROOT,
  assertOrdinaryDirectory,
  assertOrdinaryFile,
  enumerateTree,
  mkdirExclusive,
  parseNamedArguments,
  sha256,
  writeExclusiveFile,
} from "./release-common.mjs";
import { parseDeterministicTarball } from "./release-tar-audit.mjs";

const execFileAsync = promisify(execFile);
const npmCommand = process.platform === "win32" ? process.execPath : "npm";
const npmArguments =
  process.platform === "win32"
    ? [
        join(
          dirname(process.execPath),
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        ),
      ]
    : [];

function isolatedEnvironment(root, prefixBin) {
  const environment = {};
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  Object.assign(environment, {
    HOME: join(root, "home"),
    NPM_CONFIG_REGISTRY: "https://registry.invalid/",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NO_PROXY: "*",
    no_proxy: "*",
    PATH:
      prefixBin === undefined
        ? dirname(process.execPath)
        : `${prefixBin}${delimiter}${dirname(process.execPath)}`,
  });
  return environment;
}

async function run(command, arguments_, options) {
  try {
    const result = await execFileAsync(command, arguments_, {
      ...options,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (typeof error?.code === "number") {
      return {
        exitCode: error.code,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      };
    }
    throw error;
  }
}

function executableShim(prefix) {
  return process.platform === "win32"
    ? join(prefix, "thermite.cmd")
    : join(prefix, "bin", "thermite");
}

function quoteShimArgument(value) {
  if (/["\r\n\u0000%!^]/u.test(value)) {
    throw new Error(
      `INSTALL001 Shim argument contains an unsupported character: ${JSON.stringify(value)}.`,
    );
  }
  return value === "" || /[\s&|<>()]/u.test(value) ? `"${value}"` : value;
}

async function runShim(shim, arguments_, options) {
  if (process.platform !== "win32") return run(shim, arguments_, options);
  // Node refuses to spawn a batch file directly (spawn EINVAL); the npm-created
  // `thermite.cmd` launcher must run through the command interpreter, exactly as an
  // end user's shell would invoke it.
  const commandInterpreter =
    process.env.COMSPEC ??
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
  const commandLine = [shim, ...arguments_].map(quoteShimArgument).join(" ");
  return run(commandInterpreter, ["/d", "/s", "/c", `"${commandLine}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

async function verifyPrefixShims(prefix, cliEntry) {
  if (process.platform === "win32") {
    const expected = ["thermite", "thermite.cmd", "thermite.ps1"];
    const observed = (await readdir(prefix))
      .filter((name) => name.startsWith("thermite"))
      .sort();
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      throw new Error(
        `INSTALL001 Windows prefix shim set differs: ${JSON.stringify(observed)}.`,
      );
    }
    for (const name of expected) {
      const stats = await lstat(join(prefix, name));
      if (!stats.isFile() || stats.isSymbolicLink())
        throw new Error(`INSTALL001 Windows shim is not ordinary: ${name}.`);
    }
  } else {
    const bin = join(prefix, "bin");
    const names = await readdir(bin);
    if (JSON.stringify(names.sort()) !== JSON.stringify(["thermite"])) {
      throw new Error("INSTALL001 Unix prefix shim set differs.");
    }
    const shim = join(bin, "thermite");
    const stats = await lstat(shim);
    if (!stats.isSymbolicLink())
      throw new Error("INSTALL001 Unix prefix thermite shim is not a symlink.");
    const target = await import("node:fs/promises").then(({ realpath }) =>
      realpath(shim),
    );
    const expectedTarget = await import("node:fs/promises").then(
      ({ realpath }) => realpath(cliEntry),
    );
    if (target !== expectedTarget)
      throw new Error("INSTALL001 Unix prefix shim target differs.");
  }
}

async function auditPrefixEntryTypes(prefix) {
  const exempt =
    process.platform === "win32"
      ? undefined
      : resolve(prefix, "bin", "thermite");
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const stats = await lstat(path, { bigint: true });
      if (stats.isSymbolicLink()) {
        if (resolve(path) !== exempt) {
          throw new Error(
            `INSTALL001 Unexpected prefix link at ${relative(prefix, path)}.`,
          );
        }
      } else if (stats.isDirectory()) {
        await visit(path);
      } else if (!stats.isFile() || stats.nlink !== 1n) {
        throw new Error(
          `INSTALL001 Non-ordinary prefix entry at ${relative(prefix, path)}.`,
        );
      }
    }
  }
  await visit(prefix);
}

export async function installCandidate({ tarPath, expectedSha, root }) {
  const tarBytes = await readFile(tarPath);
  if (sha256(tarBytes) !== expectedSha)
    throw new Error("INSTALL002 Candidate SHA-256 mismatch.");
  parseDeterministicTarball(tarBytes);
  const prefix = join(root, "prefix");
  const cache = join(root, "cache");
  const home = join(root, "home");
  await mkdir(root, { recursive: true });
  await mkdirExclusive(prefix);
  await mkdirExclusive(cache);
  await mkdirExclusive(home);
  const userConfig = join(root, "empty-user.npmrc");
  const globalConfig = join(root, "empty-global.npmrc");
  await writeExclusiveFile(userConfig, "");
  await writeExclusiveFile(globalConfig, "");
  const environment = isolatedEnvironment(root);
  const install = await run(
    npmCommand,
    [
      ...npmArguments,
      "install",
      "--global",
      "--prefix",
      prefix,
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--install-links=false",
      "--omit=dev",
      "--workspaces=false",
      "--userconfig",
      userConfig,
      "--globalconfig",
      globalConfig,
      "--cache",
      cache,
      tarPath,
    ],
    { cwd: root, env: environment },
  );
  if (install.exitCode !== 0)
    throw new Error(`INSTALL003 Offline install failed.\n${install.stderr}`);
  const cliRoot =
    process.platform === "win32"
      ? join(prefix, "node_modules", "@thermite", "cli")
      : join(prefix, "lib", "node_modules", "@thermite", "cli");
  const cliEntry = join(cliRoot, "dist", "bin.js");
  await assertOrdinaryFile(cliEntry);
  await verifyPrefixShims(prefix, cliEntry);
  await auditPrefixEntryTypes(prefix);
  for (const { path } of await enumerateTree(cliRoot)) {
    if (path.includes("node_modules/.bin"))
      throw new Error(
        "INSTALL001 Nested npm shim leaked into package payload.",
      );
  }
  const shim = executableShim(prefix);
  const prefixBin = process.platform === "win32" ? prefix : join(prefix, "bin");
  const productEnvironment = isolatedEnvironment(root, prefixBin);
  const [directVersion, shimVersion] = await Promise.all([
    run(process.execPath, [cliEntry, "--version"], {
      cwd: root,
      env: productEnvironment,
    }),
    runShim(shim, ["--version"], { cwd: root, env: productEnvironment }),
  ]);
  if (
    directVersion.exitCode !== 0 ||
    shimVersion.exitCode !== 0 ||
    directVersion.stdout !== "0.2.0\n" ||
    shimVersion.stdout !== directVersion.stdout
  ) {
    throw new Error(
      `INSTALL004 Installed direct entry and prefix shim are not version-identical: direct=${JSON.stringify(directVersion)} shim=${JSON.stringify(shimVersion)}.`,
    );
  }
  return { prefix, cliRoot, cliEntry, shim, environment: productEnvironment };
}

function integrity(bytes) {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

const PACKED_STARTER_NAME = "Packed Starter";
const PACKED_STARTER_REVISION = "A";
const DEFAULT_STARTER_PROJECT_NAME = "Thermite Schematics Starter Project";
const DEFAULT_STARTER_REVISION = "0.1.0";

// Mirrors the product's canonical single-token splice: the packaged template is
// the authority, and `thermite init` replaces exactly one JSON string token in place.
function spliceJsonStringToken(bytes, segments, original, replacement) {
  const text = bytes.toString("utf8");
  const tree = parseTree(text, [], { allowTrailingComma: false });
  const node =
    tree === undefined ? undefined : findNodeAtLocation(tree, segments);
  if (
    node === undefined ||
    node.type !== "string" ||
    text.slice(node.offset, node.offset + node.length) !==
      JSON.stringify(original)
  ) {
    throw new Error(
      `ACCEPT001 Packaged template has no canonical token at /${segments.join("/")}.`,
    );
  }
  return Buffer.from(
    text.slice(0, node.offset) +
      JSON.stringify(replacement) +
      text.slice(node.offset + node.length),
    "utf8",
  );
}

function expectedInitializedBytes(path, authorityBytes) {
  if (path === "system.json") {
    return spliceJsonStringToken(
      authorityBytes,
      ["project", "name"],
      DEFAULT_STARTER_PROJECT_NAME,
      PACKED_STARTER_NAME,
    );
  }
  if (path === "presentation.json") {
    return spliceJsonStringToken(
      authorityBytes,
      ["revision"],
      DEFAULT_STARTER_REVISION,
      PACKED_STARTER_REVISION,
    );
  }
  return authorityBytes;
}

async function invokeInstalled(installation, arguments_, cwd) {
  return runShim(installation.shim, arguments_, {
    cwd,
    env: installation.environment,
  });
}

async function agentCall(
  installation,
  requestRoot,
  project,
  tool,
  request,
  index,
) {
  const requestPath = join(
    requestRoot,
    `${String(index).padStart(2, "0")}-${tool}.json`,
  );
  await writeExclusiveFile(
    requestPath,
    `${JSON.stringify(request, undefined, 2)}\n`,
  );
  const result = await invokeInstalled(
    installation,
    ["agent", tool, "--input", requestPath],
    project,
  );
  return {
    ...result,
    value: result.stdout === "" ? undefined : JSON.parse(result.stdout).value,
    report: result.stderr === "" ? undefined : JSON.parse(result.stderr),
  };
}

export async function runEmptyFolderWorkflow({ installation, root, label }) {
  const project = join(root, `project-${label}`);
  const requestRoot = join(root, `requests-${label}`);
  await mkdirExclusive(project);
  await mkdirExclusive(requestRoot);
  const initialized = await invokeInstalled(
    installation,
    ["init", "--name", "Packed Starter", "--revision", "A"],
    project,
  );
  if (
    initialized.exitCode !== 0 ||
    initialized.stdout !==
      'Initialized Thermite Schematics project in ".".\n' ||
    initialized.stderr !== ""
  ) {
    throw new Error(
      "ACCEPT001 Packed init did not produce the frozen success streams.",
    );
  }
  const expectedTree = [
    "AGENTS.md",
    "connections/control-power.json",
    "devices/equipment.json",
    "electrical-system.lock.json",
    "potentials/potentials.json",
    "presentation.json",
    "system.json",
  ].sort();
  const initialTree = (await enumerateTree(project))
    .map(({ path }) => path)
    .sort();
  if (JSON.stringify(initialTree) !== JSON.stringify(expectedTree)) {
    throw new Error(
      `ACCEPT001 Initialized tree differs: ${JSON.stringify(initialTree)}.`,
    );
  }
  for (const path of expectedTree) {
    const authority =
      path === "AGENTS.md"
        ? join(installation.cliRoot, "assets", "AGENTS.md")
        : join(
            installation.cliRoot,
            "templates",
            "starter-default",
            ...path.split("/"),
          );
    const [initializedBytes, authorityBytes] = await Promise.all([
      readFile(join(project, ...path.split("/"))),
      readFile(authority),
    ]);
    if (
      !initializedBytes.equals(expectedInitializedBytes(path, authorityBytes))
    ) {
      throw new Error(
        `ACCEPT001 Initialized canonical bytes differ at ${path}.`,
      );
    }
  }
  const system = JSON.parse(
    await readFile(join(project, "system.json"), "utf8"),
  );
  if (
    JSON.stringify(system.libraries) !==
      JSON.stringify([{ name: "core", version: "0.1.0" }]) ||
    system.presentation !== "presentation.json"
  ) {
    throw new Error(
      "ACCEPT001 Initialized manifest does not select shipped core without a path.",
    );
  }
  let callIndex = 0;
  const base = { format: "agent-tool-request/0.1", project: "." };
  const calls = [
    ["validate", base],
    ["resolve", { ...base, target: { by: "designation", value: "PS1" } }],
    ["inspect", { ...base, selector: { by: "designation", value: "PS1" } }],
    [
      "query",
      {
        ...base,
        query: {
          operation: "net",
          selector: { by: "parts", deviceDesignation: "PS1", terminalKey: "+" },
        },
      },
    ],
    [
      "create-view",
      {
        ...base,
        spec: {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "PS1" },
          intent: { kind: "loads" },
          flow: "left-to-right",
        },
      },
    ],
  ];
  let initialSvg;
  for (const [tool, request] of calls) {
    const result = await agentCall(
      installation,
      requestRoot,
      project,
      tool,
      request,
      callIndex++,
    );
    if (result.exitCode !== 0 || result.report?.error !== null) {
      throw new Error(`ACCEPT002 Installed agent ${tool} failed.`);
    }
    if (tool === "create-view") initialSvg = result.value.svg;
  }

  const equipmentPath = join(project, "devices", "equipment.json");
  const equipmentBytes = await readFile(equipmentPath);
  const equipment = JSON.parse(equipmentBytes.toString("utf8"));
  const originalDescription = equipment.objects[0].description;
  const patchRequest = {
    ...base,
    patchFormat: "json-patch/0.1",
    dryRun: true,
    files: [
      {
        path: "devices/equipment.json",
        expectedIntegrity: integrity(equipmentBytes),
        operations: [
          {
            op: "test",
            path: "/objects/0/description",
            value: originalDescription,
          },
          {
            op: "replace",
            path: "/objects/0/description",
            value: "Packed starter control supply",
          },
        ],
      },
    ],
  };
  const dryRun = await agentCall(
    installation,
    requestRoot,
    project,
    "apply-source-patch",
    patchRequest,
    callIndex++,
  );
  if (dryRun.exitCode !== 0 || dryRun.value.applied !== false)
    throw new Error("ACCEPT003 Dry-run patch failed.");
  const applied = await agentCall(
    installation,
    requestRoot,
    project,
    "apply-source-patch",
    { ...patchRequest, dryRun: false },
    callIndex++,
  );
  if (applied.exitCode !== 0 || applied.value.applied !== true)
    throw new Error("ACCEPT003 Apply patch failed.");
  const replay = await agentCall(
    installation,
    requestRoot,
    project,
    "apply-source-patch",
    { ...patchRequest, dryRun: false },
    callIndex++,
  );
  if (replay.exitCode !== 1 || replay.report?.error?.code !== "A004") {
    throw new Error("ACCEPT003 Stale patch replay did not fail with A004.");
  }
  const validated = await agentCall(
    installation,
    requestRoot,
    project,
    "validate",
    base,
    callIndex++,
  );
  if (validated.exitCode !== 0)
    throw new Error("ACCEPT003 Post-patch validation failed.");

  const presentationPath = join(project, "presentation.json");
  const presentationBytes = await readFile(presentationPath);
  const presentation = JSON.parse(presentationBytes.toString("utf8"));
  const presentationPatch = {
    ...base,
    patchFormat: "json-patch/0.1",
    dryRun: false,
    files: [
      {
        path: "presentation.json",
        expectedIntegrity: integrity(presentationBytes),
        operations: [
          {
            op: "test",
            path: "/backgroundColor",
            value: presentation.backgroundColor,
          },
          { op: "replace", path: "/backgroundColor", value: "#101828" },
          {
            op: "test",
            path: "/titleBlock/lines/0",
            value: presentation.titleBlock.lines[0],
          },
          {
            op: "replace",
            path: "/titleBlock/lines/0",
            value: "Packed release acceptance",
          },
        ],
      },
    ],
  };
  const presentationApplied = await agentCall(
    installation,
    requestRoot,
    project,
    "apply-source-patch",
    presentationPatch,
    callIndex++,
  );
  if (presentationApplied.exitCode !== 0)
    throw new Error("ACCEPT004 Presentation patch failed.");
  const finalView = await agentCall(
    installation,
    requestRoot,
    project,
    "create-view",
    calls[4][1],
    callIndex++,
  );
  if (finalView.exitCode !== 0)
    throw new Error("ACCEPT004 Revised create-view failed.");
  const svg = finalView.value.svg;
  for (const text of [
    "Project: Packed Starter",
    "Revision: A",
    "View: PS1 | control/loads",
    "Tool: Thermite Schematics 0.2.0 | render/0.3",
    "Packed release acceptance",
  ]) {
    if (!svg.includes(text))
      throw new Error(`ACCEPT004 SVG is missing title text ${text}.`);
  }
  const canvasMarker = 'class="canvas-background" x="0" y="0" fill="#101828"';
  const canvasMarkerIndex = svg.indexOf(canvasMarker);
  const canvasIndex = svg.lastIndexOf("<rect", canvasMarkerIndex);
  const canvasEnd = svg.indexOf("/>", canvasMarkerIndex);
  if (
    canvasMarkerIndex === -1 ||
    canvasIndex === -1 ||
    canvasEnd === -1 ||
    !svg.slice(canvasIndex, canvasEnd).includes('width="') ||
    !svg.slice(canvasIndex, canvasEnd).includes('height="')
  ) {
    throw new Error("ACCEPT004 SVG lacks the opaque configured canvas.");
  }
  // Everything before the canvas rect must be non-rendering: the root open tag
  // plus <title>, <desc>, <style>, and <defs> (clipPath geometry never paints).
  const rootOpenEnd = svg.indexOf(">", svg.indexOf("<svg"));
  const beforeCanvas = svg
    .slice(rootOpenEnd + 1, canvasIndex)
    .replace(/<(title|desc|style|defs)\b[\s\S]*?<\/\1>/gu, "");
  const paintTokens = [
    "<circle",
    "<line",
    "<path",
    "<polyline",
    "<rect",
    "<text",
    "<g",
    "<use",
    "<image",
  ];
  if (
    rootOpenEnd === -1 ||
    canvasIndex <= rootOpenEnd ||
    paintTokens.some((token) => beforeCanvas.includes(token))
  ) {
    throw new Error("ACCEPT004 Opaque canvas is not the first paint.");
  }
  const agentOutputPath = join(project, "ps1-loads-agent.svg");
  await writeExclusiveFile(agentOutputPath, svg);
  const outputPath = join(project, "ps1-loads-direct.svg");
  const direct = await invokeInstalled(
    installation,
    ["view", "PS1", "--loads", "--project", ".", "--output", outputPath],
    project,
  );
  if (direct.exitCode !== 0 || (await readFile(outputPath, "utf8")) !== svg) {
    throw new Error(
      "ACCEPT004 Direct view bytes differ from agent create-view.",
    );
  }
  const finalFiles = new Map();
  for (const { path } of await enumerateTree(project))
    finalFiles.set(path, await readFile(join(project, ...path.split("/"))));
  return { project, initialSvg, svg, finalFiles };
}

async function auditPackagedReadmes(cliRoot) {
  const readmes = [
    join(cliRoot, "README.md"),
    join(cliRoot, "node_modules", "@thermite", "schema", "README.md"),
    join(cliRoot, "node_modules", "@thermite", "core-library", "README.md"),
  ];
  for (const path of readmes) {
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(/```json\n([\s\S]*?)```/gu))
      JSON.parse(match[1]);
  }
  const cli = await readFile(readmes[0], "utf8");
  const exactInstall =
    "npm install --global --prefix <isolated-prefix> --offline --ignore-scripts --no-audit --no-fund --package-lock=false --install-links=false --omit=dev --workspaces=false --userconfig <empty-user-npmrc> --globalconfig <empty-global-npmrc> --cache <empty-cache> <absolute-downloaded-thermite-cli-0.2.0.tgz>";
  if (!cli.includes(exactInstall))
    throw new Error(
      "ACCEPT005 Packaged CLI README lost the normative install command.",
    );
  for (const command of [
    "thermite --version",
    'thermite init --name "My First Electrical Project" --revision "A"',
    "thermite validate .",
    "thermite inspect PS1 --project .",
    "thermite net PS1.+ --project .",
    "thermite view PS1 --loads --project . --output ps1-loads.svg",
  ]) {
    if (!cli.includes(command))
      throw new Error(
        `ACCEPT005 Packaged README command is absent: ${command}.`,
      );
  }
}

async function runPackagedReadmeCommands(installation, root) {
  const project = join(root, "readme-project");
  await mkdirExclusive(project);
  const commands = [
    { arguments: ["--version"], cwd: root },
    {
      arguments: [
        "init",
        "--name",
        "My First Electrical Project",
        "--revision",
        "A",
      ],
      cwd: project,
    },
    { arguments: ["validate", "."], cwd: project },
    { arguments: ["inspect", "PS1", "--project", "."], cwd: project },
    { arguments: ["net", "PS1.+", "--project", "."], cwd: project },
    {
      arguments: [
        "view",
        "PS1",
        "--loads",
        "--project",
        ".",
        "--output",
        "ps1-loads.svg",
      ],
      cwd: project,
    },
  ];
  for (const command of commands) {
    const result = await invokeInstalled(
      installation,
      command.arguments,
      command.cwd,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `ACCEPT005 Packaged README command failed: thermite ${command.arguments.join(" ")}.`,
      );
    }
  }
  await assertOrdinaryFile(join(project, "ps1-loads.svg"));
}

async function removeOwnedAcceptanceRoot(root, captured) {
  const absoluteRoot = resolve(root);
  const absoluteTemp = resolve(tmpdir());
  const child = relative(absoluteTemp, absoluteRoot);
  const observed = await lstat(absoluteRoot, { bigint: true });
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    observed.dev !== captured.dev ||
    observed.ino !== captured.ino ||
    !observed.isDirectory() ||
    observed.isSymbolicLink()
  ) {
    throw new Error("Acceptance temporary-root identity changed.");
  }
  await rm(absoluteRoot, {
    recursive: true,
    force: false,
    maxRetries: 10,
    retryDelay: 100,
  });
}

export async function acceptReleaseCandidate({ tarPath, expectedSha } = {}) {
  if (typeof tarPath !== "string" || !isAbsolute(tarPath)) {
    throw new Error("Candidate path must be absolute.");
  }
  if (!/^[0-9a-f]{64}$/u.test(expectedSha ?? ""))
    throw new Error("Candidate SHA must be lowercase 64-hex.");
  await assertOrdinaryFile(tarPath);
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "thermite-schematics-release-acceptance-"),
  );
  const captured = await lstat(temporaryRoot, { bigint: true });
  try {
    const installation = await installCandidate({
      tarPath,
      expectedSha,
      root: temporaryRoot,
    });
    await auditPackagedReadmes(installation.cliRoot);
    await runPackagedReadmeCommands(installation, temporaryRoot);
    const first = await runEmptyFolderWorkflow({
      installation,
      root: temporaryRoot,
      label: "a",
    });
    const second = await runEmptyFolderWorkflow({
      installation,
      root: temporaryRoot,
      label: "b",
    });
    if (first.initialSvg !== second.initialSvg || first.svg !== second.svg) {
      throw new Error("ACCEPT006 Repeated fresh-process SVG bytes differ.");
    }
    const firstPaths = [...first.finalFiles.keys()].sort();
    const secondPaths = [...second.finalFiles.keys()].sort();
    if (JSON.stringify(firstPaths) !== JSON.stringify(secondPaths)) {
      throw new Error("ACCEPT006 Repeated initialized file sets differ.");
    }
    for (const path of firstPaths) {
      if (!first.finalFiles.get(path).equals(second.finalFiles.get(path))) {
        throw new Error(
          `ACCEPT006 Repeated deterministic bytes differ at ${path}.`,
        );
      }
    }
    return { sha256: expectedSha, deterministicFiles: firstPaths };
  } finally {
    await removeOwnedAcceptanceRoot(temporaryRoot, captured);
  }
}

async function main(argv) {
  const arguments_ = parseNamedArguments(argv, ["--tar", "--sha"]);
  const tar = arguments_["--tar"];
  const sha = arguments_["--sha"];
  if (tar === undefined || sha === undefined || !isAbsolute(tar)) {
    throw new Error(
      "Usage: node scripts/release-acceptance.mjs --tar <absolute-tar> --sha <lowercase-64-hex>",
    );
  }
  await acceptReleaseCandidate({ tarPath: resolve(tar), expectedSha: sha });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
