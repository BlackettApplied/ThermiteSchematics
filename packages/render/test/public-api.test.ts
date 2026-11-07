import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as compiler from "@thermite/compiler";
import * as query from "@thermite/query";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");

function TypeScriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return TypeScriptSources(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("render public package boundaries", () => {
  it("emits packet modules without empty runtime imports", () => {
    const directory = join(packageRoot, "dist", "packet");
    const files = readdirSync(directory).filter((name) => name.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
    const emptyImports = files
      .sort()
      .filter((name) =>
        /\bimport\s*\{\s*\}\s*from\s*["']/u.test(
          readFileSync(join(directory, name), "utf8"),
        ),
      );
    expect(emptyImports).toEqual([]);
  });

  it("uses the compiler comparator through its public export and no query deep import", () => {
    expect(compiler.compareConductiveElementId).toBeTypeOf("function");
    const sourceFiles = TypeScriptSources(join(packageRoot, "src"));
    for (const path of sourceFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, relative(repositoryRoot, path)).not.toMatch(
        /@thermite\/query\//u,
      );
      expect(source, relative(repositoryRoot, path)).not.toMatch(
        /packages\/query\/src/u,
      );
    }
  });

  it("keeps query ordering and point-to-point helpers out of the public surface", () => {
    expect(Object.keys(query).sort()).toEqual([
      "InvalidElectricalIrError",
      "REPORT_KINDS",
      "auditContinuity",
      "buildCableSchedule",
      "buildCommunicationInventory",
      "buildConnectorAssemblyInventory",
      "buildDocumentation",
      "createProjectSnapshot",
      "createQueryEngine",
      "documentationCsv",
      "parseProjectSnapshot",
      "resolveDeviceFilter",
      "reviewProject",
      "serializeQueryResult",
    ]);
    for (const privateName of [
      "shortestConductivePath",
      "compareText",
      "compareTerminalView",
      "compareConductiveElementView",
    ]) {
      expect(query).not.toHaveProperty(privateName);
    }
  });

  it("exports only package roots for render and query", () => {
    for (const path of [
      join(packageRoot, "package.json"),
      join(repositoryRoot, "packages", "query", "package.json"),
    ]) {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as {
        exports: Record<string, unknown>;
      };
      expect(Object.keys(manifest.exports)).toEqual(["."]);
    }
  });
});
