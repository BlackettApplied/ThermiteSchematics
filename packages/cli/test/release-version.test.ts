import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { THERMITE_RELEASE_VERSION } from "@thermite/schema";
import { THERMITE_VERSION as EXPORT_INPUT_VERSION } from "../src/alpha-export-input.js";
import { THERMITE_VERSION as ALPHA_CLI_VERSION } from "../src/alpha.js";
import { CLI_VERSION } from "../src/version.js";
import { THERMITE_SCHEMATICS_PRODUCT_VERSION } from "../../render/src/product-version.js";
import { renderTitleFrameBenchmark } from "../../render/src/internal/title-data/entry.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const RENDER_STAMP_FILES = [
  "packages/render/src/packet/frame-compact.ts",
  "packages/render/src/packet/page.ts",
  "packages/render/src/packet/circuit-title.ts",
  "packages/render/src/packet/reports.ts",
  "packages/render/src/packet/topology.ts",
] as const;

describe("release version single source of truth", () => {
  it("keeps CLI, packaging scripts, and renderer stamps aligned on THERMITE_RELEASE_VERSION", async () => {
    expect(THERMITE_RELEASE_VERSION).toMatch(
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
    );
    expect(EXPORT_INPUT_VERSION).toBe(THERMITE_RELEASE_VERSION);
    expect(ALPHA_CLI_VERSION).toBe(THERMITE_RELEASE_VERSION);
    expect(CLI_VERSION).toBe("0.2.0");
    expect(THERMITE_SCHEMATICS_PRODUCT_VERSION).toBe("0.2.0");

    const packAlpha = await readFile(
      join(repoRoot, "scripts/pack-alpha.mjs"),
      "utf8",
    );
    expect(packAlpha).toContain(
      'import { THERMITE_RELEASE_VERSION as version } from "../packages/schema/src/release-version.ts";',
    );
    expect(packAlpha).not.toMatch(/const\s+version\s*=\s*["']/u);

    const runtimePack = await readFile(
      join(repoRoot, "scripts/runtime-package/pack.mjs"),
      "utf8",
    );
    expect(runtimePack).toContain("THERMITE_VERSION");

    for (const rel of RENDER_STAMP_FILES) {
      const source = await readFile(join(repoRoot, rel), "utf8");
      expect(source, rel).toContain("THERMITE_RELEASE_VERSION");
      expect(source, rel).not.toMatch(/\b\d+\.\d+\.\d+-alpha\.\d+\b/u);
    }
  });

  it("prints THERMITE_RELEASE_VERSION in standard and compact sheet stamps", async () => {
    const compiled = await compileProject(
      join(repoRoot, "examples/motor-starter"),
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    const request = {
      format: "schematic-packet-request/0.1" as const,
      index: false,
      views: [
        {
          format: "documentation-view-request/0.1" as const,
          kind: "bom" as const,
        },
      ],
    };

    const legacy = await renderSchematicPacket(compiled.ir, request);
    if (!legacy.ok) throw new Error(JSON.stringify(legacy.error));
    const legacySvg = legacy.value.sheets[0]?.svg ?? "";
    expect(legacySvg).toContain(`>Thermite ${THERMITE_RELEASE_VERSION}</text>`);

    for (const generatorStamp of ["border", "title", "metadata"] as const) {
      const compact = await renderTitleFrameBenchmark(
        compiled.ir,
        {
          format: "schematic-packet-request/0.2",
          views: request.views,
        },
        {
          format: "project-presentation/0.3",
          frame: { generatorStamp },
        },
      );
      if (!compact.ok) throw new Error(JSON.stringify(compact.error));
      const svg = compact.value.sheets[0]?.svg ?? "";
      expect(svg).toContain(
        `<metadata>Generator: Thermite Schematics ${THERMITE_RELEASE_VERSION}</metadata>`,
      );
      expect(svg.includes(`>Thermite ${THERMITE_RELEASE_VERSION}</text>`)).toBe(
        generatorStamp === "border",
      );
      expect(
        svg.includes(`Tool: Thermite Schematics ${THERMITE_RELEASE_VERSION}`),
      ).toBe(generatorStamp === "title");
    }
  });
});
