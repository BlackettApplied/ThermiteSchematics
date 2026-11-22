import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { THERMITE_RELEASE_VERSION } from "@thermite/schema";
import { THERMITE_VERSION as EXPORT_INPUT_VERSION } from "../src/alpha-export-input.js";
import { THERMITE_VERSION as ALPHA_CLI_VERSION } from "../src/alpha.js";
import { CLI_VERSION } from "../src/version.js";
import { THERMITE_SCHEMATICS_PRODUCT_VERSION } from "../../render/src/product-version.js";
import { renderTitleFrameBenchmark } from "../../render/src/internal/title-data/entry.js";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { sourceArchiveDescriptor } from "../../../scripts/pack-alpha.mjs";
import { runtimeFilename } from "../../../scripts/runtime-package/common.mjs";
import { buildRuntimeManifest } from "../../../scripts/runtime-package/pack.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const RENDER_STAMP_FILES = [
  "packages/render/src/packet/frame-compact.ts",
  "packages/render/src/packet/page.ts",
  "packages/render/src/packet/circuit-title.ts",
  "packages/render/src/packet/reports.ts",
  "packages/render/src/packet/topology.ts",
] as const;

const STAMP_PROBE_VIEWS = [
  {
    format: "documentation-view-request/0.1" as const,
    kind: "bom" as const,
  },
  {
    format: "circuit-view-request/0.1" as const,
    title: "Motor control",
    groups: [
      {
        id: "motor-control",
        lineReference: "200",
        label: "Contactor command and interlocks",
        functions: [
          { device: { by: "designation" as const, value: "PLC1" }, key: "do0" },
          {
            device: { by: "designation" as const, value: "PB1" },
            key: "contact11",
          },
          {
            device: { by: "designation" as const, value: "OL1" },
            key: "aux95",
          },
          { device: { by: "designation" as const, value: "K1" }, key: "coil" },
        ],
        conductors: ["W-CTL-005", "W-CTL-006", "W-CTL-007", "W-CTL-008"],
      },
    ],
  },
  {
    format: "wiring-view-request/0.1" as const,
    title: "Control wiring",
    conductors: ["W-CTL-005"],
  },
];

describe("release version single source of truth", () => {
  it("keeps CLI, packaging outputs, and renderer sources aligned on THERMITE_RELEASE_VERSION", async () => {
    expect(THERMITE_RELEASE_VERSION).toMatch(
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
    );
    expect(EXPORT_INPUT_VERSION).toBe(THERMITE_RELEASE_VERSION);
    expect(ALPHA_CLI_VERSION).toBe(THERMITE_RELEASE_VERSION);
    expect(CLI_VERSION).toBe("0.2.0");
    expect(THERMITE_SCHEMATICS_PRODUCT_VERSION).toBe("0.2.0");

    const sampleCommit = "a".repeat(40);
    const sampleDigest = "b".repeat(64);
    const runtimeManifest = await buildRuntimeManifest({
      sourceRoot: repoRoot,
      commit: sampleCommit,
      sourceDigest: sampleDigest,
      preview: false,
      target: "linux-x64",
      dependencies: [],
      files: [],
    });
    expect(runtimeManifest.version).toBe(THERMITE_RELEASE_VERSION);
    expect(runtimeFilename(runtimeManifest)).toBe(
      `thermite-${THERMITE_RELEASE_VERSION}-linux-x64-bun-${sampleCommit.slice(0, 8)}.zip`,
    );

    const sourceArchive = sourceArchiveDescriptor(sampleCommit, sampleDigest);
    const expectedSourceFilename = `thermite-${THERMITE_RELEASE_VERSION}-source-${sampleCommit.slice(0, 8)}.zip`;
    expect(sourceArchive.filename).toBe(expectedSourceFilename);
    expect(sourceArchive.prefix).toBe(`thermite-${THERMITE_RELEASE_VERSION}/`);
    expect(sourceArchive.manifest.version).toBe(THERMITE_RELEASE_VERSION);
    expect(sourceArchive.manifest.archive).toBe(expectedSourceFilename);

    for (const rel of RENDER_STAMP_FILES) {
      const source = await readFile(join(repoRoot, rel), "utf8");
      expect(source, rel).toContain("THERMITE_RELEASE_VERSION");
      expect(source, rel).not.toMatch(/\b\d+\.\d+\.\d+-alpha\.\d+\b/u);
    }
  });

  it("prints THERMITE_RELEASE_VERSION on BOM, circuit, and topology sheets in standard and compact frames", async () => {
    const compiled = await compileProject(
      join(repoRoot, "examples/motor-starter"),
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    const legacy = await renderSchematicPacket(compiled.ir, {
      format: "schematic-packet-request/0.1",
      index: false,
      views: STAMP_PROBE_VIEWS,
    });
    if (!legacy.ok) throw new Error(JSON.stringify(legacy.error));
    const legacyKinds = legacy.value.sheets.map((sheet) =>
      sheet.view.format === "documentation-view/0.1"
        ? sheet.view.kind
        : sheet.view.format,
    );
    expect(legacyKinds).toEqual(
      expect.arrayContaining(["bom", "circuit", "wiring"]),
    );
    for (const sheet of legacy.value.sheets) {
      expect(sheet.svg).toContain(
        `>Thermite ${THERMITE_RELEASE_VERSION}</text>`,
      );
    }

    for (const generatorStamp of ["border", "title", "metadata"] as const) {
      const compact = await renderTitleFrameBenchmark(
        compiled.ir,
        {
          format: "schematic-packet-request/0.2",
          views: STAMP_PROBE_VIEWS,
        },
        {
          format: "project-presentation/0.3",
          frame: { generatorStamp },
        },
      );
      if (!compact.ok) throw new Error(JSON.stringify(compact.error));
      const compactKinds = compact.value.sheets.map((sheet) =>
        sheet.view.format === "documentation-view/0.1"
          ? sheet.view.kind
          : sheet.view.format,
      );
      expect(compactKinds).toEqual(
        expect.arrayContaining(["bom", "circuit", "wiring"]),
      );
      for (const sheet of compact.value.sheets) {
        expect(sheet.svg).toContain(
          `<metadata>Generator: Thermite Schematics ${THERMITE_RELEASE_VERSION}</metadata>`,
        );
        expect(
          sheet.svg.includes(`>Thermite ${THERMITE_RELEASE_VERSION}</text>`),
        ).toBe(generatorStamp === "border");
        expect(
          sheet.svg.includes(
            `Tool: Thermite Schematics ${THERMITE_RELEASE_VERSION}`,
          ),
        ).toBe(generatorStamp === "title");
      }
    }
  });
});
