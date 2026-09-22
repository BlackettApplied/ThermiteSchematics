import { posix, win32 } from "node:path";
import { types } from "node:util";

import {
  DIAGNOSTIC_CATALOG,
  normalizeDiagnostics,
  type Diagnostic,
} from "@thermite/schema";
import type { AgentToolName } from "./contracts.js";

export type ReadToolFailureStage =
  | "request-read"
  | "project-load"
  | "compile"
  | "query"
  | "render"
  | "reparse-scan"
  | "reachable-read"
  | "stage-create"
  | "stage-copy"
  | "stage-write"
  | "stage-compile"
  | "stage-cleanup"
  | "precommit-load"
  | "precommit-read"
  | "commit-write"
  | "rollback-write"
  | "unexpected";

export interface ErrorSanitizerDependencies {
  readonly isProxy: (value: unknown) => boolean;
  readonly getOwnPropertyDescriptor: (
    value: object,
    key: PropertyKey,
  ) => PropertyDescriptor | undefined;
}

export const errorSanitizerDependencies: ErrorSanitizerDependencies =
  Object.freeze({
    isProxy: types.isProxy,
    getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  });

const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export function sanitizedErrorCode(
  error: unknown,
  dependencies: ErrorSanitizerDependencies = errorSanitizerDependencies,
): string {
  if (dependencies.isProxy(error)) return "UNKNOWN";
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return "UNKNOWN";
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = dependencies.getOwnPropertyDescriptor(error, "code");
  } catch {
    return "UNKNOWN";
  }
  if (
    descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "string" &&
    SAFE_CODE_PATTERN.test(descriptor.value)
  ) {
    return descriptor.value;
  }
  return "UNKNOWN";
}

export function sanitizedErrorDetail(
  stage: ReadToolFailureStage,
  error: unknown,
  dependencies: ErrorSanitizerDependencies = errorSanitizerDependencies,
): string {
  return `${stage}/${sanitizedErrorCode(error, dependencies)}`;
}

function safeDiagnosticFile(candidate: string | undefined): string {
  if (candidate === undefined) return "<project>";
  const normalized = candidate.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    posix.isAbsolute(normalized) ||
    win32.isAbsolute(normalized) ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    return "<project>";
  }
  return normalized;
}

function toolDiagnostic(
  tool: AgentToolName,
  stage: ReadToolFailureStage,
  detailCode: string,
  file: string | undefined,
): Diagnostic {
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message: `Agent ${tool} tool failure (${stage}/${detailCode}).`,
    file: safeDiagnosticFile(file),
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

export function diagnosticForReadToolException(
  tool: AgentToolName,
  stage: ReadToolFailureStage,
  error: unknown,
  file?: string,
): readonly Diagnostic[] {
  return normalizeDiagnostics([
    toolDiagnostic(tool, stage, sanitizedErrorCode(error), file),
  ]);
}

export function sanitizeToolFailureDiagnostics(
  tool: AgentToolName,
  stage: "project-load" | "compile" | "stage-compile" | "precommit-load",
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  const implicatedFile = diagnostics.find(({ code }) => code === "E001")?.file;
  return normalizeDiagnostics([
    ...diagnostics.filter(({ code }) => code !== "E001"),
    toolDiagnostic(tool, stage, "E001", implicatedFile),
  ]);
}

export function sanitizeCompileToolFailure(
  tool: AgentToolName,
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return sanitizeToolFailureDiagnostics(tool, "compile", diagnostics);
}
