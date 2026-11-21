import * as validation from "../src/layout/validate-output.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { beforeAll, expect, it, vi } from "vitest";
import { errorContractCases } from "./render-contract-fixture.js";
import { createSchematicRendererWithDependencies } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import type { SchematicViewRequest } from "../src/types.js";
import type { SchematicPacketRequest } from "../src/sheets.js";
// Every public dev 38720de error field, excluding its improvable message.
const devFields = {
  R001: {
    code: "R001",
    requestedFormat: {
      kind: "string",
      value: "schematic-view-request/0.2",
    },
    requestedRoot: {
      kind: "selector",
      by: "designation",
      value: "LS1",
    },
    requestedFamily: {
      kind: "missing",
    },
    requestedIntent: {
      kind: "intent",
      value: "trace",
    },
    requestedTarget: {
      kind: "selector",
      by: "designation",
      value: "PLC1",
    },
    requestedIncludePower: {
      kind: "boolean",
      value: false,
    },
    requestedFlow: {
      kind: "missing",
    },
    family: "control",
    deviceUid: "596f728b-1445-4c4b-8974-a3b4ea703636",
    root: "LS1",
  },
  R002: {
    code: "R002",
    family: "power",
    deviceUid: "33a15867-296b-40e4-a56b-15282f131b4c",
    lane: "line",
    root: "PS1",
  },
  R003: {
    code: "R003",
    family: "control",
    deviceUid: "10418711-330f-4482-8dab-a274923215cb",
    typeId: "core:terminal-block-8",
    root: "LS1",
  },
  R004: {
    code: "R004",
    family: "control",
    netId:
      "net:sha256:964f1ca4464e126ffaf786a4a0b742258aece22d18e88bd1246af5b630abae4f",
    root: "PS1",
  },
  R005: {
    code: "R005",
    family: "control",
    ownerKind: "project",
    ownerId: "project",
    field: "title.project-line",
    reason: "xml-illegal-code-point",
    root: "K1",
  },
  R006: {
    code: "R006",
    root: "packet",
    reason: "unprintable-layout",
  },
} as const;
let cases: Awaited<ReturnType<typeof errorContractCases>>;
beforeAll(async () => {
  cases = await errorContractCases();
});
it.each(["R001", "R002", "R003", "R004", "R005", "R006"] as const)(
  "preserves every existing dev field for %s",
  async (code) => {
    const c = cases.find((c) => c.code === code)!;
    // Machine-demo now draws. Retain this field contract under an injected
    // validator refusal, alongside the real geometric negative cases.
    const refusal =
      code === "R004"
        ? vi.spyOn(validation, "normalizeAndValidateLayout").mockReturnValue({
            ok: false,
            failureKind: "contract-violation",
            error: {
              ...devFields.R004,
              message: "Invalid layout: forced contract refusal.",
            },
          })
        : undefined;
    const engine = createElkEngine();
    if (refusal) engine.layout = async (graph) => graph;
    const result =
      "packet" in c
        ? await renderSchematicPacket(c.ir, c.packet as SchematicPacketRequest)
        : await createSchematicRendererWithDependencies(
            refusal ? { layoutEngine: engine } : {},
          ).render(c.ir, c.view as SchematicViewRequest);
    refusal?.mockRestore();
    expect(result).toMatchObject({ ok: false, error: devFields[code] });
    if (result.ok) return;
    if (code === "R001")
      expect(result.error).toMatchObject({
        targetDeviceUid: expect.any(String),
        unsupported: {
          designation: "PLC1",
          typeId: "core:plc-compact",
          functionKey: "di0",
          family: "control",
        },
        details: {
          targetDesignation: "PLC1",
          reason: "unsupported-symbol-profile",
        },
      });
    if (code === "R001") {
      expect(result.error).not.toHaveProperty("typeId");
      expect(result.error).not.toHaveProperty("functionKey");
    }
    if (code === "R006")
      expect(result.error).toMatchObject({
        details: {
          reason: "unsupported-symbol-profile",
          functionKey: "supply",
          cause: expect.stringContaining("supply_return"),
          view: { viewIndex: 0, title: "Sensor" },
        },
      });
  },
);
