import { createHash } from "node:crypto";
import { execFile as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditTitleDataSurface } from "./title-data-surface.js";
import * as schemaApi from "@thermite/schema";
import * as renderApi from "@thermite/render";
import { compileProject } from "@thermite/compiler";
import { createAgentTools } from "@thermite/agent-tools";
import { initializeAlphaProject } from "../src/alpha-init.js";
import {
  assertProjectGuideBudget,
  PROJECT_GUIDE_BYTE_LIMIT,
} from "../src/project-guide-budget.js";
const execFile = promisify(execCallback);
const cli = resolve("packages/cli/dist/thermite-bin.js");
let root: string, project: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "thermite-tb2-"));
  project = join(root, "synthetic-project");
  await initializeAlphaProject(project);
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const sha = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
async function run(args: string[]) {
  try {
    const result = await execFile(process.execPath, [cli, ...args]);
    return { ...result, code: 0 };
  } catch (error) {
    const result = error as { stdout: string; stderr: string; code: number };
    return result;
  }
}
const invalidFrames = [
  [
    { zones: { default: { columns: 5, rows: 4 } } },
    "E014",
    "/frame/zones/default/columns",
  ],
  [
    { zones: { default: { columns: 6, rows: 5 } } },
    "E014",
    "/frame/zones/default/rows",
  ],
  [{ profile: "extended" }, "E012", "/frame/profile"],
  [{ header: null }, "E011", "/frame/header"],
  [{ logo: "x" }, "E012", "/frame/logo"],
  [
    { zones: { byPaper: { a3: { landscape: { columns: 7, rows: 4 } } } } },
    "E014",
    "/frame/zones/byPaper/a3/landscape/columns",
  ],
] as const;
function validate(value: schemaApi.JsonValue) {
  return schemaApi
    .createInMemoryCanonicalSchemaRegistry()
    .validateEntity("project-presentation", value, {
      file: "presentation.json",
      nodes: new Map(),
    });
}
describe("TB2 atomic compact publication", () => {
  it("preserves every original guide byte and appends the approved snippet within budget", async () => {
    // Historical TB2b publication input from 654bfc6, not the evolving live guide.
    const guide = await readFile(
      "packages/cli/test/fixtures/guide-tb2-publication.md.txt",
    );
    expect(sha(guide.subarray(0, 19637))).toBe(
      "45a85b42a2804522fabfd59787aab0b825ac0c7e5c9feb0f3aeb575ebb676c49",
    );
    expect(guide.subarray(19637)).toEqual(
      await readFile(
        "packages/cli/test/fixtures/title-frame-guide-addition.txt",
      ),
    );
    const liveGuide = await readFile("packages/cli/assets/THERMITE_AGENTS.md");
    expect(liveGuide.length).toBeLessThanOrEqual(8000);
    expect(PROJECT_GUIDE_BYTE_LIMIT).toBe(8000);
    expect(() => assertProjectGuideBudget("a".repeat(8000))).not.toThrow();
    expect(() => assertProjectGuideBudget("a".repeat(8001))).toThrow(/8001/);
    expect(() => assertProjectGuideBudget("é".repeat(4001))).toThrow(/8002/);
  });
  it("keeps private functions out of root APIs and audits the released graph", async () => {
    for (const api of [schemaApi, renderApi])
      expect(
        Object.keys(api).filter((k) =>
          /InternalPresentation|InternalPacket|parsePresentationStructure|presentationSchema|resolveTitles|sheetKey|titleDataSchema|presentationSettings|renderTitleFrameBenchmark/.test(
            k,
          ),
        ),
      ).toEqual([]);
    const files = new Map<string, string>();
    for (const pkg of [
      "schema",
      "render",
      "compiler",
      "query",
      "cli",
      "agent-tools",
    ]) {
      const base = `packages/${pkg}/src`;
      for (const path of (await readdir(base, { recursive: true })).filter(
        (p) => p.endsWith(".ts"),
      ))
        files.set(
          schemaApi.normalizeDiagnosticFile(join(base, path)),
          await readFile(join(base, path), "utf8"),
        );
    }
    expect(auditTitleDataSurface(files, true)).toEqual([]);
    for (const [file, text] of files)
      if (file.startsWith("packages/render/src/internal/title-data/"))
        expect(text).not.toMatch(/(?:\.\.\/)+schema\/dist\//);
    const parseUrl = new URL(
      "../../render/dist/internal/title-data/parse.js",
      import.meta.url,
    ).href;
    const node = await execFile(
      "node",
      [
        "--input-type=module",
        "-e",
        `const {parseInternalPresentation}=await import(${JSON.stringify(parseUrl)});if(!parseInternalPresentation('{"format":"project-presentation/0.3"}').value)process.exit(1);`,
      ],
      { cwd: tmpdir() },
    );
    expect(node.stderr).toBe("");
  });
  it("accepts only compact 6 by 4 and retains the legacy diagnostic branch", () => {
    expect(
      validate({
        format: "project-presentation/0.3",
        frame: { zones: { default: { columns: 6, rows: 4 } } },
        titleBlock: { profile: "compact" },
      }),
    ).toEqual([]);
    expect(
      validate({
        format: "project-presentation/0.2",
        revision: "A",
        backgroundColor: "#ffffff",
        frame: { zones: { default: { columns: 6, rows: 4 } } },
      }).map(({ code, jsonPointer }) => ({ code, jsonPointer })),
    ).toEqual([{ code: "E012", jsonPointer: "/frame" }]);
  });
  it.each(invalidFrames)(
    "rejects invalid compact furniture %j",
    (frame, code, jsonPointer) => {
      expect(
        validate({ format: "project-presentation/0.3", frame }).map((d) => ({
          code: d.code,
          jsonPointer: d.jsonPointer,
        })),
      ).toEqual([{ code, jsonPointer }]);
    },
  );
  it("publishes schema, packet help and drawing-frame topic together", async () => {
    const help = await run(["packet", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("schematic-packet-request/0.2");
    const schema = await run(["guide", "schema", "project-presentation"]);
    expect(schema.code).toBe(0);
    expect(schema.stdout).toContain("project-presentation/0.3");
    const topics = await run(["guide", "--json"]);
    expect(topics.code).toBe(0);
    expect(topics.stdout).toContain("drawing-frames");
    const doc = await run(["guide", "drawing-frames"]);
    expect(doc.code).toBe(0);
    expect(doc.stdout).toContain("UNSPECIFIED");
    expect(doc.stdout).toContain(
      "Presentation validation can take two passes. If `format` is missing or unknown,",
    );
  });
  it("keeps init on 0.2 and wires compiled 0.3 through CLI, agent and public rendering", async () => {
    const file = join(project, "presentation.json"),
      original = await readFile(file);
    expect(JSON.parse(original.toString()).format).toBe(
      "project-presentation/0.2",
    );
    try {
      await writeFile(
        file,
        JSON.stringify({ format: "project-presentation/0.3" }),
      );
      const compiled = await compileProject(project);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.presentation.compactFrame).toEqual({
        format: "project-presentation/0.3",
      });
      expect(Object.isFrozen(compiled.presentation.compactFrame)).toBe(true);
      expect(
        (
          await createAgentTools().validate({
            format: "agent-tool-request/0.1",
            project,
          })
        ).ok,
      ).toBe(true);
      expect((await run(["validate", project, "--json"])).code).toBe(0);
      const request = {
        format: "schematic-packet-request/0.2" as const,
        views: [
          {
            format: "documentation-view-request/0.1" as const,
            kind: "bom" as const,
          },
        ],
        titleData: {
          defaults: { revision: "CURRENT", values: { drawnBy: "D" } },
        },
      };
      const presentationOnly = await renderApi.renderSchematicPacket(
        compiled.ir,
        { format: "schematic-packet-request/0.1", views: request.views },
        compiled.presentation,
      );
      expect(presentationOnly.ok).toBe(true);
      if (presentationOnly.ok)
        expect(presentationOnly.value.presentationFormat).toBe(
          "project-presentation/0.3",
        );
      const result = await renderApi.renderSchematicPacket(
        compiled.ir,
        request,
        compiled.presentation,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.presentationFormat).toBe("project-presentation/0.3");
      expect(result.value.sheets[0]?.svg).toContain(">D</text>");
      expect(result.value.sheets[0]?.svg).toContain(">CURRENT</text>");
      const input = join(root, "packet.json"),
        output = join(root, "packet.svg");
      await writeFile(input, JSON.stringify(request));
      const rendered = await run([
        "packet",
        "--project",
        project,
        "--input",
        input,
        "--output",
        output,
      ]);
      expect(rendered.code).toBe(0);
      expect(await readFile(output, "utf8")).toContain(">CURRENT</text>");
    } finally {
      await writeFile(file, original);
    }
  });
  it("pins the accepted format diagnostic exactly", () => {
    expect(validate({ format: "bad" })).toEqual([
      {
        code: "E014",
        severity: "error",
        message:
          'Expected "format" to be one of: ["project-presentation/0.1", "project-presentation/0.2", "project-presentation/0.3"].',
        file: "presentation.json",
        line: 1,
        column: 1,
        jsonPointer: "/format",
        allowed: [
          "project-presentation/0.1",
          "project-presentation/0.2",
          "project-presentation/0.3",
        ],
        allowedCount: 3,
      },
    ]);
  });
  it("pins compact field codes and the public diagnostic shape", () => {
    const diagnostics = validate({
      format: "project-presentation/0.3",
      titleBlock: {
        fields: { drawnBy: { slot: "drawnBy", value: "bad\u200btext" } },
      },
    });
    expect(
      diagnostics.map((d) => ({ code: d.code, jsonPointer: d.jsonPointer })),
    ).toEqual([
      { code: "E010", jsonPointer: "/titleBlock/fields/drawnBy/label" },
      { code: "E013", jsonPointer: "/titleBlock/fields/drawnBy/value" },
    ]);
    const diagnosticSchema = JSON.parse(requireDiagnosticSchema);
    // The public schema accepts compiler diagnostics, never internal ownership extras.
    expect(diagnosticSchema.additionalProperties).toBe(false);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.code).toMatch(/^[EIW][0-9]{3}$/);
    }
    for (const diagnostic of diagnostics)
      for (const key of Object.keys(diagnostic))
        expect(Object.keys(diagnosticSchema.properties)).toContain(key);
  });
});
// Read once without adding a production schema dependency to the audit helper.
const requireDiagnosticSchema = await readFile(
  "packages/schema/schemas/diagnostic.schema.json",
  "utf8",
);

it("enforces the compact raw-file byte cap and retains presentation glyph locations", async () => {
  const file = join(project, "presentation.json"),
    original = await readFile(file);
  try {
    const text =
      '{\n"format":"project-presentation/0.3",\n"titleBlock":{"fields":{"drawnBy":{"slot":"drawnBy","label":"Drawn by","value":"😀"}}}\n}';
    await writeFile(file, text);
    const compiled = await compileProject(project);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const result = await renderApi.renderSchematicPacket(
      compiled.ir,
      {
        format: "schematic-packet-request/0.2",
        views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
      },
      compiled.presentation,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.details?.titleDiagnostics).toEqual([
        expect.objectContaining({
          code: "R005",
          file: expect.stringContaining("presentation.json"),
          line: 3,
          jsonPointer: "/titleBlock/fields/drawnBy/value",
        }),
      ]);
    const raw = JSON.stringify({ format: "project-presentation/0.3" });
    await writeFile(file, raw + " ".repeat(65536 - Buffer.byteLength(raw)));
    expect((await compileProject(project)).ok).toBe(true);
    await writeFile(file, raw + " ".repeat(65537 - Buffer.byteLength(raw)));
    const large = await compileProject(project);
    expect(large.ok).toBe(false);
    expect(large.diagnostics).toEqual([
      expect.objectContaining({
        code: "E015",
        jsonPointer: "",
        message: "Presentation exceeds 64 KiB.",
      }),
      expect.objectContaining({ code: "I208", jsonPointer: "" }),
    ]);
  } finally {
    await writeFile(file, original);
  }
});
it("enforces compact normalized values at the exact byte bound", () => {
  const registry = schemaApi.createInMemoryCanonicalSchemaRegistry();
  const base = { format: "project-presentation/0.3", $schema: "" },
    padding = 65536 - Buffer.byteLength(JSON.stringify(base));
  for (const [extra, ok] of [
    [0, true],
    [1, false],
  ] as const) {
    const diagnostics = registry.validateEntity(
      "project-presentation",
      { ...base, $schema: "a".repeat(padding + extra) },
      { file: "presentation.json", nodes: new Map() },
    );
    expect(diagnostics.length === 0).toBe(ok);
    expect(
      diagnostics.map((d) => ({ code: d.code, jsonPointer: d.jsonPointer })),
    ).toEqual(ok ? [] : [{ code: "E015", jsonPointer: "" }]);
  }
});

it.each(["project-presentation/0.1", "project-presentation/0.2"])(
  "compiles %s above 64 KiB without applying the compact cap",
  async (format) => {
    const file = join(project, "presentation.json"),
      original = await readFile(file);
    try {
      const raw = JSON.stringify({
        format,
        revision: "A",
        backgroundColor: "#ffffff",
      });
      const padded = raw + " ".repeat(65537 - Buffer.byteLength(raw));
      expect(Buffer.byteLength(padded)).toBe(65537);
      await writeFile(file, padded);
      const compiled = await compileProject(project);
      expect(compiled.ok).toBe(true);
      expect(
        compiled.diagnostics.filter((d) => d.severity === "error"),
      ).toEqual([]);
    } finally {
      await writeFile(file, original);
    }
  },
);
