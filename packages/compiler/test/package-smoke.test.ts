import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const schemaRoot = join(repositoryRoot, "packages", "schema");
const coreLibraryRoot = join(repositoryRoot, "packages", "core-library");
const queryRoot = join(repositoryRoot, "packages", "query");
const renderRoot = join(repositoryRoot, "packages", "render");
const agentToolsRoot = join(repositoryRoot, "packages", "agent-tools");
const cliRoot = join(repositoryRoot, "packages", "cli");
const motorProject = join(repositoryRoot, "examples", "motor-starter");
const rendererGoldenRoot = join(renderRoot, "test", "goldens", "motor-starter");
const npmCommand = process.platform === "win32" ? process.execPath : "npm";
const npmArgumentPrefix =
  process.platform === "win32"
    ? [
        join(
          dirname(process.execPath),
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        ),
      ]
    : [];

async function run(
  command: string,
  arguments_: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
}

async function pack(
  source: string,
  destination: string,
  cwd: string,
): Promise<string> {
  const { stdout } = await run(
    npmCommand,
    [
      ...npmArgumentPrefix,
      "pack",
      source,
      "--pack-destination",
      destination,
      "--json",
      "--ignore-scripts",
    ],
    cwd,
  );
  const result = JSON.parse(stdout) as Array<{ filename: string }>;
  if (result.length !== 1 || result[0] === undefined) {
    throw new Error(`Unexpected npm pack result: ${stdout}`);
  }
  return join(destination, result[0].filename);
}

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

function extractPackedTypeConsumer(testSource: string): string {
  const sourceFile = ts.createSourceFile(
    "package-smoke.test.ts",
    testSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const candidates: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isArrayLiteralExpression(node) &&
      node.elements.length > 0 &&
      node.elements.every(ts.isStringLiteralLike)
    ) {
      const candidate = node.elements.map((element) => element.text).join("\n");
      if (
        candidate.includes(
          "completeAgentTools.applySourcePatch(applySourcePatchRequest)",
        ) &&
        candidate.includes('@thermite/agent-tools"') &&
        candidate.includes("@ts-expect-error")
      ) {
        candidates.push(candidate);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new Error(
      `Expected exactly one packed declaration consumer, found ${candidates.length}.`,
    );
  }
  return `${candidates[0]}\n`;
}

describe("packed schema, core-library, compiler, query, render, agent-tools, and CLI packages", () => {
  it(
    "install together and expose initial agent contracts plus existing APIs and CLI commands",
    { timeout: 240_000 },
    async ({ skip }) => {
      const temporaryRoot = await mkdtemp(
        join(tmpdir(), "thermite-schematics-compiler-pack-"),
      );
      const packDirectory = join(temporaryRoot, "packed");
      const consumerDirectory = join(temporaryRoot, "consumer");

      try {
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

        let tarballs: string[];
        try {
          tarballs = [
            await pack(schemaRoot, packDirectory, temporaryRoot),
            await pack(coreLibraryRoot, packDirectory, temporaryRoot),
            await pack(packageRoot, packDirectory, temporaryRoot),
            await pack(queryRoot, packDirectory, temporaryRoot),
            await pack(renderRoot, packDirectory, temporaryRoot),
            await pack(agentToolsRoot, packDirectory, temporaryRoot),
            await pack(cliRoot, packDirectory, temporaryRoot),
          ];
          await run(
            npmCommand,
            [
              ...npmArgumentPrefix,
              "install",
              "--ignore-scripts",
              "--no-audit",
              "--no-fund",
              "--package-lock=false",
              ...tarballs,
            ],
            consumerDirectory,
          );
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EPERM"
          ) {
            skip(
              "RELEASE-EVIDENCE-DENIED: seven-component package-smoke child-process tier is unavailable.",
            );
            return;
          }
          throw error;
        }

        const consumerScript = [
          'import { lstat as lstatPacked, readFile as readPackedFile, readdir as readPackedDirectory } from "node:fs/promises";',
          'import * as coreLibraryPackage from "@thermite/core-library";',
          'import { compareConductiveElementId, compileProject, computeFileIntegrity, evaluateRules, serializeIr } from "@thermite/compiler";',
          'import * as queryPackage from "@thermite/query";',
          'import * as renderPackage from "@thermite/render";',
          'import * as agentToolsPackage from "@thermite/agent-tools";',
          'if (coreLibraryPackage.SHIPPED_CORE_LIBRARY_LOCATOR !== "ais-shipped:core@0.1.0") throw new Error("packed core locator mismatch");',
          'if (JSON.stringify(coreLibraryPackage.SHIPPED_CORE_FILE_INVENTORY) !== JSON.stringify(["library/library.json","library/types/breaker-3p.json","library/types/cable-2pair-shielded.json","library/types/contactor-3p-1no.json","library/types/junction-box-8.json","library/types/limit-switch-2wire.json","library/types/motor-3ph.json","library/types/overload-3p-1nc.json","library/types/plc-compact.json","library/types/prox-pnp-3wire.json","library/types/psu-24vdc.json","library/types/pushbutton-nc.json","library/types/supply-480v-3ph.json","library/types/terminal-block-8.json"])) throw new Error("packed core inventory mismatch");',
          "const shippedCore = coreLibraryPackage.resolveShippedCoreLibrary();",
          "const shippedCoreTopLevel = (await readPackedDirectory(shippedCore.packageRootPath)).sort();",
          'if (JSON.stringify(shippedCoreTopLevel) !== JSON.stringify(["LICENSE","README.md","dist","library","package.json"])) throw new Error("packed core top-level files mismatch");',
          "for (const path of coreLibraryPackage.SHIPPED_CORE_FILE_INVENTORY) { const asset = shippedCore.packageRootPath + '/' + path; const stats = await lstatPacked(asset); if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('packed core asset is not ordinary: ' + path); await readPackedFile(asset); }",
          "let coreDeepImportBlocked = false;",
          'try { await import("@thermite/core-library/anything"); } catch (error) { coreDeepImportBlocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"; }',
          'if (!coreDeepImportBlocked) throw new Error("core-library deep subpath leaked");',
          'if (agentToolsPackage.AGENT_TOOLS_VERSION !== "agent-tools/0.1") throw new Error("packed agent-tools version mismatch");',
          'const agentReport = agentToolsPackage.serializeAgentToolReport("validate", [], null);',
          'if (agentReport !== "{\\n  \\"format\\": \\"agent-tool-report/0.1\\",\\n  \\"tool\\": \\"validate\\",\\n  \\"diagnostics\\": [],\\n  \\"error\\": null\\n}\\n") throw new Error("packed agent report bytes mismatch");',
          'if (typeof agentToolsPackage.createAgentTools !== "function" || typeof agentToolsPackage.serializeAgentToolResult !== "function") throw new Error("complete agent surface missing");',
          "let agentToolsDeepImportBlocked = false;",
          'try { await import("@thermite/agent-tools/common/errors"); } catch (error) { agentToolsDeepImportBlocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"; }',
          'if (!agentToolsDeepImportBlocked) throw new Error("agent-tools deep subpath leaked");',
          "let schemaDeepImportBlocked = false;",
          'try { await import("@thermite/schema/parser"); } catch (error) { schemaDeepImportBlocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"; }',
          'if (!schemaDeepImportBlocked) throw new Error("schema deep subpath leaked");',
          "let compilerDeepImportBlocked = false;",
          'try { await import("@thermite/compiler/loader"); } catch (error) { compilerDeepImportBlocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"; }',
          'if (!compilerDeepImportBlocked) throw new Error("compiler deep subpath leaked");',
          "const empty = await compileProject();",
          'if (!empty.ok) throw new Error("packed empty compile failed");',
          'if (evaluateRules(empty.ir).length !== 0) throw new Error("packed rule evaluation failed");',
          "const engine = queryPackage.createQueryEngine(empty.ir);",
          "const traversal = engine.followConductive([]);",
          'if (!traversal.ok || traversal.value.length !== 0) throw new Error("packed query failed");',
          'if ("shortestConductivePath" in queryPackage) throw new Error("private path helper leaked");',
          'if ("compareText" in queryPackage || "compareTerminalView" in queryPackage) throw new Error("private ordering helper leaked");',
          "let queryDeepImportBlocked = false;",
          'try { await import("@thermite/query/ordering"); } catch (error) { queryDeepImportBlocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"; }',
          'if (!queryDeepImportBlocked) throw new Error("query deep subpath leaked");',
          "let renderDeepImportBlocked = false;",
          'try { await import("@thermite/render/renderer"); } catch (error) { renderDeepImportBlocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"; }',
          'if (!renderDeepImportBlocked) throw new Error("render deep subpath leaked");',
          "let cliDeepImportBlocked = false;",
          'try { await import("@thermite/cli/agent-command"); } catch (error) { cliDeepImportBlocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"; }',
          'if (!cliDeepImportBlocked) throw new Error("CLI deep subpath leaked");',
          'if (renderPackage.RENDERER_VERSION !== "render/0.3") throw new Error("packed renderer version mismatch");',
          'if (renderPackage.SYMBOL_CATALOG_VERSION !== "ais-symbols/0.3") throw new Error("packed symbol catalog version mismatch");',
          'if (renderPackage.LAYOUT_CONFIG_VERSION !== "elk-layered/0.4+elkjs-0.12.0") throw new Error("packed layout config version mismatch");',
          "const result = await compileProject(process.argv[2]);",
          'if (!result.ok) throw new Error("packed motor-starter compile failed");',
          'const controlRequest = { format: "schematic-view-request/0.1", root: { by: "designation", value: "K1" }, family: "control", flow: "left-to-right" };',
          'const powerRequest = { format: "schematic-view-request/0.1", root: { by: "designation", value: "M1" }, family: "power", flow: "left-to-right" };',
          'const traceRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "LS1" }, intent: { kind: "trace", to: { by: "designation", value: "PLC1" }, includePower: true }, flow: "left-to-right" };',
          'const conductorsRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "CBL1" }, intent: { kind: "conductors" }, flow: "left-to-right" };',
          'const loadsRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "PS1" }, intent: { kind: "loads" }, flow: "left-to-right" };',
          "const control = await renderPackage.renderSchematic(result.ir, controlRequest, result.presentation);",
          "const power = await renderPackage.createSchematicRenderer().render(result.ir, powerRequest, result.presentation);",
          "const trace = await renderPackage.renderSchematic(result.ir, traceRequest, result.presentation);",
          "const conductors = await renderPackage.renderSchematic(result.ir, conductorsRequest, result.presentation);",
          "const loads = await renderPackage.renderSchematic(result.ir, loadsRequest, result.presentation);",
          'if (!control.ok || !power.ok || !trace.ok || !conductors.ok || !loads.ok) throw new Error("packed render failed");',
          "const invalidTextIr = structuredClone(result.ir);",
          'const invalidCable = invalidTextIr.cables.find(({ designation }) => designation === "CBL1");',
          'if (!invalidCable) throw new Error("packed cable fixture missing");',
          'invalidCable.designation = "\\ud800";',
          'const invalidCableIndex = invalidTextIr.indexes.objectRefByDesignation.find(({ value }) => value.kind === "cable" && value.uid === invalidCable.uid);',
          'if (!invalidCableIndex) throw new Error("packed cable designation index missing");',
          "invalidCableIndex.key = invalidCable.designation;",
          'const invalidText = await renderPackage.renderSchematic(invalidTextIr, { format: "schematic-view-request/0.2", root: { by: "uid", value: invalidCable.uid }, intent: { kind: "conductors" } }, result.presentation);',
          'if (invalidText.ok || invalidText.error.code !== "R005" || invalidText.error.ownerKind !== "view" || invalidText.error.field !== "title.view-line" || invalidText.error.ownerId !== "normalized-view") throw new Error("packed composed-view R005 vocabulary mismatch");',
          "const agentTools = agentToolsPackage.createAgentTools({ cwd: process.cwd() });",
          'const agentBase = { format: "agent-tool-request/0.1", project: process.argv[2] };',
          'const agentResolve = await agentTools.resolve({ ...agentBase, target: { by: "type", value: "core:contactor-3p-1no" } });',
          'const agentInspect = await agentTools.inspect({ ...agentBase, selector: { by: "designation", value: "K1" } });',
          'const agentQuery = await agentTools.query({ ...agentBase, query: { operation: "neighbors", selector: { by: "designation", value: "K1" } } });',
          'const agentValidate = await agentTools.validate({ format: "agent-tool-request/0.1", project: "isolated-patch-project" });',
          "const agentView = await agentTools.createView({ ...agentBase, spec: controlRequest });",
          'if (!agentResolve.ok || !agentInspect.ok || !agentQuery.ok || !agentValidate.ok || !agentView.ok) throw new Error("packed read agent tool failed");',
          'const sourceBeforePatch = await readPackedFile("isolated-patch-project/source.json");',
          'const agentPatchBase = { format: "agent-tool-request/0.1", project: "isolated-patch-project", patchFormat: "json-patch/0.1", files: [{ path: "source.json", expectedIntegrity: computeFileIntegrity(sourceBeforePatch), operations: [{ op: "test", path: "", value: { objects: [] } }] }] };',
          "const agentDryRun = await agentTools.applySourcePatch({ ...agentPatchBase, dryRun: true });",
          'if (!agentDryRun.ok || agentDryRun.value.applied || !(await readPackedFile("isolated-patch-project/source.json")).equals(sourceBeforePatch)) throw new Error("packed agent dry run failed");',
          "const agentApply = await agentTools.applySourcePatch({ ...agentPatchBase, dryRun: false });",
          'if (!agentApply.ok || !agentApply.value.applied || (await readPackedFile("isolated-patch-project/source.json")).equals(sourceBeforePatch)) throw new Error("packed agent apply failed");',
          'if (JSON.stringify(agentApply.value.files) !== JSON.stringify(agentDryRun.value.files)) throw new Error("packed agent dry-run/apply parity failed");',
          'const agentResult = agentToolsPackage.serializeAgentToolResult("validate", agentValidate.value);',
          'if (agentResult !== "{\\n  \\"format\\": \\"agent-tool-result/0.1\\",\\n  \\"tool\\": \\"validate\\",\\n  \\"value\\": {\\n    \\"valid\\": true\\n  }\\n}\\n") throw new Error("packed agent result bytes mismatch");',
          "const bytes = serializeIr(empty.ir);",
          'const compareOrder = compareConductiveElementId({ kind: "wire", uid: "a" }, { kind: "wire", uid: "b" });',
          "console.log(JSON.stringify({ format: empty.ir.format, finalLf: bytes.endsWith('\\n'), emptyComponents: traversal.value.length, hasShortestConductivePath: 'shortestConductivePath' in queryPackage, hasQueryOrdering: 'compareText' in queryPackage, queryDeepImportBlocked, compareOrder, renderRuntimeExports: Object.keys(renderPackage).sort(), rendererVersion: renderPackage.RENDERER_VERSION, symbolCatalogVersion: renderPackage.SYMBOL_CATALOG_VERSION, layoutConfigVersion: renderPackage.LAYOUT_CONFIG_VERSION, agentToolsRuntimeExports: Object.keys(agentToolsPackage).sort(), agentToolsVersion: agentToolsPackage.AGENT_TOOLS_VERSION, agentReport, agentResult, agentToolsDeepImportBlocked, agentRuntime: { resolveMatches: agentResolve.value.matches.length, inspectCommand: agentInspect.value.command, queryCommand: agentQuery.value.command, valid: agentValidate.value.valid, viewMatches: agentView.value.svg === control.value.svg, dryRun: agentDryRun.value, apply: agentApply.value }, control: control.value, power: power.value, trace: trace.value, conductors: conductors.value, loads: loads.value, cableTextError: invalidText.error }));",
        ].join("\n");
        const consumerScriptPath = join(consumerDirectory, "smoke.mjs");
        await writeFile(consumerScriptPath, consumerScript, "utf8");
        const api = await run(
          process.execPath,
          [consumerScriptPath, motorProject],
          consumerDirectory,
        );
        const apiResult = JSON.parse(api.stdout) as {
          format: string;
          finalLf: boolean;
          emptyComponents: number;
          hasShortestConductivePath: boolean;
          hasQueryOrdering: boolean;
          queryDeepImportBlocked: boolean;
          compareOrder: number;
          renderRuntimeExports: string[];
          rendererVersion: string;
          symbolCatalogVersion: string;
          layoutConfigVersion: string;
          agentToolsRuntimeExports: string[];
          agentToolsVersion: string;
          agentReport: string;
          agentResult: string;
          agentToolsDeepImportBlocked: boolean;
          agentRuntime: {
            resolveMatches: number;
            inspectCommand: string;
            queryCommand: string;
            valid: boolean;
            viewMatches: boolean;
            dryRun: {
              dryRun: boolean;
              applied: boolean;
              files: unknown[];
            };
            apply: {
              dryRun: boolean;
              applied: boolean;
              files: unknown[];
            };
          };
          control: { view: unknown; summary: unknown; svg: string };
          power: { view: unknown; summary: unknown; svg: string };
          trace: { view: unknown; summary: unknown; svg: string };
          conductors: { view: unknown; summary: unknown; svg: string };
          loads: { view: unknown; summary: unknown; svg: string };
          cableTextError: {
            code: string;
            ownerKind: string;
            ownerId: string;
            field: string;
            reason: string;
          };
        };
        expect(apiResult).toMatchObject({
          format: "electrical-ir/0.1",
          finalLf: true,
          emptyComponents: 0,
          hasShortestConductivePath: false,
          hasQueryOrdering: false,
          queryDeepImportBlocked: true,
          compareOrder: -1,
          renderRuntimeExports: [
            "LAYOUT_CONFIG_VERSION",
            "RENDERER_VERSION",
            "SYMBOL_CATALOG_VERSION",
            "createSchematicRenderer",
            "normalizePaperPage",
            "printPacketHtml",
            "renderSchematic",
            "renderSchematicPacket",
            "renderSchematicSheets",
          ],
          rendererVersion: "render/0.3",
          symbolCatalogVersion: "ais-symbols/0.3",
          layoutConfigVersion: "elk-layered/0.4+elkjs-0.12.0",
          agentToolsRuntimeExports: [
            "AGENT_TOOLS_VERSION",
            "createAgentTools",
            "serializeAgentToolReport",
            "serializeAgentToolResult",
          ],
          agentToolsVersion: "agent-tools/0.1",
          agentReport:
            '{\n  "format": "agent-tool-report/0.1",\n  "tool": "validate",\n  "diagnostics": [],\n  "error": null\n}\n',
          agentResult:
            '{\n  "format": "agent-tool-result/0.1",\n  "tool": "validate",\n  "value": {\n    "valid": true\n  }\n}\n',
          agentToolsDeepImportBlocked: true,
          agentRuntime: {
            resolveMatches: 1,
            inspectCommand: "inspect",
            queryCommand: "neighbors",
            valid: true,
            viewMatches: true,
            dryRun: {
              dryRun: true,
              applied: false,
            },
            apply: {
              dryRun: false,
              applied: true,
            },
          },
        });
        expect(apiResult.agentRuntime.apply.files).toEqual(
          apiResult.agentRuntime.dryRun.files,
        );
        expect(apiResult.control.view).toMatchObject({
          family: "control",
          root: { designation: "K1" },
          flow: "left-to-right",
        });
        expect(apiResult.power.view).toMatchObject({
          family: "power",
          root: { designation: "M1" },
          flow: "left-to-right",
        });
        expect(apiResult.trace.view).toMatchObject({
          format: "schematic-view/0.2",
          intent: "trace",
          root: { kind: "device", designation: "LS1" },
          target: { designation: "PLC1" },
          includePower: true,
          flow: "left-to-right",
        });
        expect(apiResult.conductors.view).toMatchObject({
          format: "schematic-view/0.2",
          intent: "conductors",
          root: { kind: "cable", designation: "CBL1" },
          flow: "left-to-right",
        });
        expect(apiResult.loads.view).toMatchObject({
          format: "schematic-view/0.2",
          intent: "loads",
          root: { kind: "device", designation: "PS1" },
          flow: "left-to-right",
        });
        expect(apiResult.cableTextError).toMatchObject({
          code: "R005",
          ownerKind: "view",
          ownerId: "normalized-view",
          field: "title.view-line",
          reason: "unpaired-surrogate",
        });
        expect(apiResult.control.svg).toBe(
          await readFile(
            join(rendererGoldenRoot, "k1-control-left-to-right.svg"),
            "utf8",
          ),
        );
        expect(apiResult.power.svg).toBe(
          await readFile(
            join(rendererGoldenRoot, "m1-power-left-to-right.svg"),
            "utf8",
          ),
        );
        expect(apiResult.trace.svg).toBe(
          await readFile(
            join(
              rendererGoldenRoot,
              "ls1-to-plc1-include-power-left-to-right.svg",
            ),
            "utf8",
          ),
        );
        expect(apiResult.conductors.svg).toBe(
          await readFile(
            join(rendererGoldenRoot, "cbl1-conductors-left-to-right.svg"),
            "utf8",
          ),
        );
        expect(apiResult.loads.svg).toBe(
          await readFile(
            join(rendererGoldenRoot, "ps1-loads-left-to-right.svg"),
            "utf8",
          ),
        );

        const installedCli = join(
          consumerDirectory,
          "node_modules",
          "@thermite",
          "cli",
          "dist",
          "bin.js",
        );
        const cli = await run(
          process.execPath,
          [installedCli, "compile", consumerDirectory, "--diagnostics-json"],
          consumerDirectory,
        );
        expect(JSON.parse(cli.stdout)).toMatchObject({
          format: "electrical-ir/0.1",
        });
        expect(JSON.parse(cli.stderr)).toEqual([]);

        const queryCli = await run(
          process.execPath,
          [
            installedCli,
            "inspect",
            "K1",
            "--project",
            join(repositoryRoot, "examples", "motor-starter"),
            "--json",
          ],
          consumerDirectory,
        );
        expect(JSON.parse(queryCli.stdout)).toMatchObject({
          command: "inspect",
          object: {
            kind: "device",
            designation: "K1",
            typeId: "core:contactor-3p-1no",
          },
        });
        expect(JSON.parse(queryCli.stderr)).toEqual({
          diagnostics: [],
          error: null,
        });

        for (const { root, family, expected } of [
          { root: "K1", family: "control", expected: apiResult.control },
          { root: "M1", family: "power", expected: apiResult.power },
        ]) {
          const rawRender = await run(
            process.execPath,
            [
              installedCli,
              "render",
              root,
              "--family",
              family,
              "--project",
              motorProject,
            ],
            consumerDirectory,
          );
          expect(rawRender).toEqual({ stdout: expected.svg, stderr: "" });
        }

        const jsonRender = await run(
          process.execPath,
          [
            installedCli,
            "render",
            "K1",
            "--family",
            "control",
            "--project",
            motorProject,
            "--json",
          ],
          consumerDirectory,
        );
        expect(JSON.parse(jsonRender.stdout)).toEqual({
          command: "render",
          view: apiResult.control.view,
          summary: apiResult.control.summary,
          artifact: {
            kind: "inline",
            mediaType: "image/svg+xml",
            svg: apiResult.control.svg,
          },
        });
        expect(JSON.parse(jsonRender.stderr)).toEqual({
          diagnostics: [],
          error: null,
        });

        const output = "packed-m1.svg";
        const fileRender = await run(
          process.execPath,
          [
            installedCli,
            "render",
            "M1",
            "--family",
            "power",
            "--project",
            motorProject,
            "--output",
            output,
            "--json",
          ],
          consumerDirectory,
        );
        expect(JSON.parse(fileRender.stdout)).toEqual({
          command: "render",
          view: apiResult.power.view,
          summary: apiResult.power.summary,
          artifact: {
            kind: "file",
            mediaType: "image/svg+xml",
            output,
            written: true,
          },
        });
        expect(JSON.parse(fileRender.stderr)).toEqual({
          diagnostics: [],
          error: null,
        });
        expect(await readFile(join(consumerDirectory, output), "utf8")).toBe(
          apiResult.power.svg,
        );

        const installedViewCases = [
          { args: ["M1", "--power"], expected: apiResult.power },
          { args: ["K1", "--actuation"], expected: apiResult.control },
          {
            args: ["LS1", "--to", "PLC1", "--include-power"],
            expected: apiResult.trace,
          },
          {
            args: ["CBL1", "--conductors"],
            expected: apiResult.conductors,
          },
          { args: ["PS1", "--loads"], expected: apiResult.loads },
        ];
        for (const { args, expected } of installedViewCases) {
          const rawView = await run(
            process.execPath,
            [installedCli, "view", ...args, "--project", motorProject],
            consumerDirectory,
          );
          expect(rawView).toEqual({ stdout: expected.svg, stderr: "" });
        }

        const jsonView = await run(
          process.execPath,
          [
            installedCli,
            "view",
            "LS1",
            "--to",
            "PLC1",
            "--include-power",
            "--project",
            motorProject,
            "--json",
          ],
          consumerDirectory,
        );
        expect(JSON.parse(jsonView.stdout)).toEqual({
          command: "view",
          view: apiResult.trace.view,
          summary: apiResult.trace.summary,
          artifact: {
            kind: "inline",
            mediaType: "image/svg+xml",
            svg: apiResult.trace.svg,
          },
        });
        expect(JSON.parse(jsonView.stderr)).toEqual({
          diagnostics: [],
          error: null,
        });

        const viewOutput = "packed-ps1-loads.svg";
        const fileView = await run(
          process.execPath,
          [
            installedCli,
            "view",
            "PS1",
            "--loads",
            "--project",
            motorProject,
            "--output",
            viewOutput,
            "--json",
          ],
          consumerDirectory,
        );
        expect(JSON.parse(fileView.stdout)).toEqual({
          command: "view",
          view: apiResult.loads.view,
          summary: apiResult.loads.summary,
          artifact: {
            kind: "file",
            mediaType: "image/svg+xml",
            output: viewOutput,
            written: true,
          },
        });
        expect(JSON.parse(fileView.stderr)).toEqual({
          diagnostics: [],
          error: null,
        });
        expect(
          await readFile(join(consumerDirectory, viewOutput), "utf8"),
        ).toBe(apiResult.loads.svg);

        const appliedPatchFile = apiResult.agentRuntime.apply.files[0] as
          { afterIntegrity: string } | undefined;
        expect(appliedPatchFile).toBeDefined();
        const installedAgentBase = {
          format: "agent-tool-request/0.1",
          project: motorProject,
        };
        const installedAgentCases = [
          {
            tool: "resolve",
            request: {
              ...installedAgentBase,
              target: { by: "designation", value: "K1" },
            },
          },
          {
            tool: "inspect",
            request: {
              ...installedAgentBase,
              selector: { by: "designation", value: "K1" },
            },
          },
          {
            tool: "query",
            request: {
              ...installedAgentBase,
              query: {
                operation: "neighbors",
                selector: { by: "designation", value: "K1" },
              },
            },
          },
          {
            tool: "validate",
            request: installedAgentBase,
          },
          {
            tool: "create-view",
            request: {
              ...installedAgentBase,
              spec: {
                format: "schematic-view-request/0.1",
                family: "control",
                root: { by: "designation", value: "K1" },
              },
            },
          },
          {
            tool: "apply-source-patch",
            request: {
              format: "agent-tool-request/0.1",
              project: "isolated-patch-project",
              patchFormat: "json-patch/0.1",
              dryRun: true,
              files: [
                {
                  path: "source.json",
                  expectedIntegrity: appliedPatchFile!.afterIntegrity,
                  operations: [
                    { op: "test", path: "", value: { objects: [] } },
                  ],
                },
              ],
            },
          },
        ] as const;

        for (const [index, entry] of installedAgentCases.entries()) {
          const input = join(
            consumerDirectory,
            "agent-command-" + String(index) + ".json",
          );
          await writeFile(
            input,
            JSON.stringify(entry.request, undefined, 2) + "\n",
            "utf8",
          );
          const invocation = await run(
            process.execPath,
            [installedCli, "agent", entry.tool, "--input", input],
            consumerDirectory,
          );
          const result = JSON.parse(invocation.stdout) as {
            format: string;
            tool: string;
            value: unknown;
          };
          expect(result).toMatchObject({
            format: "agent-tool-result/0.1",
            tool: entry.tool,
          });
          expect(JSON.parse(invocation.stderr)).toEqual({
            format: "agent-tool-report/0.1",
            tool: entry.tool,
            diagnostics: [],
            error: null,
          });
          expect(invocation.stdout + invocation.stderr).not.toContain(
            motorProject,
          );

          if (entry.tool === "resolve") {
            expect(result.value).toMatchObject({
              mode: "resolve",
              object: { designation: "K1" },
            });
          } else if (entry.tool === "inspect") {
            expect(result.value).toMatchObject({
              command: "inspect",
              object: { designation: "K1" },
            });
          } else if (entry.tool === "query") {
            expect(result.value).toMatchObject({
              command: "neighbors",
              device: { designation: "K1" },
            });
          } else if (entry.tool === "validate") {
            expect(result.value).toEqual({ valid: true });
          } else if (entry.tool === "create-view") {
            expect(result.value).toMatchObject({
              view: { family: "control", root: { designation: "K1" } },
              svg: apiResult.control.svg,
            });
          } else {
            expect(result.value).toMatchObject({
              dryRun: true,
              applied: false,
              atomicity: "per-file",
              files: [{ path: "source.json", changed: false }],
            });
          }
        }

        await writeFile(
          join(consumerDirectory, "consumer.ts"),
          [
            'import { compareConductiveElementId, compileLoadedProject, evaluateRules, serializeIr, type CompileResult, type ConductiveElementId, type ElectricalIr, type M3RuleId } from "@thermite/compiler";',
            'import { SHIPPED_CORE_FILE_INVENTORY, SHIPPED_CORE_LIBRARY_LOCATOR, resolveShippedCoreLibrary, type ShippedCoreLibraryResolution } from "@thermite/core-library";',
            'import { type RenderCommandJsonResult, type RenderCommandReport } from "@thermite/cli";',
            'import { InvalidElectricalIrError, createQueryEngine, serializeQueryResult, type CableConductorView, type CableResult, type ConductiveEdgeView, type ConductiveElementView, type ConductiveNeighbor, type DeviceView, type FunctionView, type GangedGroupView, type IncidentProjectRelationView, type InspectedObject, type InspectedTerminalView, type InspectResult, type InternalRelationView, type NeighborsResult, type NetResult, type NetSummaryView, type ObjectSelector, type PotentialView, type ProjectObjectKind, type ProjectObjectView, type ProjectRelationView, type QueryCommandResult, type QueryEngine, type QueryError, type QueryErrorCode, type QueryResult, type RelationNeighbor, type TerminalSelector, type TerminalView, type TraceComponent, type TraceResult, type TraceVisit } from "@thermite/query";',
            'import { LAYOUT_CONFIG_VERSION, RENDERER_VERSION, SYMBOL_CATALOG_VERSION, createSchematicRenderer, renderSchematic, type DemonstrationViewIntent, type IncompletePathError, type IntentSchematicViewRequest, type InvalidLayoutError, type InvalidRenderTextError, type InvalidViewRequestError, type LegacySchematicViewRequest, type NormalizedIntentSchematicView, type NormalizedLegacySchematicView, type NormalizedSchematicView, type RenderError, type RenderErrorBase, type RenderErrorCode, type RenderFailure, type RenderOutcome, type RenderSummary, type RenderTextField, type RenderTextOwnerKind, type RenderTextReason, type RenderedSchematic, type RequestedBooleanInput, type RequestedFamilyInput, type RequestedFlowInput, type RequestedFormatInput, type RequestedIntentInput, type RequestedRootInput, type RequestedStringInput, type RuntimeInputType, type SchematicFlow, type SchematicRenderer, type SchematicViewFamily, type SchematicViewRequest, type UnsupportedSymbolMappingError } from "@thermite/render";',
            'import type { Diagnostic } from "@thermite/schema";',
            'import { AGENT_TOOLS_VERSION, createAgentTools, serializeAgentToolReport, serializeAgentToolResult, type A001Error, type A001Reason, type A002Error, type A002Reason, type A003Error, type A003Reason, type A004Error, type AgentToolError, type AgentToolErrorCode, type AgentToolFailure, type AgentToolJsonReport, type AgentToolJsonResult, type AgentToolName, type AgentToolOutcome, type AgentToolRequestBase, type AgentToolValueByName, type AgentTools, type AppliedSourceFile, type ApplySourcePatchRequest, type ApplySourcePatchValue, type CreateAgentToolsOptions, type DeepReadonly, type ExecuteGraphQueryRequest, type GraphQueryValue, type JsonPrimitive, type JsonValue, type SourceFilePatch, type SourcePatchOperation, type ValidateProjectRequest, type ValidateProjectValue } from "@thermite/agent-tools";',
            'import type { CreateViewRequest, InspectObjectRequest, InspectResult as AgentInspectResult, ProjectObjectView as AgentProjectObjectView, RenderedSchematic as AgentRenderedSchematic, ResolveObjectsRequest, ResolveObjectsValue, SearchMatch, SearchMatchField, SearchMatchKind } from "@thermite/agent-tools";',
            "// @ts-expect-error Schema package exports intentionally block implementation subpaths.",
            'import type { JsonObject } from "@thermite/schema/parser";',
            "// @ts-expect-error Core-library exports intentionally block implementation subpaths.",
            'import type { PrivateCoreType } from "@thermite/core-library/private";',
            "// @ts-expect-error Compiler package exports intentionally block implementation subpaths.",
            'import type { LoadResult } from "@thermite/compiler/loader";',
            "// @ts-expect-error Agent-tools package exports intentionally block deep subpaths.",
            'import type { PlainJsonDependencies } from "@thermite/agent-tools/common/plain-json";',
            "// @ts-expect-error M4 intentionally has no public point-to-point path function.",
            'import { shortestConductivePath } from "@thermite/query";',
            "// @ts-expect-error M4 intentionally has no public point-to-point path DTO.",
            'import type { ConductivePath } from "@thermite/query";',
            "// @ts-expect-error M4 intentionally has no public ordering helpers.",
            'import { compareText } from "@thermite/query";',
            "// @ts-expect-error Query package exports intentionally block deep subpaths.",
            'import { compareTerminalView } from "@thermite/query/ordering";',
            "// @ts-expect-error Render package exports intentionally block implementation subpaths.",
            'import type { RenderDependencies } from "@thermite/render/renderer";',
            "// @ts-expect-error CLI package exports intentionally block implementation subpaths.",
            'import type { AgentCommandDependencies } from "@thermite/cli/agent-command";',
            'const agentToolsVersion: "agent-tools/0.1" = AGENT_TOOLS_VERSION;',
            'const shippedCoreLocator: "ais-shipped:core@0.1.0" = SHIPPED_CORE_LIBRARY_LOCATOR;',
            "const shippedCoreResolution: ShippedCoreLibraryResolution = resolveShippedCoreLibrary();",
            "void SHIPPED_CORE_FILE_INVENTORY;",
            "void shippedCoreLocator;",
            "void shippedCoreResolution;",
            "void (null as unknown as PrivateCoreType);",
            'const agentToolName: AgentToolName = "apply-source-patch";',
            'const agentRequest: AgentToolRequestBase = { format: "agent-tool-request/0.1", project: "." };',
            "// @ts-expect-error Common requests are readonly.",
            'agentRequest.project = "changed";',
            'const agentOptions: CreateAgentToolsOptions = { cwd: "." };',
            "const completeAgentTools: AgentTools = createAgentTools(agentOptions);",
            'const resolveObjectsRequest: ResolveObjectsRequest = { format: "agent-tool-request/0.1", project: ".", target: { by: "text", value: "motor" } };',
            "// @ts-expect-error Resolve requests freeze nested target values.",
            'resolveObjectsRequest.target.value = "changed";',
            'const inspectObjectRequest: InspectObjectRequest = { format: "agent-tool-request/0.1", project: ".", selector: { by: "designation", value: "K1" } };',
            "// @ts-expect-error Inspect requests freeze nested selectors.",
            'inspectObjectRequest.selector.value = "changed";',
            "declare const resolveObjectsValue: ResolveObjectsValue;",
            'if (resolveObjectsValue.mode === "search") {',
            "  // @ts-expect-error Resolve search results are readonly.",
            "  resolveObjectsValue.matches.push();",
            "}",
            "declare const searchMatch: SearchMatch;",
            "// @ts-expect-error Search-match DTOs are readonly.",
            'searchMatch.match.field = "uid";',
            'const searchMatchField: SearchMatchField = "designation";',
            'const searchMatchKind: SearchMatchKind = "exact";',
            "declare const agentProjectObjectView: AgentProjectObjectView;",
            "declare const agentInspectResult: AgentInspectResult;",
            "type PublicAgentToolTypes = [ResolveObjectsRequest, ResolveObjectsValue, SearchMatch, SearchMatchField, SearchMatchKind, InspectObjectRequest, AgentInspectResult, AgentProjectObjectView];",
            "declare const publicAgentToolTypes: PublicAgentToolTypes;",
            "void publicAgentToolTypes;",
            "void searchMatchField;",
            "void searchMatchKind;",
            "void agentProjectObjectView;",
            "void agentInspectResult;",
            'const sourcePatchOperation: SourcePatchOperation = { op: "test", path: "", value: { objects: [] } };',
            'const sourceFilePatch: SourceFilePatch = { path: "source.json", expectedIntegrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", operations: [sourcePatchOperation] };',
            'const applySourcePatchRequest: ApplySourcePatchRequest = { format: "agent-tool-request/0.1", project: ".", patchFormat: "json-patch/0.1", dryRun: true, files: [sourceFilePatch] };',
            "// @ts-expect-error Patch requests freeze nested operation values.",
            'applySourcePatchRequest.files[0]!.operations[0]!.path = "/changed";',
            'const appliedSourceFile: AppliedSourceFile = { path: "source.json", beforeIntegrity: "sha256-before=", afterIntegrity: "sha256-after=", byteLength: 1, changed: true };',
            'const applySourcePatchValue: ApplySourcePatchValue = { dryRun: true, applied: false, atomicity: "per-file", files: [appliedSourceFile] };',
            'const agentValueKeys: (keyof AgentToolValueByName)[] = ["resolve", "inspect", "query", "validate", "create-view", "apply-source-patch"];',
            "// @ts-expect-error The six-key map is closed.",
            'const invalidAgentValueKey: keyof AgentToolValueByName = "other";',
            'const serializedAgentResult: string = serializeAgentToolResult("validate", { valid: true });',
            "const patchOutcomePromise = completeAgentTools.applySourcePatch(applySourcePatchRequest);",
            'const graphQueryRequest: ExecuteGraphQueryRequest = { format: "agent-tool-request/0.1", project: ".", query: { operation: "net", selector: { by: "parts", deviceDesignation: "PLC1", terminalKey: "X1.0" } } };',
            "// @ts-expect-error Graph-query requests are deeply readonly.",
            'graphQueryRequest.query.operation = "trace";',
            'const validateProjectRequest: ValidateProjectRequest = { format: "agent-tool-request/0.1", project: "." };',
            "// @ts-expect-error Validate requests are readonly.",
            'validateProjectRequest.project = "changed";',
            'const createViewControlRequest: CreateViewRequest = { format: "agent-tool-request/0.1", project: ".", spec: { format: "schematic-view-request/0.1", family: "control", root: { by: "designation", value: "K1" } } };',
            'const createViewPowerRequest: CreateViewRequest = { format: "agent-tool-request/0.1", project: ".", spec: { format: "schematic-view-request/0.1", family: "power", root: { by: "uid", value: "00000000-0000-4000-8000-000000000001" }, flow: "top-to-bottom" } };',
            'const createViewTraceRequest: CreateViewRequest = { format: "agent-tool-request/0.1", project: ".", spec: { format: "schematic-view-request/0.2", root: { by: "designation", value: "LS1" }, intent: { kind: "trace", to: { by: "uid", value: "00000000-0000-4000-8000-000000000002" }, includePower: true }, flow: "left-to-right" } };',
            'const createViewConductorsRequest: CreateViewRequest = { format: "agent-tool-request/0.1", project: ".", spec: { format: "schematic-view-request/0.2", root: { by: "uid", value: "00000000-0000-4000-8000-000000000003" }, intent: { kind: "conductors" } } };',
            'const createViewLoadsRequest: CreateViewRequest = { format: "agent-tool-request/0.1", project: ".", spec: { format: "schematic-view-request/0.2", root: { by: "designation", value: "PS1" }, intent: { kind: "loads" }, flow: "top-to-bottom" } };',
            "// @ts-expect-error Create-view requests are deeply readonly.",
            'createViewTraceRequest.spec.root.value = "changed";',
            "// @ts-expect-error The agent request version is closed at 0.1.",
            'const futureAgentViewRequest: CreateViewRequest = { format: "agent-tool-request/0.2", project: ".", spec: { format: "schematic-view-request/0.1", family: "control", root: { by: "designation", value: "K1" } } };',
            "// @ts-expect-error Create-view accepts only the current public ViewSpec versions.",
            'const futureViewSpecRequest: CreateViewRequest = { format: "agent-tool-request/0.1", project: ".", spec: { format: "schematic-view-request/0.3", root: { by: "designation", value: "LS1" }, intent: { kind: "loads" } } };',
            "declare const agentRenderedSchematic: AgentRenderedSchematic;",
            "declare const graphQueryValue: GraphQueryValue;",
            "const validateProjectValue: ValidateProjectValue = { valid: true };",
            "// @ts-expect-error Validate values are readonly.",
            "validateProjectValue.valid = true;",
            'const jsonPrimitive: JsonPrimitive = "value";',
            'const jsonValue: JsonValue = { nested: [null, true, 1, "value"] };',
            "type Assert<T extends true> = T;",
            "type AssertFalse<T extends false> = T;",
            "type IsExactlyJsonValue<T> =",
            "  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends JsonValue ? 1 : 2",
            "    ? true",
            "    : false;",
            "type J = JsonValue;",
            "type ExpectedReadonlyJsonValue =",
            "  | null",
            "  | boolean",
            "  | number",
            "  | string",
            "  | readonly ExpectedReadonlyJsonValue[]",
            "  | { readonly [key: string]: ExpectedReadonlyJsonValue };",
            "type ExactChecks = [",
            "  Assert<IsExactlyJsonValue<JsonValue>> ,",
            "  Assert<IsExactlyJsonValue<J>> ,",
            "];",
            "declare const jsonResult: DeepReadonly<JsonValue>;",
            "declare const aliasResult: DeepReadonly<J>;",
            "const jsonAsExpected: ExpectedReadonlyJsonValue = jsonResult;",
            "const aliasAsExpected: ExpectedReadonlyJsonValue = aliasResult;",
            "declare const expected: ExpectedReadonlyJsonValue;",
            "const expectedAsJson: DeepReadonly<JsonValue> = expected;",
            "const expectedAsAlias: DeepReadonly<J> = expected;",
            "// @ts-expect-error the exact JsonValue short-circuit excludes functions.",
            "const jsonRejectsFunction: DeepReadonly<JsonValue> = () => 1;",
            "type LooseJson =",
            "  | JsonPrimitive",
            "  | readonly any[]",
            "  | { readonly [key: string]: any };",
            "type ArrayAnyNearMiss = JsonPrimitive | readonly any[];",
            "type ObjectAnyNearMiss =",
            "  | JsonPrimitive",
            "  | { readonly [key: string]: any };",
            "type JsonSubtype = JsonPrimitive | readonly JsonValue[];",
            "type JsonPlusFunction = JsonValue | (() => number);",
            "type JsonPlusFunctionObject =",
            "  | JsonValue",
            "  | { readonly handler: () => number };",
            "type JsonPlusDate = JsonValue | Date;",
            "type JsonPlusUndefined = JsonValue | undefined;",
            "type GuardChecks = [",
            "  AssertFalse<IsExactlyJsonValue<any>> ,",
            "  AssertFalse<IsExactlyJsonValue<JsonValue | any>> ,",
            "  AssertFalse<IsExactlyJsonValue<LooseJson>> ,",
            "  AssertFalse<IsExactlyJsonValue<ArrayAnyNearMiss>> ,",
            "  AssertFalse<IsExactlyJsonValue<ObjectAnyNearMiss>> ,",
            "  AssertFalse<IsExactlyJsonValue<JsonSubtype>> ,",
            "  AssertFalse<IsExactlyJsonValue<JsonPlusFunction>> ,",
            "  AssertFalse<IsExactlyJsonValue<JsonPlusFunctionObject>> ,",
            "  AssertFalse<IsExactlyJsonValue<JsonPlusDate>> ,",
            "  AssertFalse<IsExactlyJsonValue<JsonPlusUndefined>> ,",
            "];",
            "const anyFunction: DeepReadonly<any> = () => 1;",
            "const anyUnionFunction: DeepReadonly<JsonValue | any> = () => 1;",
            "const looseArrayFunction: DeepReadonly<LooseJson> = [() => 1];",
            "const looseObjectFunction: DeepReadonly<LooseJson> = { handler: () => 1 };",
            "const arrayNearMissFunction: DeepReadonly<ArrayAnyNearMiss> = [() => 1];",
            "const objectNearMissFunction: DeepReadonly<ObjectAnyNearMiss> = { handler: () => 1 };",
            "const subtypeValue: DeepReadonly<JsonSubtype> = [{ nested: true }];",
            "const unionFunction: DeepReadonly<JsonPlusFunction> = () => 1;",
            "const unionFunctionObject: DeepReadonly<JsonPlusFunctionObject> = { handler: () => 1 };",
            "const unionDate: DeepReadonly<JsonPlusDate> = new Date();",
            "const unionUndefined: DeepReadonly<JsonPlusUndefined> = undefined;",
            "const readonlyApplySourcePatchRequest: DeepReadonly<ApplySourcePatchRequest> = applySourcePatchRequest;",
            "const readonlyApplySourcePatchValue: DeepReadonly<ApplySourcePatchValue> = applySourcePatchValue;",
            "void (null as unknown as ExactChecks);",
            "void (null as unknown as GuardChecks);",
            "void jsonAsExpected;",
            "void aliasAsExpected;",
            "void expectedAsJson;",
            "void expectedAsAlias;",
            "void jsonRejectsFunction;",
            "void anyFunction;",
            "void anyUnionFunction;",
            "void looseArrayFunction;",
            "void looseObjectFunction;",
            "void arrayNearMissFunction;",
            "void objectNearMissFunction;",
            "void subtypeValue;",
            "void unionFunction;",
            "void unionFunctionObject;",
            "void unionDate;",
            "void unionUndefined;",
            "void readonlyApplySourcePatchRequest;",
            "void readonlyApplySourcePatchValue;",
            'const a001Reason: A001Reason = "hostile-object";',
            'const a002Reason: A002Reason = "invalid-array-index";',
            'const a003Reason: A003Reason = "not-project-source";',
            'const agentErrorCode: AgentToolErrorCode = "A004";',
            "declare const a001Error: A001Error;",
            "declare const a002Error: A002Error;",
            "declare const a003Error: A003Error;",
            "declare const a004Error: A004Error;",
            "declare const agentFailure: AgentToolFailure;",
            "declare const readonlyTuple: DeepReadonly<[{ value: string }, string[]]>;",
            "// @ts-expect-error DeepReadonly preserves tuple shape and freezes nested members.",
            'readonlyTuple[0].value = "changed";',
            "// @ts-expect-error DeepReadonly freezes tuple indexes.",
            "readonlyTuple[1] = [];",
            "// @ts-expect-error DeepReadonly freezes nested arrays.",
            'readonlyTuple[1].push("changed");',
            "declare const readonlyDiagnostic: DeepReadonly<Diagnostic>;",
            "// @ts-expect-error DeepReadonly closes imported mutable diagnostic fields.",
            'readonlyDiagnostic.message = "changed";',
            "if (readonlyDiagnostic.related) {",
            "  // @ts-expect-error DeepReadonly closes nested related locations.",
            '  readonlyDiagnostic.related[0]!.note = "changed";',
            "}",
            "declare const readonlyTerminal: DeepReadonly<InspectedTerminalView>;",
            "// @ts-expect-error DeepReadonly closes imported compiler TerminalId fields.",
            'readonlyTerminal.id.deviceUid = "changed";',
            "declare const readonlyInspect: DeepReadonly<InspectResult>;",
            "// @ts-expect-error DeepReadonly closes imported query DTO fields.",
            'readonlyInspect.command = "inspect";',
            "declare const readonlyRendered: DeepReadonly<RenderedSchematic>;",
            "// @ts-expect-error DeepReadonly closes imported render DTO fields.",
            'readonlyRendered.view.flow = "top-to-bottom";',
            "const readonlyFunction: DeepReadonly<(value: string) => number> = (value) => value.length;",
            'const functionResult: number = readonlyFunction("value");',
            "declare const agentOutcome: AgentToolOutcome<{ nested: { values: string[] } }, AgentToolError>;",
            "if (agentOutcome.ok) {",
            "  // @ts-expect-error Outcome values are recursively readonly.",
            '  agentOutcome.value.nested.values.push("changed");',
            "} else {",
            "  // @ts-expect-error failureClass is readonly in-process state.",
            '  agentOutcome.failureClass = "tool";',
            "}",
            'const agentJsonReport: AgentToolJsonReport = { format: "agent-tool-report/0.1", tool: "validate", diagnostics: [], error: null };',
            "// @ts-expect-error failureClass is deliberately absent from report envelopes.",
            "agentJsonReport.failureClass;",
            'const agentJsonResult: AgentToolJsonResult<"validate"> = { format: "agent-tool-result/0.1", tool: "validate", value: { valid: true } };',
            "// @ts-expect-error Result envelope fields are readonly.",
            'agentJsonResult.tool = "validate";',
            'const serializedAgentReport: string = serializeAgentToolReport("validate", [], null);',
            "declare const result: CompileResult;",
            "declare const ir: ElectricalIr;",
            "declare const commandResult: QueryCommandResult;",
            'const ruleId: M3RuleId = "E200";',
            'const objectSelector: ObjectSelector = { by: "designation", value: "K1" };',
            'const terminalSelector: TerminalSelector = { by: "parts", deviceDesignation: "PLC1", terminalKey: "X1.0" };',
            "const engine: QueryEngine = createQueryEngine(ir);",
            "const serialized: string = serializeQueryResult(commandResult);",
            'const rendererVersion: "render/0.3" = RENDERER_VERSION;',
            'const symbolCatalogVersion: "ais-symbols/0.3" = SYMBOL_CATALOG_VERSION;',
            'const layoutConfigVersion: "elk-layered/0.4+elkjs-0.12.0" = LAYOUT_CONFIG_VERSION;',
            "type PublicQueryTypes = [CableConductorView, CableResult, ConductiveEdgeView, ConductiveElementView, ConductiveNeighbor, DeviceView, FunctionView, GangedGroupView, IncidentProjectRelationView, InspectedObject, InspectedTerminalView, InspectResult, InternalRelationView, NeighborsResult, NetResult, NetSummaryView, PotentialView, ProjectObjectKind, ProjectObjectView, ProjectRelationView, QueryCommandResult, QueryEngine, QueryError, QueryErrorCode, QueryResult<QueryCommandResult>, RelationNeighbor, TerminalView, TraceComponent, TraceResult, TraceVisit, ConductivePath];",
            "declare const publicQueryTypes: PublicQueryTypes;",
            'const legacyRequest: LegacySchematicViewRequest = { format: "schematic-view-request/0.1", root: { by: "designation", value: "K1" }, family: "control" };',
            'const powerRequest: LegacySchematicViewRequest = { format: "schematic-view-request/0.1", root: { by: "designation", value: "M1" }, family: "power", flow: "top-to-bottom" };',
            'const traceIntent: DemonstrationViewIntent = { kind: "trace", to: { by: "designation", value: "PLC1" }, includePower: true };',
            'const traceRequest: IntentSchematicViewRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "LS1" }, intent: traceIntent };',
            'const conductorsRequest: SchematicViewRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "CBL1" }, intent: { kind: "conductors" } };',
            'const loadsRequest: SchematicViewRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "PS1" }, intent: { kind: "loads" }, flow: "top-to-bottom" };',
            "const renderRequest: SchematicViewRequest = legacyRequest;",
            'const legacyNormalized: NormalizedLegacySchematicView = { format: "schematic-view/0.1", family: "control", root: { deviceUid: "device", designation: "K1" }, flow: "left-to-right" };',
            'const traceNormalized: NormalizedIntentSchematicView = { format: "schematic-view/0.2", family: "control", intent: "trace", root: { kind: "device", deviceUid: "root", designation: "LS1" }, target: { deviceUid: "target", designation: "PLC1" }, includePower: true, flow: "left-to-right" };',
            'const cableNormalized: NormalizedSchematicView = { format: "schematic-view/0.2", family: "control", intent: "conductors", root: { kind: "cable", cableUid: "cable", designation: "CBL1" }, flow: "left-to-right" };',
            'const loadsNormalized: NormalizedSchematicView = { format: "schematic-view/0.2", family: "control", intent: "loads", root: { kind: "device", deviceUid: "source", designation: "PS1" }, flow: "left-to-right" };',
            'const renderCommandLiteral: RenderCommandJsonResult["command"] = "render";',
            'const viewCommandLiteral: RenderCommandJsonResult["command"] = "view";',
            "const renderCommandReport: RenderCommandReport = { diagnostics: [], error: null };",
            "// @ts-expect-error trace requests require an explicit includePower boolean.",
            'const missingTraceBoolean: SchematicViewRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "LS1" }, intent: { kind: "trace", to: { by: "designation", value: "PLC1" } } };',
            "// @ts-expect-error conductors rejects a trace target.",
            'const conductorsWithTarget: SchematicViewRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "CBL1" }, intent: { kind: "conductors", to: { by: "designation", value: "PLC1" } } };',
            "// @ts-expect-error loads rejects includePower.",
            'const loadsWithPower: SchematicViewRequest = { format: "schematic-view-request/0.2", root: { by: "designation", value: "PS1" }, intent: { kind: "loads", includePower: true } };',
            'const requestedIntentMissing: RequestedIntentInput = { kind: "missing" };',
            'const requestedIntentUninspectable: RequestedIntentInput = { kind: "uninspectable" };',
            'const requestedIntentTrace: RequestedIntentInput = { kind: "intent", value: "trace" };',
            'const requestedIntentConductors: RequestedIntentInput = { kind: "intent", value: "conductors" };',
            'const requestedIntentLoads: RequestedIntentInput = { kind: "intent", value: "loads" };',
            'const requestedIntentNonObject: RequestedIntentInput = { kind: "non-object", inputType: "string" };',
            'const requestedIntentMalformed: RequestedIntentInput = { kind: "malformed-intent", intentKind: { kind: "string", value: "unknown" } };',
            'const requestedBooleanMissing: RequestedBooleanInput = { kind: "missing" };',
            'const requestedBooleanUninspectable: RequestedBooleanInput = { kind: "uninspectable" };',
            'const requestedBooleanTrue: RequestedBooleanInput = { kind: "boolean", value: true };',
            'const requestedBooleanNonBoolean: RequestedBooleanInput = { kind: "non-boolean", inputType: "object" };',
            'const cableOwner: RenderTextOwnerKind = "cable";',
            'const cableConductorOwner: RenderTextOwnerKind = "cable-conductor";',
            'const projectOwner: RenderTextOwnerKind = "project";',
            'const presentationOwner: RenderTextOwnerKind = "presentation";',
            'const viewOwner: RenderTextOwnerKind = "view";',
            'const rendererOwner: RenderTextOwnerKind = "renderer";',
            'const projectNameField: RenderTextField = "project.name";',
            'const titleProjectField: RenderTextField = "title.project-line";',
            'const titleRevisionField: RenderTextField = "title.revision-line";',
            'const titleViewField: RenderTextField = "title.view-line";',
            'const titleToolField: RenderTextField = "title.tool-line";',
            'const titleAuthoredField: RenderTextField = "title.authored-line";',
            'const emptyTextReason: RenderTextReason = "empty-string";',
            'const longTextReason: RenderTextReason = "over-160-code-points";',
            'const singleLineReason: RenderTextReason = "forbidden-single-line-code-point";',
            'const surrogateReason: RenderTextReason = "unpaired-surrogate";',
            'const xmlReason: RenderTextReason = "xml-illegal-code-point";',
            'type ExpectedRenderTextOwnerKind = "project" | "presentation" | "view" | "renderer" | "cable" | "device" | "function" | "aggregate" | "terminal" | "wire" | "jumper" | "cable-conductor" | "potential" | "boundary";',
            'type ExpectedRenderTextField = "project.name" | "title.project-line" | "title.revision-line" | "title.view-line" | "title.tool-line" | "title.authored-line" | "device.designation" | "device.type" | "device.location" | "function.key" | "aggregate.key" | "terminal.key" | "wire.properties.label" | "wire.designation" | "jumper.designation" | "cable.designation" | "cable.conductor.id" | "cable.conductor.color" | "cable.conductor.size" | "potential.name" | "boundary.label";',
            'type ExpectedRenderTextReason = "empty-string" | "over-160-code-points" | "forbidden-single-line-code-point" | "unpaired-surrogate" | "xml-illegal-code-point";',
            "type ExactUnion<Actual, Expected> = [Actual] extends [Expected] ? ([Expected] extends [Actual] ? true : false) : false;",
            "type AssertTrue<Value extends true> = Value;",
            "type ExactRenderTextOwnerKind = AssertTrue<ExactUnion<RenderTextOwnerKind, ExpectedRenderTextOwnerKind>>;",
            "type ExactRenderTextField = AssertTrue<ExactUnion<RenderTextField, ExpectedRenderTextField>>;",
            "type ExactRenderTextReason = AssertTrue<ExactUnion<RenderTextReason, ExpectedRenderTextReason>>;",
            'const titleTextError: InvalidRenderTextError = { code: "R005", message: "Invalid render text.", family: "control", ownerKind: "view", ownerId: "normalized-view", field: "title.view-line", reason: "forbidden-single-line-code-point", root: "K1" };',
            "// @ts-expect-error InvalidRenderTextError fields are readonly.",
            'titleTextError.reason = "unpaired-surrogate";',
            "// @ts-expect-error Render text owners are a closed union.",
            'const invalidOwner: RenderTextOwnerKind = "title";',
            "// @ts-expect-error Render text fields are a closed union.",
            'const invalidField: RenderTextField = "title.invalid";',
            "// @ts-expect-error Render text reasons are a closed union.",
            'const invalidReason: RenderTextReason = "over-maximum-length";',
            'const cableDesignationField: RenderTextField = "cable.designation";',
            'const cableConductorIdField: RenderTextField = "cable.conductor.id";',
            'const cableConductorColorField: RenderTextField = "cable.conductor.color";',
            'const cableConductorSizeField: RenderTextField = "cable.conductor.size";',
            'declare const traceError: Extract<IncompletePathError, { intent: "trace" }>;',
            "// @ts-expect-error R002 trace code is readonly.",
            'traceError.code = "R002";',
            "// @ts-expect-error R002 trace family is readonly.",
            'traceError.family = "control";',
            "// @ts-expect-error R002 trace intent is readonly.",
            'traceError.intent = "trace";',
            "// @ts-expect-error R002 trace deviceUid is readonly.",
            'traceError.deviceUid = "root";',
            "// @ts-expect-error R002 trace targetDeviceUid is readonly.",
            'traceError.targetDeviceUid = "target";',
            "// @ts-expect-error R002 trace segment is readonly.",
            'traceError.segment = "signal";',
            "// @ts-expect-error R002 trace message is readonly.",
            'traceError.message = "message";',
            "// @ts-expect-error R002 trace root is readonly.",
            'traceError.root = "LS1";',
            'declare const conductorsError: Extract<IncompletePathError, { intent: "conductors" }>;',
            "// @ts-expect-error R002 conductors code is readonly.",
            'conductorsError.code = "R002";',
            "// @ts-expect-error R002 conductors family is readonly.",
            'conductorsError.family = "control";',
            "// @ts-expect-error R002 conductors intent is readonly.",
            'conductorsError.intent = "conductors";',
            "// @ts-expect-error R002 conductors cableUid is readonly.",
            'conductorsError.cableUid = "cable";',
            "// @ts-expect-error R002 conductors segment is readonly.",
            'conductorsError.segment = "conductors";',
            "// @ts-expect-error R002 conductors message is readonly.",
            'conductorsError.message = "message";',
            "// @ts-expect-error R002 conductors root is readonly.",
            'conductorsError.root = "CBL1";',
            'declare const loadsError: Extract<IncompletePathError, { intent: "loads" }>;',
            "// @ts-expect-error R002 loads code is readonly.",
            'loadsError.code = "R002";',
            "// @ts-expect-error R002 loads family is readonly.",
            'loadsError.family = "control";',
            "// @ts-expect-error R002 loads intent is readonly.",
            'loadsError.intent = "loads";',
            "// @ts-expect-error R002 loads deviceUid is readonly.",
            'loadsError.deviceUid = "source";',
            "// @ts-expect-error R002 loads segment is readonly.",
            'loadsError.segment = "complete-load";',
            "// @ts-expect-error R002 loads message is readonly.",
            'loadsError.message = "message";',
            "// @ts-expect-error R002 loads root is readonly.",
            'loadsError.root = "PS1";',
            "const schematicRenderer: SchematicRenderer = createSchematicRenderer();",
            "const publicRender: Promise<RenderOutcome<RenderedSchematic>> = renderSchematic(ir, renderRequest);",
            "const factoryRender: Promise<RenderOutcome<RenderedSchematic>> = schematicRenderer.render(ir, renderRequest);",
            'const conductiveLeft: ConductiveElementId = { kind: "wire", uid: "a" };',
            'const conductiveRight: ConductiveElementId = { kind: "wire", uid: "b" };',
            "const conductiveOrder: number = compareConductiveElementId(conductiveLeft, conductiveRight);",
            "type PublicRenderTypes = [DemonstrationViewIntent, IncompletePathError, IntentSchematicViewRequest, InvalidLayoutError, InvalidRenderTextError, InvalidViewRequestError, LegacySchematicViewRequest, NormalizedIntentSchematicView, NormalizedLegacySchematicView, NormalizedSchematicView, RenderError, RenderErrorBase, RenderErrorCode, RenderFailure, RenderOutcome<RenderedSchematic>, RenderSummary, RenderTextField, RenderTextOwnerKind, RenderTextReason, RenderedSchematic, RequestedBooleanInput, RequestedFamilyInput, RequestedFlowInput, RequestedFormatInput, RequestedIntentInput, RequestedRootInput, RequestedStringInput, RuntimeInputType, SchematicFlow, SchematicRenderer, SchematicViewFamily, SchematicViewRequest, UnsupportedSymbolMappingError];",
            "declare const publicRenderTypes: PublicRenderTypes;",
            "if (result.ok) serializeIr(result.ir);",
            "void compileLoadedProject;",
            "void evaluateRules;",
            "void ir;",
            "void ruleId;",
            "void graphQueryRequest;",
            "void validateProjectRequest;",
            "void createViewControlRequest;",
            "void createViewPowerRequest;",
            "void createViewTraceRequest;",
            "void createViewConductorsRequest;",
            "void createViewLoadsRequest;",
            "void futureAgentViewRequest;",
            "void futureViewSpecRequest;",
            "void agentRenderedSchematic;",
            "void graphQueryValue;",
            "void validateProjectValue;",
            "void objectSelector;",
            "void terminalSelector;",
            "void engine;",
            "void serialized;",
            "void rendererVersion;",
            "void symbolCatalogVersion;",
            "void layoutConfigVersion;",
            "void InvalidElectricalIrError;",
            "void publicQueryTypes;",
            "void renderRequest;",
            "void powerRequest;",
            "void traceRequest;",
            "void conductorsRequest;",
            "void loadsRequest;",
            "void legacyNormalized;",
            "void traceNormalized;",
            "void cableNormalized;",
            "void loadsNormalized;",
            "void renderCommandLiteral;",
            "void viewCommandLiteral;",
            "void renderCommandReport;",
            "void missingTraceBoolean;",
            "void conductorsWithTarget;",
            "void loadsWithPower;",
            "void requestedIntentMissing;",
            "void requestedIntentUninspectable;",
            "void requestedIntentTrace;",
            "void requestedIntentConductors;",
            "void requestedIntentLoads;",
            "void requestedIntentNonObject;",
            "void requestedIntentMalformed;",
            "void requestedBooleanMissing;",
            "void requestedBooleanUninspectable;",
            "void requestedBooleanTrue;",
            "void requestedBooleanNonBoolean;",
            "void cableOwner;",
            "void cableConductorOwner;",
            "void projectOwner;",
            "void presentationOwner;",
            "void viewOwner;",
            "void rendererOwner;",
            "void projectNameField;",
            "void titleProjectField;",
            "void titleRevisionField;",
            "void titleViewField;",
            "void titleToolField;",
            "void titleAuthoredField;",
            "void emptyTextReason;",
            "void longTextReason;",
            "void singleLineReason;",
            "void surrogateReason;",
            "void xmlReason;",
            "void titleTextError;",
            "void invalidOwner;",
            "void invalidField;",
            "void invalidReason;",
            "void cableDesignationField;",
            "void cableConductorIdField;",
            "void cableConductorColorField;",
            "void cableConductorSizeField;",
            "void traceError;",
            "void conductorsError;",
            "void loadsError;",
            "void schematicRenderer;",
            "void publicRender;",
            "void factoryRender;",
            "void conductiveOrder;",
            "void publicRenderTypes;",
            "type ExactRenderTextDeclarations = [ExactRenderTextOwnerKind, ExactRenderTextField, ExactRenderTextReason];",
            "declare const exactRenderTextDeclarations: ExactRenderTextDeclarations;",
            "void exactRenderTextDeclarations;",
            "void shortestConductivePath;",
            "void compareText;",
            "void compareTerminalView;",
          ].join("\n"),
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
      } catch (error) {
        if (isChildProcessDenied(error)) {
          skip(
            "RELEASE-EVIDENCE-DENIED: seven-component package-smoke child-process tier is unavailable.",
          );
          return;
        }
        throw error;
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

  it("type-checks the complete packed consumer against emitted declarations", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-agent-dist-consumer-"),
    );
    const consumerPath = join(temporaryRoot, "consumer.ts");
    const configPath = join(temporaryRoot, "tsconfig.json");

    try {
      await writeFile(
        join(temporaryRoot, "package.json"),
        '{"private":true,"type":"module"}\n',
        "utf8",
      );
      const testSource = await readFile(fileURLToPath(import.meta.url), "utf8");
      await writeFile(
        consumerPath,
        extractPackedTypeConsumer(testSource),
        "utf8",
      );
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
                "@thermite/core-library": [
                  "packages/core-library/dist/index.d.ts",
                ],
                "@thermite/compiler": ["packages/compiler/dist/index.d.ts"],
                "@thermite/query": ["packages/query/dist/index.d.ts"],
                "@thermite/render": ["packages/render/dist/index.d.ts"],
                "@thermite/agent-tools": [
                  "packages/agent-tools/dist/index.d.ts",
                ],
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

      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      expect(config.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        temporaryRoot,
      );
      const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
      });
      const diagnostics = [
        ...parsed.errors,
        ...ts.getPreEmitDiagnostics(program),
      ];
      expect(
        ts.formatDiagnostics(diagnostics, {
          getCanonicalFileName: (fileName) => fileName,
          getCurrentDirectory: () => repositoryRoot,
          getNewLine: () => "\n",
        }),
      ).toBe("");
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });
});
