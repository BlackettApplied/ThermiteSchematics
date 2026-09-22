import { readFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type CompiledProjectPresentation,
  type CompileResult,
  type ElectricalIr,
} from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import {
  renderSchematic,
  type RenderFailure,
  type RenderOutcome,
  type RenderedSchematic,
  type SchematicViewRequest,
} from "@thermite/render";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { CreateViewRequest } from "../src/create-view.js";
import {
  createInternalReadTools,
  type ReadToolDependencies,
} from "../src/read-tools.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolvePath(testRoot, "../../..");
const motorProject = "examples/motor-starter";
const unavailableShippedLibraryProject =
  "packages/compiler/fixtures/shipped-library-unavailable";
const traceGolden = join(
  repositoryRoot,
  "packages/render/test/goldens/motor-starter/ls1-to-plc1-include-power-left-to-right.svg",
);

let motorIr: ElectricalIr;
let motorPresentation: CompiledProjectPresentation;

beforeAll(async () => {
  const compiled = await compileProject(motorProject, repositoryRoot);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  motorIr = compiled.ir;
  motorPresentation = compiled.presentation;
});

function request(
  spec: SchematicViewRequest,
  project = motorProject,
): CreateViewRequest {
  return {
    format: "agent-tool-request/0.1",
    project,
    spec,
  };
}

function uidForDevice(designation: string): string {
  const device = motorIr.devices.find(
    (candidate) => candidate.designation === designation,
  );
  if (device === undefined) {
    throw new Error("Missing fixture device " + designation + ".");
  }
  return device.uid;
}

function uidForCable(designation: string): string {
  const cable = motorIr.cables.find(
    (candidate) => candidate.designation === designation,
  );
  if (cable === undefined) {
    throw new Error("Missing fixture cable " + designation + ".");
  }
  return cable.uid;
}

type RenderDependency = NonNullable<ReadToolDependencies["renderSchematic"]>;

const compiledPresentation = Object.freeze({
  format: "project-presentation/0.1" as const,
  revision: "A",
  backgroundColor: "#ffffff",
  titleBlockLines: Object.freeze(["Motor starter reference"]),
});

function successfulCompile(): CompileResult {
  return {
    ok: true,
    diagnostics: [],
    ir: motorIr,
    presentation: compiledPresentation,
  };
}

function injectedTools(
  compile: ReadToolDependencies["compileProject"] = vi.fn(async () =>
    successfulCompile(),
  ),
  render: RenderDependency = vi.fn(async (ir, spec, presentation) =>
    renderSchematic(ir, spec, presentation),
  ),
) {
  const createEngine = vi.fn(createQueryEngine);
  const dependencies: ReadToolDependencies = {
    compileProject: compile,
    createQueryEngine: createEngine,
    renderSchematic: render,
  };
  return {
    compile,
    createEngine,
    render,
    tools: createInternalReadTools({ cwd: repositoryRoot }, dependencies),
  };
}

function mockRenderedSchematic(): RenderedSchematic {
  return {
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: uidForDevice("K1"), designation: "K1" },
      flow: "left-to-right",
    },
    summary: {
      deviceUids: [],
      terminalIds: [],
      functionIds: [],
      conductiveElementIds: [],
      netIds: [],
      presentationNodeIds: [],
    },
    svg: "<svg/>\n",
  };
}

function expectFrozenTree(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const member of Object.values(value)) expectFrozenTree(member, seen);
}

describe("D8 direct-render parity", () => {
  it("passes every current request variant through with UID/designation and flow coverage", async () => {
    const cases: readonly {
      readonly name: string;
      readonly spec: SchematicViewRequest;
    }[] = [
      {
        name: "legacy control, designation, omitted flow",
        spec: {
          format: "schematic-view-request/0.1",
          family: "control",
          root: { by: "designation", value: "K1" },
        },
      },
      {
        name: "legacy power, UID, explicit top-to-bottom",
        spec: {
          format: "schematic-view-request/0.1",
          family: "power",
          root: { by: "uid", value: uidForDevice("M1") },
          flow: "top-to-bottom",
        },
      },
      {
        name: "trace, UID root, designation target, explicit left-to-right",
        spec: {
          format: "schematic-view-request/0.2",
          root: { by: "uid", value: uidForDevice("LS1") },
          intent: {
            kind: "trace",
            to: { by: "designation", value: "PLC1" },
            includePower: true,
          },
          flow: "left-to-right",
        },
      },
      {
        name: "conductors, designation, omitted flow",
        spec: {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "CBL1" },
          intent: { kind: "conductors" },
        },
      },
      {
        name: "loads, UID, explicit top-to-bottom",
        spec: {
          format: "schematic-view-request/0.2",
          root: { by: "uid", value: uidForDevice("PS1") },
          intent: { kind: "loads" },
          flow: "top-to-bottom",
        },
      },
    ];

    for (const testCase of cases) {
      const direct = await renderSchematic(
        motorIr,
        testCase.spec,
        motorPresentation,
      );
      const outcome = await createInternalReadTools({
        cwd: repositoryRoot,
      }).createView(request(testCase.spec));
      expect(outcome, testCase.name).toEqual(
        direct.ok
          ? { ok: true, diagnostics: [], value: direct.value }
          : {
              ok: false,
              diagnostics: [],
              error: direct.error,
              failureClass: "expected",
            },
      );
      expectFrozenTree(outcome);
    }
  });

  it("preserves the reviewed baseline trace SVG bytes", async () => {
    const spec: SchematicViewRequest = {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      },
      flow: "left-to-right",
    };
    const outcome = await createInternalReadTools({
      cwd: repositoryRoot,
    }).createView(request(spec));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.svg).toBe(await readFile(traceGolden, "utf8"));
  });
});

describe("D2/D8 orchestration and purity", () => {
  it("propagates the exact two E032 rows before rendering", async () => {
    const render = vi.fn(renderSchematic);
    const outcome = await injectedTools(
      (inputPath, cwd) => compileProject(inputPath, cwd),
      render,
    ).tools.createView(
      request(
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "K1" },
          family: "control",
        },
        unavailableShippedLibraryProject,
      ),
    );
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
    expect(render).not.toHaveBeenCalled();
  });

  it("compiles once and gives renderSchematic the untouched detached spec and compiled IR", async () => {
    const callerRequest: CreateViewRequest = request({
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: false,
      },
      flow: "top-to-bottom",
    });
    const callerSnapshot = structuredClone(callerRequest);
    const irSnapshot = structuredClone(motorIr);
    const renderedValue = mockRenderedSchematic();
    const compile = vi.fn(async () => successfulCompile());
    const render = vi.fn(
      async (): Promise<RenderOutcome<RenderedSchematic>> => ({
        ok: true,
        value: renderedValue,
      }),
    );
    const injected = injectedTools(compile, render);

    const outcome = await injected.tools.createView(callerRequest);

    expect(compile).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledWith(motorProject, repositoryRoot);
    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0]?.[0]).toBe(motorIr);
    expect(render.mock.calls[0]?.[1]).toEqual(callerRequest.spec);
    expect(render.mock.calls[0]?.[1]).not.toBe(callerRequest.spec);
    expect(render.mock.calls[0]?.[2]).toBe(compiledPresentation);
    expectFrozenTree(render.mock.calls[0]?.[1]);
    expect(injected.createEngine).not.toHaveBeenCalled();
    expect(callerRequest).toEqual(callerSnapshot);
    expect(motorIr).toEqual(irSnapshot);
    expect(outcome).toEqual({
      ok: true,
      diagnostics: [],
      value: renderedValue,
    });
    if (!outcome.ok) return;
    expect(outcome.value).not.toBe(renderedValue);
    expectFrozenTree(outcome);
  });
});

describe("D8 exact renderer failure passthrough", () => {
  const failures: readonly RenderFailure[] = [
    {
      code: "Q001",
      message: "Object not found.",
      input: "missing",
    },
    {
      code: "R001",
      message: "Invalid view request.",
      requestedFormat: {
        kind: "string",
        value: "schematic-view-request/0.1",
      },
      requestedRoot: {
        kind: "selector",
        by: "designation",
        value: "K1",
      },
      requestedFamily: { kind: "string", value: "control" },
      requestedFlow: { kind: "missing" },
      root: "K1",
    },
    {
      code: "R002",
      message: "Incomplete control path.",
      root: "K1",
      family: "control",
      deviceUid: "device",
      pathSide: "return",
    },
    {
      code: "R003",
      message: "Unsupported symbol mapping.",
      root: "K1",
      family: "control",
      deviceUid: "device",
      typeId: "core:unknown",
    },
    {
      code: "R004",
      message: "Invalid layout.",
      root: "K1",
      family: "control",
      netId: "net-1",
    },
    {
      code: "R005",
      message: "Invalid render text.",
      root: "K1",
      family: "control",
      ownerKind: "device",
      ownerId: "device",
      field: "device.designation",
      reason: "unpaired-surrogate",
    },
  ];

  it.each(failures)("passes $code through without remapping", async (error) => {
    const render = vi.fn(
      async (): Promise<RenderOutcome<RenderedSchematic>> => ({
        ok: false,
        error,
      }),
    );
    const outcome = await injectedTools(undefined, render).tools.createView(
      request({
        format: "schematic-view-request/0.1",
        family: "control",
        root: { by: "designation", value: "K1" },
      }),
    );
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [],
      error,
      failureClass: "expected",
    });
    if (outcome.ok) return;
    expect(outcome.error).not.toBe(error);
    expectFrozenTree(outcome);
  });

  it("sanitizes a thrown renderer exception at the render stage", async () => {
    const render = vi.fn(async () => {
      const error = Object.assign(new Error("C:/private/stage"), {
        code: "ELK_FAILURE",
      });
      throw error;
    });
    const outcome = await injectedTools(undefined, render).tools.createView(
      request({
        format: "schematic-view-request/0.1",
        family: "control",
        root: { by: "designation", value: "K1" },
      }),
    );
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E001",
          severity: "error",
          message: "Agent create-view tool failure (render/ELK_FAILURE).",
          file: motorIr.project.source.file,
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ],
      error: null,
      failureClass: "tool",
    });
    expect(JSON.stringify(outcome)).not.toContain("private");
  });
});

describe("D8/D11 request validation", () => {
  const validTrace = {
    format: "agent-tool-request/0.1",
    project: motorProject,
    spec: {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      },
      flow: "left-to-right",
    },
  };

  it.each([
    [
      "outer version",
      { ...validTrace, format: "agent-tool-request/9.9" },
      "/format",
    ],
    [
      "ViewSpec version",
      { ...validTrace, spec: { ...validTrace.spec, format: "wrong" } },
      "/spec/format",
    ],
    [
      "legacy family",
      {
        ...validTrace,
        spec: {
          format: "schematic-view-request/0.1",
          family: "signal",
          root: { by: "designation", value: "K1" },
        },
      },
      "/spec/family",
    ],
    [
      "legacy root selector",
      {
        ...validTrace,
        spec: {
          format: "schematic-view-request/0.1",
          family: "control",
          root: { by: "id", value: "K1" },
        },
      },
      "/spec/root/by",
    ],
    [
      "legacy flow",
      {
        ...validTrace,
        spec: {
          format: "schematic-view-request/0.1",
          family: "control",
          root: { by: "designation", value: "K1" },
          flow: "right-to-left",
        },
      },
      "/spec/flow",
    ],
    [
      "intent root selector",
      {
        ...validTrace,
        spec: {
          ...validTrace.spec,
          root: { by: "display", value: "LS1" },
        },
      },
      "/spec/root/by",
    ],
    [
      "intent discriminator",
      {
        ...validTrace,
        spec: { ...validTrace.spec, intent: { kind: "path" } },
      },
      "/spec/intent/kind",
    ],
    [
      "trace target selector",
      {
        ...validTrace,
        spec: {
          ...validTrace.spec,
          intent: {
            ...validTrace.spec.intent,
            to: { by: "display", value: "PLC1" },
          },
        },
      },
      "/spec/intent/to/by",
    ],
    [
      "intent flow",
      { ...validTrace, spec: { ...validTrace.spec, flow: "automatic" } },
      "/spec/flow",
    ],
  ] as const)(
    "routes a wrong %s literal to exact A001",
    async (_name, candidate, field) => {
      const injected = injectedTools();
      const outcome = await injected.tools.createView(
        candidate as unknown as CreateViewRequest,
      );
      expect(outcome).toEqual({
        ok: false,
        diagnostics: [],
        error: {
          code: "A001",
          message:
            "A001 Invalid create-view request at " +
            JSON.stringify(field) +
            ": unsupported value.",
          field,
          reason: "unsupported-value",
        },
        failureClass: "expected",
      });
      expect(injected.compile).not.toHaveBeenCalled();
      expect(injected.render).not.toHaveBeenCalled();
    },
  );

  it("completes Layer 0 before testing the wrong outer version", async () => {
    let getterCalls = 0;
    const candidate = structuredClone(validTrace) as Record<string, unknown> & {
      spec: { intent: Record<string, unknown> };
    };
    candidate.format = "wrong";
    Object.defineProperty(candidate.spec.intent, "kind", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "trace";
      },
    });
    const injected = injectedTools();
    const outcome = await injected.tools.createView(
      candidate as unknown as CreateViewRequest,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: "A001",
        field: "/spec/intent/kind",
        reason: "hostile-object",
      },
      failureClass: "expected",
    });
    expect(getterCalls).toBe(0);
    expect(injected.compile).not.toHaveBeenCalled();
  });

  it("uses v0.2 declaration order before additional-property checks", async () => {
    const injected = injectedTools();
    const outcome = await injected.tools.createView({
      format: "agent-tool-request/0.1",
      project: motorProject,
      spec: {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: "yes",
          extra: true,
        },
      },
    } as unknown as CreateViewRequest);
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: "A001",
        field: "/spec/intent/includePower",
        reason: "wrong-type",
      },
    });
    expect(injected.compile).not.toHaveBeenCalled();
  });
});
