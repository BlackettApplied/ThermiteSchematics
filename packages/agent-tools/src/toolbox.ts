import { resolve as resolvePath } from "node:path";

import type { QueryError } from "@thermite/query";
import type { RenderError, RenderedSchematic } from "@thermite/render";

import {
  createInternalApplySourcePatchTool,
  type ApplySourcePatchValue,
} from "./apply-source-patch.js";
import type { AgentToolOutcome, DeepReadonly } from "./common/contracts.js";
import type { AgentToolError } from "./common/errors.js";
import type { CreateViewRequest } from "./create-view.js";
import type { InspectObjectRequest, InspectResult } from "./inspect.js";
import type { ExecuteGraphQueryRequest, GraphQueryValue } from "./query.js";
import { createInternalReadTools } from "./read-tools.js";
import type { ResolveObjectsRequest, ResolveObjectsValue } from "./resolve.js";
import type { ApplySourcePatchRequest } from "./source-patch-request.js";
import type {
  ValidateProjectRequest,
  ValidateProjectValue,
} from "./validate.js";

export interface CreateAgentToolsOptions {
  readonly cwd?: string;
}

export interface AgentTools {
  resolve(
    request: DeepReadonly<ResolveObjectsRequest>,
  ): Promise<
    AgentToolOutcome<ResolveObjectsValue, QueryError | AgentToolError>
  >;
  inspect(
    request: DeepReadonly<InspectObjectRequest>,
  ): Promise<AgentToolOutcome<InspectResult, QueryError | AgentToolError>>;
  query(
    request: DeepReadonly<ExecuteGraphQueryRequest>,
  ): Promise<AgentToolOutcome<GraphQueryValue, QueryError | AgentToolError>>;
  validate(
    request: DeepReadonly<ValidateProjectRequest>,
  ): Promise<AgentToolOutcome<ValidateProjectValue, AgentToolError>>;
  createView(
    request: DeepReadonly<CreateViewRequest>,
  ): Promise<
    AgentToolOutcome<
      RenderedSchematic,
      QueryError | RenderError | AgentToolError
    >
  >;
  applySourcePatch(
    request: DeepReadonly<ApplySourcePatchRequest>,
  ): Promise<AgentToolOutcome<ApplySourcePatchValue, AgentToolError>>;
}

export function createAgentTools(
  options: DeepReadonly<CreateAgentToolsOptions> = {},
): AgentTools {
  const cwd = resolvePath(options.cwd ?? process.cwd());
  const readTools = createInternalReadTools({ cwd });
  const patchTool = createInternalApplySourcePatchTool({ cwd });
  return Object.freeze({
    resolve: readTools.resolve,
    inspect: readTools.inspect,
    query: readTools.query,
    validate: readTools.validate,
    createView: readTools.createView,
    applySourcePatch: patchTool.applySourcePatch,
  });
}
