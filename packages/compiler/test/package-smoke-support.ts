import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

export const execFileAsync = promisify(execFile);
export const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryRoot = resolve(packageRoot, "../..");
export const schemaRoot = join(repositoryRoot, "packages", "schema");
export const coreLibraryRoot = join(repositoryRoot, "packages", "core-library");
export const queryRoot = join(repositoryRoot, "packages", "query");
export const renderRoot = join(repositoryRoot, "packages", "render");
export const agentToolsRoot = join(repositoryRoot, "packages", "agent-tools");
export const cliRoot = join(repositoryRoot, "packages", "cli");
export const motorProject = join(repositoryRoot, "examples", "motor-starter");
export const rendererGoldenRoot = join(
  renderRoot,
  "test",
  "goldens",
  "motor-starter",
);
export async function run(
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
export async function pack(
  source: string,
  destination: string,
): Promise<string> {
  const { stdout } = await run(
    process.execPath,
    ["pm", "pack", "--destination", destination, "--quiet", "--ignore-scripts"],
    source,
  );
  return resolve(destination, stdout.trim());
}
export function extractPackedTypeConsumer(testSource: string): string {
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
export type ApiResult = {
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
