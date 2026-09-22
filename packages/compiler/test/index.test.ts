import { describe, expect, it } from "vitest";

import * as compiler from "../src/index.js";

describe("compiler public API", () => {
  it("exports the compiler, serializer, stage, loader, and lock APIs", () => {
    expect(Object.keys(compiler)).toEqual([
      "SHIPPED_CORE_DISPLAY_ROOT",
      "SHIPPED_CORE_FILE_INVENTORY",
      "SHIPPED_CORE_LIBRARY_LOCATOR",
      "SHIPPED_CORE_LIBRARY_NAME",
      "SHIPPED_CORE_LIBRARY_VERSION",
      "SHIPPED_CORE_PACKAGE_NAME",
      "resolveShippedCoreLibrary",
      "compileLoadedProject",
      "compileProject",
      "expandResolvedProject",
      "normalizeProjectGraph",
      "assembleElectricalIr",
      "compareConductiveElementId",
      "compareSourceRef",
      "serializeIr",
      "deriveProjectNets",
      "evaluateRules",
      "loadProject",
      "writeFileAtomically",
      "LIBRARY_LOCK_FILE_NAME",
      "LIBRARY_LOCK_SCHEMA_ID",
      "computeFileIntegrity",
      "computeLibraryIntegrity",
      "generateLibraryLock",
      "lockProject",
      "serializeLibraryLock",
      "verifyLibraryLock",
      "writeLibraryLock",
      "buildProjectCatalogs",
      "resolveLoadedProject",
      "analyzeCompleteness",
    ]);
    expect(compiler.loadProject).toBeTypeOf("function");
    expect(compiler.compileLoadedProject).toBeTypeOf("function");
    expect(compiler.compileProject).toBeTypeOf("function");
    expect(compiler.serializeIr).toBeTypeOf("function");
    expect(compiler.expandResolvedProject).toBeTypeOf("function");
    expect(compiler.normalizeProjectGraph).toBeTypeOf("function");
    expect(compiler.deriveProjectNets).toBeTypeOf("function");
    expect(compiler.evaluateRules).toBeTypeOf("function");
    expect(compiler.verifyLibraryLock).toBeTypeOf("function");
    expect(compiler.resolveLoadedProject).toBeTypeOf("function");
    expect(compiler.resolveShippedCoreLibrary).toBeTypeOf("function");
  });

  it("regenerates the exact motor-starter presentation authorities through the product path", async () => {
    const { updateMotorStarterPresentation } =
      await import("../../../scripts/update-motor-starter-presentation.mjs");
    await expect(
      updateMotorStarterPresentation("--check"),
    ).resolves.toBeUndefined();

    const loaded = await compiler.loadProject(
      "examples/motor-starter",
      process.cwd(),
    );
    if (!loaded.ok) {
      throw new Error(JSON.stringify(loaded.diagnostics));
    }
    expect(loaded.project.presentation).toMatchObject({
      file: "presentation.json",
      kind: "project_presentation",
      value: {
        format: "project-presentation/0.1",
        revision: "A",
        backgroundColor: "#ffffff",
        titleBlock: { lines: ["Motor starter reference"] },
      },
    });
    const compiled = await compiler.compileProject(
      "examples/motor-starter",
      process.cwd(),
    );
    if (!compiled.ok) {
      throw new Error(JSON.stringify(compiled.diagnostics));
    }
    expect(compiled.presentation).toEqual({
      format: "project-presentation/0.1",
      revision: "A",
      backgroundColor: "#ffffff",
      titleBlockLines: ["Motor starter reference"],
    });
    expect(compiled.ir.libraries[0]?.source).toEqual({
      file: "system.json",
      line: 14,
      column: 17,
      jsonPointer: "/libraries/0",
    });
  });
});
