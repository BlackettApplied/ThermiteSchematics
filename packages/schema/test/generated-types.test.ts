import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { checkCommittedGeneratedFiles } from "../scripts/generate-types.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const generatedRoot = join(packageRoot, "src", "generated");
const expectedGeneratedFiles = [
  "cable-type.ts",
  "cable.ts",
  "canonical-schemas.ts",
  "device-type.ts",
  "device.ts",
  "index.ts",
  "jumper.ts",
  "library-file.ts",
  "library-lock.ts",
  "library.ts",
  "potential.ts",
  "project-presentation.ts",
  "project.ts",
  "relation.ts",
  "source-file.ts",
  "wire.ts",
] as const;

function strictConsumerDiagnostics(): readonly ts.Diagnostic[] {
  const configPath = join(
    packageRoot,
    "test",
    "type-consumer",
    "tsconfig.json",
  );
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) return [config.error];
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath,
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
}

describe("generated schema types", () => {
  it("passes the temporary-directory drift check and offline resolver policy", async () => {
    await checkCommittedGeneratedFiles();
  });

  it("commits only the explicit generated surface and no common root", async () => {
    expect((await readdir(generatedRoot)).sort()).toEqual(
      [...expectedGeneratedFiles].sort(),
    );

    const barrel = await readFile(join(generatedRoot, "index.ts"), "utf8");
    expect(barrel).not.toContain("common");
    for (const name of [
      "Cable",
      "CableType",
      "Device",
      "DeviceType",
      "Jumper",
      "LibraryManifest",
      "LibraryFile",
      "LibraryLock",
      "Potential",
      "ProjectManifest",
      "ProjectPresentationFile",
      "Relation",
      "SourceFile",
      "Wire",
      "DeviceFunction",
      "ValidatedDeviceType",
    ]) {
      expect(barrel).toContain(name);
    }
  });

  it("compiles an external package consumer under the full strict config", () => {
    const diagnostics = strictConsumerDiagnostics();
    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    ).toEqual([]);
  });

  it("wires schema drift before the root TypeScript build", async () => {
    const packageJson = JSON.parse(
      await readFile(join(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts.check).toMatch(
      /^npm run generate:types:check && npm run build/,
    );
  });
});
