import type { Diagnostic } from "@thermite/schema";

import type { AgentToolFailure } from "./errors.js";

export type JsonPrimitive = null | boolean | number | string;

export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

type ReadonlyJsonValue =
  | JsonPrimitive
  | readonly ReadonlyJsonValue[]
  | { readonly [key: string]: ReadonlyJsonValue };

type DeepReadonlyWalk<T> = T extends JsonPrimitive
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends readonly unknown[]
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

type IsExactlyJsonValue<T> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends JsonValue ? 1 : 2
    ? true
    : false;
export type DeepReadonly<T> =
  IsExactlyJsonValue<T> extends true ? ReadonlyJsonValue : DeepReadonlyWalk<T>;

export interface AgentToolRequestBase {
  readonly format: "agent-tool-request/0.1";
  readonly project: string;
}

export type AgentToolName =
  | "resolve"
  | "inspect"
  | "query"
  | "validate"
  | "create-view"
  | "apply-source-patch";

export type AgentToolOutcome<Value, Failure extends AgentToolFailure> =
  | {
      readonly ok: true;
      readonly diagnostics: readonly DeepReadonly<Diagnostic>[];
      readonly value: DeepReadonly<Value>;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly DeepReadonly<Diagnostic>[];
      readonly error: DeepReadonly<Failure> | null;
      readonly failureClass: "expected" | "tool";
    };

export interface AgentToolJsonReport {
  readonly format: "agent-tool-report/0.1";
  readonly tool: AgentToolName;
  readonly diagnostics: readonly DeepReadonly<Diagnostic>[];
  readonly error: DeepReadonly<AgentToolFailure> | null;
}
