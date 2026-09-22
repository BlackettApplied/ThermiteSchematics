import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TextDecoder, types } from "node:util";

import {
  createAgentTools,
  serializeAgentToolReport,
  serializeAgentToolResult,
  type A001Error,
  type AgentToolFailure,
  type AgentToolName,
  type AgentToolOutcome,
  type AgentToolValueByName,
  type AgentTools,
  type ApplySourcePatchRequest,
  type CreateAgentToolsOptions,
  type CreateViewRequest,
  type DeepReadonly,
  type ExecuteGraphQueryRequest,
  type InspectObjectRequest,
  type ResolveObjectsRequest,
  type ValidateProjectRequest,
} from "@thermite/agent-tools";
import {
  DIAGNOSTIC_CATALOG,
  parseJson,
  type Diagnostic,
  type JsonValue,
} from "@thermite/schema";

export interface AgentInputStream extends AsyncIterable<unknown> {}

export type AgentToolsFactory = (
  options?: DeepReadonly<CreateAgentToolsOptions>,
) => AgentTools;

export interface RunAgentCommandOptions {
  readonly cwd?: string;
  readonly stdin?: AgentInputStream;
  readonly createTools?: AgentToolsFactory;
}

export interface AgentCommandResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

type AnyAgentOutcome = AgentToolOutcome<
  AgentToolValueByName[AgentToolName],
  AgentToolFailure
>;

const REQUEST_FILE = "<request>";
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/u;

interface JsonTextPath {
  readonly parent: JsonTextPath | undefined;
  readonly token: string | number;
}

type JsonTextFrame =
  | {
      readonly kind: "array";
      readonly path: JsonTextPath | undefined;
      index: number;
      state: "value-or-end" | "comma-or-end";
    }
  | {
      readonly kind: "object";
      readonly path: JsonTextPath | undefined;
      readonly seen: Set<string>;
      key: string | undefined;
      state: "key-or-end" | "colon" | "value" | "comma-or-end";
    };

function appendTextPath(
  parent: JsonTextPath | undefined,
  token: string | number,
): JsonTextPath {
  return { parent, token };
}

function textPathPointer(path: JsonTextPath): string {
  const tokens: (string | number)[] = [];
  let current: JsonTextPath | undefined = path;
  while (current !== undefined) {
    tokens.push(current.token);
    current = current.parent;
  }
  tokens.reverse();
  return tokens
    .map(
      (token) =>
        `/${String(token).replaceAll("~", "~0").replaceAll("/", "~1")}`,
    )
    .join("");
}

function skipJsonWhitespace(text: string, offset: number): number {
  let index = offset;
  while (
    text[index] === " " ||
    text[index] === "\t" ||
    text[index] === "\r" ||
    text[index] === "\n"
  ) {
    index += 1;
  }
  return index;
}

function stringTokenEnd(text: string, offset: number): number {
  let index = offset + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x5c) index += 2;
    else if (code === 0x22) return index + 1;
    else index += 1;
  }
  return text.length;
}

function scalarTokenEnd(text: string, offset: number): number {
  let index = offset;
  while (index < text.length && !/[\s,\]}]/u.test(text[index]!)) index += 1;
  return index;
}

function completeTextValue(frames: JsonTextFrame[]): void {
  const parent = frames[frames.length - 1];
  if (parent === undefined) return;
  if (parent.kind === "array") {
    parent.index += 1;
    parent.state = "comma-or-end";
  } else {
    parent.key = undefined;
    parent.state = "comma-or-end";
  }
}

function firstDuplicateMemberPointer(text: string): string | undefined {
  const frames: JsonTextFrame[] = [];
  let offset = skipJsonWhitespace(text, 0);
  let rootComplete = false;

  const consumeValue = (path: JsonTextPath | undefined): void => {
    const token = text[offset];
    if (token === "{") {
      offset += 1;
      frames.push({
        kind: "object",
        path,
        seen: new Set<string>(),
        key: undefined,
        state: "key-or-end",
      });
      return;
    }
    if (token === "[") {
      offset += 1;
      frames.push({ kind: "array", path, index: 0, state: "value-or-end" });
      return;
    }
    offset =
      token === '"'
        ? stringTokenEnd(text, offset)
        : scalarTokenEnd(text, offset);
    if (frames.length === 0) rootComplete = true;
    else completeTextValue(frames);
  };

  consumeValue(undefined);
  while (!rootComplete) {
    offset = skipJsonWhitespace(text, offset);
    const frame = frames[frames.length - 1]!;
    if (frame.kind === "array") {
      if (frame.state === "value-or-end") {
        if (text[offset] === "]") {
          offset += 1;
          frames.pop();
          if (frames.length === 0) rootComplete = true;
          else completeTextValue(frames);
        } else {
          consumeValue(appendTextPath(frame.path, frame.index));
        }
      } else if (text[offset] === ",") {
        offset += 1;
        frame.state = "value-or-end";
      } else {
        offset += 1;
        frames.pop();
        if (frames.length === 0) rootComplete = true;
        else completeTextValue(frames);
      }
      continue;
    }

    switch (frame.state) {
      case "key-or-end": {
        if (text[offset] === "}") {
          offset += 1;
          frames.pop();
          if (frames.length === 0) rootComplete = true;
          else completeTextValue(frames);
          break;
        }
        const end = stringTokenEnd(text, offset);
        const key = JSON.parse(text.slice(offset, end)) as string;
        const keyPath = appendTextPath(frame.path, key);
        if (frame.seen.has(key)) return textPathPointer(keyPath);
        frame.seen.add(key);
        frame.key = key;
        frame.state = "colon";
        offset = end;
        break;
      }
      case "colon":
        offset += 1;
        frame.state = "value";
        break;
      case "value":
        consumeValue(appendTextPath(frame.path, frame.key!));
        break;
      case "comma-or-end":
        if (text[offset] === ",") {
          offset += 1;
          frame.state = "key-or-end";
        } else {
          offset += 1;
          frames.pop();
          if (frames.length === 0) rootComplete = true;
          else completeTextValue(frames);
        }
        break;
    }
  }
  return undefined;
}

function sanitizedErrorCode(error: unknown): string {
  if (types.isProxy(error)) return "UNKNOWN";
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return "UNKNOWN";
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(error, "code");
  } catch {
    return "UNKNOWN";
  }

  return descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "string" &&
    SAFE_CODE_PATTERN.test(descriptor.value)
    ? descriptor.value
    : "UNKNOWN";
}

function requestReadDiagnostic(error: unknown): Diagnostic {
  const detail = `request-read/${sanitizedErrorCode(error)}`;
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message: `Unable to read agent request "<request>" (${detail}).`,
    file: REQUEST_FILE,
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

function unexpectedDiagnostic(tool: AgentToolName, error: unknown): Diagnostic {
  const detail = `unexpected/${sanitizedErrorCode(error)}`;
  return {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message: `Agent ${tool} tool failure (${detail}).`,
    file: "<project>",
    line: 1,
    column: 1,
    jsonPointer: "",
  };
}

function a001Error(
  tool: AgentToolName,
  field: string,
  reason: "invalid-json" | "duplicate-member",
): A001Error {
  const reasonText = reason.replaceAll("-", " ");
  return {
    code: "A001",
    message: `A001 Invalid ${tool} request at ${JSON.stringify(field)}: ${reasonText}.`,
    field,
    reason,
  };
}

function expectedRequestFailure(
  tool: AgentToolName,
  error: A001Error,
): AgentCommandResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: serializeAgentToolReport(tool, [], error),
  };
}

function toolFailure(
  tool: AgentToolName,
  diagnostics: readonly Diagnostic[],
): AgentCommandResult {
  return {
    exitCode: 2,
    stdout: "",
    stderr: serializeAgentToolReport(tool, diagnostics, null),
  };
}

async function readStdin(stream: AgentInputStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk, "utf8"));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      const error = new TypeError(
        "Agent request input produced a non-byte chunk.",
      );
      Object.defineProperty(error, "code", { value: "INVALID_CHUNK" });
      throw error;
    }
  }
  return Buffer.concat(chunks);
}

async function readRequestBytes(
  input: string,
  cwd: string,
  stdin: AgentInputStream,
): Promise<Uint8Array> {
  return input === "-" ? readStdin(stdin) : readFile(resolve(cwd, input));
}

function parseRequest(
  tool: AgentToolName,
  bytes: Uint8Array,
): { readonly ok: true; readonly value: JsonValue } | AgentCommandResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return expectedRequestFailure(tool, a001Error(tool, "", "invalid-json"));
  }

  let parsed: ReturnType<typeof parseJson>;
  try {
    parsed = parseJson(text, REQUEST_FILE);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    let value: JsonValue;
    try {
      value = JSON.parse(text) as JsonValue;
    } catch {
      return expectedRequestFailure(tool, a001Error(tool, "", "invalid-json"));
    }
    const duplicatePointer = firstDuplicateMemberPointer(text);
    return duplicatePointer === undefined
      ? { ok: true, value }
      : expectedRequestFailure(
          tool,
          a001Error(tool, duplicatePointer, "duplicate-member"),
        );
  }
  if (parsed.diagnostics.some(({ code }) => code === "E002")) {
    return expectedRequestFailure(tool, a001Error(tool, "", "invalid-json"));
  }

  const duplicate = parsed.diagnostics.find(({ code }) => code === "E003");
  if (duplicate !== undefined) {
    return expectedRequestFailure(
      tool,
      a001Error(tool, duplicate.jsonPointer, "duplicate-member"),
    );
  }

  if (parsed.value === undefined) {
    return expectedRequestFailure(tool, a001Error(tool, "", "invalid-json"));
  }
  return { ok: true, value: parsed.value };
}

async function dispatchAgentRequest(
  tool: AgentToolName,
  request: JsonValue,
  tools: AgentTools,
): Promise<AnyAgentOutcome> {
  switch (tool) {
    case "resolve":
      return tools.resolve(
        request as unknown as DeepReadonly<ResolveObjectsRequest>,
      );
    case "inspect":
      return tools.inspect(
        request as unknown as DeepReadonly<InspectObjectRequest>,
      );
    case "query":
      return tools.query(
        request as unknown as DeepReadonly<ExecuteGraphQueryRequest>,
      );
    case "validate":
      return tools.validate(
        request as unknown as DeepReadonly<ValidateProjectRequest>,
      );
    case "create-view":
      return tools.createView(
        request as unknown as DeepReadonly<CreateViewRequest>,
      );
    case "apply-source-patch":
      return tools.applySourcePatch(
        request as unknown as DeepReadonly<ApplySourcePatchRequest>,
      );
  }
}

function serializeOutcome(
  tool: AgentToolName,
  outcome: AnyAgentOutcome,
): AgentCommandResult {
  if (!outcome.ok) {
    return {
      exitCode: outcome.failureClass === "tool" ? 2 : 1,
      stdout: "",
      stderr: serializeAgentToolReport(
        tool,
        outcome.diagnostics,
        outcome.error,
      ),
    };
  }

  const stdout = serializeAgentToolResult(tool, outcome.value);
  const stderr = serializeAgentToolReport(tool, outcome.diagnostics, null);
  return { exitCode: 0, stdout, stderr };
}

export async function runAgentCommand(
  tool: AgentToolName,
  input: string,
  options: RunAgentCommandOptions = {},
): Promise<AgentCommandResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  let bytes: Uint8Array;
  try {
    bytes = await readRequestBytes(input, cwd, options.stdin ?? process.stdin);
  } catch (error) {
    return toolFailure(tool, [requestReadDiagnostic(error)]);
  }

  try {
    const parsed = parseRequest(tool, bytes);
    if (!("ok" in parsed)) return parsed;
    const tools = (options.createTools ?? createAgentTools)({ cwd });
    const outcome = await dispatchAgentRequest(tool, parsed.value, tools);
    return serializeOutcome(tool, outcome);
  } catch (error) {
    return toolFailure(tool, [unexpectedDiagnostic(tool, error)]);
  }
}
