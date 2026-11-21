import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  compileProject,
  computeFileIntegrity,
  loadProject,
  loadProjectForSourcePatch,
} from "@thermite/compiler";
import { describe, expect, it } from "vitest";

import { createAgentTools } from "../src/toolbox.js";
import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import type {
  ApplySourcePatchRequest,
  SourcePatchOperation,
} from "../src/source-patch-request.js";
import {
  createPatchProjectFixture,
  type PatchProjectFixture,
} from "./patch-project-fixture.js";

const file = "sources/objects.json";
const uid = "abcd0000-0000-4000-8000-000000000001";

async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await readdir(root, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )) {
    if (entry.isDirectory()) {
      for (const [path, hash] of Object.entries(
        await tree(join(root, entry.name)),
      ))
        result[`${entry.name}/${path}`] = hash;
    } else
      result[entry.name] = computeFileIntegrity(
        await readFile(join(root, entry.name)),
      );
  }
  return result;
}

async function brokenProject(extra: boolean, uppercase: boolean) {
  const fixture = await createPatchProjectFixture("repair");
  const path = join(fixture.projectRoot, file);
  const source = JSON.parse(await readFile(path, "utf8"));
  source.objects.pop(); // Remove the synthetic E201 so schema repair must compile cleanly.
  source.objects[0].uid = uppercase ? uid.toUpperCase() : uid;
  if (extra) source.objects[0].unexpected = true;
  await writeFile(path, `${JSON.stringify(source, null, 2)}\n`);
  return fixture;
}

async function request(
  fixture: PatchProjectFixture,
  operations: readonly SourcePatchOperation[],
): Promise<ApplySourcePatchRequest> {
  return {
    format: "agent-tool-request/0.1",
    project: fixture.projectRoot,
    patchFormat: "json-patch/0.1",
    dryRun: true,
    files: [
      {
        path: file,
        expectedIntegrity: computeFileIntegrity(
          await readFile(join(fixture.projectRoot, file)),
        ),
        operations,
      },
    ],
  };
}

function repairs(extra: boolean, uppercase: boolean): SourcePatchOperation[] {
  return [
    {
      op: "test",
      path: "/objects/0/uid",
      value: uppercase ? uid.toUpperCase() : uid,
    },
    ...(extra
      ? [{ op: "remove" as const, path: "/objects/0/unexpected" }]
      : []),
    ...(uppercase
      ? [{ op: "replace" as const, path: "/objects/0/uid", value: uid }]
      : []),
  ];
}

describe("guarded schema repair", () => {
  it("exposes raw snapshots only to opted-in patch callers", async () => {
    const fixture = await brokenProject(true, false);
    try {
      const normal = await loadProject(fixture.projectRoot);
      expect(normal).toMatchObject({ ok: false });
      expect(normal).not.toHaveProperty("sourcePatchProject");
      expect(await compileProject(fixture.projectRoot)).not.toHaveProperty(
        "sourcePatchProject",
      );
      // Unknown options cannot turn the public compiler/loader into a patch loader.
      const obsoleteOptions = { captureSourcePatchSnapshot: true };
      expect(
        await compileProject(
          fixture.projectRoot,
          fixture.root,
          obsoleteOptions as never,
        ),
      ).not.toHaveProperty("sourcePatchProject");
      expect(
        await loadProject(
          fixture.projectRoot,
          fixture.root,
          obsoleteOptions as never,
        ),
      ).not.toHaveProperty("sourcePatchProject");
      const repair = await loadProjectForSourcePatch(
        fixture.projectRoot,
        fixture.root,
      );
      expect(repair).toMatchObject({
        ok: false,
        sourcePatchProject: {
          sources: [
            {
              file,
              value: {
                objects: [
                  expect.objectContaining({ uid, unexpected: true }),
                  expect.anything(),
                  expect.anything(),
                  expect.anything(),
                ],
              },
            },
          ],
        },
      });
      await writeFile(
        join(fixture.projectRoot, "system.json"),
        '{"format":"electrical-system/0.1","sources":42}',
      );
      expect(
        await loadProjectForSourcePatch(fixture.projectRoot, fixture.root),
      ).not.toHaveProperty("sourcePatchProject");
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    ["E012", true, false],
    ["E013", false, true],
    ["E012 and E013", true, true],
  ] as const)(
    "dry-runs and applies %s using raw JSON, a byte guard and a UID test",
    async (_name, extra, uppercase) => {
      const fixture = await brokenProject(extra, uppercase);
      try {
        const original = await loadProject(fixture.projectRoot);
        expect(original.ok).toBe(false);
        expect(original.diagnostics.map((d) => d.code).sort()).toEqual([
          ...(extra ? ["E012"] : []),
          ...(uppercase ? ["E013"] : []),
        ]);
        const before = await tree(fixture.root);
        const input = await request(fixture, repairs(extra, uppercase));
        const tools = createAgentTools();
        const dry = await tools.applySourcePatch(input);
        expect(dry).toMatchObject({
          ok: true,
          value: { dryRun: true, applied: false },
        });
        expect(await tree(fixture.root)).toEqual(before);
        const applied = await tools.applySourcePatch({
          ...input,
          dryRun: false,
        });
        expect(applied).toMatchObject({
          ok: true,
          value: { dryRun: false, applied: true },
        });
        if (!dry.ok || !applied.ok) throw new Error("Expected a repair");
        expect(applied.value.files).toEqual(dry.value.files);
        const after = await tree(fixture.root);
        expect(Object.keys(after)).toEqual(Object.keys(before));
        expect(
          Object.keys(after).filter((path) => after[path] !== before[path]),
        ).toEqual([`project/${file}`]);
        expect(await compileProject(fixture.projectRoot)).toMatchObject({
          ok: true,
        });
        expect(
          await tools.validate({
            format: "agent-tool-request/0.1",
            project: fixture.projectRoot,
          }),
        ).toMatchObject({ ok: true });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each([true, false])(
    "refuses partial repairs with remaining diagnostics (dryRun=%s)",
    async (dryRun) => {
      const fixture = await brokenProject(true, true);
      try {
        const before = await tree(fixture.root);
        const input = await request(
          fixture,
          repairs(true, false).map((op) =>
            op.op === "test" ? { ...op, value: uid.toUpperCase() } : op,
          ),
        );
        const outcome = await createAgentTools().applySourcePatch({
          ...input,
          dryRun,
        });
        expect(outcome).toMatchObject({ ok: false, failureClass: "expected" });
        expect(outcome.diagnostics.map((d) => d.code)).toEqual([
          "E013",
          "I208",
        ]);
        expect(await tree(fixture.root)).toEqual(before);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("retains A004 and A002 guards on schema-invalid sources", async () => {
    const fixture = await brokenProject(true, false);
    try {
      const before = await tree(fixture.root);
      const input = await request(fixture, repairs(true, false));
      const tools = createAgentTools();
      expect(
        await tools.applySourcePatch({
          ...input,
          files: [
            {
              ...input.files[0]!,
              expectedIntegrity: computeFileIntegrity(Buffer.from("stale")),
            },
          ],
        }),
      ).toMatchObject({ ok: false, error: { code: "A004" } });
      expect(
        await tools.applySourcePatch({
          ...input,
          files: [{ ...input.files[0]!, operations: repairs(true, true) }],
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "A002", reason: "test-failed" },
      });
      expect(await tree(fixture.root)).toEqual(before);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("parser refusals and staged repair checks", () => {
  it.each(['{\n  "objects": [\n}\n', '{"objects":[],"objects":[]}\n'])(
    "refuses ambiguous or invalid JSON with A006 and parser locations",
    async (text) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        await writeFile(join(fixture.projectRoot, "sources/a.json"), text);
        const before = await tree(fixture.root);
        const parsed = await loadProject(fixture.projectRoot);
        const diagnostic = parsed.diagnostics.find(
          (d) => d.code === "E002" || d.code === "E003",
        )!;
        for (const dryRun of [true, false]) {
          const outcome = await createAgentTools().applySourcePatch({
            format: "agent-tool-request/0.1",
            project: fixture.projectRoot,
            patchFormat: "json-patch/0.1",
            dryRun,
            files: [
              {
                path: "sources/a.json",
                expectedIntegrity: before["project/sources/a.json"]!,
                operations: [{ op: "test", path: "", value: {} }],
              },
            ],
          });
          expect(outcome).toMatchObject({
            ok: false,
            failureClass: "expected",
            error: {
              code: "A006",
              file: "sources/a.json",
              line: diagnostic.line,
              column: diagnostic.column,
            },
          });
          if (outcome.ok) throw new Error("Expected parser refusal");
          expect(outcome.error?.message).toContain(
            "Cannot apply a guarded patch",
          );
          expect(outcome.error?.message).toContain(
            "thermite guide agent-requests",
          );
          expect(outcome.diagnostics).toEqual(parsed.diagnostics);
          expect(await tree(fixture.root)).toEqual(before);
        }
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("checks the entire project's staged compilation after schema repair", async () => {
    const fixture = await brokenProject(true, false);
    try {
      const input = await request(fixture, repairs(true, false));
      const source = JSON.parse(
        await readFile(join(fixture.projectRoot, file), "utf8"),
      );
      source.objects[3].uid = "abcd0000-0000-4000-8000-000000000099";
      source.objects[3].designation = "W-MISSING";
      source.objects[3].endpoints[1].device = "MISSING";
      await writeFile(
        join(fixture.projectRoot, "sources/bad.json"),
        JSON.stringify({ objects: [source.objects[3]] }),
      );
      const before = await tree(fixture.root);
      const outcome = await createAgentTools().applySourcePatch({
        ...input,
        dryRun: false,
      });
      expect(outcome).toMatchObject({ ok: false, failureClass: "expected" });
      expect(outcome.diagnostics.some((d) => d.code === "E101")).toBe(true);
      expect(outcome.diagnostics.some((d) => d.code === "E012")).toBe(false);
      expect(await tree(fixture.root)).toEqual(before);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses a concurrent edit while reloading a schema-invalid source", async () => {
    const fixture = await brokenProject(true, false);
    try {
      const input = await request(fixture, repairs(true, false));
      const path = join(fixture.projectRoot, file);
      const changed = `${await readFile(path, "utf8")} `;
      const tools = createInternalApplySourcePatchTool(
        {},
        {
          ...defaultApplySourcePatchDependencies,
          async compileProject(project, cwd) {
            const compiled = await compileProject(project, cwd);
            await writeFile(path, changed);
            return compiled;
          },
        },
      );
      expect(
        await tools.applySourcePatch({ ...input, dryRun: false }),
      ).toMatchObject({ ok: false, error: { code: "A004", file } });
      expect(await readFile(path, "utf8")).toBe(changed);
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports A006 if the JSON becomes invalid before commit", async () => {
    const fixture = await brokenProject(true, false);
    try {
      const input = await request(fixture, repairs(true, false));
      const path = join(fixture.projectRoot, file);
      const tools = createInternalApplySourcePatchTool(
        {},
        {
          ...defaultApplySourcePatchDependencies,
          async compileProject(project, cwd) {
            const compiled = await compileProject(project, cwd);
            await writeFile(path, "{");
            return compiled;
          },
        },
      );
      expect(
        await tools.applySourcePatch({ ...input, dryRun: false }),
      ).toMatchObject({
        ok: false,
        error: { code: "A006", file },
        failureClass: "expected",
      });
      expect(await readFile(path, "utf8")).toBe("{");
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("presentation schema repair", () => {
  it("repairs only the referenced presentation and keeps it guarded", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const manifest = join(fixture.projectRoot, "system.json");
      const system = JSON.parse(await readFile(manifest, "utf8"));
      await writeFile(
        manifest,
        JSON.stringify({ ...system, presentation: "presentation.json" }),
      );
      await writeFile(
        join(fixture.projectRoot, "presentation.json"),
        JSON.stringify({
          format: "project-presentation/0.1",
          revision: "A",
          backgroundColor: "#ffffff",
          unexpected: true,
        }),
      );
      const before = await tree(fixture.root);
      const input: ApplySourcePatchRequest = {
        format: "agent-tool-request/0.1",
        project: fixture.projectRoot,
        patchFormat: "json-patch/0.1",
        dryRun: true,
        files: [
          {
            path: "presentation.json",
            expectedIntegrity: before["project/presentation.json"]!,
            operations: [
              { op: "test", path: "/revision", value: "A" },
              { op: "remove", path: "/unexpected" },
            ],
          },
        ],
      };
      const tools = createAgentTools();
      expect(await tools.applySourcePatch(input)).toMatchObject({ ok: true });
      expect(await tree(fixture.root)).toEqual(before);
      expect(
        await tools.applySourcePatch({ ...input, dryRun: false }),
      ).toMatchObject({ ok: true });
      const after = await tree(fixture.root);
      expect(
        Object.keys(after).filter((path) => after[path] !== before[path]),
      ).toEqual(["project/presentation.json"]);
      expect(await compileProject(fixture.projectRoot)).toMatchObject({
        ok: true,
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
