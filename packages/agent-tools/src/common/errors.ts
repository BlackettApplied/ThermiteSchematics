import type { QueryError } from "@thermite/query";
import type { RenderError } from "@thermite/render";

import type { AgentToolName } from "./contracts.js";

export type AgentToolErrorCode = "A001" | "A002" | "A003" | "A004";

export type A001Reason =
  | "invalid-json"
  | "missing"
  | "wrong-type"
  | "unsupported-value"
  | "additional-property"
  | "empty-string"
  | "empty-array"
  | "invalid-integrity"
  | "non-finite-number"
  | "hostile-object"
  | "duplicate-member";

export type A002Reason =
  | "invalid-pointer"
  | "root-mutation"
  | "missing-target"
  | "invalid-array-index"
  | "test-failed";

export type A003Reason =
  "invalid-path" | "duplicate-file" | "not-project-source" | "reparse-point";

export interface A001Error {
  readonly code: "A001";
  readonly message: string;
  readonly field: string;
  readonly reason: A001Reason;
}

export interface A002Error {
  readonly code: "A002";
  readonly message: string;
  readonly file: string;
  readonly operationIndex: number;
  readonly path: string;
  readonly reason: A002Reason;
}

export interface A003Error {
  readonly code: "A003";
  readonly message: string;
  readonly file: string;
  readonly reason: A003Reason;
}

export interface A004Error {
  readonly code: "A004";
  readonly message: string;
  readonly file: string;
  readonly expectedIntegrity: string;
  readonly actualIntegrity: string;
}

export type AgentToolError = A001Error | A002Error | A003Error | A004Error;

export type AgentToolFailure = AgentToolError | QueryError | RenderError;

function quote(value: string): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError("A string must have a JSON representation.");
  }
  return encoded;
}

function reasonText(reason: A001Reason | A002Reason | A003Reason): string {
  return reason.replaceAll("-", " ");
}

export function createA001Error(
  tool: AgentToolName,
  field: string,
  reason: A001Reason,
): A001Error {
  const error: A001Error = {
    code: "A001",
    message: `A001 Invalid ${tool} request at ${quote(field)}: ${reasonText(reason)}.`,
    field,
    reason,
  };
  return Object.freeze(error);
}

export function createA002Error(
  file: string,
  operationIndex: number,
  path: string,
  reason: A002Reason,
): A002Error {
  const error: A002Error = {
    code: "A002",
    message: `A002 Source patch failed for ${quote(file)} operation ${operationIndex} at ${quote(path)}: ${reasonText(reason)}.`,
    file,
    operationIndex,
    path,
    reason,
  };
  return Object.freeze(error);
}

export function createA003Error(file: string, reason: A003Reason): A003Error {
  const error: A003Error = {
    code: "A003",
    message: `A003 Unsafe source patch target ${quote(file)}: ${reasonText(reason)}.`,
    file,
    reason,
  };
  return Object.freeze(error);
}

export function createA004Error(
  file: string,
  expectedIntegrity: string,
  actualIntegrity: string,
): A004Error {
  const error: A004Error = {
    code: "A004",
    message: `A004 Guarded file ${quote(file)} does not match its required integrity.`,
    file,
    expectedIntegrity,
    actualIntegrity,
  };
  return Object.freeze(error);
}
