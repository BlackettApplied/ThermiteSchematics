import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type CompileResult,
  type ElectricalIr,
} from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import type { Diagnostic } from "@thermite/schema";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createInternalReadTools,
  type ReadToolDependencies,
} from "../src/read-tools.js";
import type { ValidateProjectRequest } from "../src/validate.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolvePath(testRoot, "../../..");
const motorProject = "examples/motor-starter";
const warningProject =
  "packages/compiler/fixtures/rules/exact-duplicate-potential";
const errorProject =
  "packages/compiler/fixtures/rules/exclusive-terminal-second-wire";
const unavailableShippedLibraryProject =
  "packages/compiler/fixtures/shipped-library-unavailable";
const rulesFixtureRoot = resolvePath(
  repositoryRoot,
  "packages/compiler/fixtures/rules",
);
let motorIr: ElectricalIr;

beforeAll(async () => {
  const compiled = await compileProject(motorProject, repositoryRoot);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  motorIr = compiled.ir;
});

function request(project: string): ValidateProjectRequest {
  return { format: "agent-tool-request/0.1", project };
}

function injectedTools(
  compile: ReadToolDependencies["compileProject"],
  createEngine = vi.fn(createQueryEngine),
) {
  const dependencies: ReadToolDependencies = {
    compileProject: compile,
    createQueryEngine: createEngine,
  };
  return {
    createEngine,
    tools: createInternalReadTools({ cwd: repositoryRoot }, dependencies),
  };
}

describe("D7 exact compiler validation", () => {
  it.each([
    ["clean success", motorProject, true, []],
    ["warning success", warningProject, true, ["W902"]],
    ["authored error", errorProject, false, ["E201"]],
  ])(
    "matches direct compileProject for %s",
    async (_name, project, expectedOk, expectedCodes) => {
      const direct = await compileProject(project, repositoryRoot);
      const outcome = await createInternalReadTools({
        cwd: repositoryRoot,
      }).validate(request(project));
      expect(outcome.ok).toBe(expectedOk);
      expect(outcome.diagnostics.map(({ code }) => code)).toEqual(
        expectedCodes,
      );

      if (direct.ok) {
        expect(outcome).toEqual({
          ok: true,
          diagnostics: direct.diagnostics,
          value: { valid: true },
        });
        if (!outcome.ok) return;
        expect(Object.isFrozen(outcome.value)).toBe(true);
        expect(outcome.value).toEqual({ valid: true });
      } else {
        expect(direct.toolFailure).toBe(false);
        expect(outcome).toEqual({
          ok: false,
          diagnostics: direct.diagnostics,
          error: null,
          failureClass: "expected",
        });
        expect(Object.hasOwn(outcome, "value")).toBe(false);
      }
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(Object.isFrozen(outcome.diagnostics)).toBe(true);
      expect(outcome.diagnostics.every(Object.isFrozen)).toBe(true);
    },
  );

  it("keeps W902 as a successful verbatim compiler warning", async () => {
    const direct = await compileProject(warningProject, repositoryRoot);
    if (!direct.ok) throw new Error("Expected warning-only compilation.");
    expect(direct.diagnostics.map(({ code }) => code)).toEqual(["W902"]);

    const outcome = await createInternalReadTools({
      cwd: repositoryRoot,
    }).validate(request(warningProject));
    expect(outcome).toEqual({
      ok: true,
      diagnostics: direct.diagnostics,
      value: { valid: true },
    });
    expect(outcome.diagnostics).not.toBe(direct.diagnostics);
    expect(JSON.stringify(outcome.diagnostics)).toBe(
      JSON.stringify(direct.diagnostics),
    );
  });

  it("calls only compileProject, exactly once", async () => {
    const compile = vi.fn(async (inputPath: string | undefined, cwd: string) =>
      compileProject(inputPath, cwd),
    );
    const { createEngine, tools } = injectedTools(compile);
    const outcome = await tools.validate(request(motorProject));
    expect(outcome).toMatchObject({ ok: true, value: { valid: true } });
    expect(compile).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledWith(motorProject, repositoryRoot);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("passes a real lock verification failure through verbatim", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-agent-validate-lock-"),
    );
    const projectRoot = join(temporaryRoot, "project");
    try {
      await cp(
        join(rulesFixtureRoot, "exact-duplicate-potential"),
        projectRoot,
        {
          recursive: true,
        },
      );
      await cp(
        join(rulesFixtureRoot, "library"),
        join(temporaryRoot, "library"),
        { recursive: true },
      );
      const lockPath = join(projectRoot, "electrical-system.lock.json");
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
        libraries: { rules: { version: string } };
      };
      lock.libraries.rules.version = "9.9.9";
      await writeFile(lockPath, `${JSON.stringify(lock, undefined, 2)}\n`);

      const direct = await compileProject(projectRoot, repositoryRoot);
      if (direct.ok || direct.toolFailure) {
        throw new Error("Expected an authored lock failure.");
      }
      const outcome = await createInternalReadTools({
        cwd: repositoryRoot,
      }).validate(request(projectRoot));
      expect(outcome).toEqual({
        ok: false,
        diagnostics: direct.diagnostics,
        error: null,
        failureClass: "expected",
      });
      expect(direct.diagnostics.some(({ code }) => code === "E106")).toBe(true);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("propagates the exact two E032 diagnostics as an expected agent failure", async () => {
    const outcome = await createInternalReadTools({
      cwd: repositoryRoot,
    }).validate(request(unavailableShippedLibraryProject));
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E032",
          severity: "error",
          message:
            'Shipped library "unknown" at version "9.9.9" is unavailable.',
          file: "system.json",
          line: 1,
          column: 108,
          jsonPointer: "/libraries/0/name",
        },
        {
          code: "E032",
          severity: "error",
          message:
            'Shipped library "core" does not provide version "9.9.9"; available version is "0.1.0".',
          file: "system.json",
          line: 1,
          column: 162,
          jsonPointer: "/libraries/1/version",
        },
      ],
      error: null,
      failureClass: "expected",
    });
  });
});

describe("D7 compiler tool-failure routing", () => {
  it("copies the compiler toolFailure class and sanitizes a real E001", async () => {
    const missing = "Z:/private/validate-project";
    const direct = await compileProject(missing, repositoryRoot);
    if (direct.ok || !direct.toolFailure) {
      throw new Error("Expected compiler tool failure.");
    }
    const outcome = await createInternalReadTools({
      cwd: repositoryRoot,
    }).validate(request(missing));
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E001",
          severity: "error",
          message: "Agent validate tool failure (compile/E001).",
          file: "system.json",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ],
      error: null,
      failureClass: "tool",
    });
    expect(JSON.stringify(outcome)).not.toContain("private");
    expect(direct.diagnostics[0]?.message).not.toBe(
      outcome.diagnostics[0]?.message,
    );
  });

  it("replaces only E001 while retaining other compiler diagnostics", async () => {
    const warningCompile = await compileProject(warningProject, repositoryRoot);
    if (!warningCompile.ok) throw new Error("Expected warning compilation.");
    const warning = warningCompile.diagnostics[0]!;
    const rawE001: Diagnostic = {
      code: "E001",
      severity: "error",
      message: "private compiler path C:/secret/project",
      file: "C:/secret/project/system.json",
      line: 1,
      column: 1,
      jsonPointer: "",
    };
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: false,
      diagnostics: [warning, rawE001],
      toolFailure: true,
    }));
    const outcome = await injectedTools(compile).tools.validate(
      request(motorProject),
    );
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E001",
          severity: "error",
          message: "Agent validate tool failure (compile/E001).",
          file: "<project>",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
        warning,
      ],
      error: null,
      failureClass: "tool",
    });
    expect(JSON.stringify(outcome)).not.toContain("secret");
  });
});

describe("D7/D11 validate request closure", () => {
  it("finishes Layer 0 before declaration-order validation", async () => {
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: true,
      diagnostics: [],
      ir: motorIr,
    }));
    const { tools } = injectedTools(compile);
    const value = { format: "wrong" } as Record<string, unknown>;
    Object.defineProperty(value, "project", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    const outcome = await tools.validate(
      value as unknown as ValidateProjectRequest,
    );
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "A001",
        message: 'A001 Invalid validate request at "/project": hostile object.',
        field: "/project",
        reason: "hostile-object",
      },
      failureClass: "expected",
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("rejects strict instead of reinterpreting a warning", async () => {
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: true,
      diagnostics: [],
      ir: motorIr,
    }));
    const { tools } = injectedTools(compile);
    const outcome = await tools.validate({
      format: "agent-tool-request/0.1",
      project: warningProject,
      strict: true,
    } as unknown as ValidateProjectRequest);
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "A001",
        message:
          'A001 Invalid validate request at "/strict": additional property.',
        field: "/strict",
        reason: "additional-property",
      },
      failureClass: "expected",
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("uses format then project declaration order", async () => {
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: true,
      diagnostics: [],
      ir: motorIr,
    }));
    const outcome = await injectedTools(compile).tools.validate({
      format: "wrong-version",
      project: "",
      extra: true,
    } as unknown as ValidateProjectRequest);
    expect(outcome).toMatchObject({
      ok: false,
      error: { field: "/format", reason: "unsupported-value" },
    });
    expect(compile).not.toHaveBeenCalled();
  });
});
