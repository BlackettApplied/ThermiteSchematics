import { AGENT_REQUEST_VOCABULARY } from "./request-vocabulary.js";
import {
  computeFileIntegrity,
  type ElectricalIr,
  type LoadedProject,
  type LoadedDocument,
  type SourceRef,
} from "@thermite/compiler";
import { appendJsonPointer } from "@thermite/schema";

import type { AgentToolName } from "./common/contracts.js";
import { createA001Error } from "./common/errors.js";
import {
  requiredArray,
  requiredString,
  type FieldValidationResult,
  type JsonRecord,
} from "./common/request-validation.js";

export interface SourceMetadataRequest {
  readonly include?: readonly "source"[];
}

export interface SourceFileIntegrity {
  readonly file: string;
  readonly integrity: string;
}

export interface ObjectSource extends SourceFileIntegrity {
  readonly pointer: string;
  /** The owning project object's UUID; omitted for every library origin. */
  readonly uid?: string;
  readonly patchEligible: boolean;
  readonly origin:
    | { readonly kind: "project" }
    | {
        readonly kind: "library";
        readonly name: string;
        readonly resolutionKind: "local" | "shipped";
      };
  readonly reason?: string;
}

/** Optional metadata on source-backed records; derived summaries have no source. */
export type SourceAnnotated<Value> = Value extends ObjectSource
  ? Value
  : Value extends readonly unknown[]
    ? { readonly [Key in keyof Value]: SourceAnnotated<Value[Key]> }
    : Value extends object
      ? {
          readonly [Key in keyof Value]: SourceAnnotated<Value[Key]>;
        } & (string extends keyof Value
          ? unknown
          : { readonly source?: ObjectSource }) &
          (Value extends { readonly kind: "device"; readonly typeId: string }
            ? {
                readonly deviceType?: {
                  readonly id: string;
                  readonly source: ObjectSource;
                };
              }
            : {})
      : Value;

export type SourceMetadataResult<Value> = SourceAnnotated<Value> & {
  readonly sourceFiles?: readonly SourceFileIntegrity[];
};

const INCLUDES = new Set<string>(
  AGENT_REQUEST_VOCABULARY["inspect"]["/include/*"],
);

export function validateSourceInclude(
  tool: AgentToolName,
  root: JsonRecord,
): FieldValidationResult<undefined> {
  if (!Object.hasOwn(root, "include")) return { ok: true, value: undefined };
  const include = requiredArray(tool, root, "include");
  if (!include.ok) return include;
  const seen = new Set<string>();
  for (let index = 0; index < include.value.length; index += 1) {
    const member = requiredString(
      tool,
      root.include as unknown as JsonRecord,
      String(index),
      "/include",
      INCLUDES,
    );
    if (!member.ok) return member;
    if (seen.has(member.value)) {
      return {
        ok: false,
        error: createA001Error(tool, `/include/${index}`, "duplicate-member"),
      };
    }
    seen.add(member.value);
  }
  return { ok: true, value: undefined };
}

// Only traverse query-owned view fields, never arbitrary authored metadata.
const VIEW_FIELDS = new Set([
  "object",
  "matches",
  "from",
  "to",
  "otherDevice",
  "relation",
  "terminal",
  "terminals",
  "endpoints",
  "net",
  "potentials",
  "elements",
  "projectRelations",
  "functions",
  "cableType",
]);

/** Uses only loader-owned bytes and IR refs from that same loaded project. No I/O. */
export function withSourceMetadata<Value>(
  value: Value,
  ir: Readonly<ElectricalIr>,
  project: LoadedProject,
): SourceMetadataResult<Value> {
  const documents = new Map(
    [
      project.manifest,
      ...project.sources,
      ...(project.presentation === undefined ? [] : [project.presentation]),
      ...project.libraries.flatMap((library) => [
        library.manifest,
        ...library.sources,
      ]),
    ].map((document) => [document.file, document] as const),
  );
  const objects = new Map(
    [
      ...ir.devices,
      ...ir.wires,
      ...ir.jumpers,
      ...ir.cables,
      ...ir.relations,
      ...ir.potentials,
    ].map((object) => [object.uid, object] as const),
  );
  const terminals = new Map(
    ir.terminals.map((terminal) => [
      JSON.stringify([terminal.id.deviceUid, terminal.id.terminalKey]),
      terminal,
    ]),
  );
  const functions = new Map(
    ir.functions.map((fn) => [
      JSON.stringify([fn.id.deviceUid, fn.id.functionKey]),
      fn,
    ]),
  );
  const devices = new Map(ir.devices.map((device) => [device.uid, device]));
  const deviceTypes = new Map(ir.deviceTypes.map((type) => [type.id, type]));
  const conductors = new Map(
    ir.cableConductors.map((conductor) => [
      JSON.stringify([conductor.id.cableUid, conductor.id.conductorId]),
      conductor,
    ]),
  );
  const libraries = new Map(
    project.libraries.map((library) => [library.dependencyIndex, library]),
  );
  const cableTypes = new Map(ir.cableTypes.map((type) => [type.id, type]));
  const files = new Map<string, SourceFileIntegrity>();

  function fileGuard(document: LoadedDocument<unknown>): SourceFileIntegrity {
    let guard = files.get(document.file);
    if (guard === undefined) {
      guard = {
        file: document.file,
        integrity: computeFileIntegrity(document.rawBytes),
      };
      files.set(document.file, guard);
    }
    return guard;
  }

  // Include empty source files and referenced presentation, even when no view
  // refers to them. Do not discover or read files outside this loaded snapshot.
  for (const document of documents.values()) {
    if (
      document.owner.kind === "project" &&
      (document.kind === "project_source" ||
        document.kind === "project_presentation")
    ) {
      fileGuard(document);
    }
  }

  function source(ref: SourceRef, uid?: string): ObjectSource {
    const document = documents.get(ref.file);
    if (document === undefined || !document.nodes.has(ref.jsonPointer)) {
      throw new TypeError(
        "An inspected source is absent from the admitted project snapshot.",
      );
    }
    const guard = fileGuard(document);
    const patchEligible =
      document.owner.kind === "project" &&
      (document.kind === "project_source" ||
        document.kind === "project_presentation");
    const owner = document.owner;
    const library =
      owner.kind === "library"
        ? libraries.get(owner.dependencyIndex)
        : undefined;
    if (owner.kind === "library" && library === undefined) {
      throw new TypeError(
        "An inspected library is absent from the admitted project snapshot.",
      );
    }
    return {
      ...guard,
      pointer: ref.jsonPointer,
      ...(uid === undefined || owner.kind === "library" ? {} : { uid }),
      patchEligible,
      origin:
        library === undefined
          ? { kind: "project" }
          : {
              kind: "library",
              name: library.dependency.name,
              resolutionKind: library.resolutionKind,
            },
      ...(patchEligible
        ? {}
        : {
            reason:
              library === undefined
                ? "Only project source and referenced presentation documents are patch eligible."
                : "Library files cannot be modified by apply-source-patch.",
          }),
    };
  }

  function decorate(
    input: unknown,
    ownerUid?: string,
    field?: string,
  ): unknown {
    if (Array.isArray(input))
      return input.map((member) => decorate(member, ownerUid, field));
    if (input === null || typeof input !== "object") return input;
    const record = input as Record<string, unknown>;
    const object =
      typeof record.uid === "string" ? objects.get(record.uid) : undefined;
    const uid = object?.uid ?? ownerUid;
    const result = { ...record };
    for (const key of Object.keys(record)) {
      if (VIEW_FIELDS.has(key)) result[key] = decorate(record[key], uid, key);
    }
    if (object !== undefined) {
      result.source = source(object.source, object.uid);
      const device = devices.get(object.uid);
      const type =
        device === undefined ? undefined : deviceTypes.get(device.typeId);
      if (type !== undefined && record.typeId !== undefined) {
        result.deviceType = { id: type.id, source: source(type.source) };
        // These copied records are type declarations, not instance patch targets.
        for (const key of ["connectionCoverage", "ports", "connectorPorts"]) {
          if (record[key] === undefined) continue;
          const ref = {
            ...type.source,
            jsonPointer: appendJsonPointer(type.source.jsonPointer, key),
          };
          const member = { ...(record[key] as Record<string, unknown>) };
          if (key !== "connectionCoverage") {
            for (const portKey of Object.keys(member)) {
              const portRef = {
                ...ref,
                jsonPointer: appendJsonPointer(ref.jsonPointer, portKey),
              };
              const port = { ...(member[portKey] as Record<string, unknown>) };
              if (key === "connectorPorts" && port.pins !== undefined) {
                const pins = { ...(port.pins as Record<string, unknown>) };
                for (const pin of Object.keys(pins)) {
                  pins[pin] = {
                    ...(pins[pin] as Record<string, unknown>),
                    source: source({
                      ...portRef,
                      jsonPointer: appendJsonPointer(
                        appendJsonPointer(portRef.jsonPointer, "pins"),
                        pin,
                      ),
                    }),
                  };
                }
                port.pins = pins;
              }
              member[portKey] = { ...port, source: source(portRef) };
            }
          }
          result[key] =
            key === "connectionCoverage"
              ? { ...member, source: source(ref) }
              : member;
        }
      }
    } else if (field === "cableType" && typeof record.id === "string") {
      const type = cableTypes.get(record.id);
      if (type !== undefined) result.source = source(type.source);
    } else if (
      field === "functions" &&
      typeof record.key === "string" &&
      uid !== undefined
    ) {
      const fn = functions.get(JSON.stringify([uid, record.key]));
      if (fn !== undefined) result.source = source(fn.source, uid);
    } else if (
      typeof record.id === "object" &&
      record.id !== null &&
      "terminalKey" in record.id
    ) {
      const id = record.id as { deviceUid: string; terminalKey: string };
      const terminal = terminals.get(
        JSON.stringify([id.deviceUid, id.terminalKey]),
      );
      if (terminal !== undefined)
        result.source = source(terminal.source, id.deviceUid);
    } else if (record.kind === "cable_conductor") {
      const conductor = conductors.get(
        JSON.stringify([record.cableUid, record.conductorId]),
      );
      if (conductor !== undefined)
        result.source = source(conductor.source, conductor.cableUid);
    }
    return result;
  }

  const annotated = decorate(value) as SourceAnnotated<Value>;
  return {
    ...annotated,
    sourceFiles: [...files.values()].sort((left, right) =>
      left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
    ),
  };
}
