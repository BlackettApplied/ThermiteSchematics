import { resolve as resolvePath } from "node:path";

import {
  compileProject,
  type CompiledProjectPresentation,
  type CompileResult,
  type ElectricalIr,
} from "@thermite/compiler";
import {
  createQueryEngine,
  type InspectResult,
  type QueryEngine,
  type QueryError,
  type QueryResult,
} from "@thermite/query";
import {
  renderSchematic,
  type RenderError,
  type RenderOutcome,
  type RenderedSchematic,
  type SchematicViewRequest,
} from "@thermite/render";
import type { Diagnostic } from "@thermite/schema";

import type {
  AgentToolName,
  AgentToolOutcome,
  DeepReadonly,
} from "./common/contracts.js";
import type { AgentToolError, AgentToolFailure } from "./common/errors.js";
import { detachedFrozenCopy } from "./common/immutable.js";
import {
  diagnosticForReadToolException,
  sanitizeCompileToolFailure,
  type ReadToolFailureStage,
} from "./common/tool-failure.js";
import {
  validateCreateViewRequest,
  type CreateViewRequest,
} from "./create-view.js";
import {
  inspectCompiledProject,
  validateInspectRequest,
  type InspectObjectRequest,
} from "./inspect.js";
import {
  executeGraphQuery,
  validateGraphQueryRequest,
  type ExecuteGraphQueryRequest,
  type GraphQueryValue,
} from "./query.js";
import {
  resolveCompiledProject,
  validateResolveRequest,
  type ResolveObjectsRequest,
  type ResolveObjectsValue,
} from "./resolve.js";
import {
  validateValidateProjectRequest,
  type ValidateProjectRequest,
  type ValidateProjectValue,
} from "./validate.js";

export interface ReadToolDependencies {
  readonly compileProject: (
    inputPath: string | undefined,
    cwd: string,
  ) => Promise<CompileResult>;
  readonly createQueryEngine: (ir: Readonly<ElectricalIr>) => QueryEngine;
  readonly renderSchematic?: (
    ir: Readonly<ElectricalIr>,
    spec: Readonly<SchematicViewRequest>,
    presentation?: Readonly<CompiledProjectPresentation>,
  ) => Promise<RenderOutcome<RenderedSchematic>>;
}

export interface InternalReadToolsOptions {
  readonly cwd?: string;
}

export interface InternalReadTools {
  readonly resolve: (
    request: DeepReadonly<ResolveObjectsRequest>,
  ) => Promise<
    AgentToolOutcome<ResolveObjectsValue, QueryError | AgentToolError>
  >;
  readonly inspect: (
    request: DeepReadonly<InspectObjectRequest>,
  ) => Promise<AgentToolOutcome<InspectResult, QueryError | AgentToolError>>;
  readonly query: (
    request: DeepReadonly<ExecuteGraphQueryRequest>,
  ) => Promise<AgentToolOutcome<GraphQueryValue, QueryError | AgentToolError>>;
  readonly validate: (
    request: DeepReadonly<ValidateProjectRequest>,
  ) => Promise<AgentToolOutcome<ValidateProjectValue, AgentToolError>>;
  readonly createView: (
    request: DeepReadonly<CreateViewRequest>,
  ) => Promise<
    AgentToolOutcome<
      RenderedSchematic,
      QueryError | RenderError | AgentToolError
    >
  >;
}

const defaultReadToolDependencies: ReadToolDependencies = Object.freeze({
  compileProject,
  createQueryEngine,
  renderSchematic,
});

type ReadFailure = QueryError | AgentToolError;

function failureOutcome<Value, Failure extends AgentToolFailure = ReadFailure>(
  diagnostics: readonly Diagnostic[],
  error: Failure | null,
  failureClass: "expected" | "tool",
): AgentToolOutcome<Value, Failure> {
  return {
    ok: false,
    diagnostics,
    error: error as DeepReadonly<Failure> | null,
    failureClass,
  };
}

function successOutcome<Value, Failure extends AgentToolFailure = ReadFailure>(
  diagnostics: readonly Diagnostic[],
  value: Value,
): AgentToolOutcome<Value, Failure> {
  return {
    ok: true,
    diagnostics,
    value: value as DeepReadonly<Value>,
  };
}

function toolExceptionOutcome<
  Value,
  Failure extends AgentToolFailure = ReadFailure,
>(
  tool: AgentToolName,
  stage: ReadToolFailureStage,
  error: unknown,
  file?: string,
): AgentToolOutcome<Value, Failure> {
  return failureOutcome<Value, Failure>(
    diagnosticForReadToolException(tool, stage, error, file),
    null,
    "tool",
  );
}

function finish<Value, Failure extends AgentToolFailure = ReadFailure>(
  tool: AgentToolName,
  outcome: AgentToolOutcome<Value, Failure>,
): AgentToolOutcome<Value, Failure> {
  try {
    return detachedFrozenCopy(outcome) as unknown as AgentToolOutcome<
      Value,
      Failure
    >;
  } catch (error) {
    return detachedFrozenCopy(
      toolExceptionOutcome<Value, Failure>(tool, "unexpected", error),
    ) as unknown as AgentToolOutcome<Value, Failure>;
  }
}

async function runCompiledRead<Value>(
  tool: "resolve" | "inspect" | "query",
  project: string,
  cwd: string,
  dependencies: ReadToolDependencies,
  query: (
    ir: Readonly<ElectricalIr>,
    engine: QueryEngine,
  ) => QueryResult<Value>,
): Promise<AgentToolOutcome<Value, ReadFailure>> {
  let compiled: CompileResult;
  try {
    compiled = await dependencies.compileProject(project, cwd);
  } catch (error) {
    return finish(tool, toolExceptionOutcome<Value>(tool, "compile", error));
  }
  if (!compiled.ok) {
    const diagnostics = compiled.toolFailure
      ? sanitizeCompileToolFailure(tool, compiled.diagnostics)
      : compiled.diagnostics;
    return finish(
      tool,
      failureOutcome<Value>(
        diagnostics,
        null,
        compiled.toolFailure ? "tool" : "expected",
      ),
    );
  }

  try {
    const engine = dependencies.createQueryEngine(compiled.ir);
    const result = query(compiled.ir, engine);
    if (!result.ok) {
      return finish(
        tool,
        failureOutcome<Value>(compiled.diagnostics, result.error, "expected"),
      );
    }
    return finish(tool, successOutcome(compiled.diagnostics, result.value));
  } catch (error) {
    return finish(
      tool,
      toolExceptionOutcome<Value>(
        tool,
        "query",
        error,
        compiled.ir.project.source.file,
      ),
    );
  }
}

async function runValidation(
  project: string,
  cwd: string,
  dependencies: ReadToolDependencies,
): Promise<AgentToolOutcome<ValidateProjectValue, AgentToolError>> {
  let compiled: CompileResult;
  try {
    compiled = await dependencies.compileProject(project, cwd);
  } catch (error) {
    return finish(
      "validate",
      toolExceptionOutcome<ValidateProjectValue, AgentToolError>(
        "validate",
        "compile",
        error,
      ),
    );
  }
  if (!compiled.ok) {
    const diagnostics = compiled.toolFailure
      ? sanitizeCompileToolFailure("validate", compiled.diagnostics)
      : compiled.diagnostics;
    return finish(
      "validate",
      failureOutcome<ValidateProjectValue, AgentToolError>(
        diagnostics,
        null,
        compiled.toolFailure ? "tool" : "expected",
      ),
    );
  }

  const value: ValidateProjectValue = { valid: true };
  return finish(
    "validate",
    successOutcome<ValidateProjectValue, AgentToolError>(
      compiled.diagnostics,
      value,
    ),
  );
}

async function runCreateView(
  request: CreateViewRequest,
  cwd: string,
  dependencies: ReadToolDependencies,
): Promise<
  AgentToolOutcome<RenderedSchematic, QueryError | RenderError | AgentToolError>
> {
  type CreateViewFailure = QueryError | RenderError | AgentToolError;
  let compiled: CompileResult;
  try {
    compiled = await dependencies.compileProject(request.project, cwd);
  } catch (error) {
    return finish(
      "create-view",
      toolExceptionOutcome<RenderedSchematic, CreateViewFailure>(
        "create-view",
        "compile",
        error,
      ),
    );
  }
  if (!compiled.ok) {
    const diagnostics = compiled.toolFailure
      ? sanitizeCompileToolFailure("create-view", compiled.diagnostics)
      : compiled.diagnostics;
    return finish(
      "create-view",
      failureOutcome<RenderedSchematic, CreateViewFailure>(
        diagnostics,
        null,
        compiled.toolFailure ? "tool" : "expected",
      ),
    );
  }

  try {
    const renderer = dependencies.renderSchematic ?? renderSchematic;
    const rendered = await renderer(
      compiled.ir,
      request.spec,
      compiled.presentation,
    );
    if (!rendered.ok) {
      return finish(
        "create-view",
        failureOutcome<RenderedSchematic, CreateViewFailure>(
          compiled.diagnostics,
          rendered.error,
          "expected",
        ),
      );
    }
    return finish(
      "create-view",
      successOutcome<RenderedSchematic, CreateViewFailure>(
        compiled.diagnostics,
        rendered.value,
      ),
    );
  } catch (error) {
    return finish(
      "create-view",
      toolExceptionOutcome<RenderedSchematic, CreateViewFailure>(
        "create-view",
        "render",
        error,
        compiled.ir.project.source.file,
      ),
    );
  }
}

export function createInternalReadTools(
  options: InternalReadToolsOptions = {},
  dependencies: ReadToolDependencies = defaultReadToolDependencies,
): InternalReadTools {
  const cwd = resolvePath(options.cwd ?? process.cwd());
  return Object.freeze({
    async resolve(request: DeepReadonly<ResolveObjectsRequest>) {
      try {
        const validated = validateResolveRequest(request);
        if (!validated.ok) {
          return finish(
            "resolve",
            failureOutcome<ResolveObjectsValue>(
              [],
              validated.error,
              "expected",
            ),
          );
        }
        return await runCompiledRead(
          "resolve",
          validated.value.project,
          cwd,
          dependencies,
          (ir, engine) =>
            resolveCompiledProject(ir, engine, validated.value.target),
        );
      } catch (error) {
        return finish(
          "resolve",
          toolExceptionOutcome<ResolveObjectsValue>(
            "resolve",
            "unexpected",
            error,
          ),
        );
      }
    },

    async inspect(request: DeepReadonly<InspectObjectRequest>) {
      try {
        const validated = validateInspectRequest(request);
        if (!validated.ok) {
          return finish(
            "inspect",
            failureOutcome<InspectResult>([], validated.error, "expected"),
          );
        }
        return await runCompiledRead(
          "inspect",
          validated.value.project,
          cwd,
          dependencies,
          (_ir, engine) =>
            inspectCompiledProject(engine, validated.value.selector),
        );
      } catch (error) {
        return finish(
          "inspect",
          toolExceptionOutcome<InspectResult>("inspect", "unexpected", error),
        );
      }
    },

    async query(request: DeepReadonly<ExecuteGraphQueryRequest>) {
      try {
        const validated = validateGraphQueryRequest(request);
        if (!validated.ok) {
          return finish(
            "query",
            failureOutcome<GraphQueryValue>([], validated.error, "expected"),
          );
        }
        return await runCompiledRead(
          "query",
          validated.value.project,
          cwd,
          dependencies,
          (_ir, engine) => executeGraphQuery(engine, validated.value.query),
        );
      } catch (error) {
        return finish(
          "query",
          toolExceptionOutcome<GraphQueryValue>("query", "unexpected", error),
        );
      }
    },

    async validate(request: DeepReadonly<ValidateProjectRequest>) {
      try {
        const validated = validateValidateProjectRequest(request);
        if (!validated.ok) {
          return finish(
            "validate",
            failureOutcome<ValidateProjectValue, AgentToolError>(
              [],
              validated.error,
              "expected",
            ),
          );
        }
        return await runValidation(validated.value.project, cwd, dependencies);
      } catch (error) {
        return finish(
          "validate",
          toolExceptionOutcome<ValidateProjectValue, AgentToolError>(
            "validate",
            "unexpected",
            error,
          ),
        );
      }
    },

    async createView(request: DeepReadonly<CreateViewRequest>) {
      type CreateViewFailure = QueryError | RenderError | AgentToolError;
      try {
        const validated = validateCreateViewRequest(request);
        if (!validated.ok) {
          return finish(
            "create-view",
            failureOutcome<RenderedSchematic, CreateViewFailure>(
              [],
              validated.error,
              "expected",
            ),
          );
        }
        return await runCreateView(validated.value, cwd, dependencies);
      } catch (error) {
        return finish(
          "create-view",
          toolExceptionOutcome<RenderedSchematic, CreateViewFailure>(
            "create-view",
            "unexpected",
            error,
          ),
        );
      }
    },
  });
}
