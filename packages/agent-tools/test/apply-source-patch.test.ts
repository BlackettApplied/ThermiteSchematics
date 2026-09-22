import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  compileProject,
  computeFileIntegrity,
  loadProject,
} from "@thermite/compiler";
import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "../src/common/contracts.js";
import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
  type ApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import type {
  ApplySourcePatchRequest,
  SourcePatchOperation,
} from "../src/source-patch-request.js";
import {
  createPatchProjectFixture,
  type PatchProjectFixture,
} from "./patch-project-fixture.js";

async function requestFor(
  fixture: PatchProjectFixture,
  path: string,
  operations: readonly SourcePatchOperation[],
  dryRun: boolean,
  project = "project",
): Promise<ApplySourcePatchRequest> {
  const bytes = await readFile(join(fixture.projectRoot, path));
  return {
    format: "agent-tool-request/0.1",
    project,
    patchFormat: "json-patch/0.1",
    dryRun,
    files: [
      {
        path,
        expectedIntegrity: computeFileIntegrity(bytes),
        operations,
      },
    ],
  };
}

function toolsFor(
  fixture: PatchProjectFixture,
  dependencies: ApplySourcePatchDependencies = defaultApplySourcePatchDependencies,
) {
  return createInternalApplySourcePatchTool(
    { cwd: fixture.root },
    dependencies,
  );
}

async function expectNoStageResidue(fixture: PatchProjectFixture) {
  expect(
    (await readdir(fixture.root)).filter((name) =>
      name.startsWith(".thermite-schematics-stage-"),
    ),
  ).toEqual([]);
}

describe("D10 product-path source patch application", () => {
  it("sanitizes deep accepted proposal serialization as frozen unexpected E001", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      let deep: JsonValue = null;
      for (let depth = 0; depth < 20_000; depth += 1) deep = [deep];
      const request = await requestFor(
        fixture,
        "sources/a.json",
        [{ op: "add", path: "/deep", value: deep }],
        true,
      );
      const outcome = await toolsFor(fixture).applySourcePatch(request);
      expect(outcome).toEqual({
        ok: false,
        diagnostics: [
          {
            code: "E001",
            severity: "error",
            message:
              "Agent apply-source-patch tool failure (unexpected/UNKNOWN).",
            file: "<project>",
            line: 1,
            column: 1,
            jsonPointer: "",
          },
        ],
        error: null,
        failureClass: "tool",
      });
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(Object.isFrozen(outcome.diagnostics)).toBe(true);
      await expectNoStageResidue(fixture);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps dry-run/apply records identical and commits only the apply", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const path = "sources/a.json";
      const sourcePath = join(fixture.projectRoot, path);
      const before = await readFile(sourcePath);
      const operations: readonly SourcePatchOperation[] = [
        { op: "test", path: "", value: { objects: [] } },
      ];
      const dryRequest = await requestFor(fixture, path, operations, true);
      const dry = await toolsFor(fixture).applySourcePatch(dryRequest);
      expect(dry).toMatchObject({
        ok: true,
        diagnostics: [],
        value: {
          dryRun: true,
          applied: false,
          atomicity: "per-file",
          files: [{ path, changed: true }],
        },
      });
      expect(await readFile(sourcePath)).toEqual(before);

      const apply = await toolsFor(fixture).applySourcePatch({
        ...dryRequest,
        dryRun: false,
      });
      expect(apply).toMatchObject({
        ok: true,
        diagnostics: [],
        value: {
          dryRun: false,
          applied: true,
          atomicity: "per-file",
        },
      });
      if (!dry.ok || !apply.ok) return;
      expect(apply.value.files).toEqual(dry.value.files);
      expect(await readFile(sourcePath, "utf8")).toBe(
        '{\n  "objects": []\n}\n',
      );
      expect(Object.isFrozen(apply)).toBe(true);
      expect(Object.isFrozen(apply.value.files)).toBe(true);
      expect(await compileProject(fixture.projectRoot)).toMatchObject({
        ok: true,
      });

      const writer = vi.fn(
        defaultApplySourcePatchDependencies.writeFileAtomically,
      );
      const noOpRequest = await requestFor(fixture, path, operations, false);
      const noOp = await toolsFor(fixture, {
        ...defaultApplySourcePatchDependencies,
        writeFileAtomically: writer,
      }).applySourcePatch(noOpRequest);
      expect(noOp).toMatchObject({
        ok: true,
        value: {
          applied: false,
          files: [{ path, changed: false }],
        },
      });
      expect(writer).not.toHaveBeenCalled();
      await expectNoStageResidue(fixture);
    } finally {
      await fixture.cleanup();
    }
  });

  it("admits only an authored project presentation after project sources and stages its compiler context", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const systemPath = join(fixture.projectRoot, "system.json");
      const system = JSON.parse(await readFile(systemPath, "utf8"));
      system.presentation = "presentation.json";
      await writeFile(
        systemPath,
        `${JSON.stringify(system, undefined, 2)}\n`,
        "utf8",
      );
      await writeFile(
        join(fixture.projectRoot, "presentation.json"),
        `${JSON.stringify(
          {
            format: "project-presentation/0.1",
            revision: "A",
            backgroundColor: "#ffffff",
            titleBlock: { lines: ["Patchable"] },
          },
          undefined,
          2,
        )}\n`,
        "utf8",
      );

      const loaded = await loadProject(fixture.projectRoot);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
      expect(loaded.project.presentation).toMatchObject({
        file: "presentation.json",
        kind: "project_presentation",
      });

      const request = await requestFor(
        fixture,
        "presentation.json",
        [{ op: "replace", path: "/revision", value: "B" }],
        false,
      );
      const outcome = await toolsFor(fixture).applySourcePatch(request);
      expect(outcome).toMatchObject({
        ok: true,
        diagnostics: [],
        value: {
          applied: true,
          files: [{ path: "presentation.json", changed: true }],
        },
      });
      const compiled = await compileProject(fixture.projectRoot);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      expect(compiled.presentation).toEqual({
        format: "project-presentation/0.1",
        revision: "B",
        backgroundColor: "#ffffff",
        titleBlockLines: ["Patchable"],
      });

      const absentFixture = await createPatchProjectFixture("clean");
      try {
        await writeFile(
          join(absentFixture.projectRoot, "presentation.json"),
          await readFile(join(fixture.projectRoot, "presentation.json")),
        );
        const absentRequest = await requestFor(
          absentFixture,
          "presentation.json",
          [{ op: "test", path: "/revision", value: "B" }],
          true,
        );
        const rejected =
          await toolsFor(absentFixture).applySourcePatch(absentRequest);
        expect(rejected).toMatchObject({
          ok: false,
          diagnostics: [],
          error: {
            code: "A003",
            file: "presentation.json",
            reason: "not-project-source",
          },
          failureClass: "expected",
        });
      } finally {
        await absentFixture.cleanup();
      }
      await expectNoStageResidue(fixture);
    } finally {
      await fixture.cleanup();
    }
  });
  it("repairs a structurally loadable project with an existing semantic error", async () => {
    const fixture = await createPatchProjectFixture("repair");
    try {
      const before = await compileProject(fixture.projectRoot);
      expect(before).toMatchObject({ ok: false, toolFailure: false });
      expect(before.diagnostics.map(({ code }) => code)).toContain("E201");

      const request = await requestFor(
        fixture,
        "sources/objects.json",
        [{ op: "remove", path: "/objects/4" }],
        false,
      );
      const outcome = await toolsFor(fixture).applySourcePatch(request);
      expect(outcome).toMatchObject({
        ok: true,
        diagnostics: [],
        value: { applied: true },
      });
      expect(await compileProject(fixture.projectRoot)).toMatchObject({
        ok: true,
      });
      await expectNoStageResidue(fixture);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects stale integrity before staging and staged semantic errors without writes", async () => {
    const staleFixture = await createPatchProjectFixture("stale");
    try {
      const path = "sources/a.json";
      const sourcePath = join(staleFixture.projectRoot, path);
      const before = await readFile(sourcePath);
      const stale = await requestFor(
        staleFixture,
        path,
        [{ op: "test", path: "", value: { objects: [] } }],
        false,
      );
      stale.files[0]!.expectedIntegrity = computeFileIntegrity(
        Buffer.from("stale", "utf8"),
      );
      const outcome = await toolsFor(staleFixture).applySourcePatch(stale);
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [],
        error: { code: "A004", file: path },
        failureClass: "expected",
      });
      expect(await readFile(sourcePath)).toEqual(before);
      await expectNoStageResidue(staleFixture);
    } finally {
      await staleFixture.cleanup();
    }

    const stagedFixture = await createPatchProjectFixture("staged-failure");
    try {
      const path = "sources/a.json";
      const sourcePath = join(stagedFixture.projectRoot, path);
      const before = await readFile(sourcePath);
      const request = await requestFor(
        stagedFixture,
        path,
        [
          {
            op: "add",
            path: "/objects/-",
            value: {
              uid: "10000000-0000-4000-8000-000000000001",
              kind: "wire",
              designation: "W1",
              endpoints: [
                { device: "MISSING-A", terminal: "1" },
                { device: "MISSING-B", terminal: "1" },
              ],
            },
          },
        ],
        false,
      );
      const outcome = await toolsFor(stagedFixture).applySourcePatch(request);
      expect(outcome).toMatchObject({
        ok: false,
        error: null,
        failureClass: "expected",
      });
      expect(outcome.diagnostics.length).toBeGreaterThan(0);
      expect(await readFile(sourcePath)).toEqual(before);
      await expectNoStageResidue(stagedFixture);
    } finally {
      await stagedFixture.cleanup();
    }
  });

  it("uses the loader-resolved custom manifest file for stage and precommit", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const customManifest = join(fixture.projectRoot, "custom-project.json");
      await rename(join(fixture.projectRoot, "system.json"), customManifest);
      const compile = vi.fn(
        async (inputPath: string | undefined, cwd: string) =>
          compileProject(inputPath, cwd),
      );
      const load = vi.fn(async (inputPath: string | undefined, cwd: string) =>
        loadProject(inputPath, cwd),
      );
      const request = await requestFor(
        fixture,
        "sources/a.json",
        [{ op: "test", path: "", value: { objects: [] } }],
        false,
        "project/custom-project.json",
      );
      const outcome = await toolsFor(fixture, {
        ...defaultApplySourcePatchDependencies,
        compileProject: compile,
        loadProject: load,
      }).applySourcePatch(request);
      expect(outcome).toMatchObject({ ok: true });
      expect(compile).toHaveBeenCalledOnce();
      expect(basename(compile.mock.calls[0]![0]!)).toBe("custom-project.json");
      expect(compile.mock.calls[0]![0]).not.toBe(
        expect.stringMatching(/[\\/]project$/u),
      );
      expect(load).toHaveBeenCalledTimes(2);
      expect(load.mock.calls[1]![0]).toBe(customManifest);
      await expectNoStageResidue(fixture);
    } finally {
      await fixture.cleanup();
    }
  });
});
