import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");

async function run(
  command: string,
  arguments_: string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await execFileAsync(command, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

describe("packed package", () => {
  it(
    "installs into an isolated consumer and validates through installed exports",
    { timeout: 120_000 },
    async ({ skip }) => {
      const temporaryRoot = await mkdtemp(
        join(tmpdir(), "thermite-schematics-schema-pack-"),
      );
      const packDirectory = join(temporaryRoot, "packed");
      const consumerDirectory = join(temporaryRoot, "consumer");

      try {
        await mkdir(packDirectory);
        await mkdir(consumerDirectory);
        await writeFile(
          join(consumerDirectory, "package.json"),
          JSON.stringify({
            name: "schema-package-smoke-consumer",
            private: true,
            type: "module",
          }),
          "utf8",
        );

        let packOutput: string;

        try {
          packOutput = await run(
            process.execPath,
            [
              "pm",
              "pack",
              "--destination",
              packDirectory,
              "--quiet",
              "--ignore-scripts",
            ],
            packageRoot,
          );
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EPERM"
          ) {
            skip("The execution sandbox denied child-process creation.");
            return;
          }

          throw error;
        }
        const tarball = resolve(packDirectory, packOutput.trim());

        await run(
          process.execPath,
          [
            "install",
            "--ignore-scripts",
            "--no-save",
            "--backend=copyfile",
            "--linker=hoisted",
            tarball,
          ],
          consumerDirectory,
        );

        const consumerScript = [
          'import deviceSchema from "@thermite/schema/schemas/device.schema.json" with { type: "json" };',
          'import { loadSchemaRegistry, parseJson } from "@thermite/schema";',
          'const expectedId = "https://thermiteschematics.com/schemas/0.1/device.schema.json";',
          'if (deviceSchema.$id !== expectedId) throw new Error("schema subpath import failed");',
          "const registry = await loadSchemaRegistry();",
          "const parsed = parseJson(JSON.stringify({",
          '  uid: "12345678-1234-4234-9234-123456789abc",',
          '  kind: "device",',
          '  designation: "K1",',
          '  type: "core:contactor-3p-1no",',
          '}), "device.json");',
          'if (parsed.value === undefined || parsed.diagnostics.length > 0) throw new Error("parse failed");',
          'const diagnostics = registry.validateEntity("device", parsed.value, {',
          '  file: "device.json",',
          "  nodes: parsed.nodes,",
          "});",
          "console.log(JSON.stringify({ schemaId: deviceSchema.$id, diagnostics }));",
        ].join("\n");
        const consumerScriptPath = join(consumerDirectory, "smoke.mjs");
        await writeFile(consumerScriptPath, consumerScript, "utf8");

        const smokeOutput = await run(
          process.execPath,
          [consumerScriptPath],
          consumerDirectory,
        );

        expect(JSON.parse(smokeOutput)).toEqual({
          schemaId:
            "https://thermiteschematics.com/schemas/0.1/device.schema.json",
          diagnostics: [],
        });

        await writeFile(
          join(consumerDirectory, "consumer.ts"),
          await readFile(
            join(packageRoot, "test", "type-consumer", "consumer.ts"),
            "utf8",
          ),
          "utf8",
        );
        await writeFile(
          join(consumerDirectory, "tsconfig.json"),
          `${JSON.stringify(
            {
              extends: join(repositoryRoot, "tsconfig.base.json").replaceAll(
                "\\",
                "/",
              ),
              compilerOptions: { noEmit: true },
              files: ["consumer.ts"],
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        await run(
          process.execPath,
          [
            join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"),
            "-p",
            consumerDirectory,
          ],
          consumerDirectory,
        );
      } finally {
        await rm(temporaryRoot, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    },
  );
});
