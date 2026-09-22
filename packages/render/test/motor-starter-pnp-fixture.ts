import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");
const canonicalProjectRoot = join(repositoryRoot, "examples", "motor-starter");
const canonicalLibraryRoot = join(
  repositoryRoot,
  "packages",
  "core-library",
  "library",
);

const equipmentRelativePath = "devices/equipment.json";
const fieldTerminationsRelativePath = "connections/field-terminations.json";

const baselineType = '"type": "core:limit-switch-2wire"';
const pnpType = '"type": "core:prox-pnp-3wire"';
const baselineDescription =
  '"description": "Normally open field limit switch permissive"';
const pnpDescription =
  '"description": "Three-wire PNP field proximity sensor permissive"';

const newWire = `    {
      "uid": "4afbc8b2-5bd7-4b92-8f9d-dcf124b85d01",
      "kind": "wire",
      "designation": "W-FLD-004",
      "endpoints": [
        { "device": "JB1", "terminal": "X1.3" },
        { "device": "LS1", "terminal": "3" }
      ],
      "properties": {
        "label": "0V-JB1-LS1",
        "size": "18AWG",
        "color": "blue/white"
      }
    },
`;

export interface MotorStarterPnpExperiment {
  readonly root: string;
  readonly projectRoot: string;
  readonly libraryRoot: string;
  readonly baselineProjectFiles: ReadonlyMap<string, Buffer>;
  readonly baselineLibraryFiles: ReadonlyMap<string, Buffer>;
  applyTypeOnlyEdit(): Promise<void>;
  applyCompletedEdit(): Promise<void>;
  cleanup(): Promise<void>;
}

function replaceExactlyOnce(
  source: string,
  search: string,
  replacement: string,
  context: string,
): string {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`${context} must occur exactly once.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(
    first + search.length,
  )}`;
}

async function snapshotOrdinaryFiles(
  root: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const files = new Map<string, Buffer>();

  async function visit(path: string): Promise<void> {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`Experiment copy contains a reparse point: ${path}`);
    }
    if (stats.isDirectory()) {
      const entries = await readdir(path);
      entries.sort((left, right) => left.localeCompare(right));
      for (const entry of entries) await visit(join(path, entry));
      return;
    }
    if (!stats.isFile()) {
      throw new Error(`Experiment copy contains a non-regular file: ${path}`);
    }
    files.set(relative(root, path).split(sep).join("/"), await readFile(path));
  }

  await visit(root);
  return files;
}

export async function snapshotMotorStarterExperimentFiles(
  experiment: Pick<MotorStarterPnpExperiment, "projectRoot" | "libraryRoot">,
): Promise<{
  readonly project: ReadonlyMap<string, Buffer>;
  readonly library: ReadonlyMap<string, Buffer>;
}> {
  return {
    project: await snapshotOrdinaryFiles(experiment.projectRoot),
    library: await snapshotOrdinaryFiles(experiment.libraryRoot),
  };
}

function assertDisposableExperimentRoot(root: string): void {
  const parent = resolve(tmpdir());
  if (
    dirname(resolve(root)) !== parent ||
    !basename(root).startsWith("thermite-schematics-m6-pnp-")
  ) {
    throw new Error(`Refusing to remove unexpected experiment root: ${root}`);
  }
}

export async function createMotorStarterPnpExperiment(): Promise<MotorStarterPnpExperiment> {
  const root = await mkdtemp(
    join(resolve(tmpdir()), "thermite-schematics-m6-pnp-"),
  );
  const projectRoot = join(root, "examples", "motor-starter");
  const libraryRoot = canonicalLibraryRoot;
  let stage: "baseline" | "type-only" | "complete" = "baseline";

  const cleanup = async (): Promise<void> => {
    assertDisposableExperimentRoot(root);
    await rm(root, { recursive: true, force: true });
  };

  try {
    const baselineProjectFiles =
      await snapshotOrdinaryFiles(canonicalProjectRoot);
    const baselineLibraryFiles =
      await snapshotOrdinaryFiles(canonicalLibraryRoot);
    await mkdir(join(root, "examples"), { recursive: true });
    await cp(canonicalProjectRoot, projectRoot, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await snapshotOrdinaryFiles(projectRoot);
    await snapshotOrdinaryFiles(libraryRoot);

    return Object.freeze({
      root,
      projectRoot,
      libraryRoot,
      baselineProjectFiles,
      baselineLibraryFiles,
      async applyTypeOnlyEdit(): Promise<void> {
        if (stage !== "baseline") {
          throw new Error("The LS1 type-only edit is out of sequence.");
        }
        const path = join(projectRoot, equipmentRelativePath);
        const source = await readFile(path, "utf8");
        await writeFile(
          path,
          replaceExactlyOnce(
            source,
            baselineType,
            pnpType,
            "LS1 baseline type",
          ),
          "utf8",
        );
        stage = "type-only";
      },
      async applyCompletedEdit(): Promise<void> {
        if (stage !== "type-only") {
          throw new Error(
            "The completed LS1 edit must follow type-only validation.",
          );
        }

        const equipmentPath = join(projectRoot, equipmentRelativePath);
        const equipment = await readFile(equipmentPath, "utf8");
        await writeFile(
          equipmentPath,
          replaceExactlyOnce(
            equipment,
            baselineDescription,
            pnpDescription,
            "LS1 baseline description",
          ),
          "utf8",
        );

        const fieldPath = join(projectRoot, fieldTerminationsRelativePath);
        let field = await readFile(fieldPath, "utf8");
        field = replaceExactlyOnce(
          field,
          '{ "device": "LS1", "terminal": "13" }',
          '{ "device": "LS1", "terminal": "1" }',
          "W-FLD-002 LS1 endpoint",
        );
        field = replaceExactlyOnce(
          field,
          '{ "device": "LS1", "terminal": "14" }',
          '{ "device": "LS1", "terminal": "4" }',
          "W-FLD-003 LS1 endpoint",
        );
        field = replaceExactlyOnce(
          field,
          '"label": "LS1-SWITCHED-RETURN"',
          '"label": "LS1-PNP-OUT-PLC1-DI0"',
          "W-FLD-003 label",
        );
        field = replaceExactlyOnce(
          field,
          `    {
      "uid": "7bdee01c-ec15-4747-9208-ee650da1e681"`,
          `${newWire}    {
      "uid": "7bdee01c-ec15-4747-9208-ee650da1e681"`,
          "JP1 insertion point",
        );
        await writeFile(fieldPath, field, "utf8");
        stage = "complete";
      },
      cleanup,
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
}
