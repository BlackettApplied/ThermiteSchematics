import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LibraryLock } from "@thermite/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  LIBRARY_LOCK_FILE_NAME,
  computeFileIntegrity,
  computeLibraryIntegrity,
  compileProject,
  generateLibraryLock,
  loadProject,
  lockProject,
  serializeLibraryLock,
  verifyLibraryLock,
  writeFileAtomically,
  type AtomicWriteOperations,
  type LoadedProject,
} from "../src/index.js";

const temporaryRoots: string[] = [];
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
}

function typeDocument(libraryName: string, index: number) {
  return {
    types: [
      {
        kind: "cable_type",
        id: `${libraryName}:cable-${index}`,
        conductors: [{ id: "1", color: index === 0 ? "black" : "white" }],
      },
    ],
  };
}

async function addLibrary(
  projectRoot: string,
  name: string,
  fileCount: number,
): Promise<{ root: string; files: string[] }> {
  const libraryRoot = join(projectRoot, "libraries", name);
  const typeRoot = join(libraryRoot, "types");
  await mkdir(typeRoot, { recursive: true });
  await writeJson(join(libraryRoot, "library.json"), {
    name,
    version: "1.0.0",
    sources: ["types/*.json"],
  });

  const fileNames = ["zeta.json", "alpha.json", "middle.json"].slice(
    0,
    fileCount,
  );

  for (const [index, fileName] of fileNames.entries()) {
    await writeJson(join(typeRoot, fileName), typeDocument(name, index));
  }

  return {
    root: libraryRoot,
    files: fileNames.map((fileName) => join(typeRoot, fileName)),
  };
}

async function createFixture(
  libraryNames: readonly string[] = ["alpha"],
  filesPerLibrary = 2,
): Promise<{
  root: string;
  manifest: string;
  lock: string;
  libraries: Map<string, { root: string; files: string[] }>;
}> {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "thermite-schematics-lock-"),
  );
  temporaryRoots.push(temporaryRoot);
  const projectRoot = join(temporaryRoot, "project");
  const sourceRoot = join(projectRoot, "sources");
  await mkdir(sourceRoot, { recursive: true });
  await writeJson(join(sourceRoot, "empty.json"), { objects: [] });

  const libraries = new Map<string, { root: string; files: string[] }>();

  for (const name of libraryNames) {
    libraries.set(name, await addLibrary(projectRoot, name, filesPerLibrary));
  }

  const manifest = join(projectRoot, "system.json");
  await writeJson(manifest, {
    format: "electrical-system/0.1",
    project: { name: "Lock fixture" },
    sources: ["sources/*.json"],
    ...(libraryNames.length === 0
      ? {}
      : {
          libraries: libraryNames.map((name) => ({
            name,
            version: "1.0.0",
            path: `libraries/${name}`,
          })),
        }),
  });

  return {
    root: projectRoot,
    manifest,
    lock: join(projectRoot, LIBRARY_LOCK_FILE_NAME),
    libraries,
  };
}

async function loadClean(root: string): Promise<LoadedProject> {
  const result = await loadProject(root);
  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }

  return result.project;
}

async function createLock(root: string): Promise<Buffer> {
  const result = await lockProject(root);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return readFile(result.lockPath);
}

async function mutateValidJsonBytes(path: string): Promise<void> {
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace(/\n$/u, " \n"), "utf8");
}

async function readLockValue(path: string): Promise<LibraryLock> {
  return JSON.parse(await readFile(path, "utf8")) as LibraryLock;
}

async function editCanonicalLock(
  path: string,
  edit: (lock: LibraryLock) => void,
): Promise<void> {
  const lock = await readLockValue(path);
  edit(lock);
  await writeFile(path, serializeLibraryLock(lock), "utf8");
}

describe("D6 lock hashing and canonical generation", () => {
  it("uses standard padded Base64 for exact raw bytes and the aggregate record sequence", () => {
    expect(computeFileIntegrity(Buffer.from("abc", "utf8"))).toBe(
      "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
    );

    const files = {
      "types/z.json": "sha256-z",
      "library.json": "sha256-library",
      "types/a.json": "sha256-a",
    };
    const records =
      "library.json\0sha256-library\n" +
      "types/a.json\0sha256-a\n" +
      "types/z.json\0sha256-z\n";
    const expected = `sha256-${createHash("sha256")
      .update(Buffer.from(records, "utf8"))
      .digest("base64")}`;

    expect(computeLibraryIntegrity(files)).toBe(expected);
  });

  it("fixes field order, sorts names and files, and emits portable two-space LF bytes", async () => {
    const fixture = await createFixture(["zeta", "alpha"], 2);
    const alphaLibrary = fixture.libraries.get("alpha")!;
    await writeJson(
      join(alphaLibrary.root, "a.json"),
      typeDocument("alpha", 3),
    );
    await writeJson(join(alphaLibrary.root, "library.json"), {
      name: "alpha",
      version: "1.0.0",
      sources: ["a.json", "types/*.json"],
    });
    const project = await loadClean(fixture.root);
    const generated = generateLibraryLock(project);
    const serialized = serializeLibraryLock(generated);
    const reorderedProject: LoadedProject = {
      ...project,
      libraries: [...project.libraries].reverse().map((library) => ({
        ...library,
        logicalRootPath: `C:\\portable\\${library.dependency.name}`,
        canonicalRootPath: `/portable/${library.dependency.name}`,
        sources: [...library.sources].reverse(),
      })),
    };

    expect(serializeLibraryLock(generateLibraryLock(reorderedProject))).toBe(
      serialized,
    );
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
    expect(serialized).not.toContain("\r");
    expect(serialized).not.toContain("types\\");
    expect(serialized).toContain('\n  "lockfile_version": 1,\n');
    expect(serialized.indexOf('"$schema"')).toBeLessThan(
      serialized.indexOf('"lockfile_version"'),
    );
    expect(serialized.indexOf('"lockfile_version"')).toBeLessThan(
      serialized.indexOf('"project_format"'),
    );
    expect(serialized.indexOf('"project_format"')).toBeLessThan(
      serialized.indexOf('"libraries"'),
    );
    expect(serialized.indexOf('"alpha"')).toBeLessThan(
      serialized.indexOf('"zeta"'),
    );
    expect(serialized.indexOf('"a.json"')).toBeLessThan(
      serialized.indexOf('"library.json"'),
    );
    expect(serialized.indexOf('"library.json"')).toBeLessThan(
      serialized.indexOf('"types/alpha.json"'),
    );
    expect(serialized.indexOf('"types/alpha.json"')).toBeLessThan(
      serialized.indexOf('"types/zeta.json"'),
    );
    const alphaEntry = serialized.slice(serialized.indexOf('"alpha"'));
    expect(alphaEntry.indexOf('"version"')).toBeLessThan(
      alphaEntry.indexOf('"path"'),
    );
    expect(alphaEntry.indexOf('"path"')).toBeLessThan(
      alphaEntry.indexOf('"resolutionKind"'),
    );
    expect(alphaEntry.indexOf('"resolutionKind"')).toBeLessThan(
      alphaEntry.indexOf('"integrity"'),
    );
    expect(alphaEntry.indexOf('"integrity"')).toBeLessThan(
      alphaEntry.indexOf('"files"'),
    );
    expect(serialized.split("\n").every((line) => !/[ \t]+$/u.test(line))).toBe(
      true,
    );

    for (const integrity of Object.values(generated.libraries).flatMap(
      (library) => [library.integrity, ...Object.values(library.files)],
    )) {
      expect(integrity).toMatch(
        /^sha256-[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/u,
      );
    }
    expect(
      Object.values(generated.libraries).map(
        ({ resolutionKind }) => resolutionKind,
      ),
    ).toEqual(["local", "local"]);
  });

  it("emits the exact shipped locator and provenance in locks", async () => {
    const loaded = await loadProject(
      join(repositoryRoot, "examples", "motor-starter"),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));

    const generated = generateLibraryLock(loaded.project);
    expect(generated.libraries.core).toMatchObject({
      version: "0.1.0",
      path: "ais-shipped:core@0.1.0",
      resolutionKind: "shipped",
    });
    expect(Object.keys(generated.libraries.core!)).toEqual([
      "version",
      "path",
      "resolutionKind",
      "integrity",
      "files",
    ]);
  });

  it("normalizes absent v1 provenance to local without changing raw or parsed authority", async () => {
    const fixture = await createFixture();
    await createLock(fixture.root);
    const lock = await readLockValue(fixture.lock);
    delete lock.libraries.alpha!.resolutionKind;
    const legacyBytes = Buffer.from(JSON.stringify(lock, undefined, 2) + "\n");
    await writeFile(fixture.lock, legacyBytes);

    const loaded = await loadProject(fixture.root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    expect(loaded.project.libraryLock.state).toBe("valid");
    if (loaded.project.libraryLock.state !== "valid") {
      throw new Error("Expected a valid legacy lock snapshot.");
    }
    expect(
      loaded.project.libraryLock.value.libraries.alpha?.resolutionKind,
    ).toBe("local");
    expect(
      loaded.project.libraryLock.parsedValue.libraries.alpha?.resolutionKind,
    ).toBeUndefined();
    expect(Buffer.from(loaded.project.libraryLock.rawBytes)).toEqual(
      legacyBytes,
    );
    expect(
      loaded.project.libraryLock.nodes.has("/libraries/alpha/resolutionKind"),
    ).toBe(false);
    expect(verifyLibraryLock(loaded.project)).toMatchObject({
      ok: true,
      diagnostics: [],
      lock: { libraries: { alpha: { resolutionKind: "local" } } },
    });
    expect(await readFile(fixture.lock)).toEqual(legacyBytes);
  });

  it("compiles the pinned pre-M8 local lock without writing it", async () => {
    const root = join(
      repositoryRoot,
      "packages",
      "cli",
      "fixtures",
      "valid project",
    );
    const lockPath = join(root, LIBRARY_LOCK_FILE_NAME);
    const before = await readFile(lockPath);
    const gitBlob = createHash("sha1")
      .update(Buffer.from(`blob ${before.length}\0`, "utf8"))
      .update(before)
      .digest("hex");
    expect(gitBlob).toBe("b1f43146b2345166316bf4d16fdda1ffb3370b0b");
    expect(before.toString("utf8")).not.toContain('"resolutionKind"');

    const loaded = await loadProject(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
    expect(loaded.project.libraries[0]?.resolutionKind).toBe("local");
    expect(
      loaded.project.libraryLock.state === "valid"
        ? loaded.project.libraryLock.value.libraries.mini?.resolutionKind
        : undefined,
    ).toBe("local");

    const compiled = await compileProject(root);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.ir.libraries[0]?.resolutionKind).toBe("local");
    expect(await readFile(lockPath)).toEqual(before);
  });

  it("writes integer-like library names and file paths in code-unit order", () => {
    const hash = computeFileIntegrity(Buffer.from("canonical", "utf8"));
    const library = {
      version: "1.0.0",
      path: "portable",
      integrity: hash,
      files: Object.fromEntries([
        ["2", hash],
        ["10", hash],
        ["library.json", hash],
      ]),
    };
    const lock: LibraryLock = {
      $schema:
        "https://thermiteschematics.com/schemas/0.1/library-lock.schema.json",
      lockfile_version: 1,
      project_format: "electrical-system/0.1",
      libraries: Object.fromEntries([
        ["2", library],
        ["10", library],
      ]),
    };
    const lines = serializeLibraryLock(lock).split("\n");

    expect(lines.filter((line) => /^    "(?:10|2)": \{$/u.test(line))).toEqual([
      '    "10": {',
      '    "2": {',
    ]);
    expect(
      lines.filter((line) => /^        "(?:10|2|library\.json)": /u.test(line)),
    ).toEqual([
      `        "10": "${hash}",`,
      `        "2": "${hash}",`,
      `        "library.json": "${hash}"`,
      `        "10": "${hash}",`,
      `        "2": "${hash}",`,
      `        "library.json": "${hash}"`,
    ]);
  });

  it("preserves __proto__ library and file keys through generation, verification, and --check", async () => {
    const fixture = await createFixture(["__proto__"], 0);
    const libraryRoot = fixture.libraries.get("__proto__")!.root;
    await writeJson(
      join(libraryRoot, "__proto__"),
      typeDocument("__proto__", 0),
    );
    await writeJson(join(libraryRoot, "library.json"), {
      name: "__proto__",
      version: "1.0.0",
      sources: ["__proto__"],
    });

    const generated = generateLibraryLock(await loadClean(fixture.root));
    expect(Object.hasOwn(generated.libraries, "__proto__")).toBe(true);
    expect(
      Object.hasOwn(generated.libraries["__proto__"]!.files, "__proto__"),
    ).toBe(true);
    expect(serializeLibraryLock(generated)).toContain('\n    "__proto__": {\n');
    expect(serializeLibraryLock(generated)).toContain(
      '\n        "__proto__": "sha256-',
    );

    await createLock(fixture.root);
    const persisted = await readLockValue(fixture.lock);
    expect(Object.hasOwn(persisted.libraries, "__proto__")).toBe(true);
    expect(
      Object.hasOwn(persisted.libraries["__proto__"]!.files, "__proto__"),
    ).toBe(true);

    expect(
      await verifyLibraryLock(await loadClean(fixture.root), {
        checkCanonical: true,
      }),
    ).toMatchObject({ ok: true, diagnostics: [] });
    expect(
      await lockProject(fixture.root, process.cwd(), { check: true }),
    ).toMatchObject({
      ok: true,
      diagnostics: [],
      written: false,
    });
  });
});

describe("D4 lock verification precedence", () => {
  it("rejects absent local-normalized provenance for shipped resolution", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-shipped-kind-"),
    );
    temporaryRoots.push(temporaryRoot);
    const projectRoot = join(temporaryRoot, "project");
    await mkdir(projectRoot);
    await writeJson(join(projectRoot, "system.json"), {
      format: "electrical-system/0.1",
      project: { name: "Shipped kind mismatch" },
      sources: ["source.json"],
      libraries: [{ name: "core", version: "0.1.0" }],
    });
    await writeJson(join(projectRoot, "source.json"), { objects: [] });
    await createLock(projectRoot);
    const lockPath = join(projectRoot, LIBRARY_LOCK_FILE_NAME);
    const lock = await readLockValue(lockPath);
    delete lock.libraries.core!.resolutionKind;
    await writeFile(lockPath, JSON.stringify(lock, undefined, 2) + "\n");

    const verified = verifyLibraryLock(await loadClean(projectRoot));
    expect(verified).toMatchObject({
      ok: false,
      toolFailure: false,
      diagnostics: [
        {
          code: "E106",
          message:
            'Library "core" lock resolution kind "local" does not match manifest-selected kind "shipped".',
          file: "system.json",
          jsonPointer: "/libraries/0",
        },
      ],
    });
  });

  it("verifies a clean locked input", async () => {
    const fixture = await createFixture();
    await createLock(fixture.root);
    const result = await verifyLibraryLock(await loadClean(fixture.root), {
      checkCanonical: true,
    });

    expect(result).toMatchObject({ ok: true, diagnostics: [] });
  });

  it("emits E105 at the manifest libraries value and handles zero-library absence", async () => {
    const fixture = await createFixture();
    const result = await verifyLibraryLock(await loadClean(fixture.root));

    expect(result).toMatchObject({
      ok: false,
      toolFailure: false,
      diagnostics: [
        {
          code: "E105",
          file: "system.json",
          line: 9,
          column: 16,
          jsonPointer: "/libraries",
        },
      ],
    });

    const empty = await createFixture([]);
    const emptyCheck = await lockProject(empty.root, process.cwd(), {
      check: true,
    });
    const emptyWrite = await lockProject(empty.root);

    expect(emptyCheck).toMatchObject({
      ok: true,
      diagnostics: [],
      written: false,
    });
    expect(emptyWrite).toMatchObject({
      ok: true,
      diagnostics: [],
      written: false,
    });
    await expect(readFile(empty.lock)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeFile(empty.lock, "{\n", "utf8");
    const repairedEmpty = await lockProject(empty.root);
    expect(repairedEmpty).toMatchObject({
      ok: true,
      diagnostics: [],
      written: true,
      lock: { libraries: {} },
    });
    expect(
      await verifyLibraryLock(await loadClean(empty.root), {
        checkCanonical: true,
      }),
    ).toMatchObject({ ok: true, diagnostics: [] });
  });

  it("assigns structurally valid byte changes to E108 at 1:1 without mutating the lock", async () => {
    const fixture = await createFixture();
    const before = await createLock(fixture.root);
    const changedFile = fixture.libraries.get("alpha")!.files[0]!;
    await mutateValidJsonBytes(changedFile);

    const checked = await lockProject(fixture.root, process.cwd(), {
      check: true,
    });

    expect(checked.ok).toBe(false);
    expect(checked.diagnostics).toMatchObject([
      {
        code: "E108",
        file: `libraries/alpha/types/${basename(changedFile)}`,
        line: 1,
        column: 1,
        jsonPointer: "",
        related: [
          {
            file: LIBRARY_LOCK_FILE_NAME,
            line: 14,
            column: 28,
            note: expect.stringContaining("Locked integrity"),
          },
        ],
      },
    ]);
    expect(await readFile(fixture.lock)).toEqual(before);
  });

  it("assigns added and removed valid glob matches to E107 with sorted lists", async () => {
    const addedFixture = await createFixture();
    await createLock(addedFixture.root);
    const addedPath = join(
      addedFixture.libraries.get("alpha")!.root,
      "types",
      "added.json",
    );
    await writeJson(addedPath, typeDocument("alpha", 10));
    const added = await verifyLibraryLock(await loadClean(addedFixture.root));

    expect(added.diagnostics).toMatchObject([
      {
        code: "E107",
        file: LIBRARY_LOCK_FILE_NAME,
        line: 11,
        column: 16,
        jsonPointer: "/libraries/alpha/files",
        message: expect.stringContaining('added ["types/added.json"]'),
        related: [
          {
            file: "libraries/alpha/library.json",
            line: 4,
            column: 14,
            note: expect.stringContaining("source globs"),
          },
        ],
      },
    ]);

    const removedFixture = await createFixture();
    await createLock(removedFixture.root);
    const removedPath = removedFixture.libraries.get("alpha")!.files[0]!;
    await unlink(removedPath);
    const removed = await verifyLibraryLock(
      await loadClean(removedFixture.root),
    );

    expect(removed.diagnostics).toMatchObject([
      {
        code: "E107",
        message: expect.stringContaining(
          `removed ["types/${basename(removedPath)}"]`,
        ),
      },
    ]);
  });

  it("assigns version, path, name-set, and project-format changes to E106", async () => {
    const versionFixture = await createFixture();
    const versionLock = await createLock(versionFixture.root);
    const versionManifest = JSON.parse(
      await readFile(versionFixture.manifest, "utf8"),
    ) as {
      libraries: Array<{ name: string; version: string; path: string }>;
    };
    versionManifest.libraries[0]!.version = "1.1.0";
    await writeJson(versionFixture.manifest, versionManifest);
    const libraryManifestPath = join(
      versionFixture.libraries.get("alpha")!.root,
      "library.json",
    );
    const libraryManifest = JSON.parse(
      await readFile(libraryManifestPath, "utf8"),
    ) as { name: string; version: string; sources: string[] };
    libraryManifest.version = "1.1.0";
    await writeJson(libraryManifestPath, libraryManifest);
    const version = await lockProject(versionFixture.root, process.cwd(), {
      check: true,
    });
    expect(version.diagnostics).toMatchObject([
      {
        code: "E106",
        file: "system.json",
        jsonPointer: "/libraries/0/version",
        related: [
          {
            file: LIBRARY_LOCK_FILE_NAME,
            line: 7,
            column: 18,
          },
        ],
      },
    ]);
    expect(await readFile(versionFixture.lock)).toEqual(versionLock);

    const pathFixture = await createFixture();
    await createLock(pathFixture.root);
    const oldRoot = pathFixture.libraries.get("alpha")!.root;
    const newRoot = join(pathFixture.root, "libraries", "alpha-new");
    await rename(oldRoot, newRoot);
    const pathManifest = JSON.parse(
      await readFile(pathFixture.manifest, "utf8"),
    ) as {
      libraries: Array<{ name: string; version: string; path: string }>;
    };
    pathManifest.libraries[0]!.path = "libraries/alpha-new";
    await writeJson(pathFixture.manifest, pathManifest);
    const pathResult = await verifyLibraryLock(
      await loadClean(pathFixture.root),
    );
    expect(pathResult.diagnostics).toMatchObject([
      {
        code: "E106",
        jsonPointer: "/libraries/0/path",
        related: [
          {
            file: LIBRARY_LOCK_FILE_NAME,
            line: 8,
            column: 15,
          },
        ],
      },
    ]);

    const namesFixture = await createFixture(["alpha", "beta"]);
    await createLock(namesFixture.root);
    const namesManifest = JSON.parse(
      await readFile(namesFixture.manifest, "utf8"),
    ) as {
      libraries: Array<{ name: string; version: string; path: string }>;
    };
    namesManifest.libraries = namesManifest.libraries.slice(0, 1);
    await writeJson(namesFixture.manifest, namesManifest);
    const names = await verifyLibraryLock(await loadClean(namesFixture.root));
    expect(names.diagnostics).toMatchObject([
      {
        code: "E106",
        file: LIBRARY_LOCK_FILE_NAME,
        line: 17,
        column: 5,
        jsonPointer: "/libraries/beta",
      },
    ]);

    const missingNameFixture = await createFixture(["alpha"]);
    await createLock(missingNameFixture.root);
    await addLibrary(missingNameFixture.root, "beta", 2);
    const missingNameManifest = JSON.parse(
      await readFile(missingNameFixture.manifest, "utf8"),
    ) as {
      libraries: Array<{ name: string; version: string; path: string }>;
    };
    missingNameManifest.libraries.push({
      name: "beta",
      version: "1.0.0",
      path: "libraries/beta",
    });
    await writeJson(missingNameFixture.manifest, missingNameManifest);
    const missingName = await verifyLibraryLock(
      await loadClean(missingNameFixture.root),
    );
    expect(missingName.diagnostics).toMatchObject([
      {
        code: "E106",
        file: "system.json",
        line: 15,
        column: 5,
        jsonPointer: "/libraries/1",
      },
    ]);

    const formatFixture = await createFixture();
    await createLock(formatFixture.root);
    await editCanonicalLock(formatFixture.lock, (lock) => {
      lock.project_format = "electrical-system/0.2";
    });
    const format = await verifyLibraryLock(await loadClean(formatFixture.root));
    expect(format.diagnostics).toMatchObject([
      {
        code: "E106",
        file: "system.json",
        line: 2,
        column: 13,
        jsonPointer: "/format",
        related: [
          {
            file: LIBRARY_LOCK_FILE_NAME,
            line: 4,
            column: 21,
          },
        ],
      },
    ]);
  });

  it("reports E109 before disk file-set or content comparisons", async () => {
    const fixture = await createFixture();
    await createLock(fixture.root);
    await editCanonicalLock(fixture.lock, (lock) => {
      lock.libraries.alpha!.integrity = computeFileIntegrity(
        Buffer.from("corrupt aggregate", "utf8"),
      );
    });
    await mutateValidJsonBytes(fixture.libraries.get("alpha")!.files[0]!);
    await writeJson(
      join(fixture.libraries.get("alpha")!.root, "types", "added.json"),
      typeDocument("alpha", 10),
    );

    const result = await verifyLibraryLock(await loadClean(fixture.root));

    expect(result.diagnostics).toMatchObject([
      {
        code: "E109",
        file: LIBRARY_LOCK_FILE_NAME,
        line: 10,
        column: 20,
        jsonPointer: "/libraries/alpha/integrity",
      },
    ]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("collects all same-row failures before applying downstream suppression", async () => {
    const fixture = await createFixture(["alpha", "beta"]);
    await createLock(fixture.root);
    await editCanonicalLock(fixture.lock, (lock) => {
      lock.libraries.alpha!.integrity = computeFileIntegrity(
        Buffer.from("bad alpha aggregate", "utf8"),
      );
      lock.libraries.beta!.integrity = computeFileIntegrity(
        Buffer.from("bad beta aggregate", "utf8"),
      );
    });
    for (const library of fixture.libraries.values()) {
      await mutateValidJsonBytes(library.files[0]!);
    }

    const result = await verifyLibraryLock(await loadClean(fixture.root));

    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "E109",
      "E109",
    ]);
    expect(
      result.diagnostics.map(({ message }) => message).join(" "),
    ).toContain("alpha");
    expect(
      result.diagnostics.map(({ message }) => message).join(" "),
    ).toContain("beta");
  });

  it("collects each row across libraries and suppresses only downstream work in that scope", async () => {
    const fixture = await createFixture(["alpha", "beta", "gamma", "delta"], 2);
    await createLock(fixture.root);
    await editCanonicalLock(fixture.lock, (lock) => {
      lock.libraries.alpha!.version = "2.0.0";
      lock.libraries.beta!.integrity = computeFileIntegrity(
        Buffer.from("bad beta aggregate", "utf8"),
      );
    });

    await mutateValidJsonBytes(fixture.libraries.get("alpha")!.files[0]!);
    await mutateValidJsonBytes(fixture.libraries.get("beta")!.files[0]!);
    await writeJson(
      join(fixture.libraries.get("beta")!.root, "types", "added.json"),
      typeDocument("beta", 10),
    );
    await mutateValidJsonBytes(fixture.libraries.get("gamma")!.files[0]!);
    await writeJson(
      join(fixture.libraries.get("gamma")!.root, "types", "added.json"),
      typeDocument("gamma", 10),
    );
    for (const file of fixture.libraries.get("delta")!.files) {
      await mutateValidJsonBytes(file);
    }

    const result = await verifyLibraryLock(await loadClean(fixture.root), {
      checkCanonical: true,
    });
    const codes = result.diagnostics.map(({ code }) => code);

    expect(codes.filter((code) => code === "E106")).toHaveLength(1);
    expect(codes.filter((code) => code === "E109")).toHaveLength(1);
    expect(codes.filter((code) => code === "E107")).toHaveLength(1);
    expect(codes.filter((code) => code === "E108")).toHaveLength(2);
    expect(codes).not.toContain("E110");
    expect(
      result.diagnostics.find(({ code }) => code === "E106")?.message,
    ).toContain("alpha");
    expect(
      result.diagnostics.find(({ code }) => code === "E109")?.message,
    ).toContain("beta");
    expect(
      result.diagnostics.find(({ code }) => code === "E107")?.message,
    ).toContain("gamma");
    expect(
      result.diagnostics
        .filter(({ code }) => code === "E108")
        .every(({ message }) => message.includes("delta")),
    ).toBe(true);
  });

  it("keeps malformed added and changed files at stage 0 under M1 E0xx ownership", async () => {
    const addedFixture = await createFixture();
    const addedBefore = await createLock(addedFixture.root);
    await writeFile(
      join(addedFixture.libraries.get("alpha")!.root, "types", "bad.json"),
      "{\n",
      "utf8",
    );
    const added = await lockProject(addedFixture.root, process.cwd(), {
      check: true,
    });
    expect(added.diagnostics.map(({ code }) => code)).toEqual(["E002"]);
    expect(await readFile(addedFixture.lock)).toEqual(addedBefore);

    const changedFixture = await createFixture();
    const changedBefore = await createLock(changedFixture.root);
    await writeFile(
      changedFixture.libraries.get("alpha")!.files[0]!,
      "{\n",
      "utf8",
    );
    const changed = await lockProject(changedFixture.root, process.cwd(), {
      check: true,
    });
    expect(changed.diagnostics.map(({ code }) => code)).toEqual(["E002"]);
    expect(await readFile(changedFixture.lock)).toEqual(changedBefore);
  });

  it("keeps malformed lock parser/schema failures under E0xx ownership", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.lock, "{\n", "utf8");
    const parserResult = await verifyLibraryLock(await loadClean(fixture.root));
    expect(parserResult.diagnostics.map(({ code }) => code)).toEqual(["E002"]);

    await writeJson(fixture.lock, { unexpected: true });
    const schemaResult = await verifyLibraryLock(await loadClean(fixture.root));
    expect(schemaResult.diagnostics.length).toBeGreaterThan(0);
    expect(
      schemaResult.diagnostics.every(({ code }) => /^E0\d\d$/u.test(code)),
    ).toBe(true);
  });

  it("emits E110 only for --check byte drift after semantic success", async () => {
    const fixture = await createFixture();
    const canonical = await createLock(fixture.root);
    const drifted = canonical.toString("utf8").replaceAll("\n", "\r\n");
    await writeFile(fixture.lock, drifted, "utf8");
    const before = await readFile(fixture.lock);
    const project = await loadClean(fixture.root);

    const normal = await verifyLibraryLock(project);
    const checked = await verifyLibraryLock(project, { checkCanonical: true });

    expect(normal).toMatchObject({ ok: true, diagnostics: [] });
    expect(checked).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "E110",
          file: LIBRARY_LOCK_FILE_NAME,
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ],
    });
    expect(await readFile(fixture.lock)).toEqual(before);
  });
});

describe("D6 atomic writes and explicit repair", () => {
  function actualOperations(
    renameOperation: AtomicWriteOperations["rename"] = rename,
  ): AtomicWriteOperations {
    return {
      open: async (path, flags) => open(path, flags),
      rename: renameOperation,
      unlink,
    };
  }

  it("uses exclusive same-directory temps, retries collisions, and renames over the destination", async () => {
    const fixture = await createFixture([]);
    const destination = join(fixture.root, "output.json");
    const collision = join(fixture.root, ".collision.tmp");
    const replacement = join(fixture.root, ".replacement.tmp");
    await writeFile(destination, "old", "utf8");
    await writeFile(collision, "collision", "utf8");

    await writeFileAtomically(destination, "new", {
      temporaryPath: (_path, attempt) =>
        attempt === 0 ? collision : replacement,
    });

    expect(await readFile(destination, "utf8")).toBe("new");
    expect(await readFile(collision, "utf8")).toBe("collision");
    await expect(readFile(replacement)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(dirname(collision)).toBe(dirname(destination));
  });

  it("cleans its temp and preserves the destination on write or rename failure", async () => {
    const fixture = await createFixture([]);
    const destination = join(fixture.root, "output.json");
    const writeTemp = join(fixture.root, ".write-failure.tmp");
    const renameTemp = join(fixture.root, ".rename-failure.tmp");
    await writeFile(destination, "old", "utf8");

    const writeFailureOperations: AtomicWriteOperations = {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          writeFile: async () => {
            throw new Error("injected write failure");
          },
          close: async () => handle.close(),
        };
      },
      rename,
      unlink,
    };

    await expect(
      writeFileAtomically(destination, "new", {
        operations: writeFailureOperations,
        temporaryPath: () => writeTemp,
      }),
    ).rejects.toThrow("injected write failure");
    expect(await readFile(destination, "utf8")).toBe("old");
    await expect(readFile(writeTemp)).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      writeFileAtomically(destination, "new", {
        operations: actualOperations(async () => {
          throw new Error("injected rename failure");
        }),
        temporaryPath: () => renameTemp,
      }),
    ).rejects.toThrow("injected rename failure");
    expect(await readFile(destination, "utf8")).toBe("old");
    await expect(readFile(renameTemp)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("repairs malformed and stale locks but never writes after structural failure", async () => {
    const malformedFixture = await createFixture();
    await writeFile(malformedFixture.lock, "{\n", "utf8");
    const repairedMalformed = await lockProject(malformedFixture.root);
    expect(repairedMalformed).toMatchObject({ ok: true, written: true });
    expect(
      await verifyLibraryLock(await loadClean(malformedFixture.root), {
        checkCanonical: true,
      }),
    ).toMatchObject({ ok: true, diagnostics: [] });

    const staleFixture = await createFixture();
    const original = await createLock(staleFixture.root);
    await mutateValidJsonBytes(staleFixture.libraries.get("alpha")!.files[0]!);
    const repairedStale = await lockProject(staleFixture.root);
    expect(repairedStale).toMatchObject({ ok: true, written: true });
    expect(await readFile(staleFixture.lock)).not.toEqual(original);
    expect(
      await verifyLibraryLock(await loadClean(staleFixture.root), {
        checkCanonical: true,
      }),
    ).toMatchObject({ ok: true, diagnostics: [] });

    const invalidFixture = await createFixture();
    const before = await createLock(invalidFixture.root);
    await writeFile(
      invalidFixture.libraries.get("alpha")!.files[0]!,
      "{\n",
      "utf8",
    );
    const invalid = await lockProject(invalidFixture.root);
    expect(invalid).toMatchObject({ ok: false, toolFailure: false });
    expect(invalid.diagnostics.map(({ code }) => code)).toEqual(["E002"]);
    expect(await readFile(invalidFixture.lock)).toEqual(before);
  });

  it("surfaces injected atomic failure as E001 and leaves the prior lock untouched", async () => {
    const fixture = await createFixture();
    const before = await createLock(fixture.root);
    const temporaryPath = join(fixture.root, ".injected.tmp");
    const result = await lockProject(fixture.root, process.cwd(), {
      atomicWrite: {
        operations: actualOperations(async () => {
          throw new Error("injected rename failure");
        }),
        temporaryPath: () => temporaryPath,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      toolFailure: true,
      diagnostics: [
        {
          code: "E001",
          file: LIBRARY_LOCK_FILE_NAME,
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ],
    });
    expect(await readFile(fixture.lock)).toEqual(before);
    await expect(readFile(temporaryPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
