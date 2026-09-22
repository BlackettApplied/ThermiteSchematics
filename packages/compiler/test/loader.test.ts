import { symlinkSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SHIPPED_CORE_DISPLAY_ROOT,
  SHIPPED_CORE_LIBRARY_LOCATOR,
  compileProject,
  loadProject,
  resolveShippedCoreLibrary,
} from "../src/index.js";
import {
  canonicalizeMatchedFile,
  canonicalizeMatchedPath,
  displayPath,
} from "../src/loader.js";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
}

function junctionCreationWasDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["EACCES", "EPERM", "ENOTSUP"].includes(String(error.code))
  );
}

async function removeTemporaryDirectory(path: string): Promise<void> {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

describe("project loader", () => {
  it("rejects a realpath-canonicalized match outside its canonical root", async () => {
    const canonicalRoot = resolve("canonical-project");
    const lexicalMatch = join(canonicalRoot, "linked", "source.json");
    const insideMatch = join(canonicalRoot, "sources", "source.json");
    const outsideMatch = resolve(canonicalRoot, "..", "outside", "source.json");

    await expect(
      canonicalizeMatchedPath(
        canonicalRoot,
        lexicalMatch,
        async () => outsideMatch,
      ),
    ).resolves.toBeUndefined();
    await expect(
      canonicalizeMatchedPath(
        canonicalRoot,
        lexicalMatch,
        async () => insideMatch,
      ),
    ).resolves.toBe(insideMatch);
  });

  it("keys canonical matches by filesystem identity with exact-path fallback", async () => {
    const canonicalRoot = resolve("canonical-project");
    const upperMatch = join(canonicalRoot, "sources", "A.json");
    const lowerMatch = join(canonicalRoot, "sources", "a.json");
    const canonicalize = async (path: string) => path;
    const sameIdentity = async () => ({ dev: 10n, ino: 20n });
    const distinctUpper = async () => ({ dev: 10n, ino: 20n });
    const distinctLower = async () => ({ dev: 10n, ino: 21n });
    const unavailableIdentity = async (): Promise<never> => {
      throw new Error("stat unavailable");
    };

    const sameUpper = await canonicalizeMatchedFile(
      canonicalRoot,
      upperMatch,
      canonicalize,
      sameIdentity,
    );
    const sameLower = await canonicalizeMatchedFile(
      canonicalRoot,
      lowerMatch,
      canonicalize,
      sameIdentity,
    );
    const differentUpper = await canonicalizeMatchedFile(
      canonicalRoot,
      upperMatch,
      canonicalize,
      distinctUpper,
    );
    const differentLower = await canonicalizeMatchedFile(
      canonicalRoot,
      lowerMatch,
      canonicalize,
      distinctLower,
    );
    const fallbackUpper = await canonicalizeMatchedFile(
      canonicalRoot,
      upperMatch,
      canonicalize,
      unavailableIdentity,
    );
    const fallbackLower = await canonicalizeMatchedFile(
      canonicalRoot,
      lowerMatch,
      canonicalize,
      unavailableIdentity,
    );

    expect(sameUpper?.identityKey).toBe(sameLower?.identityKey);
    expect(differentUpper?.identityKey).not.toBe(differentLower?.identityKey);
    expect(fallbackUpper).toEqual({
      canonicalPath: upperMatch,
      logicalPath: upperMatch,
      identityKey: `path:${upperMatch}`,
    });
    expect(fallbackLower).toEqual({
      canonicalPath: lowerMatch,
      logicalPath: lowerMatch,
      identityKey: `path:${lowerMatch}`,
    });
  });

  it("preserves logical display paths when canonical roots differ", async () => {
    const logicalRoot = resolve("logical-parent", "project");
    const canonicalRoot = resolve("physical-parent", "project");
    const logicalMatch = join(logicalRoot, "sources", "bad.json");
    const canonicalMatch = join(canonicalRoot, "sources", "bad.json");

    const matchedFile = await canonicalizeMatchedFile(
      canonicalRoot,
      logicalMatch,
      async () => canonicalMatch,
      async () => ({ dev: 10n, ino: 20n }),
    );

    expect(matchedFile).toEqual({
      canonicalPath: canonicalMatch,
      logicalPath: logicalMatch,
      identityKey: "stat:10:20",
    });
    expect(displayPath(matchedFile!.logicalPath, logicalRoot)).toBe(
      "sources/bad.json",
    );
  });

  it("rejects a project root that is itself a directory link", async ({
    skip,
  }) => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-linked-project-root-"),
    );
    const targetRoot = join(temporaryRoot, "project-target");
    const linkedRoot = join(temporaryRoot, "project-link");

    try {
      await mkdir(join(targetRoot, "sources"), { recursive: true });
      await writeJson(join(targetRoot, "system.json"), {
        format: "electrical-system/0.1",
        project: { name: "Linked project root regression" },
        sources: ["sources/*.json"],
      });
      await writeJson(join(targetRoot, "sources", "bad.json"), {
        objects: [
          {
            kind: "device",
            designation: "K1",
            type: "core:contactor-3p-1no",
          },
        ],
      });

      try {
        symlinkSync(
          targetRoot,
          linkedRoot,
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch (error) {
        if (junctionCreationWasDenied(error)) {
          skip("The filesystem denied directory-link creation.");
          return;
        }

        throw error;
      }

      const result = await loadProject(linkedRoot);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected the linked project root to fail loading.");
      }

      expect(result.toolFailure).toBe(true);
      expect(result.diagnostics).toMatchObject([
        {
          code: "E001",
          file: "system.json",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("project source root");
      expect(result.diagnostics[0]?.message).toContain(
        "symlink or reparse-point component",
      );
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("rejects a library root that is itself a directory link", async ({
    skip,
  }) => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-linked-library-root-"),
    );
    const projectRoot = join(temporaryRoot, "project");
    const targetRoot = join(temporaryRoot, "library-target");
    const linkedRoot = join(temporaryRoot, "library-link");

    try {
      await mkdir(join(projectRoot, "sources"), { recursive: true });
      await mkdir(targetRoot);
      await writeJson(join(projectRoot, "system.json"), {
        format: "electrical-system/0.1",
        project: { name: "Linked library root regression" },
        sources: ["sources/*.json"],
        libraries: [
          { name: "linked", version: "0.1.0", path: "../library-link" },
        ],
      });
      await writeJson(join(projectRoot, "sources", "empty.json"), {
        objects: [],
      });
      await writeFile(join(targetRoot, "library.json"), "not JSON\n", "utf8");

      try {
        symlinkSync(
          targetRoot,
          linkedRoot,
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch (error) {
        if (junctionCreationWasDenied(error)) {
          skip("The filesystem denied directory-link creation.");
          return;
        }

        throw error;
      }

      const result = await loadProject(projectRoot);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected the linked library root to fail loading.");
      }

      expect(result.toolFailure).toBe(true);
      expect(result.diagnostics).toMatchObject([
        {
          code: "E001",
          file: "../library-link/library.json",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("library source root");
      expect(result.diagnostics[0]?.message).toContain(
        "symlink or reparse-point component",
      );
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it.runIf(process.platform === "win32")(
    "rejects a junction in a project glob static base",
    async ({ skip }) => {
      const temporaryRoot = await mkdtemp(
        join(tmpdir(), "thermite-schematics-project-junction-"),
      );
      const projectRoot = join(temporaryRoot, "project");
      const outsideRoot = join(temporaryRoot, "outside");

      try {
        await mkdir(projectRoot);
        await mkdir(outsideRoot);
        await writeJson(join(projectRoot, "system.json"), {
          format: "electrical-system/0.1",
          project: { name: "Project junction regression" },
          sources: ["linked/*.json"],
        });
        await writeJson(join(outsideRoot, "source.json"), { objects: [] });

        try {
          symlinkSync(outsideRoot, join(projectRoot, "linked"), "junction");
        } catch (error) {
          if (junctionCreationWasDenied(error)) {
            skip("Windows denied junction creation.");
            return;
          }

          throw error;
        }

        const result = await loadProject(projectRoot);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("Expected the project junction to fail loading.");
        }

        expect(result.toolFailure).toBe(true);
        expect(result.diagnostics).toMatchObject([
          {
            code: "E001",
            file: "system.json",
            line: 1,
            column: 1,
            jsonPointer: "",
          },
        ]);
        expect(result.diagnostics[0]?.message).toContain(
          "static base contains symlink or reparse-point component",
        );
      } finally {
        await removeTemporaryDirectory(temporaryRoot);
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects a junction in a library glob static base",
    async ({ skip }) => {
      const temporaryRoot = await mkdtemp(
        join(tmpdir(), "thermite-schematics-library-junction-"),
      );
      const projectRoot = join(temporaryRoot, "project");
      const sourceRoot = join(projectRoot, "sources");
      const libraryRoot = join(projectRoot, "library");
      const outsideRoot = join(temporaryRoot, "outside");

      try {
        await mkdir(sourceRoot, { recursive: true });
        await mkdir(libraryRoot);
        await mkdir(outsideRoot);
        await writeJson(join(projectRoot, "system.json"), {
          format: "electrical-system/0.1",
          project: { name: "Library junction regression" },
          sources: ["sources/*.json"],
          libraries: [{ name: "linked", version: "0.1.0", path: "library" }],
        });
        await writeJson(join(sourceRoot, "empty.json"), { objects: [] });
        await writeJson(join(libraryRoot, "library.json"), {
          name: "linked",
          version: "0.1.0",
          sources: ["linked/*.json"],
        });
        await writeJson(join(outsideRoot, "types.json"), { types: [] });

        try {
          symlinkSync(outsideRoot, join(libraryRoot, "linked"), "junction");
        } catch (error) {
          if (junctionCreationWasDenied(error)) {
            skip("Windows denied junction creation.");
            return;
          }

          throw error;
        }

        const result = await loadProject(projectRoot);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("Expected the library junction to fail loading.");
        }

        expect(result.toolFailure).toBe(true);
        expect(result.diagnostics).toMatchObject([
          {
            code: "E001",
            file: "library/library.json",
            line: 1,
            column: 1,
            jsonPointer: "",
          },
        ]);
        expect(result.diagnostics[0]?.message).toContain(
          "static base contains symlink or reparse-point component",
        );
      } finally {
        await removeTemporaryDirectory(temporaryRoot);
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "deduplicates Windows case variants by canonical physical path",
    async () => {
      const temporaryRoot = await mkdtemp(
        join(tmpdir(), "thermite-schematics-case-dedupe-"),
      );
      const projectRoot = join(temporaryRoot, "project");
      const sourceRoot = join(projectRoot, "Sources");

      try {
        await mkdir(sourceRoot, { recursive: true });
        await writeJson(join(projectRoot, "system.json"), {
          format: "electrical-system/0.1",
          project: { name: "Case dedupe regression" },
          sources: ["Sources/*.json", "SOURCES/*.json"],
        });
        await writeJson(join(sourceRoot, "device.json"), {
          objects: [
            {
              uid: "12345678-1234-4234-9234-123456789abc",
              kind: "device",
              designation: "K1",
              type: "core:contactor-3p-1no",
            },
            {
              kind: "device",
              designation: "K2",
              type: "core:contactor-3p-1no",
            },
          ],
        });

        const result = await loadProject(projectRoot);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("Expected the invalid project to fail loading.");
        }

        expect(result.toolFailure).toBe(false);
        expect(result.diagnostics).toMatchObject([
          {
            code: "E010",
            file: "Sources/device.json",
            jsonPointer: "/objects/1/uid",
          },
        ]);
        expect(result.diagnostics.some(({ code }) => code === "E020")).toBe(
          false,
        );
      } finally {
        await removeTemporaryDirectory(temporaryRoot);
      }
    },
  );

  it("validates distinct case-variant files when the directory supports them", async ({
    skip,
  }) => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-case-distinct-"),
    );
    const projectRoot = join(temporaryRoot, "project");
    const sourceRoot = join(projectRoot, "sources");
    const upperFile = join(sourceRoot, "A.json");
    const lowerFile = join(sourceRoot, "a.json");

    try {
      await mkdir(sourceRoot, { recursive: true });
      await writeJson(join(projectRoot, "system.json"), {
        format: "electrical-system/0.1",
        project: { name: "Distinct case-variant files regression" },
        sources: ["sources/*.json"],
      });
      await writeJson(upperFile, {
        objects: [
          {
            kind: "device",
            designation: "K1",
            type: "core:contactor-3p-1no",
          },
        ],
      });
      await writeJson(lowerFile, {
        objects: [
          {
            kind: "device",
            designation: "K2",
            type: "core:contactor-3p-1no",
          },
        ],
      });

      const [upperStat, lowerStat] = await Promise.all([
        stat(upperFile, { bigint: true }),
        stat(lowerFile, { bigint: true }),
      ]);

      if (upperStat.dev === lowerStat.dev && upperStat.ino === lowerStat.ino) {
        skip("The fixture directory is not case-sensitive.");
        return;
      }

      const result = await loadProject(projectRoot);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected the invalid project to fail loading.");
      }

      expect(result.toolFailure).toBe(false);
      expect(result.diagnostics).toMatchObject([
        {
          code: "E010",
          file: "sources/A.json",
          jsonPointer: "/objects/0/uid",
        },
        {
          code: "E010",
          file: "sources/a.json",
          jsonPointer: "/objects/0/uid",
        },
      ]);
      expect(result.diagnostics).toHaveLength(2);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("uses forward-slash diagnostic paths in Unicode directories", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-unicode-"),
    );
    const projectRoot = join(temporaryRoot, "électrique-電気");
    const sourceRoot = join(projectRoot, "données-資料");

    try {
      await mkdir(sourceRoot, { recursive: true });
      await writeJson(join(projectRoot, "system.json"), {
        format: "electrical-system/0.1",
        project: { name: "Unicode path regression" },
        sources: ["données-資料/*.json"],
      });
      await writeJson(join(sourceRoot, "défaut.json"), {
        objects: [
          {
            kind: "device",
            designation: "K1",
            type: "core:contactor-3p-1no",
          },
        ],
      });

      const result = await loadProject(projectRoot);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected the invalid project to fail loading.");
      }

      expect(result.toolFailure).toBe(false);
      expect(result.diagnostics).toMatchObject([
        {
          code: "E010",
          file: "données-資料/défaut.json",
          jsonPointer: "/objects/0/uid",
        },
      ]);
      expect(
        result.diagnostics.every(
          (diagnostic) => !diagnostic.file.includes(String.fromCharCode(92)),
        ),
      ).toBe(true);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("retains typed documents, pointer maps, raw bytes, canonical paths, and ownership", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-loaded-project-"),
    );
    const projectRoot = join(temporaryRoot, "project");
    const sourceRoot = join(projectRoot, "sources");
    const libraryRoot = join(projectRoot, "library");
    const typeRoot = join(libraryRoot, "types");
    const manifestPath = join(projectRoot, "system.json");
    const projectSourcePath = join(sourceRoot, "objects.json");
    const libraryManifestPath = join(libraryRoot, "library.json");
    const librarySourcePath = join(typeRoot, "types.json");

    try {
      await mkdir(sourceRoot, { recursive: true });
      await mkdir(typeRoot, { recursive: true });
      await writeJson(manifestPath, {
        format: "electrical-system/0.1",
        project: { name: "Typed load model" },
        sources: ["sources/*.json"],
        libraries: [{ name: "mini", version: "0.1.0", path: "library" }],
      });
      await writeJson(projectSourcePath, { objects: [] });
      await writeJson(libraryManifestPath, {
        name: "mini",
        version: "0.1.0",
        sources: ["types/*.json"],
      });
      await writeJson(librarySourcePath, {
        types: [
          {
            kind: "cable_type",
            id: "mini:cable",
            conductors: [{ id: "1", color: "black" }],
          },
        ],
      });

      const result = await loadProject(projectRoot);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("Expected the typed load-model fixture to load.");
      }

      const projectSource = result.project.sources[0]!;
      const library = result.project.libraries[0]!;
      const librarySource = library.sources[0]!;

      expect(result.diagnostics).toEqual([]);
      expect(result.project.logicalRootPath).toBe(projectRoot);
      await expect(realpath(projectRoot)).resolves.toBe(
        result.project.canonicalRootPath,
      );
      expect(result.project.manifest).toMatchObject({
        file: "system.json",
        logicalPath: manifestPath,
        owner: { kind: "project" },
        kind: "project_manifest",
      });
      expect(result.project.manifest.nodes.has("/project/name")).toBe(true);
      expect(Buffer.from(result.project.manifest.rawBytes)).toEqual(
        await readFile(manifestPath),
      );
      await expect(realpath(manifestPath)).resolves.toBe(
        result.project.manifest.canonicalPath,
      );
      expect(projectSource).toMatchObject({
        file: "sources/objects.json",
        logicalPath: projectSourcePath,
        owner: { kind: "project" },
        kind: "project_source",
        value: { objects: [] },
      });
      expect(library).toMatchObject({
        dependencyIndex: 0,
        dependency: { name: "mini", version: "0.1.0", path: "library" },
        resolutionKind: "local",
        logicalRootPath: libraryRoot,
      });
      await expect(realpath(libraryRoot)).resolves.toBe(
        library.canonicalRootPath,
      );
      expect(library.manifest).toMatchObject({
        file: "library/library.json",
        logicalPath: libraryManifestPath,
        owner: { kind: "library", name: "mini", dependencyIndex: 0 },
        kind: "library_manifest",
      });
      expect(librarySource).toMatchObject({
        file: "library/types/types.json",
        logicalPath: librarySourcePath,
        owner: { kind: "library", name: "mini", dependencyIndex: 0 },
        kind: "library_source",
      });
      expect(librarySource.nodes.has("/types/0/id")).toBe(true);
      expect(Buffer.from(librarySource.rawBytes)).toEqual(
        await readFile(librarySourcePath),
      );
      expect(librarySource.value.types[0]?.kind).toBe("cable_type");
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("loads one exact presentation document, excludes an exact source overlap, and compiles frozen context", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-presentation-loader-"),
    );
    try {
      await writeJson(join(temporaryRoot, "system.json"), {
        format: "electrical-system/0.1",
        project: { name: "Presentation loader" },
        sources: ["source.json", "presentation.json"],
        presentation: "presentation.json",
      });
      await writeJson(join(temporaryRoot, "source.json"), { objects: [] });
      await writeJson(join(temporaryRoot, "presentation.json"), {
        format: "project-presentation/0.1",
        revision: "A",
        backgroundColor: "#101828",
        titleBlock: { lines: ["First", "Second"] },
      });

      const loaded = await loadProject(temporaryRoot);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
      expect(loaded.project.sources.map(({ file }) => file)).toEqual([
        "source.json",
      ]);
      expect(loaded.project.presentation).toMatchObject({
        file: "presentation.json",
        logicalPath: join(temporaryRoot, "presentation.json"),
        owner: { kind: "project" },
        kind: "project_presentation",
        value: {
          format: "project-presentation/0.1",
          revision: "A",
          backgroundColor: "#101828",
          titleBlock: { lines: ["First", "Second"] },
        },
      });
      expect(Buffer.from(loaded.project.presentation!.rawBytes)).toEqual(
        await readFile(join(temporaryRoot, "presentation.json")),
      );

      const first = await compileProject(temporaryRoot);
      const second = await compileProject(temporaryRoot);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("compile failed");
      expect(first.presentation).toEqual({
        format: "project-presentation/0.1",
        revision: "A",
        backgroundColor: "#101828",
        titleBlockLines: ["First", "Second"],
      });
      expect(Object.isFrozen(first.presentation)).toBe(true);
      expect(Object.isFrozen(first.presentation.titleBlockLines)).toBe(true);
      expect(first.presentation).not.toBe(second.presentation);
      expect(first.presentation.titleBlockLines).not.toBe(
        loaded.project.presentation!.value.titleBlock!.lines,
      );
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("compiles exact presentation defaults for every legacy-compatible project name", async () => {
    const names = [
      "",
      "line\nbreak",
      "x".repeat(161),
      "line\u2028separator",
      "paragraph\u2029separator",
    ];
    for (const [index, name] of names.entries()) {
      const temporaryRoot = await mkdtemp(
        join(tmpdir(), `thermite-schematics-presentation-default-${index}-`),
      );
      try {
        await writeJson(join(temporaryRoot, "system.json"), {
          format: "electrical-system/0.1",
          project: { name },
          sources: ["source.json"],
        });
        await writeJson(join(temporaryRoot, "source.json"), { objects: [] });
        const compiled = await compileProject(temporaryRoot);
        expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
        if (!compiled.ok) continue;
        expect(compiled.presentation).toEqual({
          format: "project-presentation/0.1",
          revision: "UNSPECIFIED",
          backgroundColor: "#ffffff",
          titleBlockLines: [],
        });
        expect(compiled.ir.project.name).toBe(name);
      } finally {
        await removeTemporaryDirectory(temporaryRoot);
      }
    }
  });

  it("returns schema and sanitized I/O diagnostics for invalid or missing presentation files", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-presentation-failures-"),
    );
    try {
      await writeJson(join(temporaryRoot, "source.json"), { objects: [] });
      await writeJson(join(temporaryRoot, "system.json"), {
        format: "electrical-system/0.1",
        project: { name: "Presentation failures" },
        sources: ["source.json"],
        presentation: "presentation.json",
      });
      let loaded = await loadProject(temporaryRoot);
      expect(loaded).toMatchObject({
        ok: false,
        toolFailure: true,
        diagnostics: [
          {
            code: "E001",
            file: "presentation.json",
            jsonPointer: "",
          },
        ],
      });

      await writeJson(join(temporaryRoot, "presentation.json"), {
        format: "project-presentation/0.1",
        revision: "bad\u2028revision",
        backgroundColor: "#ffffff",
      });
      loaded = await loadProject(temporaryRoot);
      expect(loaded).toMatchObject({
        ok: false,
        toolFailure: false,
        diagnostics: [
          {
            code: "E013",
            file: "presentation.json",
            jsonPointer: "/revision",
          },
        ],
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });
  it("resolves shipped core with stable paths and provenance under global install roots", async () => {
    const actual = resolveShippedCoreLibrary();
    const projectRoot = resolve("examples", "motor-starter");
    const observations: unknown[] = [];

    for (const packageRootPath of [
      "C:/prefix/node_modules/@thermite/core-library",
      "/opt/prefix/node_modules/@thermite/core-library",
    ]) {
      let calls = 0;
      const result = await loadProject(projectRoot, process.cwd(), {
        resolveShippedCoreLibrary: () => {
          calls += 1;
          return { ...actual, packageRootPath };
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(calls).toBe(1);
      const library = result.project.libraries[0]!;
      const files = [
        library.manifest.file,
        ...library.sources.map(({ file }) => file),
      ];
      expect(library).toMatchObject({
        dependency: { name: "core", version: "0.1.0" },
        resolutionKind: "shipped",
      });
      expect(files[0]).toBe(`${SHIPPED_CORE_DISPLAY_ROOT}/library.json`);
      expect(files).toHaveLength(14);
      expect(
        files.every(
          (file) =>
            file.startsWith(`${SHIPPED_CORE_DISPLAY_ROOT}/`) &&
            !file.includes(packageRootPath),
        ),
      ).toBe(true);
      observations.push({
        resolutionKind: library.resolutionKind,
        locator: SHIPPED_CORE_LIBRARY_LOCATOR,
        files,
      });
    }

    expect(observations[0]).toEqual(observations[1]);
  });

  it("returns the frozen two-row E032 result through public compileProject", async () => {
    const root = fileURLToPath(
      new URL("../fixtures/shipped-library-unavailable/", import.meta.url),
    );
    const result = await compileProject(root);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E032",
          severity: "error",
          message:
            'Shipped library "unknown" at version "9.9.9" is unavailable.',
          file: "system.json",
          line: 1,
          column: 108,
          jsonPointer: "/libraries/0/name",
        },
        {
          code: "E032",
          severity: "error",
          message:
            'Shipped library "core" does not provide version "9.9.9"; available version is "0.1.0".',
          file: "system.json",
          line: 1,
          column: 162,
          jsonPointer: "/libraries/1/version",
        },
      ],
      toolFailure: false,
    });
  });

  it("keeps an explicit locator-text directory local on Ubuntu", async () => {
    if (process.platform === "win32") return;

    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-local-locator-"),
    );
    const projectRoot = join(temporaryRoot, "project");
    const libraryRoot = join(projectRoot, SHIPPED_CORE_LIBRARY_LOCATOR);
    try {
      await mkdir(libraryRoot, { recursive: true });
      await writeJson(join(projectRoot, "system.json"), {
        format: "electrical-system/0.1",
        project: { name: "Locator collision" },
        sources: ["source.json"],
        libraries: [
          {
            name: "core",
            version: "0.1.0",
            path: SHIPPED_CORE_LIBRARY_LOCATOR,
          },
        ],
      });
      await writeJson(join(projectRoot, "source.json"), { objects: [] });
      await writeJson(join(libraryRoot, "library.json"), {
        name: "core",
        version: "0.1.0",
        sources: ["types.json"],
      });
      await writeJson(join(libraryRoot, "types.json"), {
        types: [
          {
            kind: "cable_type",
            id: "core:collision-cable",
            conductors: [{ id: "1", color: "black" }],
          },
        ],
      });
      let shippedCalls = 0;
      const result = await loadProject(projectRoot, process.cwd(), {
        resolveShippedCoreLibrary: () => {
          shippedCalls += 1;
          return resolveShippedCoreLibrary();
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(shippedCalls).toBe(0);
      expect(result.project.libraries[0]).toMatchObject({
        dependency: {
          name: "core",
          version: "0.1.0",
          path: SHIPPED_CORE_LIBRARY_LOCATOR,
        },
        resolutionKind: "local",
        logicalRootPath: libraryRoot,
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("keeps a local @thermite/core-library collision explicit and local", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-local-package-collision-"),
    );
    const projectRoot = join(temporaryRoot, "project");
    const authoredPath = "@thermite/core-library";
    const libraryRoot = join(projectRoot, "@thermite", "core-library");
    try {
      await mkdir(libraryRoot, { recursive: true });
      await writeJson(join(projectRoot, "system.json"), {
        format: "electrical-system/0.1",
        project: { name: "Package-name collision" },
        sources: ["source.json"],
        libraries: [
          {
            name: "core",
            version: "0.1.0",
            path: authoredPath,
          },
        ],
      });
      await writeJson(join(projectRoot, "source.json"), { objects: [] });
      await writeJson(join(libraryRoot, "library.json"), {
        name: "core",
        version: "0.1.0",
        sources: ["types.json"],
      });
      await writeJson(join(libraryRoot, "types.json"), {
        types: [
          {
            kind: "cable_type",
            id: "core:package-name-collision-cable",
            conductors: [{ id: "1", color: "black" }],
          },
        ],
      });
      let shippedCalls = 0;
      const result = await loadProject(projectRoot, process.cwd(), {
        resolveShippedCoreLibrary: () => {
          shippedCalls += 1;
          return resolveShippedCoreLibrary();
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(shippedCalls).toBe(0);
      expect(result.project.libraries[0]).toMatchObject({
        dependency: {
          name: "core",
          version: "0.1.0",
          path: authoredPath,
        },
        resolutionKind: "local",
        logicalRootPath: libraryRoot,
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });
});
