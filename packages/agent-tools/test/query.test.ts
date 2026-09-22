import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type CompileResult,
  type ElectricalIr,
} from "@thermite/compiler";
import {
  createQueryEngine,
  serializeQueryResult,
  type QueryEngine,
  type QueryError,
  type QueryResult,
} from "@thermite/query";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createInternalReadTools,
  type ReadToolDependencies,
} from "../src/read-tools.js";
import {
  executeGraphQuery,
  type ExecuteGraphQueryRequest,
  type GraphQueryValue,
} from "../src/query.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolvePath(testRoot, "../../..");
const project = "examples/motor-starter";
const ls1Uid = "596f728b-1445-4c4b-8974-a3b4ea703636";
const cableUid = "c4c1bfdf-567a-4f6c-9e08-147342061afe";
let motorIr: ElectricalIr;

beforeAll(async () => {
  const compiled = await compileProject(project, repositoryRoot);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  motorIr = compiled.ir;
});

function request(
  query: ExecuteGraphQueryRequest["query"],
  projectPath = project,
): ExecuteGraphQueryRequest {
  return {
    format: "agent-tool-request/0.1",
    project: projectPath,
    query,
  };
}

function injectedTools(
  ir: ElectricalIr,
  compile = vi.fn(async (): Promise<CompileResult> => ({
    ok: true,
    diagnostics: [],
    ir,
  })),
  createEngine: (ir: Readonly<ElectricalIr>) => QueryEngine = createQueryEngine,
) {
  const dependencies: ReadToolDependencies = {
    compileProject: compile,
    createQueryEngine: createEngine,
  };
  return {
    compile,
    tools: createInternalReadTools({ cwd: repositoryRoot }, dependencies),
  };
}

interface QueryCase {
  readonly name: string;
  readonly query: ExecuteGraphQueryRequest["query"];
  readonly direct: (engine: QueryEngine) => QueryResult<GraphQueryValue>;
}

const successCases: readonly QueryCase[] = [
  {
    name: "neighbors by designation",
    query: {
      operation: "neighbors",
      selector: { by: "designation", value: "LS1" },
    },
    direct: (engine) => engine.neighbors({ by: "designation", value: "LS1" }),
  },
  {
    name: "neighbors by uid",
    query: {
      operation: "neighbors",
      selector: { by: "uid", value: ls1Uid },
    },
    direct: (engine) => engine.neighbors({ by: "uid", value: ls1Uid }),
  },
  {
    name: "trace by designation",
    query: {
      operation: "trace",
      selector: { by: "designation", value: "LS1" },
    },
    direct: (engine) => engine.trace({ by: "designation", value: "LS1" }),
  },
  {
    name: "trace by uid",
    query: {
      operation: "trace",
      selector: { by: "uid", value: ls1Uid },
    },
    direct: (engine) => engine.trace({ by: "uid", value: ls1Uid }),
  },
  {
    name: "cable by designation",
    query: {
      operation: "cable",
      selector: { by: "designation", value: "CBL1" },
    },
    direct: (engine) => engine.cable({ by: "designation", value: "CBL1" }),
  },
  {
    name: "cable by uid",
    query: {
      operation: "cable",
      selector: { by: "uid", value: cableUid },
    },
    direct: (engine) => engine.cable({ by: "uid", value: cableUid }),
  },
  {
    name: "net by id",
    query: {
      operation: "net",
      selector: {
        by: "id",
        value: { deviceUid: ls1Uid, terminalKey: "14" },
      },
    },
    direct: (engine) =>
      engine.net({
        by: "id",
        value: { deviceUid: ls1Uid, terminalKey: "14" },
      }),
  },
  {
    name: "net by parts",
    query: {
      operation: "net",
      selector: {
        by: "parts",
        deviceDesignation: "LS1",
        terminalKey: "14",
      },
    },
    direct: (engine) =>
      engine.net({
        by: "parts",
        deviceDesignation: "LS1",
        terminalKey: "14",
      }),
  },
  {
    name: "net by display",
    query: {
      operation: "net",
      selector: { by: "display", value: "LS1.14" },
    },
    direct: (engine) => engine.net({ by: "display", value: "LS1.14" }),
  },
];

describe("D6 closed graph-query dispatcher", () => {
  it.each(successCases)(
    "matches direct query DTO and bytes for $name",
    async ({ query, direct }) => {
      const directResult = direct(createQueryEngine(motorIr));
      if (!directResult.ok) throw new Error(JSON.stringify(directResult.error));

      const outcome = await createInternalReadTools({
        cwd: repositoryRoot,
      }).query(request(query));
      expect(outcome).toEqual({
        ok: true,
        diagnostics: [],
        value: directResult.value,
      });
      if (!outcome.ok) throw new Error("Expected graph-query success.");
      expect(serializeQueryResult(outcome.value)).toBe(
        serializeQueryResult(directResult.value),
      );
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(Object.isFrozen(outcome.value)).toBe(true);
    },
  );

  it("calls only the same-named engine method", () => {
    const representativeCases = [
      successCases[0]!,
      successCases[2]!,
      successCases[4]!,
      successCases[7]!,
    ];
    for (const testCase of representativeCases) {
      const engine = createQueryEngine(motorIr);
      const spies = {
        neighbors: vi.spyOn(engine, "neighbors"),
        trace: vi.spyOn(engine, "trace"),
        net: vi.spyOn(engine, "net"),
        cable: vi.spyOn(engine, "cable"),
      };
      const result = executeGraphQuery(engine, testCase.query);
      expect(result.ok).toBe(true);
      for (const [name, spy] of Object.entries(spies)) {
        expect(spy).toHaveBeenCalledTimes(
          name === testCase.query.operation ? 1 : 0,
        );
      }
    }
  });

  it("returns the plan-literal motor-starter graph facts", async () => {
    const tools = createInternalReadTools({ cwd: repositoryRoot });
    const neighbors = await tools.query(request(successCases[0]!.query));
    const trace = await tools.query(request(successCases[2]!.query));
    const cable = await tools.query(request(successCases[4]!.query));
    const net = await tools.query(request(successCases[7]!.query));
    if (
      !neighbors.ok ||
      neighbors.value.command !== "neighbors" ||
      !trace.ok ||
      trace.value.command !== "trace" ||
      !cable.ok ||
      cable.value.command !== "cable" ||
      !net.ok ||
      net.value.command !== "net"
    ) {
      throw new Error("Expected all four graph-query successes.");
    }
    expect(neighbors.value.device.designation).toBe("LS1");
    expect(
      neighbors.value.conductive.map(
        ({ otherTerminal }) => otherTerminal.display,
      ),
    ).toEqual(["JB1.X1.1", "JB1.X1.2"]);
    expect(neighbors.value.relations).toEqual([]);
    expect(
      trace.value.components.map(({ visits }) =>
        visits.map(({ terminal }) => terminal.display),
      ),
    ).toEqual([
      ["LS1.13", "JB1.X1.1", "TB1.2", "TB1.1", "PS1.+", "PLC1.L+"],
      ["LS1.14", "JB1.X1.2", "TB1.3", "PLC1.X1.0"],
    ]);
    expect(cable.value.cable.designation).toBe("CBL1");
    expect(cable.value.conductors.map(({ id }) => id.conductorId)).toEqual([
      "1+",
      "1-",
      "2+",
      "2-",
    ]);
    expect(net.value.selectedTerminal.display).toBe("LS1.14");
    expect(net.value.net.terminals.map(({ display }) => display)).toEqual([
      "JB1.X1.2",
      "LS1.14",
      "PLC1.X1.0",
      "TB1.3",
    ]);
    expect(
      net.value.net.elements.map(({ element }) => element.display),
    ).toEqual(["W-FLD-001", "W-FLD-003", "CBL1.1-"]);
    expect(net.value.net.potentials).toEqual([]);
  });

  it("compiles exactly once per request", async () => {
    const { compile, tools } = injectedTools(motorIr);
    await tools.query(request(successCases[0]!.query));
    await tools.query(request(successCases[7]!.query));
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile).toHaveBeenNthCalledWith(1, project, repositoryRoot);
    expect(compile).toHaveBeenNthCalledWith(2, project, repositoryRoot);
  });
});

describe("D6 query error parity", () => {
  const errorCases: readonly (QueryCase & { readonly expected: QueryError })[] =
    [
      {
        name: "Q001",
        query: {
          operation: "neighbors",
          selector: { by: "designation", value: "MISSING" },
        },
        direct: (engine) =>
          engine.neighbors({ by: "designation", value: "MISSING" }),
        expected: {
          code: "Q001",
          message: 'No project object has designation "MISSING".',
          input: "MISSING",
        },
      },
      {
        name: "Q002",
        query: {
          operation: "cable",
          selector: { by: "designation", value: "LS1" },
        },
        direct: (engine) => engine.cable({ by: "designation", value: "LS1" }),
        expected: {
          code: "Q002",
          message: 'Object "LS1" is a device; cable requires a cable.',
          input: "LS1",
          expectedKind: "cable",
          actualKind: "device",
        },
      },
      {
        name: "Q003",
        query: {
          operation: "net",
          selector: { by: "display", value: "NO_DOT" },
        },
        direct: (engine) => engine.net({ by: "display", value: "NO_DOT" }),
        expected: {
          code: "Q003",
          message:
            'Cannot parse terminal reference "NO_DOT"; use a dotted device-and-terminal reference or --device/--terminal.',
          input: "NO_DOT",
        },
      },
      {
        name: "Q004",
        query: {
          operation: "net",
          selector: {
            by: "parts",
            deviceDesignation: "LS1",
            terminalKey: "MISSING",
          },
        },
        direct: (engine) =>
          engine.net({
            by: "parts",
            deviceDesignation: "LS1",
            terminalKey: "MISSING",
          }),
        expected: {
          code: "Q004",
          message: 'Device "LS1" has no terminal "MISSING".',
          input: "MISSING",
          deviceDesignation: "LS1",
          terminalKey: "MISSING",
        },
      },
    ];

  it.each(errorCases)(
    "passes $name through byte-for-byte",
    async ({ query, direct, name, expected }) => {
      const directResult = direct(createQueryEngine(motorIr));
      if (directResult.ok) throw new Error(`Expected ${name}.`);
      expect(directResult.error).toEqual(expected);
      const outcome = await createInternalReadTools({
        cwd: repositoryRoot,
      }).query(request(query));
      expect(outcome).toEqual({
        ok: false,
        diagnostics: [],
        error: expected,
        failureClass: "expected",
      });
      if (outcome.ok || outcome.error === null) {
        throw new Error(`Expected ${name}.`);
      }
      expect(JSON.stringify(outcome.error)).toBe(
        JSON.stringify(directResult.error),
      );
    },
  );

  it("passes authored compiler errors through without dispatch", async () => {
    const fixture =
      "packages/compiler/fixtures/rules/exclusive-terminal-second-wire";
    const direct = await compileProject(fixture, repositoryRoot);
    if (direct.ok || direct.toolFailure) {
      throw new Error("Expected an authored compiler failure.");
    }
    const createEngine = vi.fn(createQueryEngine);
    const dependencies: ReadToolDependencies = {
      compileProject,
      createQueryEngine: createEngine,
    };
    const outcome = await createInternalReadTools(
      { cwd: repositoryRoot },
      dependencies,
    ).query(request(successCases[0]!.query, fixture));
    expect(outcome).toEqual({
      ok: false,
      diagnostics: direct.diagnostics,
      error: null,
      failureClass: "expected",
    });
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("routes an engine failure to sanitized E001 tool failure", async () => {
    const compile = vi.fn(async (): Promise<CompileResult> => ({
      ok: true,
      diagnostics: [],
      ir: motorIr,
    }));
    const createEngine = vi.fn((): QueryEngine => {
      throw { code: "INVALID_IR", message: "must not leak" };
    });
    const outcome = await injectedTools(
      motorIr,
      compile,
      createEngine,
    ).tools.query(request(successCases[0]!.query));
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E001",
          severity: "error",
          message: "Agent query tool failure (query/INVALID_IR).",
          file: "system.json",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ],
      error: null,
      failureClass: "tool",
    });
    expect(JSON.stringify(outcome)).not.toContain("must not leak");
  });
});

describe("D6/D11 request closure and selector validation", () => {
  it.each(["inspect", "resolveTerminal", "followConductive", "arbitrary"])(
    "rejects operation %s before compile",
    async (operation) => {
      const { compile, tools } = injectedTools(motorIr);
      const outcome = await tools.query(
        request({
          operation,
          selector: { by: "designation", value: "LS1" },
        } as unknown as ExecuteGraphQueryRequest["query"]),
      );
      expect(outcome).toEqual({
        ok: false,
        diagnostics: [],
        error: {
          code: "A001",
          message:
            'A001 Invalid query request at "/query/operation": unsupported value.',
          field: "/query/operation",
          reason: "unsupported-value",
        },
        failureClass: "expected",
      });
      expect(compile).not.toHaveBeenCalled();
    },
  );

  it("rejects object/terminal selector crossovers and extra controls", async () => {
    const { compile, tools } = injectedTools(motorIr);
    const crossover = await tools.query(
      request({
        operation: "trace",
        selector: {
          by: "parts",
          deviceDesignation: "LS1",
          terminalKey: "14",
        },
      } as unknown as ExecuteGraphQueryRequest["query"]),
    );
    expect(crossover).toMatchObject({
      ok: false,
      error: {
        field: "/query/selector/by",
        reason: "unsupported-value",
      },
    });

    const extra = await tools.query(
      request({
        operation: "neighbors",
        selector: { by: "designation", value: "LS1", depth: 2 },
        filter: "wire",
      } as unknown as ExecuteGraphQueryRequest["query"]),
    );
    expect(extra).toMatchObject({
      ok: false,
      error: {
        field: "/query/selector/depth",
        reason: "additional-property",
      },
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it("validates nested terminal-id fields in declaration order", async () => {
    const { compile, tools } = injectedTools(motorIr);
    const outcome = await tools.query(
      request({
        operation: "net",
        selector: {
          by: "id",
          value: { deviceUid: "", terminalKey: "", extra: true },
        },
      } as unknown as ExecuteGraphQueryRequest["query"]),
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        field: "/query/selector/value/deviceUid",
        reason: "empty-string",
      },
    });
    expect(compile).not.toHaveBeenCalled();
  });
});
