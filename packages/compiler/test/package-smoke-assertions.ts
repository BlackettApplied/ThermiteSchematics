import type { ApiResult } from "./package-smoke-support.js";
import { expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { rendererGoldenRoot } from "./package-smoke-support.js";

export function assertRuntimeApi(apiResult: ApiResult) {
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
      "describeCodePoint",
      "normalizePaperPage",
      "printPacketHtml",
      "renderSchematic",
      "renderSchematicPacket",
      "renderSchematicSheets",
      "supportsGlyph",
      "unshapedPrintableFont",
    ],
    rendererVersion: "render/0.3",
    symbolCatalogVersion: "ais-symbols/0.3",
    layoutConfigVersion: "elk-layered/0.4+elkjs-0.12.0",
    agentToolsRuntimeExports: [
      "AGENT_REQUEST_VOCABULARY",
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
}

export function assertViewContracts(apiResult: ApiResult) {
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
}

export async function assertGoldenSvgs(apiResult: ApiResult) {
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
      join(rendererGoldenRoot, "ls1-to-plc1-include-power-left-to-right.svg"),
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
}
