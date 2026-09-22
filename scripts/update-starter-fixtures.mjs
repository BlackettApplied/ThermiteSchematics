import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { format, resolveConfig } from "prettier";

import {
  compileProject,
  generateLibraryLock,
  serializeLibraryLock,
  SHIPPED_CORE_FILE_INVENTORY,
  resolveShippedCoreLibrary,
  writeFileAtomically,
} from "../packages/compiler/dist/index.js";
import {
  DEFAULT_STARTER_PROJECT_NAME,
  DEFAULT_STARTER_REVISION,
  STARTER_NON_LOCK_TEMPLATE_PATHS,
  STARTER_TEMPLATE_PATHS,
  buildStarterScaffold,
  createStarterLoadedProject,
  prepareStarterScaffoldFromAssets,
} from "../packages/cli/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(
  repositoryRoot,
  "packages",
  "cli",
  "templates",
  "starter-default",
);
const rootAgentGuide = join(repositoryRoot, "AGENTS.md");
const STARTER_IDENTITIES = Object.freeze({
  ps1: "33a15867-296b-40e4-a56b-15282f131b4c",
  plc1: "81148ad3-8c03-4c8d-8c70-6b33bb3b0266",
  controlWirePositive: "5b70d7ec-1a8f-4d53-a60b-e077a8ffb10d",
  controlWireReturn: "00f8fde6-55ad-4b82-8bfb-ac3a0268161a",
  potentialPositive: "46be3efd-17b7-43ee-bb9d-a019c4fb2cdd",
  potentialReturn: "aaccbc22-3208-42dd-ae26-54dce0250f8d",
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function formattedJsonBytes(value, destination, prettierConfig) {
  const source =
    typeof value === "string" ? value : JSON.stringify(value, undefined, 2);
  const once = await format(source + (source.endsWith("\n") ? "" : "\n"), {
    ...prettierConfig,
    filepath: destination,
    endOfLine: "lf",
  });
  const twice = await format(once, {
    ...prettierConfig,
    filepath: destination,
    endOfLine: "lf",
  });
  if (
    once !== twice ||
    !once.endsWith("\n") ||
    once.endsWith("\n\n") ||
    once.includes("\r") ||
    once.split("\n").some((line) => /[ \t]+$/u.test(line))
  ) {
    throw new Error(
      "Repository Prettier is not byte-stable for " +
        relative(repositoryRoot, destination).split(sep).join("/") +
        ".",
    );
  }
  return Buffer.from(once, "utf8");
}

async function loadStaticCoreBytes() {
  const root = resolveShippedCoreLibrary().packageRootPath;
  const files = new Map();
  for (const path of SHIPPED_CORE_FILE_INVENTORY) {
    const localPath = join(root, ...path.split("/"));
    const status = await lstat(localPath, { bigint: true });
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1n) {
      throw new Error("Shipped core fixture is not ordinary: " + path);
    }
    files.set(path, await readFile(localPath));
  }
  return files;
}

async function generateOwnedBytes() {
  const prettierConfig =
    (await resolveConfig(join(repositoryRoot, "package.json"))) ?? {};
  const values = buildStarterScaffold({
    name: DEFAULT_STARTER_PROJECT_NAME,
    revision: DEFAULT_STARTER_REVISION,
    identities: STARTER_IDENTITIES,
  });
  const nonLockBytes = new Map();
  for (const path of STARTER_NON_LOCK_TEMPLATE_PATHS) {
    nonLockBytes.set(
      path,
      await formattedJsonBytes(
        values[path],
        join(templateRoot, ...path.split("/")),
        prettierConfig,
      ),
    );
  }

  const shippedCore = await loadStaticCoreBytes();
  const loaded = createStarterLoadedProject(nonLockBytes, shippedCore);
  const canonicalLock = serializeLibraryLock(generateLibraryLock(loaded));
  const lockPath = join(templateRoot, "electrical-system.lock.json");
  const lockBytes = await formattedJsonBytes(
    canonicalLock,
    lockPath,
    prettierConfig,
  );
  if (lockBytes.toString("utf8") !== canonicalLock) {
    throw new Error("Repository Prettier changed the canonical lock bytes.");
  }

  const generated = new Map(nonLockBytes);
  generated.set("electrical-system.lock.json", lockBytes);
  const ordered = new Map(
    STARTER_TEMPLATE_PATHS.map((path) => [path, generated.get(path)]),
  );
  prepareStarterScaffoldFromAssets(
    {
      agentGuide: await readFile(rootAgentGuide),
      templates: ordered,
      shippedCore,
    },
    DEFAULT_STARTER_PROJECT_NAME,
    DEFAULT_STARTER_REVISION,
  );
  return ordered;
}

async function inventoryOrdinaryFiles(root) {
  try {
    const rootStatus = await lstat(root, { bigint: true });
    if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
      throw new Error("Starter fixture root is not an ordinary directory.");
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const files = [];
  async function visit(directory, prefix) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => compareText(left.name, right.name),
    );
    for (const entry of entries) {
      const logicalPath =
        prefix === "" ? entry.name : prefix + "/" + entry.name;
      const localPath = join(directory, entry.name);
      const status = await lstat(localPath, { bigint: true });
      if (
        entry.isSymbolicLink() ||
        status.isSymbolicLink() ||
        (!status.isFile() && !status.isDirectory())
      ) {
        throw new Error(
          "Starter fixture tree contains a link or special entry.",
        );
      }
      if (status.isDirectory()) {
        await visit(localPath, logicalPath);
      } else {
        if (status.nlink !== 1n) {
          throw new Error("Starter fixture tree contains a hard-linked file.");
        }
        files.push(logicalPath);
      }
    }
  }
  await visit(root, "");
  return files.sort(compareText);
}

function requireClosedPaths(paths, allowMissing) {
  const expected = [...STARTER_TEMPLATE_PATHS].sort(compareText);
  if (paths.some((path) => !expected.includes(path))) {
    throw new Error("Starter fixture tree contains an unexpected path.");
  }
  if (!allowMissing && JSON.stringify(paths) !== JSON.stringify(expected)) {
    throw new Error("Starter fixture tree has a missing path.");
  }
}

async function writeTemporaryTree(root, generated) {
  const status = await lstat(root, { bigint: true });
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error("Starter fixture temporary root is not ordinary.");
  }
  await mkdir(join(root, "connections"));
  await mkdir(join(root, "devices"));
  await mkdir(join(root, "potentials"));
  for (const path of STARTER_TEMPLATE_PATHS) {
    await writeFile(join(root, ...path.split("/")), generated.get(path), {
      flag: "wx",
      mode: 0o644,
    });
  }
  requireClosedPaths(await inventoryOrdinaryFiles(root), false);
  const compiled = await compileProject(root);
  if (!compiled.ok) {
    throw new Error(
      "Generated starter does not compile: " +
        JSON.stringify(compiled.diagnostics),
    );
  }
}

export async function updateStarterFixtures(mode) {
  if (mode !== "--write" && mode !== "--check") {
    throw new Error(
      "Usage: node scripts/update-starter-fixtures.mjs --write|--check",
    );
  }
  const generated = await generateOwnedBytes();
  const temporaryRoot = await mkdtemp(
    join(resolve(tmpdir()), "thermite-schematics-starter-fixtures-"),
  );
  try {
    await writeTemporaryTree(temporaryRoot, generated);
    requireClosedPaths(
      await inventoryOrdinaryFiles(templateRoot),
      mode === "--write",
    );

    if (mode === "--write") {
      await mkdir(templateRoot, { recursive: true });
      await mkdir(join(templateRoot, "connections"), { recursive: true });
      await mkdir(join(templateRoot, "devices"), { recursive: true });
      await mkdir(join(templateRoot, "potentials"), { recursive: true });
      for (const path of STARTER_TEMPLATE_PATHS) {
        await writeFileAtomically(
          join(templateRoot, ...path.split("/")),
          generated.get(path),
        );
      }
    } else {
      for (const path of STARTER_TEMPLATE_PATHS) {
        const committed = await readFile(
          join(templateRoot, ...path.split("/")),
        );
        if (!committed.equals(generated.get(path))) {
          throw new Error("Starter fixture is stale: " + path);
        }
      }
    }
    requireClosedPaths(await inventoryOrdinaryFiles(templateRoot), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await updateStarterFixtures(process.argv[2]);
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + "\n",
    );
    process.exitCode = 1;
  }
}
