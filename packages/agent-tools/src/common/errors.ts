import type { QueryError } from "@thermite/query";
import type { RenderError } from "@thermite/render";
import { LIBRARY_LOCK_FILE_NAME } from "@thermite/compiler";
import { boundedAlternatives, formatAllowedValues } from "@thermite/schema";

import type { AgentToolName } from "./contracts.js";

export type AgentToolErrorCode =
  "A001" | "A002" | "A003" | "A004" | "A005" | "A006";

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
  /** For a closed-literal field: the accepted literals in declared order (at most 50). */
  readonly allowed?: readonly string[];
  /** Number of accepted literals whenever `allowed` is present. */
  readonly allowedCount?: number;
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

export interface ProjectWriteOwner {
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
  readonly thermiteVersion: string;
}

export type ProjectWriteOwnerState =
  "alive" | "not-running" | "other-host" | "unknown";

export interface A005Error {
  readonly code: "A005";
  readonly message: string;
  readonly file: string;
  readonly lockPath: string;
  readonly owner: ProjectWriteOwner | null;
  readonly ageMs: number | null;
  readonly ownerState: ProjectWriteOwnerState;
}

export type AgentToolError =
  A001Error | A002Error | A003Error | A004Error | A005Error | A006Error;

export interface A006Error {
  readonly code: "A006";
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export function createA006Error(
  file: string,
  line: number,
  column: number,
): A006Error {
  const remedy =
    file === LIBRARY_LOCK_FILE_NAME
      ? "run thermite lock . to regenerate the lock, then validate"
      : "repair JSON syntax or duplicate keys with an ordinary edit, then validate and resume the guarded loop";
  return Object.freeze({
    code: "A006",
    message: `A006 Cannot apply a guarded patch to ${JSON.stringify(file)} at line ${line}, column ${column}: ${remedy} (thermite guide agent-requests).`,
    file,
    line,
    column,
  });
}

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
  allowedValues?: Iterable<string>,
): A001Error {
  const message = `A001 Invalid ${tool} request at ${quote(field)}: ${reasonText(reason)}`;
  if (allowedValues === undefined) {
    return Object.freeze({
      code: "A001",
      message: `${message}.`,
      field,
      reason,
    });
  }
  const alternatives = boundedAlternatives([...allowedValues]);
  return Object.freeze({
    code: "A001",
    message: `${message}; allowed values: ${formatAllowedValues(alternatives)}.`,
    field,
    reason,
    allowed: Object.freeze(alternatives.allowed),
    allowedCount: alternatives.allowedCount,
  });
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

export function createA005Error(
  file: string,
  lockPath: string,
  owner: ProjectWriteOwner | null,
  ageMs: number | null,
  ownerState: ProjectWriteOwnerState,
): A005Error {
  const status =
    owner === null
      ? "owner metadata is unavailable"
      : `owner ${JSON.stringify(owner)}, age ${ageMs ?? "unknown"} ms, status ${ownerState}`;
  const recovery =
    ownerState === "not-running"
      ? "The recorded PID is not running on this host; the reservation appears abandoned. Stop all project writers and remove"
      : "Wait for a live owner. To establish abandonment, check that the recorded hostname is this host and its PID is no longer alive; age alone is insufficient. With all project writers stopped, remove";
  return Object.freeze({
    code: "A005",
    message: `A005 Project write reservation held or abandoned at ${quote(lockPath)}: ${status}. ${recovery} ${quote(lockPath)} only after confirming abandonment. Then re-inspect the project and rebuild the patch.`,
    file,
    lockPath,
    owner,
    ageMs,
    ownerState,
  });
}
