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
      "buildCableSchedule",
      "buildCommunicationInventory",
      "buildConnectorAssemblyInventory",
      "buildDocumentation",
      "createProjectSnapshot",
      "createQueryEngine",
      "documentationCsv",
      "parseProjectSnapshot",
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
