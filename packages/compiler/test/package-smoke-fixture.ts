import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  pack,
  schemaRoot,
  coreLibraryRoot,
  packageRoot,
  queryRoot,
  renderRoot,
  agentToolsRoot,
  cliRoot,
  run,
  motorProject,
  repositoryRoot,
  extractPackedTypeConsumer,
} from "./package-smoke-support.js";
import type { ApiResult } from "./package-smoke-support.js";

export async function preparePackedFiles(
  packDirectory: string,
  consumerDirectory: string,
) {
  await mkdir(packDirectory);

  await mkdir(consumerDirectory);

  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify({
      name: "compiler-package-smoke-consumer",
      private: true,
      type: "module",
    }),
    "utf8",
  );

  await writeFile(
    join(consumerDirectory, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Packed compiler smoke" },
      sources: ["source.json"],
    }),
    "utf8",
  );

  await writeFile(
    join(consumerDirectory, "source.json"),
    JSON.stringify({ objects: [] }),
    "utf8",
  );
}

export async function prepareIsolatedPatch(consumerDirectory: string) {
  const isolatedPatchProject = join(
    consumerDirectory,
    "isolated-patch-project",
  );

  await mkdir(isolatedPatchProject);

  await writeFile(
    join(isolatedPatchProject, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Packed agent patch smoke" },
      sources: ["source.json"],
    }),
    "utf8",
  );

  await writeFile(
    join(isolatedPatchProject, "source.json"),
    JSON.stringify({ objects: [] }),
    "utf8",
  );
}

export async function installPackedPackages(
  consumerDirectory: string,
  packDirectory: string,
) {
  let tarballs: string[];

  tarballs = [
    await pack(schemaRoot, packDirectory),
    await pack(coreLibraryRoot, packDirectory),
    await pack(packageRoot, packDirectory),
    await pack(queryRoot, packDirectory),
    await pack(renderRoot, packDirectory),
    await pack(agentToolsRoot, packDirectory),
    await pack(cliRoot, packDirectory),
  ];

  // Bun resolves transitive semver references independently of tarball
  // arguments. Pin every private workspace to its packed artifact so the
  // isolated consumer never tries to fetch @thermite packages from npm.
  const packedRoots = [
    schemaRoot,
    coreLibraryRoot,
    packageRoot,
    queryRoot,
    renderRoot,
    agentToolsRoot,
    cliRoot,
  ];

  const overrides = Object.fromEntries(
    await Promise.all(
      packedRoots.map(async (root, index) => {
        const manifest = JSON.parse(
          await readFile(join(root, "package.json"), "utf8"),
        );
        return [manifest.name, `file:${tarballs[index]}`];
      }),
    ),
  );

  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify({
      name: "compiler-package-smoke-consumer",
      private: true,
      type: "module",
      overrides,
    }),
    "utf8",
  );

  await run(
    process.execPath,
    [
      "install",
      "--ignore-scripts",
      "--no-save",
      "--backend=copyfile",
      "--linker=hoisted",
      ...tarballs,
    ],
    consumerDirectory,
  );
}

export async function runPackedApi(
  consumerDirectory: string,
  consumerScript: string,
) {
  const consumerScriptPath = join(consumerDirectory, "smoke.mjs");

  await writeFile(consumerScriptPath, consumerScript, "utf8");

  const api = await run(
    process.execPath,
    [consumerScriptPath, motorProject],
    consumerDirectory,
  );
  const apiResult = JSON.parse(api.stdout) as ApiResult;
  return apiResult;
}

export async function checkPackedDeclarations(
  consumerDirectory: string,
  packedTypeConsumer: string,
) {
  await writeFile(
    join(consumerDirectory, "consumer.ts"),
    packedTypeConsumer,
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
}

export async function prepareDistConsumer(
  temporaryRoot: string,
  consumerPath: string,
  configPath: string,
  testSourcePath: string,
) {
  await writeFile(
    join(temporaryRoot, "package.json"),
    '{"private":true,"type":"module"}\n',
    "utf8",
  );

  const testSource = await readFile(testSourcePath, "utf8");

  await writeFile(consumerPath, extractPackedTypeConsumer(testSource), "utf8");

  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        extends: join(repositoryRoot, "tsconfig.base.json").replaceAll(
          "\\",
          "/",
        ),
        compilerOptions: {
          noEmit: true,
          baseUrl: repositoryRoot.replaceAll("\\", "/"),
          paths: {
            "@thermite/schema": ["packages/schema/dist/index.d.ts"],
            "@thermite/core-library": ["packages/core-library/dist/index.d.ts"],
            "@thermite/compiler": ["packages/compiler/dist/index.d.ts"],
            "@thermite/query": ["packages/query/dist/index.d.ts"],
            "@thermite/render": ["packages/render/dist/index.d.ts"],
            "@thermite/agent-tools": ["packages/agent-tools/dist/index.d.ts"],
            "@thermite/cli": ["packages/cli/dist/index.d.ts"],
          },
        },
        files: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
