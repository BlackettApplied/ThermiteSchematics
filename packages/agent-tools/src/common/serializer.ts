import type { Diagnostic } from "@thermite/schema";

import type { ApplySourcePatchValue } from "../apply-source-patch.js";
import type { RenderedSchematic } from "../create-view.js";
import type { InspectResult } from "../inspect.js";
import type { GraphQueryValue } from "../query.js";
import type { ResolveObjectsValue } from "../resolve.js";
import type { ValidateProjectValue } from "../validate.js";
import type {
  AgentToolJsonReport,
  AgentToolName,
  DeepReadonly,
} from "./contracts.js";
import type { AgentToolFailure } from "./errors.js";

type JsonRecord = Record<string, unknown>;

const METADATA_FIELDS = new Set([
  "rating",
  "electrical",
  "properties",
  "construction",
]);

export interface AgentToolValueByName {
  readonly resolve: DeepReadonly<ResolveObjectsValue>;
  readonly inspect: DeepReadonly<InspectResult>;
  readonly query: DeepReadonly<GraphQueryValue>;
  readonly validate: DeepReadonly<ValidateProjectValue>;
  readonly "create-view": DeepReadonly<RenderedSchematic>;
  readonly "apply-source-patch": DeepReadonly<ApplySourcePatchValue>;
}

export interface AgentToolJsonResult<Tool extends AgentToolName> {
  readonly format: "agent-tool-result/0.1";
  readonly tool: Tool;
  readonly value: AgentToolValueByName[Tool];
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type CanonicalContainer = unknown[] | JsonRecord;

interface CanonicalFrame {
  readonly source: readonly unknown[] | JsonRecord;
  readonly target: CanonicalContainer;
  readonly metadata: boolean;
}

function canonicalContainer(value: unknown): CanonicalContainer | undefined {
  if (Array.isArray(value)) return new Array<unknown>(value.length);
  return isRecord(value) ? (Object.create(null) as JsonRecord) : undefined;
}

function canonicalResultCopy(value: unknown, metadata = false): unknown {
  const root = canonicalContainer(value);
  if (root === undefined) return value;
  const pending: CanonicalFrame[] = [
    {
      source: value as readonly unknown[] | JsonRecord,
      target: root,
      metadata,
    },
  ];

  while (pending.length > 0) {
    const frame = pending.pop()!;
    if (Array.isArray(frame.source)) {
      const target = frame.target as unknown[];
      for (let index = 0; index < frame.source.length; index += 1) {
        const member = frame.source[index];
        const child = canonicalContainer(member);
        target[index] = child ?? member;
        if (child !== undefined) {
          pending.push({
            source: member as readonly unknown[] | JsonRecord,
            target: child,
            metadata: frame.metadata,
          });
        }
      }
      continue;
    }

    const source = frame.source as JsonRecord;
    const target = frame.target as JsonRecord;
    const keys = Object.keys(source).filter((key) => source[key] !== undefined);
    if (frame.metadata) keys.sort(compareCodeUnits);
    for (const key of keys) {
      const member = source[key];
      const child = canonicalContainer(member);
      target[key] = child ?? member;
      if (child !== undefined) {
        pending.push({
          source: member as readonly unknown[] | JsonRecord,
          target: child,
          metadata: frame.metadata || METADATA_FIELDS.has(key),
        });
      }
    }
  }
  return root;
}

export function serializeAgentToolResult<Tool extends AgentToolName>(
  tool: Tool,
  value: AgentToolValueByName[Tool],
): string {
  const result: AgentToolJsonResult<Tool> = {
    format: "agent-tool-result/0.1",
    tool,
    value: canonicalResultCopy(value) as AgentToolValueByName[Tool],
  };
  return `${JSON.stringify(result, undefined, 2)}\n`;
}

export function serializeAgentToolReport(
  tool: AgentToolName,
  diagnostics: readonly DeepReadonly<Diagnostic>[],
  error: DeepReadonly<AgentToolFailure> | null,
): string {
  const report: AgentToolJsonReport = {
    format: "agent-tool-report/0.1",
    tool,
    diagnostics,
    error,
  };
  return `${JSON.stringify(report, undefined, 2)}\n`;
}
