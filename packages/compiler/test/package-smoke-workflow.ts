import { consumerScript } from "./package-smoke-program.js";
import {
  runPackedApi,
  checkPackedDeclarations,
} from "./package-smoke-fixture.js";
import {
  assertRuntimeApi,
  assertViewContracts,
  assertGoldenSvgs,
} from "./package-smoke-assertions.js";
import { join } from "node:path";
import {
  assertCompileAndInspect,
  assertRawRender,
  assertJsonRender,
  assertFileRender,
  assertRawViews,
  assertJsonView,
  assertFileView,
} from "./package-smoke-cli.js";
import { assertAgentCommands } from "./package-smoke-agent.js";

export async function assertPackedContracts(
  consumerDirectory: string,
  consumerScript: string,
  packedTypeConsumer: string,
) {
  const apiResult = await runPackedApi(consumerDirectory, consumerScript);
  assertRuntimeApi(apiResult);
  assertViewContracts(apiResult);
  await assertGoldenSvgs(apiResult);

  const installedCli = join(
    consumerDirectory,
    "node_modules",
    "@thermite",
    "cli",
    "dist",
    "bin.js",
  );
  await assertCompileAndInspect(consumerDirectory, installedCli);
  await assertRawRender(consumerDirectory, installedCli, apiResult);
  await assertJsonRender(consumerDirectory, installedCli, apiResult);
  await assertFileRender(consumerDirectory, installedCli, apiResult);
  await assertRawViews(consumerDirectory, installedCli, apiResult);
  await assertJsonView(consumerDirectory, installedCli, apiResult);
  await assertFileView(consumerDirectory, installedCli, apiResult);
  await assertAgentCommands(consumerDirectory, installedCli, apiResult);
  await checkPackedDeclarations(consumerDirectory, packedTypeConsumer);
}
