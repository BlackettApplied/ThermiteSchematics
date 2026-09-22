import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { updateShippedCoreGoldens } from "../../../scripts/update-shipped-core-goldens.mjs";
import { updateTask4Goldens } from "../../../scripts/update-task4-goldens.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const manifestPath = join(
  repositoryRoot,
  "scripts",
  "m8-golden-migration.json",
);

type Classification = "regenerate" | "byte-identical";
interface MigrationRow {
  readonly path: string;
  readonly classification: Classification;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function posixPath(path: string): string {
  return path.replaceAll(String.fromCharCode(92), "/");
}

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory()
      ? files(path)
      : entry.isFile()
        ? [posixPath(relative(repositoryRoot, path))]
        : [];
  });
}

function currentGoldenPaths(): string[] {
  const cli = files(join(packageRoot, "test", "goldens")).filter(
    (path) => !path.includes("/m8-r005/"),
  );
  const render = files(
    join(repositoryRoot, "packages", "render", "test", "goldens"),
  );
  return [
    ...cli,
    ...render,
    "packages/compiler/test/goldens/motor-starter.ir.json",
    "examples/motor-starter/electrical-system.lock.json",
  ].sort(compareText);
}

const task2Regenerate = new Set([
  "examples/motor-starter/electrical-system.lock.json",
  "packages/compiler/test/goldens/motor-starter.ir.json",
  "packages/cli/test/goldens/motor-starter-agent/type-only-patch.stderr.json",
]);

function expectedClassification(path: string): Classification {
  if (task2Regenerate.has(path)) return "regenerate";
  if (
    path ===
      "packages/cli/test/goldens/motor-starter-agent/baseline-view.stdout.json" ||
    path ===
      "packages/cli/test/goldens/motor-starter-agent/pnp-view.stdout.json" ||
    (path.startsWith("packages/render/test/goldens/motor-starter") &&
      path.endsWith(".svg")) ||
    (path.startsWith("packages/cli/test/goldens/motor-starter/") &&
      /\/(?:render|view)-.*\.stdout\.(?:json|svg)$/u.test(path)) ||
    (path.startsWith("packages/cli/test/goldens/motor-starter-pnp/") &&
      /\/view-.*\.stdout\.(?:json|svg)$/u.test(path))
  ) {
    return "regenerate";
  }
  return "byte-identical";
}

function validateRows(value: unknown): readonly MigrationRow[] {
  if (!Array.isArray(value)) throw new Error("manifest is not an array");
  const seen = new Set<string>();
  let previous = "";
  for (const row of value) {
    if (
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row) ||
      JSON.stringify(Object.keys(row)) !==
        JSON.stringify(["path", "classification"])
    ) {
      throw new Error("invalid row shape");
    }
    const candidate = row as Partial<MigrationRow>;
    if (
      typeof candidate.path !== "string" ||
      candidate.path.includes(String.fromCharCode(92)) ||
      (candidate.classification !== "regenerate" &&
        candidate.classification !== "byte-identical")
    ) {
      throw new Error("invalid row value");
    }
    if (
      seen.has(candidate.path) ||
      (previous !== "" && compareText(previous, candidate.path) >= 0)
    ) {
      throw new Error("duplicate or unsorted path");
    }
    seen.add(candidate.path);
    previous = candidate.path;
  }
  return value as MigrationRow[];
}

function readManifest(): readonly MigrationRow[] {
  return validateRows(JSON.parse(readFileSync(manifestPath, "utf8")));
}

describe("M8 Task 4 closed golden migration manifest", () => {
  it("deep-equals all 99 current paths and exact classifications", () => {
    const cliPaths = files(join(packageRoot, "test", "goldens")).filter(
      (path) => !path.includes("/m8-r005/"),
    );
    const renderPaths = files(
      join(repositoryRoot, "packages", "render", "test", "goldens"),
    );
    expect(cliPaths).toHaveLength(84);
    expect(renderPaths).toHaveLength(13);

    const paths = currentGoldenPaths();
    const expected = paths.map((path) => ({
      path,
      classification: expectedClassification(path),
    }));
    const manifest = readManifest();
    expect(manifest).toEqual(expected);
    expect(manifest).toHaveLength(99);
    expect(
      manifest.filter(({ classification }) => classification === "regenerate"),
    ).toHaveLength(36);
    expect(
      manifest.filter(
        ({ classification }) => classification === "byte-identical",
      ),
    ).toHaveLength(63);
    expect(
      files(join(packageRoot, "test", "goldens", "m8-r005")).sort(compareText),
    ).toEqual([
      "packages/cli/test/goldens/m8-r005/presentation-surrogate.stderr.json",
      "packages/cli/test/goldens/m8-r005/presentation-surrogate.stdout.txt",
      "packages/cli/test/goldens/m8-r005/project-empty.stderr.json",
      "packages/cli/test/goldens/m8-r005/project-empty.stdout.txt",
      "packages/cli/test/goldens/m8-r005/view-single-line.stderr.json",
      "packages/cli/test/goldens/m8-r005/view-single-line.stdout.txt",
    ]);
  });

  it("rejects duplicate paths, unknown classes, and moving either class", () => {
    const manifest = readManifest();
    expect(() => validateRows([...manifest, manifest[0]])).toThrow();
    expect(() =>
      validateRows([
        ...manifest.slice(0, 1),
        { ...manifest[1], classification: "unknown" },
        ...manifest.slice(2),
      ]),
    ).toThrow();
    const moved = manifest.map((row, index) =>
      index === 0
        ? {
            ...row,
            classification:
              row.classification === "regenerate"
                ? ("byte-identical" as const)
                : ("regenerate" as const),
          }
        : row,
    );
    expect(moved).not.toEqual(
      currentGoldenPaths().map((path) => ({
        path,
        classification: expectedClassification(path),
      })),
    );
  });

  it("runs both generating owners in non-writing check mode", async () => {
    await updateShippedCoreGoldens("--check");
    await updateTask4Goldens("--check");
  });
});
