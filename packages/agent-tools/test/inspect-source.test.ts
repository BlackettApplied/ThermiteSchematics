import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileLoadedProject,
  compileProject,
  computeFileIntegrity,
  loadProject,
  lockProject,
} from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import { describe, expect, it } from "vitest";

import { createAgentTools, serializeAgentToolResult } from "../src/index.js";
import { createInternalReadTools } from "../src/read-tools.js";
import { createPatchProjectFixture } from "./patch-project-fixture.js";
import { initializeAlphaProject } from "../../cli/src/alpha-init.js";
import { createMotorStarterPnpExperiment } from "../../render/test/motor-starter-pnp-fixture.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const base = { format: "agent-tool-request/0.1", project: "." } as const;
const selector = { by: "designation", value: "LS1" } as const;
const include = ["source"] as const;

async function readSource(
  tools: ReturnType<typeof createAgentTools>,
  tool: "inspect" | "resolve",
) {
  const outcome =
    tool === "inspect"
      ? await tools.inspect({ ...base, selector, include })
      : await tools.resolve({ ...base, target: selector, include });
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  if (!outcome.ok || !("object" in outcome.value))
    throw new Error("Expected exact object");
  expect(outcome.value.object.source).toBeDefined();
  return outcome.value.object;
}

function expectLibraryUidsAbsent(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (
    record.origin !== null &&
    typeof record.origin === "object" &&
    "kind" in record.origin &&
    record.origin.kind === "library"
  ) {
    expect(record).not.toHaveProperty("uid");
  }
  for (const child of Object.values(record)) expectLibraryUidsAbsent(child);
}

function patch(
  source: { file: string; pointer: string; integrity: string; uid?: string },
  description: string,
) {
  return {
    ...base,
    patchFormat: "json-patch/0.1" as const,
    dryRun: true,
    files: [
      {
        path: source.file,
        expectedIntegrity: source.integrity,
        operations: [
          {
            op: "test" as const,
            path: `${source.pointer}/uid`,
            value: source.uid ?? "not-a-project-object",
          },
          {
            op: "replace" as const,
            path: `${source.pointer}/description`,
            value: description,
          },
        ],
      },
    ],
  };
}

describe("guarded inspect/resolve source pointers", () => {
  it("records the old no-source/A004 discovery workaround", async () => {
    const experiment = await createMotorStarterPnpExperiment();
    try {
      const tools = createAgentTools({ cwd: experiment.projectRoot });
      const inspected = await tools.inspect({ ...base, selector });
      expect(inspected.ok).toBe(true);
      if (!inspected.ok) throw new Error("Expected inspection");
      expect(inspected.value.object).not.toHaveProperty("source");
      const stale = await tools.applySourcePatch(
        patch(
          {
            file: "devices/equipment.json",
            pointer: "/objects/0",
            integrity: `sha256-${"A".repeat(43)}=`,
          },
          "probe",
        ),
      );
      expect(stale).toMatchObject({
        ok: false,
        error: {
          code: "A004",
          actualIntegrity: computeFileIntegrity(
            await readFile(
              join(experiment.projectRoot, "devices/equipment.json"),
            ),
          ),
        },
      });
    } finally {
      await experiment.cleanup();
    }
  });

  it.each(["inspect", "resolve"] as const)(
    "uses %s values verbatim for dry-run and exact-object apply",
    async (tool) => {
      const experiment = await createMotorStarterPnpExperiment();
      try {
        const tools = createAgentTools({ cwd: experiment.projectRoot });
        const object = await readSource(tools, tool);
        const source = object.source!;
        expect(source).toMatchObject({
          file: "devices/equipment.json",
          uid: object.uid,
          patchEligible: true,
        });
        const before = await readFile(
          join(experiment.projectRoot, source.file),
        );
        expect(source.integrity).toBe(computeFileIntegrity(before));
        const expected = JSON.parse(before.toString("utf8"));
        const index = Number(source.pointer.split("/").at(-1));
        expect(expected.objects[index].uid).toBe(object.uid);
        expected.objects[index].description = "T1 guarded description";
        const expectedBytes = Buffer.from(
          `${JSON.stringify(expected, undefined, 2)}\n`,
        );
        const request = patch(source, expected.objects[index].description);
        const dry = await tools.applySourcePatch(request);
        expect(dry).toMatchObject({
          ok: true,
          value: {
            dryRun: true,
            files: [
              {
                beforeIntegrity: source.integrity,
                afterIntegrity: computeFileIntegrity(expectedBytes),
              },
            ],
          },
        });
        expect(
          await readFile(join(experiment.projectRoot, source.file)),
        ).toEqual(before);
        const applied = await tools.applySourcePatch({
          ...request,
          dryRun: false,
        });
        expect(applied.ok, JSON.stringify(applied)).toBe(true);
        expect(
          await readFile(join(experiment.projectRoot, source.file)),
        ).toEqual(expectedBytes);
        for (const [file, bytes] of experiment.baselineProjectFiles) {
          if (file !== source.file)
            expect(await readFile(join(experiment.projectRoot, file))).toEqual(
              bytes,
            );
        }
      } finally {
        await experiment.cleanup();
      }
    },
  );
});

describe("source snapshot safety and compatibility", () => {
  it.each(
    (["inspect", "resolve"] as const).flatMap((tool) =>
      (["insertion", "deletion", "reorder"] as const).map((mutation) => ({
        tool,
        mutation,
      })),
    ),
  )(
    "rejects $mutation using the old $tool guard without writing",
    async ({ tool, mutation }) => {
      const experiment = await createMotorStarterPnpExperiment();
      try {
        const tools = createAgentTools({ cwd: experiment.projectRoot });
        const object = await readSource(tools, tool);
        const source = object.source!;
        const path = join(experiment.projectRoot, source.file);
        const document = JSON.parse(await readFile(path, "utf8"));
        const index = Number(source.pointer.split("/").at(-1));
        if (mutation === "deletion") document.objects.splice(index, 1);
        else if (mutation === "reorder") document.objects.reverse();
        else
          document.objects.splice(index, 0, {
            kind: "device",
            uid: "b9beb18f-3681-450a-bf7e-4720643e9c77",
            designation: "SIBLING",
            type: "core:limit-switch-2wire",
          });
        const reordered = Buffer.from(
          `${JSON.stringify(document, undefined, 2)}\n`,
        );
        await writeFile(path, reordered);
        for (const dryRun of [true, false]) {
          const result = await tools.applySourcePatch({
            ...patch(source, "must not be written"),
            dryRun,
          });
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: "A004",
              actualIntegrity: computeFileIntegrity(reordered),
            },
          });
          expect(await readFile(path)).toEqual(reordered);
        }
      } finally {
        await experiment.cleanup();
      }
    },
  );

  it("keeps guards and pointers on the loaded snapshot when bytes change before compilation", async () => {
    const experiment = await createMotorStarterPnpExperiment();
    try {
      const path = join(experiment.projectRoot, "devices/equipment.json");
      const before = await readFile(path);
      const tools = createInternalReadTools(
        { cwd: experiment.projectRoot },
        {
          compileProject,
          createQueryEngine,
          loadProject: async (input, cwd) => {
            const loaded = await loadProject(input, cwd);
            const document = JSON.parse(before.toString("utf8"));
            document.objects.reverse();
            await writeFile(
              path,
              `${JSON.stringify(document, undefined, 2)}\n`,
            );
            return loaded;
          },
        },
      );
      const result = await tools.inspect({ ...base, selector, include });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw new Error("Expected inspection");
      const source = result.value.object.source!;
      expect(source.integrity).toBe(computeFileIntegrity(before));
      const index = Number(source.pointer.split("/").at(-1));
      expect(JSON.parse(before.toString("utf8")).objects[index].uid).toBe(
        result.value.object.uid,
      );
      expect(computeFileIntegrity(await readFile(path))).not.toBe(
        source.integrity,
      );
      expect(
        await createAgentTools({
          cwd: experiment.projectRoot,
        }).applySourcePatch(patch(source, "stale")),
      ).toMatchObject({ ok: false, error: { code: "A004" } });
    } finally {
      await experiment.cleanup();
    }
  });

  it("marks shipped terminals, functions and cable types as library data, and deduplicates guards", async () => {
    const tools = createAgentTools({
      cwd: join(repositoryRoot, "examples/motor-starter"),
    });
    const result = await tools.inspect({ ...base, selector, include });
    if (!result.ok || result.value.object.kind !== "device")
      throw new Error(JSON.stringify(result));
    const object = result.value.object;
    expectLibraryUidsAbsent(result.value);
    for (const member of [
      ...object.terminals,
      ...object.functions,
      ...object.functions.flatMap((fn) => fn.terminals),
    ]) {
      expect(member.source).toMatchObject({
        patchEligible: false,
        origin: { kind: "library", name: "core", resolutionKind: "shipped" },
        reason: "Library files cannot be modified by apply-source-patch.",
      });
      expect(member.source!.file).toMatch(/^@thermite\/core-library\//u);
      expect(member.source).not.toHaveProperty("uid");
    }
    expect(object.source).toMatchObject({
      patchEligible: true,
      origin: { kind: "project" },
    });
    const cable = await tools.inspect({
      ...base,
      selector: { by: "designation", value: "CBL1" },
      include,
    });
    if (!cable.ok || cable.value.object.kind !== "cable")
      throw new Error(JSON.stringify(cable));
    expectLibraryUidsAbsent(cable.value);
    expect(cable.value.object.cableType.source).toMatchObject({
      patchEligible: false,
      origin: { kind: "library" },
    });
    expect(
      await tools.applySourcePatch(
        patch(object.terminals[0]!.source!, "ineligible"),
      ),
    ).toMatchObject({ ok: false, error: { code: "A003" } });
    const search = await tools.resolve({
      ...base,
      target: { by: "text", value: "core:" },
      include,
    });
    if (!search.ok || search.value.mode !== "search")
      throw new Error(JSON.stringify(search));
    const guards = search.value.sourceFiles!;
    expect(guards.length).toBeLessThan(search.value.matches.length);
    expect(guards.map(({ file }) => file)).toEqual(
      [...new Set(guards.map(({ file }) => file))].sort(),
    );
    for (const { object } of search.value.matches)
      expect(guards).toContainEqual({
        file: object.source!.file,
        integrity: object.source!.integrity,
      });
    expect(Object.isFrozen(result.value.sourceFiles)).toBe(true);
    expect(Object.isFrozen(object.source)).toBe(true);
    expect(JSON.stringify([result, search, cable])).not.toContain(
      repositoryRoot,
    );
  });

  it("matches the existing agent inspect and resolve goldens when include is omitted", async () => {
    const tools = createAgentTools({
      cwd: join(repositoryRoot, "examples/motor-starter"),
    });
    const inspected = await tools.inspect({ ...base, selector });
    const resolved = await tools.resolve({
      ...base,
      target: { by: "text", value: "LS1" },
    });
    if (!inspected.ok || !resolved.ok)
      throw new Error("Expected legacy results");
    const goldenRoot = join(
      repositoryRoot,
      "packages/cli/test/goldens/motor-starter-agent",
    );
    expect(serializeAgentToolResult("inspect", inspected.value)).toBe(
      await readFile(join(goldenRoot, "inspect-ls1.stdout.json"), "utf8"),
    );
    expect(serializeAgentToolResult("resolve", resolved.value)).toBe(
      await readFile(join(goldenRoot, "search-ls1.stdout.json"), "utf8"),
    );
  });

  it("returns the same authored compilation failure with or without source inclusion", async () => {
    const fixture = await createPatchProjectFixture("semantic-invalid");
    try {
      const tools = createAgentTools({ cwd: fixture.projectRoot });
      const selector = { by: "designation", value: "LOAD1" } as const;
      for (const tool of ["inspect", "resolve"] as const) {
        const request =
          tool === "inspect"
            ? { ...base, selector }
            : { ...base, target: selector };
        const plain = await tools[tool](request as never);
        const included = await tools[tool]({ ...request, include } as never);
        expect(included).toEqual(plain);
        expect(included).toMatchObject({
          ok: false,
          failureClass: "expected",
          error: null,
        });
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("escapes / and ~ in local library terminal/function keys and refuses those targets", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const root = fixture.projectRoot;
      await mkdir(join(root, "library"));
      await writeFile(
        join(root, "system.json"),
        JSON.stringify({
          format: "electrical-system/0.1",
          project: { name: "Escaping" },
          sources: ["sources/*.json"],
          libraries: [{ name: "escape", version: "1.0.0", path: "library" }],
        }),
      );
      await writeFile(
        join(root, "library/library.json"),
        JSON.stringify({
          name: "escape",
          version: "1.0.0",
          sources: ["types.json"],
        }),
      );
      const libraryBytes = Buffer.from(
        JSON.stringify({
          types: [
            {
              kind: "device_type",
              id: "escape:keys",
              terminals: { "a/b~c": { description: "escaped terminal" } },
              functions: { "f/g~h": { kind: "other", terminals: ["a/b~c"] } },
              ports: { source: { medium: "ethernet", connector: "RJ45" } },
              connectorPorts: {
                "p/q~r": {
                  connector: "TEST",
                  pins: { "s/t~u": { terminal: "a/b~c" } },
                },
              },
              connectionCoverage: {
                status: "partial",
                notes: "Synthetic source metadata fixture",
              },
            },
          ],
        }),
      );
      await writeFile(join(root, "library/types.json"), libraryBytes);
      await writeFile(
        join(root, "sources/a.json"),
        JSON.stringify({
          objects: [
            {
              kind: "device",
              uid: "c2a8fd5e-3695-488a-9ce2-87a1c114ca7f",
              designation: "LS1",
              type: "escape:keys",
            },
          ],
        }),
      );
      expect((await lockProject(".", root)).ok).toBe(true);
      const tools = createAgentTools({ cwd: root });
      const result = await tools.inspect({ ...base, selector, include });
      if (!result.ok || result.value.object.kind !== "device")
        throw new Error(JSON.stringify(result));
      expectLibraryUidsAbsent(result.value);
      const terminal = result.value.object.terminals[0]!.source!;
      const fn = result.value.object.functions[0]!.source!;
      expect(terminal).toMatchObject({
        file: "library/types.json",
        pointer: "/types/0/terminals/a~1b~0c",
        integrity: computeFileIntegrity(libraryBytes),
        patchEligible: false,
        origin: { kind: "library", resolutionKind: "local" },
      });
      expect(fn.pointer).toBe("/types/0/functions/f~1g~0h");
      expect(terminal).not.toHaveProperty("uid");
      expect(fn).not.toHaveProperty("uid");
      const object = result.value.object;
      expect(object.deviceType!.source).toMatchObject({
        pointer: "/types/0",
        patchEligible: false,
      });
      expect(object.connectionCoverage!.source).toMatchObject({
        pointer: "/types/0/connectionCoverage",
        patchEligible: false,
      });
      expect(Object.keys(object.ports!)).toEqual(["source"]);
      expect(object.ports!.source).toMatchObject({
        medium: "ethernet",
        source: { pointer: "/types/0/ports/source", patchEligible: false },
      });
      expect(object.connectorPorts!["p/q~r"]!.source!.pointer).toBe(
        "/types/0/connectorPorts/p~1q~0r",
      );
      expect(
        object.connectorPorts!["p/q~r"]!.pins!["s/t~u"]!.source!.pointer,
      ).toBe("/types/0/connectorPorts/p~1q~0r/pins/s~1t~0u");
      expect(
        await tools.applySourcePatch(patch(terminal, "ineligible")),
      ).toMatchObject({ ok: false, error: { code: "A003" } });
      expect(await readFile(join(root, terminal.file))).toEqual(libraryBytes);
    } finally {
      await fixture.cleanup();
    }
  });

  it("is deterministic in fresh processes with different cwd, locale and timezone", async () => {
    const entry = join(repositoryRoot, "packages/cli/dist/bin.js");
    const project = join(repositoryRoot, "examples/motor-starter");
    for (const tool of ["inspect", "resolve"] as const) {
      const input = JSON.stringify(
        tool === "inspect"
          ? { ...base, project, selector, include }
          : { ...base, project, target: { by: "text", value: "LS1" }, include },
      );
      const run = async (cwd: string, tz: string, locale: string) => {
        const child = execFile(
          process.execPath,
          [entry, "agent", tool, "--input", "-"],
          {
            cwd,
            env: { ...process.env, TZ: tz, LANG: locale, LC_ALL: locale },
            encoding: "utf8",
          },
        );
        child.stdin!.end(input);
        return new Promise<{ stdout: string; stderr: string }>(
          (resolve, reject) => {
            let stdout = "",
              stderr = "";
            child.stdout!.on("data", (chunk) => {
              stdout += chunk;
            });
            child.stderr!.on("data", (chunk) => {
              stderr += chunk;
            });
            child.on("error", reject);
            child.on("close", (code) =>
              code === 0
                ? resolve({ stdout, stderr })
                : reject(new Error(`${code}: ${stderr}`)),
            );
          },
        );
      };
      const [first, second] = await Promise.all([
        run(repositoryRoot, "UTC", "C"),
        run(project, "Pacific/Honolulu", "en_US.UTF-8"),
      ]);
      expect(first).toEqual(second);
      expect(JSON.parse(first.stdout).value.sourceFiles.length).toBeGreaterThan(
        0,
      );
      expect(first.stdout).not.toContain(repositoryRoot);
    }
  });

  it.each(["inspect", "resolve"] as const)(
    "validates the %s include array and lists its allowed enum",
    async (tool) => {
      const tools = createAgentTools({ cwd: repositoryRoot });
      for (const [include, field, reason] of [
        ["source", "/include", "wrong-type"],
        [[], "/include", "empty-array"],
        [[null], "/include/0", "wrong-type"],
        [[""], "/include/0", "empty-string"],
        [["other"], "/include/0", "unsupported-value"],
        [["source", "other"], "/include/1", "unsupported-value"],
      ] as const) {
        const request = {
          ...base,
          project: "does-not-exist",
          ...(tool === "inspect" ? { selector } : { target: selector }),
          include,
        };
        const outcome = await tools[tool](request as never);
        expect(outcome).toMatchObject({
          ok: false,
          diagnostics: [],
          error: { code: "A001", field, reason },
        });
        if (reason === "unsupported-value")
          expect(outcome).toMatchObject({
            error: { allowed: ["source"], allowedCount: 1 },
          });
      }
    },
  );
});

it("returns exact pointers for all project object kinds and their one-hop project objects", async () => {
  const project = join(repositoryRoot, "examples/motor-starter");
  const compiled = await compileProject(".", project);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled));
  const tools = createAgentTools({ cwd: project });
  for (const object of [
    compiled.ir.devices[0]!,
    compiled.ir.wires[0]!,
    compiled.ir.jumpers[0]!,
    compiled.ir.cables[0]!,
    compiled.ir.relations[0]!,
    compiled.ir.potentials[0]!,
  ]) {
    const selector = { by: "uid", value: object.uid } as const;
    const inspected = await tools.inspect({ ...base, selector, include });
    const resolved = await tools.resolve({
      ...base,
      target: selector,
      include,
    });
    if (!inspected.ok || !resolved.ok || resolved.value.mode !== "resolve")
      throw new Error("Expected exact results");
    const source = inspected.value.object.source!;
    expect(resolved.value.object).not.toHaveProperty("deviceType");
    expect(source).toEqual(resolved.value.object.source);
    expect(source).toMatchObject({
      file: object.source.file,
      pointer: object.source.jsonPointer,
      uid: object.uid,
      patchEligible: true,
    });
    const bytes = await readFile(join(project, source.file));
    expect(source.integrity).toBe(computeFileIntegrity(bytes));
    expect(
      JSON.parse(bytes.toString("utf8")).objects[
        Number(source.pointer.split("/").at(-1))
      ].uid,
    ).toBe(object.uid);
    const projected = inspected.value.object;
    if (projected.kind === "relation") {
      expect(projected.from.source!.patchEligible).toBe(true);
      expect(projected.to.source!.patchEligible).toBe(true);
      expect(projected.from.deviceType!.source.patchEligible).toBe(false);
      expect(projected.to.deviceType!.source.patchEligible).toBe(false);
    }
  }
});

async function cabinetsFixture() {
  const fixture = await createPatchProjectFixture("clean");
  const projectRoot = join(fixture.root, "cabinets");
  try {
    await initializeAlphaProject(projectRoot, { template: "cabinets" });
    return { ...fixture, projectRoot };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}

describe("admitted source guards", () => {
  it("rejects an in-request index shift at the object's uid test without writing", async () => {
    const fixture = await cabinetsFixture();
    try {
      const tools = createAgentTools({ cwd: fixture.projectRoot });
      const inspected = await tools.inspect({
        ...base,
        selector: { by: "designation", value: "TB2" },
        include,
      });
      if (!inspected.ok) throw new Error(JSON.stringify(inspected));
      const source = inspected.value.object.source!;
      expect(source.pointer).toBe("/objects/1");
      const path = join(fixture.projectRoot, source.file);
      const before = await readFile(path);
      const request = {
        ...base,
        patchFormat: "json-patch/0.1" as const,
        files: [
          {
            path: source.file,
            expectedIntegrity: source.integrity,
            operations: [
              {
                op: "add" as const,
                path: "/objects/0",
                value: {
                  kind: "device",
                  uid: randomUUID(),
                  designation: "TB9",
                  type: "core:terminal-block-8",
                },
              },
              {
                op: "test" as const,
                path: `${source.pointer}/uid`,
                value: source.uid!,
              },
              {
                op: "add" as const,
                path: `${source.pointer}/description`,
                value: "TB2 only",
              },
            ],
          },
        ],
      };
      for (const dryRun of [true, false]) {
        const result = await tools.applySourcePatch({ ...request, dryRun });
        expect(result).toMatchObject({
          ok: false,
          failureClass: "expected",
          error: {
            code: "A002",
            reason: "test-failed",
            operationIndex: 1,
            path: `${source.pointer}/uid`,
          },
        });
        expect(await readFile(path)).toEqual(before);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("provides guards for every admitted patchable file, including empty sources and presentation", async () => {
    const fixture = await cabinetsFixture();
    try {
      const tools = createAgentTools({ cwd: fixture.projectRoot });
      const inspected = await tools.inspect({
        ...base,
        selector: { by: "designation", value: "TB2" },
        include,
      });
      if (!inspected.ok) throw new Error(JSON.stringify(inspected));
      const loaded = await loadProject(".", fixture.projectRoot);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded));
      for (const document of [
        ...loaded.project.sources,
        loaded.project.presentation!,
      ]) {
        expect(inspected.value.sourceFiles).toContainEqual({
          file: document.file,
          integrity: computeFileIntegrity(document.rawBytes),
        });
      }
      const guards = inspected.value.sourceFiles!;
      expect(guards.map(({ file }) => file)).toEqual(
        [...new Set(guards.map(({ file }) => file))].sort(),
      );
      expect(guards.map(({ file }) => file)).not.toContain("system.json");
      expect(guards.map(({ file }) => file)).not.toContain(
        "electrical-system.lock.json",
      );
      const wireGuard = guards.find(
        ({ file }) => file === "connections/control-power.json",
      )!;
      const presentationGuard = guards.find(
        ({ file }) => file === "presentation.json",
      )!;
      expect(wireGuard).toBeDefined();
      expect(presentationGuard).toBeDefined();
      const wire = {
        kind: "wire",
        uid: randomUUID(),
        designation: "W-FIRST",
        endpoints: [
          { device: "TB1", terminal: "3" },
          { device: "TB2", terminal: "3" },
        ],
      };
      const request = {
        ...base,
        patchFormat: "json-patch/0.1" as const,
        files: [
          {
            path: wireGuard.file,
            expectedIntegrity: wireGuard.integrity,
            operations: [
              { op: "add" as const, path: "/objects/-", value: wire },
            ],
          },
          {
            path: presentationGuard.file,
            expectedIntegrity: presentationGuard.integrity,
            operations: [
              { op: "replace" as const, path: "/revision", value: "T1" },
            ],
          },
        ],
      };
      for (const dryRun of [true, false]) {
        const result = await tools.applySourcePatch({ ...request, dryRun });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(
          JSON.parse(
            await readFile(join(fixture.projectRoot, wireGuard.file), "utf8"),
          ).objects,
        ).toEqual(dryRun ? [] : [wire]);
      }
      expect(
        JSON.parse(
          await readFile(
            join(fixture.projectRoot, presentationGuard.file),
            "utf8",
          ),
        ).revision,
      ).toBe("T1");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps guards on the admitted bytes and omits unreferenced or subsequently appearing files", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      await writeFile(join(fixture.projectRoot, "presentation.json"), "{}\n");
      const bPath = join(fixture.projectRoot, "sources/b.json");
      const bBefore = await readFile(bPath);
      const tools = createInternalReadTools(
        { cwd: fixture.projectRoot },
        {
          compileProject,
          createQueryEngine,
          loadProject: async (input, cwd) => {
            const loaded = await loadProject(input, cwd);
            await writeFile(
              join(fixture.projectRoot, "sources/late.json"),
              '{"objects":[]}\n',
            );
            await writeFile(bPath, '{ "objects": [] }\n');
            return loaded;
          },
        },
      );
      const result = await tools.resolve({
        ...base,
        target: { by: "text", value: "no matches" },
        include,
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.value).toMatchObject({ mode: "search", matches: [] });
      expect(result.value.sourceFiles).toEqual([
        {
          file: "sources/a.json",
          integrity: computeFileIntegrity(
            await readFile(join(fixture.projectRoot, "sources/a.json")),
          ),
        },
        { file: "sources/b.json", integrity: computeFileIntegrity(bBefore) },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["inspect", "resolve"] as const)(
    "rejects duplicate %s include entries at their repeated index",
    async (tool) => {
      const tools = createAgentTools({ cwd: repositoryRoot });
      const result = await tools[tool]({
        ...base,
        project: "does-not-exist",
        ...(tool === "inspect" ? { selector } : { target: selector }),
        include: ["source", "source"],
      } as never);
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [],
        failureClass: "expected",
        error: {
          code: "A001",
          field: "/include/1",
          reason: "duplicate-member",
        },
      });
      if (!result.ok) expect(result.error).not.toHaveProperty("allowed");
    },
  );

  it.each(["query", "validate", "createView"] as const)(
    "still rejects include on %s before compilation",
    async (tool) => {
      const tools = createAgentTools({ cwd: repositoryRoot });
      const extras =
        tool === "query"
          ? {
              query: {
                operation: "net",
                selector: {
                  by: "parts",
                  deviceDesignation: "PS1",
                  terminalKey: "+",
                },
              },
            }
          : tool === "createView"
            ? {
                spec: {
                  format: "schematic-view-request/0.2",
                  root: { by: "designation", value: "PS1" },
                  intent: { kind: "loads" },
                },
              }
            : {};
      expect(
        await tools[tool]({
          ...base,
          project: "does-not-exist",
          ...extras,
          include,
        } as never),
      ).toMatchObject({
        ok: false,
        diagnostics: [],
        failureClass: "expected",
        error: {
          code: "A001",
          field: "/include",
          reason: "additional-property",
        },
      });
    },
  );

  it.each(["inspect", "resolve"] as const)(
    "classifies %s provenance absent from the snapshot as a tool failure",
    async (tool) => {
      for (const invalid of ["file", "pointer"] as const) {
        const tools = createInternalReadTools(
          { cwd: join(repositoryRoot, "examples/motor-starter") },
          {
            compileProject,
            createQueryEngine,
            compileLoadedProject: (project) => {
              const result = compileLoadedProject(project);
              if (!result.ok) throw new Error(JSON.stringify(result));
              const device = result.ir.devices.find(
                ({ designation }) => designation === "LS1",
              )!;
              if (invalid === "file")
                device.source.file = "not-in-snapshot.json";
              else device.source.jsonPointer = "/objects/99999";
              return result;
            },
          },
        );
        const request = {
          ...base,
          ...(tool === "inspect" ? { selector } : { target: selector }),
          include,
        };
        expect(await tools[tool](request as never)).toMatchObject({
          ok: false,
          error: null,
          failureClass: "tool",
          diagnostics: [
            {
              code: "E001",
              severity: "error",
              message: `Agent ${tool} tool failure (query/UNKNOWN).`,
            },
          ],
        });
      }
    },
  );
});
