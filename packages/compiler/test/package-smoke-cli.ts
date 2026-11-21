import { run, repositoryRoot, motorProject } from "./package-smoke-support.js";
import { expect } from "vitest";
import { join } from "node:path";
import { motorDiagnostics } from "../../cli/test/motor-starter-diagnostics.js";
import type { ApiResult } from "./package-smoke-support.js";
import { formatHumanDiagnostics } from "../../cli/src/index.js";
import { readFile } from "node:fs/promises";
import { embedPrintableFont } from "../../cli/src/printable-font.js";

export async function assertCompileAndInspect(
  consumerDirectory: string,
  installedCli: string,
) {
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
    diagnostics: motorDiagnostics,
    error: null,
  });
}

export async function assertRawRender(
  consumerDirectory: string,
  installedCli: string,
  apiResult: ApiResult,
) {
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
    expect(rawRender).toEqual({
      stdout: expected.svg,
      stderr: `${formatHumanDiagnostics(motorDiagnostics)}\n`,
    });
  }
}

export async function assertJsonRender(
  consumerDirectory: string,
  installedCli: string,
  apiResult: ApiResult,
) {
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
    diagnostics: motorDiagnostics,
    error: null,
  });
}

export async function assertFileRender(
  consumerDirectory: string,
  installedCli: string,
  apiResult: ApiResult,
) {
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
    diagnostics: motorDiagnostics,
    error: null,
  });

  expect(await readFile(join(consumerDirectory, output), "utf8")).toBe(
    embedPrintableFont(apiResult.power.svg),
  );
}

export async function assertRawViews(
  consumerDirectory: string,
  installedCli: string,
  apiResult: ApiResult,
) {
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
    expect(rawView).toEqual({
      stdout: expected.svg,
      stderr: `${formatHumanDiagnostics(motorDiagnostics)}\n`,
    });
  }
}

export async function assertJsonView(
  consumerDirectory: string,
  installedCli: string,
  apiResult: ApiResult,
) {
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
    diagnostics: motorDiagnostics,
    error: null,
  });
}

export async function assertFileView(
  consumerDirectory: string,
  installedCli: string,
  apiResult: ApiResult,
) {
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
    diagnostics: motorDiagnostics,
    error: null,
  });

  expect(await readFile(join(consumerDirectory, viewOutput), "utf8")).toBe(
    embedPrintableFont(apiResult.loads.svg),
  );
}
