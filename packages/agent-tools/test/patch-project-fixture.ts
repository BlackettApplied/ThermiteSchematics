import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PatchFixtureKind =
  | "clean"
  | "semantic-invalid"
  | "repair"
  | "stale"
  | "reparse"
  | "staged-failure"
  | "commit-failure"
  | "rollback-failure";

export interface PatchProjectFixture {
  readonly kind: PatchFixtureKind;
  readonly root: string;
  readonly projectRoot: string;
  cleanup(): Promise<void>;
}

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");
const cleanProjectRoot = join(testRoot, "fixtures", "patch-project");
const semanticProjectRoot = join(
  repositoryRoot,
  "packages",
  "compiler",
  "fixtures",
  "rules",
  "exclusive-terminal-second-wire",
);
const semanticLibraryRoot = join(
  repositoryRoot,
  "packages",
  "compiler",
  "fixtures",
  "rules",
  "library",
);

async function assertOrdinaryTree(path: string): Promise<void> {
  const status = await lstat(path);
  if (status.isSymbolicLink()) {
    throw new Error("Patch fixtures must not contain links or junctions.");
  }
  if (status.isDirectory()) {
    const names = await readdir(path);
    names.sort();
    for (const name of names) {
      await assertOrdinaryTree(join(path, name));
    }
    return;
  }
  if (!status.isFile()) {
    throw new Error("Patch fixtures must contain only ordinary files.");
  }
}

export async function createPatchProjectFixture(
  kind: PatchFixtureKind,
): Promise<PatchProjectFixture> {
  const root = await mkdtemp(
    join(resolve(tmpdir()), `thermite-schematics-m7-${kind}-`),
  );
  const projectRoot = join(root, "project");
  try {
    if (kind === "semantic-invalid" || kind === "repair") {
      await cp(semanticProjectRoot, projectRoot, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      await cp(semanticLibraryRoot, join(root, "library"), {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
    } else {
      await mkdir(projectRoot);
      await cp(cleanProjectRoot, projectRoot, {
        recursive: true,
        dereference: false,
        force: false,
        verbatimSymlinks: true,
      });
      await writeFile(
        join(projectRoot, "sources", "a.json"),
        '{"objects":[]}\n',
        "utf8",
      );
      await writeFile(
        join(projectRoot, "sources", "b.json"),
        '{"objects":[]}\n',
        "utf8",
      );
    }
    await assertOrdinaryTree(root);
    return Object.freeze({
      kind,
      root,
      projectRoot,
      async cleanup() {
        await rm(root, {
          recursive: true,
          force: true,
          maxRetries: 2,
          retryDelay: 50,
        });
      },
    });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
