import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  SHIPPED_CORE_VERSIONS,
  compileProject,
  lockProject,
  analyzeCompleteness,
  resolveShippedCoreLibrary,
} from "@thermite/compiler";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_STARTER_IDENTITIES,
  DEFAULT_STARTER_PROJECT_NAME,
  DEFAULT_STARTER_REVISION,
  INIT_NON_EMPTY_MESSAGE,
  INIT_SUCCESS_MESSAGE,
  INIT_SYNTAX_MESSAGE,
  STARTER_DIRECTORY_PATHS,
  STARTER_NON_LOCK_TEMPLATE_PATHS,
  STARTER_OUTPUT_FILE_PATHS,
  STARTER_TEMPLATE_PATHS,
  buildStarterScaffold,
  createStarterLoadedProject,
  parseInitArguments,
  prepareStarterScaffoldFromAssets,
  runCli,
  runInit,
  type InitAssetLocations,
  type InitFileHandle,
  type InitFileStatus,
  type InitFilesystemDependencies,
  type InitResult,
  type ShippedCoreFilePath,
  type StarterAssetBytes,
  type StarterTemplatePath,
} from "../src/index.js";

const STARTER_CORE = SHIPPED_CORE_VERSIONS["0.2.0"]!;
const SHIPPED_CORE_FILE_INVENTORY = STARTER_CORE.fileInventory;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const templateRoot = join(packageRoot, "templates", "starter-default");
const temporaryRoots: string[] = [];

const messages = Object.freeze({
  INIT001:
    "INIT001 Cannot initialize: --name must be 1-160 XML-valid single-line Unicode code points.\n",
  INIT002:
    "INIT002 Cannot initialize: --revision must be 1-128 XML-valid single-line Unicode code points.\n",
  INIT003: "INIT003 Cannot initialize: current directory inspection failed.\n",
  INIT004:
    "INIT004 Cannot initialize: current directory is not an ordinary directory.\n",
  INIT005:
    "INIT005 Cannot initialize: packaged starter assets are unavailable.\n",
  INIT006: "INIT006 Cannot initialize: starter preparation failed.\n",
  INIT007: "INIT007 Cannot initialize: final empty-directory check failed.\n",
  INIT008: "INIT008 Cannot initialize: scaffold write failed.\n",
  INIT009:
    "INIT009 Cannot initialize: rollback failed; created entries may remain.\n",
  INIT010:
    "INIT010 Cannot initialize: concurrent filesystem change detected.\n",
  INIT011:
    "INIT011 Cannot initialize: rollback ownership changed; foreign entries were preserved.\n",
  INIT012:
    "INIT012 Cannot initialize: created entry identity capture failed.\n",
});

type NodeKind = "directory" | "file" | "junction" | "special";
interface MemoryNode {
  kind: NodeKind;
  dev: bigint;
  ino: bigint;
  nlink: bigint;
  bytes: Buffer;
}
interface MemoryCall {
  readonly operation:
    | "realpath"
    | "lstat"
    | "readdir"
    | "readFile"
    | "mkdir"
    | "open"
    | "fstat"
    | "writeFile"
    | "close"
    | "unlink"
    | "rmdir";
  readonly path: string;
  readonly ordinal: number;
}
type MemoryHook = (
  call: MemoryCall,
  filesystem: MemoryFilesystem,
) => void | InitFileStatus | Uint8Array;

class MemoryStatus implements InitFileStatus {
  constructor(
    readonly kind: NodeKind,
    readonly dev: bigint,
    readonly ino: bigint,
    readonly nlink: bigint,
  ) {}
  isDirectory(): boolean {
    return this.kind === "directory" || this.kind === "junction";
  }
  isFile(): boolean {
    return this.kind === "file";
  }
  isSymbolicLink(): boolean {
    return this.kind === "junction";
  }
}

function nativeAncestorPaths(path: string): string[] {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const remainder = absolute.slice(root.length);
  const segments = remainder === "" ? [] : remainder.split(sep).filter(Boolean);
  const paths = [root];
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    paths.push(current);
  }
  return paths;
}

function nativeError(code: string): Error & { code: string } {
  return Object.assign(
    new Error(
      process.platform === "win32"
        ? "native failure at C:\\Users\\private\\project"
        : "native failure at /home/private/project",
    ),
    { code },
  );
}

class MemoryFilesystem implements InitFilesystemDependencies {
  readonly calls: MemoryCall[] = [];
  readonly nodes = new Map<string, MemoryNode>();
  readonly cwd = resolve(".virtual-init-project");
  readonly assetLocations: InitAssetLocations = {
    cliPackageRootPath: resolve(".virtual-cli-package"),
    corePackageRootPath: resolve(".virtual-core-package"),
  };
  hook: MemoryHook | undefined;
  private nextInode = 100n;
  private readonly ordinals = new Map<MemoryCall["operation"], number>();

  constructor() {
    for (const path of nativeAncestorPaths(this.cwd)) {
      this.addNode(path, "directory");
    }
  }

  private record(operation: MemoryCall["operation"], path: string) {
    const ordinal = (this.ordinals.get(operation) ?? 0) + 1;
    this.ordinals.set(operation, ordinal);
    const call = { operation, path, ordinal } as const;
    this.calls.push(call);
    return this.hook?.(call, this);
  }

  addNode(
    path: string,
    kind: NodeKind,
    bytes: Uint8Array = new Uint8Array(),
    nlink = 1n,
  ): MemoryNode {
    const node = {
      kind,
      dev: 1n,
      ino: this.nextInode,
      nlink,
      bytes: Buffer.from(bytes),
    };
    this.nextInode += 1n;
    this.nodes.set(resolve(path), node);
    return node;
  }

  replaceNode(
    path: string,
    kind: NodeKind,
    bytes: Uint8Array = new Uint8Array(),
    nlink = 1n,
  ): MemoryNode {
    return this.addNode(path, kind, bytes, nlink);
  }

  status(
    path: string,
    observedIdentity: Partial<Pick<MemoryNode, "dev" | "ino">> = {},
  ): InitFileStatus {
    const node = this.nodes.get(resolve(path));
    if (node === undefined) throw nativeError("ENOENT");
    return new MemoryStatus(
      node.kind,
      observedIdentity.dev ?? node.dev,
      observedIdentity.ino ?? node.ino,
      node.nlink,
    );
  }

  async realpath(path: string): Promise<string> {
    this.record("realpath", path);
    this.status(path);
    return resolve(path);
  }
  async lstat(
    path: string,
    { bigint }: { readonly bigint: true },
  ): Promise<InitFileStatus> {
    expect(bigint).toBe(true);
    const result = this.record("lstat", path);
    return result instanceof MemoryStatus ? result : this.status(path);
  }
  async readdir(path: string): Promise<string[]> {
    this.record("readdir", path);
    const absolute = resolve(path);
    const status = this.status(absolute);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw nativeError("ENOTDIR");
    }
    const prefix = absolute.endsWith(sep) ? absolute : absolute + sep;
    const children = new Set<string>();
    for (const candidate of this.nodes.keys()) {
      if (!candidate.startsWith(prefix)) continue;
      const remainder = candidate.slice(prefix.length);
      if (remainder !== "") children.add(remainder.split(sep)[0]!);
    }
    return [...children].sort();
  }
  async readFile(path: string): Promise<Uint8Array> {
    const result = this.record("readFile", path);
    if (result instanceof Uint8Array) return Buffer.from(result);
    const node = this.nodes.get(resolve(path));
    if (node === undefined) throw nativeError("ENOENT");
    if (node.kind !== "file") throw nativeError("EISDIR");
    return Buffer.from(node.bytes);
  }
  async mkdir(path: string): Promise<void> {
    this.record("mkdir", path);
    const absolute = resolve(path);
    if (this.nodes.has(absolute)) throw nativeError("EEXIST");
    this.addNode(absolute, "directory");
  }
  async open(path: string, flags: "wx", mode: 0o644): Promise<InitFileHandle> {
    expect(flags).toBe("wx");
    expect(mode).toBe(0o644);
    this.record("open", path);
    const absolute = resolve(path);
    if (this.nodes.has(absolute)) throw nativeError("EEXIST");
    const node = this.addNode(absolute, "file");
    let closed = false;
    return {
      stat: async ({ bigint }) => {
        expect(bigint).toBe(true);
        const result = this.record("fstat", absolute);
        return result instanceof MemoryStatus
          ? result
          : new MemoryStatus(node.kind, node.dev, node.ino, node.nlink);
      },
      writeFile: async (bytes) => {
        this.record("writeFile", absolute);
        if (closed) throw nativeError("EBADF");
        node.bytes = Buffer.from(bytes);
      },
      close: async () => {
        this.record("close", absolute);
        closed = true;
      },
    };
  }
  async unlink(path: string): Promise<void> {
    this.record("unlink", path);
    const absolute = resolve(path);
    const node = this.nodes.get(absolute);
    if (node === undefined) throw nativeError("ENOENT");
    if (node.kind !== "file") throw nativeError("EISDIR");
    this.nodes.delete(absolute);
  }
  async rmdir(path: string): Promise<void> {
    this.record("rmdir", path);
    const absolute = resolve(path);
    const node = this.nodes.get(absolute);
    if (node === undefined) throw nativeError("ENOENT");
    if (node.kind !== "directory") throw nativeError("ENOTDIR");
    const prefix = absolute.endsWith(sep) ? absolute : absolute + sep;
    if (
      [...this.nodes.keys()].some((candidate) => candidate.startsWith(prefix))
    ) {
      throw nativeError("ENOTEMPTY");
    }
    this.nodes.delete(absolute);
  }
}
async function addPackagedAssets(
  filesystem: MemoryFilesystem,
): Promise<StarterAssetBytes> {
  const templates = new Map<StarterTemplatePath, Uint8Array>();
  for (const path of STARTER_TEMPLATE_PATHS) {
    const bytes = await readFile(join(templateRoot, ...path.split("/")));
    templates.set(path, bytes);
    filesystem.addNode(
      join(
        filesystem.assetLocations.cliPackageRootPath,
        "templates",
        "starter-default",
        ...path.split("/"),
      ),
      "file",
      bytes,
    );
  }
  const agentGuide = await readFile(join(packageRoot, "assets", "AGENTS.md"));
  filesystem.addNode(
    join(filesystem.assetLocations.cliPackageRootPath, "assets", "AGENTS.md"),
    "file",
    agentGuide,
  );
  const actualCoreRoot = resolveShippedCoreLibrary().packageRootPath;
  const shippedCore = new Map<ShippedCoreFilePath, Uint8Array>();
  for (const path of SHIPPED_CORE_FILE_INVENTORY) {
    const bytes = await readFile(join(actualCoreRoot, ...path.split("/")));
    shippedCore.set(path, bytes);
    filesystem.addNode(
      join(filesystem.assetLocations.corePackageRootPath, ...path.split("/")),
      "file",
      bytes,
    );
  }
  return { agentGuide, templates, shippedCore };
}

async function createMemoryFilesystem(): Promise<{
  filesystem: MemoryFilesystem;
  assets: StarterAssetBytes;
}> {
  const filesystem = new MemoryFilesystem();
  const assets = await addPackagedAssets(filesystem);
  return { filesystem, assets };
}

function expectFailure(result: InitResult, stderr: string): void {
  expect(result).toEqual({ exitCode: 2, stdout: "", stderr });
  expect(result.stderr).not.toContain(repositoryRoot);
  expect(result.stderr).not.toContain("private");
  expect(result.stderr.endsWith("\n")).toBe(true);
  expect(result.stderr).not.toContain("\r");
}

async function invoke(
  args: readonly string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["node", "thermite", ...args], {
    cwd,
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  });
  return { exitCode, stdout, stderr };
}

async function invokeWithFilesystem(
  args: readonly string[],
  filesystem: MemoryFilesystem,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["node", "thermite", ...args], {
    cwd: filesystem.cwd,
    initFilesystem: filesystem,
    initAssetLocations: filesystem.assetLocations,
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  });
  return { exitCode, stdout, stderr };
}

async function inventory(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const logical = prefix === "" ? entry.name : prefix + "/" + entry.name;
    paths.push(logical + (entry.isDirectory() ? "/" : ""));
    if (entry.isDirectory()) {
      paths.push(...(await inventory(join(root, entry.name), logical)));
    }
  }
  return paths.sort();
}

function jsonOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonOrder);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value).map((key) => [
        key,
        jsonOrder(Reflect.get(value, key)),
      ]),
    );
  }
  return value;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

describe("thermite init product", () => {
  it("regenerates, formats, schema-checks, and byte-checks the closed fixture set", async () => {
    const { updateStarterFixtures } =
      await import("../../../scripts/update-starter-fixtures.mjs");
    await updateStarterFixtures("--check");
  });
  it("initializes exact bytes, compiles/renders, and collides without mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "thermite-schematics-init-"));
    temporaryRoots.push(root);
    expect(await invoke(["init"], root)).toEqual({
      exitCode: 0,
      stdout: INIT_SUCCESS_MESSAGE,
      stderr: "",
    });
    expect(await inventory(root)).toEqual([
      "AGENTS.md",
      "connections/",
      "connections/control-power.json",
      "devices/",
      "devices/equipment.json",
      "electrical-system.lock.json",
      "potentials/",
      "potentials/potentials.json",
      "presentation.json",
      "system.json",
    ]);

    const evidence = new Map<string, { bytes: number; sha256: string }>();
    for (const path of STARTER_TEMPLATE_PATHS) {
      const actualPath = join(root, ...path.split("/"));
      const [actual, expected, status] = await Promise.all([
        readFile(actualPath),
        readFile(join(templateRoot, ...path.split("/"))),
        lstat(actualPath, { bigint: true }),
      ]);
      expect(actual).toEqual(expected);
      expect(status.isFile()).toBe(true);
      expect(status.isSymbolicLink()).toBe(false);
      expect(status.nlink).toBe(1n);
      evidence.set(path, {
        bytes: actual.length,
        sha256: createHash("sha256").update(actual).digest("hex"),
      });
    }
    expect(evidence.size).toBe(6);
    for (const path of STARTER_DIRECTORY_PATHS) {
      const status = await lstat(join(root, path), { bigint: true });
      expect(status.isDirectory()).toBe(true);
      expect(status.isSymbolicLink()).toBe(false);
    }
    expect(await readFile(join(root, "AGENTS.md"))).toEqual(
      await readFile(join(packageRoot, "assets", "AGENTS.md")),
    );
    expect(
      JSON.parse(await readFile(join(root, "presentation.json"), "utf8")),
    ).toMatchObject({ revision: "0.1.0" });

    const before = new Map(
      await Promise.all(
        STARTER_OUTPUT_FILE_PATHS.map(
          async (path) =>
            [path, await readFile(join(root, ...path.split("/")))] as const,
        ),
      ),
    );
    expect(await invoke(["init"], root)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: INIT_NON_EMPTY_MESSAGE,
    });
    for (const [path, bytes] of before) {
      expect(await readFile(join(root, ...path.split("/")))).toEqual(bytes);
    }

    const compiled = await invoke(["compile", "."], root);
    expect(compiled.exitCode).toBe(0);
    expect(compiled.stderr.match(/ W\d{3} /gu)).toEqual([" W905 "]);
    expect(compiled.stderr).toContain("Starter AC feed is not designed");
    expect(JSON.parse(compiled.stdout)).toMatchObject({
      format: "electrical-ir/0.1",
      project: { name: DEFAULT_STARTER_PROJECT_NAME },
    });
    const rendered = await invoke(["view", "PS1", "--loads"], root);
    expect(rendered.exitCode).toBe(0);
    expect(rendered.stderr.match(/ W\d{3} /gu)).toEqual([" W905 "]);
    expect(rendered.stdout).toContain("<svg");
    expect(rendered.stdout.endsWith("\n")).toBe(true);
  });

  it("splices only escaped name/revision tokens and preserves recursive order", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "thermite-schematics-init-options-"),
    );
    temporaryRoots.push(root);
    const name = 'Starter "雪" \\ 😀';
    const revision = 'rev "β" \\ 1';
    expect(
      await invoke(
        ["init", "--revision", revision, "--name", name, "--"],
        root,
      ),
    ).toEqual({ exitCode: 0, stdout: INIT_SUCCESS_MESSAGE, stderr: "" });

    for (const path of STARTER_TEMPLATE_PATHS) {
      const committed = await readFile(
        join(templateRoot, ...path.split("/")),
        "utf8",
      );
      const actual = await readFile(join(root, ...path.split("/")), "utf8");
      const expected =
        path === "system.json"
          ? committed.replace(
              JSON.stringify(DEFAULT_STARTER_PROJECT_NAME),
              JSON.stringify(name),
            )
          : path === "presentation.json"
            ? committed.replace(
                JSON.stringify(DEFAULT_STARTER_REVISION),
                JSON.stringify(revision),
              )
            : committed;
      expect(actual).toBe(expected);
      expect(jsonOrder(JSON.parse(actual))).toEqual(
        jsonOrder(JSON.parse(expected)),
      );
    }
  });
  it("runs built CLI from a genuinely empty OS-temp cwd without default flags", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "thermite-schematics-init-built-"),
    );
    temporaryRoots.push(root);
    const built = await import("../dist/index.js");
    let stdout = "";
    let stderr = "";
    const exitCode = await built.runCli(["node", "thermite", "init"], {
      cwd: root,
      stdout: { write: (text) => (stdout += text) },
      stderr: { write: (text) => (stderr += text) },
    });
    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: INIT_SUCCESS_MESSAGE,
      stderr: "",
    });
    for (const path of STARTER_TEMPLATE_PATHS) {
      expect(await readFile(join(root, ...path.split("/")))).toEqual(
        await readFile(join(templateRoot, ...path.split("/"))),
      );
    }
  });
  it("initializes when pathname identities report an unreported device number", async () => {
    const { filesystem, assets } = await createMemoryFilesystem();
    const outputPaths = new Set(
      STARTER_OUTPUT_FILE_PATHS.map((path) =>
        join(filesystem.cwd, ...path.split("/")),
      ),
    );
    filesystem.hook = (call, memory) =>
      call.operation === "lstat" &&
      outputPaths.has(call.path) &&
      memory.nodes.has(call.path)
        ? memory.status(call.path, { dev: 0n })
        : undefined;

    expect(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
    ).toEqual({
      exitCode: 0,
      stdout: INIT_SUCCESS_MESSAGE,
      stderr: "",
    });

    const expected = prepareStarterScaffoldFromAssets(
      assets,
      DEFAULT_STARTER_PROJECT_NAME,
      DEFAULT_STARTER_REVISION,
    ).files;
    for (const path of STARTER_OUTPUT_FILE_PATHS) {
      expect(
        filesystem.nodes.get(join(filesystem.cwd, ...path.split("/")))?.bytes,
      ).toEqual(Buffer.from(expected.get(path)!));
    }
    expect(
      filesystem.calls.filter(
        (call) => call.operation === "unlink" || call.operation === "rmdir",
      ),
    ).toEqual([]);
  });

  it("rolls back completely when an unreported device number accompanies a foreign inode", async () => {
    const { filesystem } = await createMemoryFilesystem();
    const agentPath = join(filesystem.cwd, "AGENTS.md");
    filesystem.hook = (call, memory) => {
      if (
        call.operation === "lstat" &&
        call.path === agentPath &&
        !memory.calls.some((candidate) => candidate.operation === "close")
      ) {
        const inode = memory.nodes.get(agentPath)!.ino;
        return memory.status(agentPath, { dev: 0n, ino: inode + 1_000n });
      }
    };

    expectFailure(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
      messages.INIT010,
    );
    expect(
      filesystem.calls
        .filter(
          (call) => call.operation === "unlink" || call.operation === "rmdir",
        )
        .map(({ operation, path }) => ({ operation, path })),
    ).toEqual([
      { operation: "unlink", path: agentPath },
      { operation: "rmdir", path: join(filesystem.cwd, "potentials") },
      { operation: "rmdir", path: join(filesystem.cwd, "devices") },
      { operation: "rmdir", path: join(filesystem.cwd, "connections") },
    ]);
    expect(
      [...filesystem.nodes.keys()].filter((path) =>
        path.startsWith(filesystem.cwd + sep),
      ),
    ).toEqual([]);
  });

  it("still rejects two different non-zero device numbers with an equal inode", async () => {
    const { filesystem } = await createMemoryFilesystem();
    const agentPath = join(filesystem.cwd, "AGENTS.md");
    filesystem.hook = (call, memory) =>
      call.operation === "lstat" &&
      call.path === agentPath &&
      !memory.calls.some((candidate) => candidate.operation === "close")
        ? memory.status(agentPath, { dev: 2n })
        : undefined;

    expectFailure(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
      messages.INIT010,
    );
  });

  it("rollback guards remove entries under an unreported device number and preserve foreign inodes", async () => {
    const { filesystem } = await createMemoryFilesystem();
    const agentPath = join(filesystem.cwd, "AGENTS.md");
    const removablePath = join(
      filesystem.cwd,
      "connections",
      "control-power.json",
    );
    let foreignAgent: MemoryNode | undefined;
    filesystem.hook = (call, memory) => {
      if (call.operation === "writeFile" && call.path === removablePath) {
        throw nativeError("EIO");
      }
      const rollbackStarted = memory.calls.some(
        (candidate) =>
          candidate.operation === "writeFile" &&
          candidate.path === removablePath,
      );
      if (
        rollbackStarted &&
        call.operation === "lstat" &&
        call.path === removablePath
      ) {
        return memory.status(removablePath, { dev: 0n });
      }
      if (
        rollbackStarted &&
        call.operation === "lstat" &&
        call.path === agentPath &&
        foreignAgent === undefined
      ) {
        foreignAgent = memory.replaceNode(
          agentPath,
          "file",
          Buffer.from("foreign\n"),
        );
        foreignAgent.dev = 0n;
      }
    };

    expectFailure(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
      messages.INIT011,
    );
    expect(filesystem.nodes.has(removablePath)).toBe(false);
    expect(filesystem.nodes.get(agentPath)).toBe(foreignAgent);
    expect(foreignAgent?.bytes).toEqual(Buffer.from("foreign\n"));
    expect(
      filesystem.calls
        .filter(
          (call) => call.operation === "unlink" || call.operation === "rmdir",
        )
        .map(({ operation, path }) => ({ operation, path })),
    ).toEqual([
      { operation: "unlink", path: removablePath },
      { operation: "rmdir", path: join(filesystem.cwd, "potentials") },
      { operation: "rmdir", path: join(filesystem.cwd, "devices") },
      { operation: "rmdir", path: join(filesystem.cwd, "connections") },
    ]);
  });
});

describe("thermite init grammar and validation", () => {
  it.each([
    ["unknown short", ["init", "-n", "x"]],
    ["unknown long", ["init", "--unknown"]],
    ["duplicate name", ["init", "--name", "a", "--name", "b"]],
    ["duplicate revision", ["init", "--revision", "a", "--revision", "b"]],
    ["missing operand", ["init", "--name"]],
    ["positional", ["init", "project"]],
    ["post terminator positional", ["init", "--", "project"]],
    ["equals spelling", ["init", "--name=value"]],
    ["mixed help", ["init", "--help", "--name", "x"]],
  ] as const)("rejects %s before filesystem access", async (_label, args) => {
    const { filesystem } = await createMemoryFilesystem();
    expect(await invokeWithFilesystem(args, filesystem)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: INIT_SYNTAX_MESSAGE,
    });
    expect(filesystem.calls).toEqual([]);
  });

  it("accepts the frozen action grammar and sole help success", async () => {
    expect(parseInitArguments([])).toEqual({
      kind: "action",
      name: DEFAULT_STARTER_PROJECT_NAME,
      revision: DEFAULT_STARTER_REVISION,
    });
    expect(parseInitArguments(["--"])).toMatchObject({ kind: "action" });
    expect(parseInitArguments(["--name", "--revision"])).toEqual({
      kind: "action",
      name: "--revision",
      revision: DEFAULT_STARTER_REVISION,
    });
    expect(parseInitArguments(["--help"])).toEqual({ kind: "help" });

    const { filesystem } = await createMemoryFilesystem();
    const help = await invokeWithFilesystem(["init", "--help"], filesystem);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage: thermite init [options]");
    expect(help.stdout).toContain("--name <project-name>");
    expect(help.stdout).toContain("--revision <revision>");
    expect(help.stderr).toBe("");
    expect(filesystem.calls).toEqual([]);
  });

  it.each([
    ["empty", ""],
    ["161 ASCII characters", "x".repeat(161)],
    ["161 astral characters", "😀".repeat(161)],
    ["U+0000", "bad\u0000name"],
    ["U+0009", "bad\tname"],
    ["U+000A", "bad\nname"],
    ["U+000D", "bad\rname"],
    ["U+0085", "bad\u0085name"],
    ["U+2028", "bad\u2028name"],
    ["U+2029", "bad\u2029name"],
  ] as const)(
    "rejects %s name with INIT001 and no I/O",
    async (_label, name) => {
      const { filesystem } = await createMemoryFilesystem();
      expectFailure(
        await runInit(name, "", {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT001,
      );
      expect(filesystem.calls).toEqual([]);
    },
  );

  it.each([
    ["empty", ""],
    ["129 ASCII characters", "x".repeat(129)],
    ["129 astral characters", "😀".repeat(129)],
    ["U+0000", "bad\u0000revision"],
    ["U+0009", "bad\trevision"],
    ["U+000A", "bad\nrevision"],
    ["U+000D", "bad\rrevision"],
    ["U+0085", "bad\u0085revision"],
    ["U+2028", "bad\u2028revision"],
    ["U+2029", "bad\u2029revision"],
  ] as const)(
    "rejects %s revision with INIT002 and no I/O",
    async (_label, revision) => {
      const { filesystem } = await createMemoryFilesystem();
      expectFailure(
        await runInit("valid", revision, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT002,
      );
      expect(filesystem.calls).toEqual([]);
    },
  );
});

describe("thermite init closed preparation and filesystem state machine", () => {
  it("reads only exact ordered assets and prepares with no discovery I/O", async () => {
    const { filesystem, assets } = await createMemoryFilesystem();
    expect(
      prepareStarterScaffoldFromAssets(
        assets,
        DEFAULT_STARTER_PROJECT_NAME,
        DEFAULT_STARTER_REVISION,
      ).files.size,
    ).toBe(7);
    const result = await runInit(undefined, undefined, {
      cwd: filesystem.cwd,
      filesystem,
      assetLocations: filesystem.assetLocations,
    });
    expect(result).toEqual({
      exitCode: 0,
      stdout: INIT_SUCCESS_MESSAGE,
      stderr: "",
    });
    expect(
      filesystem.calls.filter((call) => call.operation === "realpath"),
    ).toHaveLength(1);

    const expectedAssetPaths = [
      join(filesystem.assetLocations.cliPackageRootPath, "assets", "AGENTS.md"),
      ...STARTER_TEMPLATE_PATHS.map((path) =>
        join(
          filesystem.assetLocations.cliPackageRootPath,
          "templates",
          "starter-default",
          ...path.split("/"),
        ),
      ),
      ...SHIPPED_CORE_FILE_INVENTORY.map((path) =>
        join(filesystem.assetLocations.corePackageRootPath, ...path.split("/")),
      ),
    ];
    const assetCalls = filesystem.calls.filter((call) =>
      expectedAssetPaths.includes(call.path),
    );
    expect(
      assetCalls.map(({ operation, path }) => ({ operation, path })),
    ).toEqual(
      expectedAssetPaths.flatMap((path) => [
        { operation: "lstat", path },
        { operation: "readFile", path },
      ]),
    );
    expect(
      filesystem.calls.filter((call) => call.operation === "readdir"),
    ).toHaveLength(6);

    const nonLock = new Map(
      STARTER_NON_LOCK_TEMPLATE_PATHS.map((path) => [
        path,
        assets.templates.get(path)!,
      ]),
    );
    expect(
      createStarterLoadedProject(nonLock, assets.shippedCore).sources,
    ).toHaveLength(3);
    expect(
      buildStarterScaffold({
        name: DEFAULT_STARTER_PROJECT_NAME,
        revision: DEFAULT_STARTER_REVISION,
        identities: DEFAULT_STARTER_IDENTITIES,
      }),
    ).toBeDefined();
  });
  it("maps initial inspection, type, assets, preparation, and final recheck", async () => {
    {
      const { filesystem } = await createMemoryFilesystem();
      filesystem.hook = (call) => {
        if (call.operation === "realpath") throw nativeError("EACCES");
      };
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT003,
      );
    }
    {
      const { filesystem } = await createMemoryFilesystem();
      filesystem.replaceNode(filesystem.cwd, "junction");
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT004,
      );
    }
    {
      const { filesystem } = await createMemoryFilesystem();
      const guide = join(
        filesystem.assetLocations.cliPackageRootPath,
        "assets",
        "AGENTS.md",
      );
      filesystem.hook = (call) => {
        if (call.operation === "readFile" && call.path === guide) {
          throw nativeError("EIO");
        }
      };
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT005,
      );
    }
    {
      const { filesystem } = await createMemoryFilesystem();
      const throwingString = {
        *[Symbol.iterator]() {
          yield "x";
        },
        toJSON() {
          throw new Error("private serialization failure");
        },
      } as unknown as string;
      expectFailure(
        await runInit(throwingString, DEFAULT_STARTER_REVISION, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT006,
      );
    }
    {
      const { filesystem } = await createMemoryFilesystem();
      filesystem.hook = (call) => {
        if (
          call.operation === "readdir" &&
          call.path === filesystem.cwd &&
          call.ordinal === 2
        ) {
          throw nativeError("EIO");
        }
      };
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT007,
      );
    }
  });

  it("keeps both emptiness collisions at exit 1 without unauthorized work", async () => {
    const first = await createMemoryFilesystem();
    first.filesystem.addNode(
      join(first.filesystem.cwd, ".hidden"),
      "file",
      Buffer.from("x"),
    );
    expect(
      await runInit(undefined, undefined, {
        cwd: first.filesystem.cwd,
        filesystem: first.filesystem,
        assetLocations: first.filesystem.assetLocations,
      }),
    ).toEqual({ exitCode: 1, stdout: "", stderr: INIT_NON_EMPTY_MESSAGE });
    expect(
      first.filesystem.calls.some((call) => call.operation === "open"),
    ).toBe(false);
    expect(
      first.filesystem.calls.some((call) => call.operation === "readFile"),
    ).toBe(false);

    const second = await createMemoryFilesystem();
    second.filesystem.hook = (call, filesystem) => {
      if (
        call.operation === "readdir" &&
        call.path === filesystem.cwd &&
        call.ordinal === 2
      ) {
        filesystem.addNode(
          join(filesystem.cwd, "foreign"),
          "file",
          Buffer.from("x"),
        );
      }
    };
    expect(
      await runInit(undefined, undefined, {
        cwd: second.filesystem.cwd,
        filesystem: second.filesystem,
        assetLocations: second.filesystem.assetLocations,
      }),
    ).toEqual({ exitCode: 1, stdout: "", stderr: INIT_NON_EMPTY_MESSAGE });
    expect(
      second.filesystem.calls.some((call) => call.operation === "mkdir"),
    ).toBe(false);
  });

  it.each([
    ["mkdir I/O", "mkdir", "EACCES", messages.INIT008],
    ["mkdir collision", "mkdir", "EEXIST", messages.INIT010],
    ["open I/O", "open", "EACCES", messages.INIT008],
    ["open collision", "open", "EEXIST", messages.INIT010],
  ] as const)(
    "maps %s and rolls back captured entries",
    async (_label, operation, code, stderr) => {
      const { filesystem } = await createMemoryFilesystem();
      filesystem.hook = (call) => {
        if (call.operation === operation && call.ordinal === 1) {
          throw nativeError(code);
        }
      };
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        stderr,
      );
      expect(
        [...filesystem.nodes.keys()].filter((path) =>
          path.startsWith(filesystem.cwd + sep),
        ),
      ).toEqual([]);
    },
  );

  it("returns INIT012 with directory residue and zero removal calls", async () => {
    const { filesystem } = await createMemoryFilesystem();
    const created = join(filesystem.cwd, "connections");
    filesystem.hook = (call) => {
      if (
        call.operation === "lstat" &&
        call.path === created &&
        filesystem.nodes.has(created)
      ) {
        throw nativeError("EIO");
      }
    };
    expectFailure(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
      messages.INIT012,
    );
    expect(filesystem.nodes.has(created)).toBe(true);
    expect(
      filesystem.calls.filter((call) => call.operation === "unlink"),
    ).toEqual([]);
    expect(
      filesystem.calls.filter((call) => call.operation === "rmdir"),
    ).toEqual([]);
  });

  it("fstats before pathname access and retains all residue on INIT012", async () => {
    const { filesystem } = await createMemoryFilesystem();
    filesystem.hook = (call) => {
      if (call.operation === "fstat" && call.ordinal === 1) {
        throw nativeError("EIO");
      }
      if (call.operation === "close") throw nativeError("EIO");
    };
    expectFailure(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
      messages.INIT012,
    );
    const openIndex = filesystem.calls.findIndex(
      (call) => call.operation === "open",
    );
    expect(
      filesystem.calls
        .slice(openIndex, openIndex + 3)
        .map((call) => call.operation),
    ).toEqual(["open", "fstat", "close"]);
    expect(filesystem.nodes.has(join(filesystem.cwd, "AGENTS.md"))).toBe(true);
    expect(
      filesystem.calls.some(
        (call) => call.operation === "unlink" || call.operation === "rmdir",
      ),
    ).toBe(false);
  });
  it.each([
    ["wrong type", new MemoryStatus("special", 1n, 500n, 1n)],
    ["reparse", new MemoryStatus("junction", 1n, 501n, 1n)],
  ])(
    "keeps zero-removal directory residue for %s capture",
    async (_label, observed) => {
      const { filesystem } = await createMemoryFilesystem();
      const created = join(filesystem.cwd, "connections");
      filesystem.hook = (call) => {
        if (
          call.operation === "lstat" &&
          call.path === created &&
          filesystem.nodes.has(created)
        ) {
          return observed;
        }
      };
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT012,
      );
      expect(filesystem.nodes.has(created)).toBe(true);
      expect(
        filesystem.calls.some(
          (call) => call.operation === "unlink" || call.operation === "rmdir",
        ),
      ).toBe(false);
    },
  );

  it.each([
    ["wrong type", new MemoryStatus("special", 1n, 600n, 1n)],
    ["link count", new MemoryStatus("file", 1n, 601n, 2n)],
  ])(
    "keeps zero-removal file residue for %s fstat",
    async (_label, observed) => {
      const { filesystem } = await createMemoryFilesystem();
      filesystem.hook = (call) =>
        call.operation === "fstat" && call.ordinal === 1 ? observed : undefined;
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        messages.INIT012,
      );
      expect(filesystem.nodes.has(join(filesystem.cwd, "AGENTS.md"))).toBe(
        true,
      );
      expect(
        filesystem.calls.some(
          (call) => call.operation === "unlink" || call.operation === "rmdir",
        ),
      ).toBe(false);
    },
  );

  it("maps a one-shot pre-create identity change to INIT010 and rolls back", async () => {
    const { filesystem } = await createMemoryFilesystem();
    let injected = false;
    filesystem.hook = (call) => {
      if (
        !injected &&
        call.operation === "lstat" &&
        call.path === filesystem.cwd &&
        filesystem.calls.some((candidate) => candidate.operation === "mkdir")
      ) {
        injected = true;
        return new MemoryStatus("directory", 9n, 9n, 1n);
      }
    };
    expectFailure(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
      messages.INIT010,
    );
    expect(
      [...filesystem.nodes.keys()].filter((path) =>
        path.startsWith(filesystem.cwd + sep),
      ),
    ).toEqual([]);
  });
  it("settles cleanup close before rollback and retains primary codes", async () => {
    for (const scenario of ["pathname", "write"] as const) {
      const { filesystem } = await createMemoryFilesystem();
      const agentPath = join(filesystem.cwd, "AGENTS.md");
      filesystem.hook = (call) => {
        if (
          scenario === "pathname" &&
          call.operation === "lstat" &&
          call.path === agentPath &&
          !filesystem.calls.some((candidate) => candidate.operation === "close")
        ) {
          return new MemoryStatus("file", 99n, 99n, 1n);
        }
        if (
          scenario === "write" &&
          call.operation === "writeFile" &&
          call.path === agentPath
        ) {
          throw nativeError("EIO");
        }
      };
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        scenario === "pathname" ? messages.INIT010 : messages.INIT008,
      );
      const closeIndex = filesystem.calls.findIndex(
        (call) => call.operation === "close",
      );
      const firstRollback = filesystem.calls.findIndex(
        (call) => call.operation === "unlink" || call.operation === "rmdir",
      );
      expect(closeIndex).toBeGreaterThan(-1);
      expect(firstRollback).toBeGreaterThan(closeIndex);
    }
  });

  it("retries close once, maps cleanup failure, and lets guard refusal win", async () => {
    for (const guardRefusal of [false, true]) {
      const { filesystem } = await createMemoryFilesystem();
      const agentPath = join(filesystem.cwd, "AGENTS.md");
      filesystem.hook = (call) => {
        if (call.operation === "close" && call.ordinal <= 2) {
          throw nativeError("EIO");
        }
        if (
          guardRefusal &&
          call.operation === "lstat" &&
          call.path === agentPath &&
          filesystem.calls.filter(
            (candidate) => candidate.operation === "close",
          ).length >= 2
        ) {
          return new MemoryStatus("file", 77n, 77n, 1n);
        }
      };
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        guardRefusal ? messages.INIT011 : messages.INIT009,
      );
      expect(
        filesystem.calls.filter((call) => call.operation === "close"),
      ).toHaveLength(2);
    }
  });

  it("continues bounded rollback after I/O and guard failures", async () => {
    for (const kind of ["io", "foreign"] as const) {
      const { filesystem } = await createMemoryFilesystem();
      const agentPath = join(filesystem.cwd, "AGENTS.md");
      filesystem.hook = (call) => {
        if (call.operation === "writeFile" && call.path === agentPath) {
          throw nativeError("EIO");
        }
        if (
          kind === "io" &&
          call.operation === "unlink" &&
          call.path === agentPath
        ) {
          throw nativeError("EPERM");
        }
        if (
          kind === "foreign" &&
          call.operation === "lstat" &&
          call.path === agentPath &&
          filesystem.calls.some((candidate) => candidate.operation === "close")
        ) {
          return new MemoryStatus("file", 55n, 55n, 1n);
        }
      };
      expectFailure(
        await runInit(undefined, undefined, {
          cwd: filesystem.cwd,
          filesystem,
          assetLocations: filesystem.assetLocations,
        }),
        kind === "io" ? messages.INIT009 : messages.INIT011,
      );
      expect(
        filesystem.calls.filter((call) => call.operation === "rmdir"),
      ).toHaveLength(3);
      expect(filesystem.nodes.has(agentPath)).toBe(true);
    }
  });

  it("maps final verification byte mismatch through rollback", async () => {
    const { filesystem } = await createMemoryFilesystem();
    const agentPath = join(filesystem.cwd, "AGENTS.md");
    filesystem.hook = (call, memory) => {
      if (call.operation === "readFile" && call.path === agentPath) {
        memory.nodes.get(agentPath)!.bytes = Buffer.from("mismatch\n");
      }
    };
    expectFailure(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
      messages.INIT010,
    );
    expect(filesystem.nodes.has(agentPath)).toBe(false);
  });

  it("scopes guard-to-read replacement to bytes and rollback precedence", async () => {
    for (const equalBytes of [true, false]) {
      const { filesystem } = await createMemoryFilesystem();
      const agentPath = join(filesystem.cwd, "AGENTS.md");
      filesystem.hook = (call, memory) => {
        if (call.operation === "readFile" && call.path === agentPath) {
          const old = memory.nodes.get(agentPath)!;
          memory.replaceNode(
            agentPath,
            "file",
            equalBytes ? old.bytes : Buffer.from("foreign\n"),
          );
        }
      };
      const result = await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      });
      if (equalBytes) {
        expect(result).toEqual({
          exitCode: 0,
          stdout: INIT_SUCCESS_MESSAGE,
          stderr: "",
        });
      } else {
        expectFailure(result, messages.INIT011);
      }
    }
  });

  it("does not invent INIT011 after the last rollback guard", async () => {
    const { filesystem } = await createMemoryFilesystem();
    const agentPath = join(filesystem.cwd, "AGENTS.md");
    filesystem.hook = (call, memory) => {
      if (call.operation === "writeFile" && call.path === agentPath) {
        throw nativeError("EIO");
      }
      if (call.operation === "unlink" && call.path === agentPath) {
        memory.replaceNode(agentPath, "file", Buffer.from("foreign\n"));
      }
    };
    expectFailure(
      await runInit(undefined, undefined, {
        cwd: filesystem.cwd,
        filesystem,
        assetLocations: filesystem.assetLocations,
      }),
      messages.INIT008,
    );
    expect(filesystem.nodes.has(agentPath)).toBe(false);
  });
});

describe("thermite init --name (alpha CLI)", () => {
  const run = promisify(execFile);
  const entry = join(repositoryRoot, "thermite.mjs");
  const cabinetsCaption =
    "Inter-cabinet cable / two used cores and two spare cores";
  // The exact default presentation; --name must not change it when omitted.
  const defaultPresentation = `{
  "$schema": "https://thermiteschematics.com/schemas/0.1/project-presentation.schema.json",
  "format": "project-presentation/0.2",
  "revision": "A",
  "backgroundColor": "#ffffff",
  "titleBlock": {
    "lines": [
      "Starter project"
    ]
  },
  "page": {
    "size": "tabloid",
    "orientation": "landscape",
    "marginMm": 10
  }
}
`;
  async function alphaInit(...args: string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "thermite-alpha-init-name-"));
    temporaryRoots.push(root);
    await run(process.execPath, [entry, "init", "project", ...args], {
      cwd: root,
    });
    return join(root, "project");
  }
  async function files(root: string): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else
          result.set(
            path
              .slice(root.length + 1)
              .split(sep)
              .join("/"),
            await readFile(path),
          );
      }
    };
    await walk(root);
    return new Map([...result].sort(([a], [b]) => a.localeCompare(b)));
  }
  const readJson = async (path: string) =>
    JSON.parse(await readFile(path, "utf8"));
  async function titleSvg(project: string): Promise<string> {
    await run(
      process.execPath,
      [entry, "view", "PS1", "--loads", "-o", "loads.svg"],
      { cwd: project },
    );
    return readFile(join(project, "loads.svg"), "utf8");
  }
  const occurrences = (text: string, part: string) =>
    text.split(part).length - 1;

  it("keeps the default name and starter caption when --name is omitted", async () => {
    const project = await alphaInit();
    expect(await readFile(join(project, "presentation.json"), "utf8")).toBe(
      defaultPresentation,
    );
    expect((await readJson(join(project, "system.json"))).project.name).toBe(
      "Thermite Electrical Project",
    );
    const svg = await titleSvg(project);
    expect(occurrences(svg, "Thermite Electrical Project")).toBe(1);
    expect(occurrences(svg, "Starter project")).toBe(1);
  });

  it("names the project and its title block, changing only system and presentation", async () => {
    const plain = await alphaInit();
    const named = await alphaInit("--name", "Line <A> & B");
    const before = await files(plain),
      after = await files(named);
    expect([...after.keys()]).toEqual([...before.keys()]);
    expect(
      [...before.keys()].filter(
        (path) => !before.get(path)!.equals(after.get(path)!),
      ),
    ).toEqual(["presentation.json", "system.json"]);
    expect((await readJson(join(named, "system.json"))).project.name).toBe(
      "Line <A> & B",
    );
    // The heading already prints project.name; the unnamed-project caption goes.
    const expected = JSON.parse(defaultPresentation);
    delete expected.titleBlock;
    expect(await readJson(join(named, "presentation.json"))).toEqual(expected);
    const svg = await titleSvg(named);
    expect(occurrences(svg, "Line &lt;A&gt; &amp; B")).toBe(1);
    expect(svg).not.toContain("Starter project");
    expect(svg).not.toContain("Thermite Electrical Project");
  });

  it("treats an explicit --name equal to the default as a name", async () => {
    const project = await alphaInit("--name", "Thermite Electrical Project");
    expect(
      await readJson(join(project, "presentation.json")),
    ).not.toHaveProperty("titleBlock");
  });

  it("keeps the cabinets caption under an explicit name", async () => {
    const project = await alphaInit(
      "--template",
      "cabinets",
      "--name",
      "Cabinet 7",
    );
    expect((await readJson(join(project, "system.json"))).project.name).toBe(
      "Cabinet 7",
    );
    expect(
      (await readJson(join(project, "presentation.json"))).titleBlock,
    ).toEqual({ lines: [cabinetsCaption] });
  });

  it("rejects an invalid name without creating the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "thermite-alpha-init-name-"));
    temporaryRoots.push(root);
    await expect(
      run(process.execPath, [entry, "init", "project", "--name", "a\nb"], {
        cwd: root,
      }),
    ).rejects.toMatchObject({ code: expect.any(Number) });
    expect(await readdir(root)).toEqual([]);
  });
});

describe("reviewed core starter", () => {
  it.each(["starter", "cabinets"] as const)(
    "alpha init %s locks reviewed 0.2.0",
    async (template) => {
      const { initializeAlphaProject } = await import("../src/alpha-init.js");
      const root = await mkdtemp(join(tmpdir(), "thermite-reviewed-init-"));
      temporaryRoots.push(root);
      const project = join(root, "project");
      await initializeAlphaProject(project, { template });
      const lock = JSON.parse(
        await readFile(join(project, "electrical-system.lock.json"), "utf8"),
      );
      expect(lock.libraries.core).toMatchObject({
        version: "0.2.0",
        path: "libraries/core",
        resolutionKind: "local",
      });
      const result = await compileProject(project);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const report = analyzeCompleteness(result.ir);
      expect(report.counts.unreviewedModels).toBe(0);
      expect(
        report.findings.filter((f) => f.code === "I003" || f.code === "W904"),
      ).toEqual([]);
      expect(report.findings.filter((f) => f.code === "I005")).toHaveLength(2);
      const strict = spawnSync(
        process.execPath,
        [join(repositoryRoot, "thermite.mjs"), "validate", project, "--strict"],
        { encoding: "utf8" },
      );
      expect(strict.status, strict.stderr).toBe(template === "starter" ? 1 : 0);
      expect(strict.stdout).not.toContain("W904");
      if (template === "starter") {
        expect(strict.stdout).not.toContain("W903");
        expect(strict.stdout).toContain("W905");
      } else expect(strict.stderr).toBe("");

      if (template === "starter") {
        const psu = report.devices.find((d) => d.designation === "PS1")!;
        for (const key of ["L", "N"]) {
          expect(psu.connections.find((c) => c.key === key)).toMatchObject({
            required: true,
            connection: "unconnected",
            review: { status: "deferred" },
          });
          expect(
            report.findings
              .filter((f) => f.designation === "PS1" && f.key === key)
              .map((f) => f.code),
          ).toEqual(["W905"]);
        }
      }
    },
  );
});

it("strict validates a 0.2.0 core project with every required point connected", async () => {
  const root = await mkdtemp(join(tmpdir(), "thermite-core02-strict-"));
  temporaryRoots.push(root);
  await cp(join(repositoryRoot, "examples/motor-starter"), root, {
    recursive: true,
  });
  const manifest = JSON.parse(
    await readFile(join(root, "system.json"), "utf8"),
  );
  manifest.libraries[0].version = "0.2.0";
  await writeFile(join(root, "system.json"), JSON.stringify(manifest));
  expect((await lockProject(root)).ok).toBe(true);
  const compiled = await compileProject(root);
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const report = analyzeCompleteness(compiled.ir);
  expect(report.counts.requiredMissing).toBe(0);
  expect(report.counts.warnings).toBe(0);
  expect(report.findings.filter((f) => f.code === "I005")).toHaveLength(11);
  expect(compiled.diagnostics.map((d) => [d.code, d.severity])).toEqual([
    ["I305", "info"],
  ]);
  const strict = spawnSync(
    process.execPath,
    [join(repositoryRoot, "thermite.mjs"), "validate", root, "--strict"],
    { encoding: "utf8" },
  );
  expect(strict.status, strict.stderr).toBe(0);
  expect(strict.stderr).toBe("");
});
