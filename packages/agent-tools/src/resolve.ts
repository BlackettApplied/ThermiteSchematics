import type { ElectricalIr } from "@thermite/compiler";
import type {
  ProjectObjectView,
  QueryEngine,
  QueryResult,
} from "@thermite/query";

import type { AgentToolRequestBase, JsonValue } from "./common/contracts.js";
import { detachAndFreezePlainJson } from "./common/plain-json.js";
import {
  firstAdditionalProperty,
  recordValue,
  requiredRecord,
  requiredString,
  type FieldValidationResult,
} from "./common/request-validation.js";

export type { ProjectObjectView } from "@thermite/query";

export interface ResolveObjectsRequest extends AgentToolRequestBase {
  readonly target:
    | { readonly by: "uid" | "designation"; readonly value: string }
    | { readonly by: "type" | "text"; readonly value: string };
}

export type SearchMatchKind = "exact" | "prefix" | "substring";
export type SearchMatchField =
  "designation" | "name" | "uid" | "alias" | "typeId" | "description";

export interface SearchMatch {
  readonly object: ProjectObjectView;
  readonly match: {
    readonly kind: SearchMatchKind;
    readonly field: SearchMatchField;
    readonly text: string;
  };
}

export type ResolveObjectsValue =
  | { readonly mode: "resolve"; readonly object: ProjectObjectView }
  | { readonly mode: "search"; readonly matches: readonly SearchMatch[] };

type ResolveTarget = ResolveObjectsRequest["target"];

interface SearchableObject {
  readonly kind: ProjectObjectView["kind"];
  readonly uid: string;
  readonly designation?: string;
  readonly description?: string;
  readonly aliases: readonly string[];
  readonly typeId?: string;
  readonly name?: string;
}

interface RankedCandidate {
  readonly kind: SearchMatchKind;
  readonly field: SearchMatchField;
  readonly text: string;
}

const REQUEST_FIELDS = new Set(["format", "project", "target"]);
const TARGET_FIELDS = new Set(["by", "value"]);
const REQUEST_FORMATS = new Set(["agent-tool-request/0.1"]);
const TARGET_KINDS = new Set(["uid", "designation", "type", "text"]);

const MATCH_KIND_RANK: Readonly<Record<SearchMatchKind, number>> = {
  exact: 0,
  prefix: 1,
  substring: 2,
};
const MATCH_FIELD_RANK: Readonly<Record<SearchMatchField, number>> = {
  designation: 0,
  name: 1,
  uid: 2,
  alias: 3,
  typeId: 4,
  description: 5,
};
const OBJECT_KIND_RANK: Readonly<Record<ProjectObjectView["kind"], number>> = {
  device: 0,
  wire: 1,
  jumper: 2,
  cable: 3,
  relation: 4,
  potential: 5,
};

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCandidates(
  left: RankedCandidate,
  right: RankedCandidate,
): number {
  return (
    MATCH_KIND_RANK[left.kind] - MATCH_KIND_RANK[right.kind] ||
    MATCH_FIELD_RANK[left.field] - MATCH_FIELD_RANK[right.field] ||
    compareCodeUnits(left.text, right.text)
  );
}

function objectDisplay(object: ProjectObjectView): string {
  return object.designation ?? `${object.kind}:${object.uid}`;
}

export function compareSearchMatches(
  left: SearchMatch,
  right: SearchMatch,
): number {
  return (
    compareCandidates(left.match, right.match) ||
    compareCodeUnits(objectDisplay(left.object), objectDisplay(right.object)) ||
    OBJECT_KIND_RANK[left.object.kind] - OBJECT_KIND_RANK[right.object.kind] ||
    compareCodeUnits(left.object.uid, right.object.uid)
  );
}

function classify(text: string, value: string): SearchMatchKind | undefined {
  if (text === value) return "exact";
  if (text.startsWith(value)) return "prefix";
  if (text.includes(value)) return "substring";
  return undefined;
}

function candidatesFor(
  object: SearchableObject,
  value: string,
): readonly RankedCandidate[] {
  const fields: readonly (readonly [SearchMatchField, string | undefined])[] = [
    ["designation", object.designation],
    ["name", object.name],
    ["uid", object.uid],
    ...object.aliases.map((alias) => ["alias", alias] as const),
    ["typeId", object.typeId],
    ["description", object.description],
  ];
  return fields.flatMap(([field, text]) => {
    if (text === undefined) return [];
    const kind = classify(text, value);
    return kind === undefined ? [] : [{ kind, field, text }];
  });
}

function searchableObjects(
  ir: Readonly<ElectricalIr>,
): readonly SearchableObject[] {
  return [
    ...ir.devices.map((object) => ({ kind: "device" as const, ...object })),
    ...ir.wires.map((object) => ({ kind: "wire" as const, ...object })),
    ...ir.jumpers.map((object) => ({ kind: "jumper" as const, ...object })),
    ...ir.cables.map((object) => ({ kind: "cable" as const, ...object })),
    ...ir.relations.map((object) => ({ kind: "relation" as const, ...object })),
    ...ir.potentials.map((object) => ({
      kind: "potential" as const,
      ...object,
    })),
  ];
}

function resolvedView(
  engine: QueryEngine,
  object: SearchableObject,
): ProjectObjectView {
  const result = engine.resolveObject({ by: "uid", value: object.uid });
  if (result.ok) return result.value;
  throw result.error;
}

function searchByType(
  ir: Readonly<ElectricalIr>,
  engine: QueryEngine,
  value: string,
): ResolveObjectsValue {
  const matches = searchableObjects(ir)
    .filter(
      (object) =>
        (object.kind === "device" || object.kind === "cable") &&
        object.typeId === value,
    )
    .map((object): SearchMatch => ({
      object: resolvedView(engine, object),
      match: { kind: "exact", field: "typeId", text: value },
    }))
    .sort(compareSearchMatches);
  return { mode: "search", matches };
}

function searchByText(
  ir: Readonly<ElectricalIr>,
  engine: QueryEngine,
  value: string,
): ResolveObjectsValue {
  const matches: SearchMatch[] = [];
  const seen = new Set<string>();
  for (const object of searchableObjects(ir)) {
    if (seen.has(object.uid)) continue;
    seen.add(object.uid);
    const winner = [...candidatesFor(object, value)].sort(compareCandidates)[0];
    if (winner === undefined) continue;
    matches.push({ object: resolvedView(engine, object), match: winner });
  }
  matches.sort(compareSearchMatches);
  return { mode: "search", matches };
}

export function resolveCompiledProject(
  ir: Readonly<ElectricalIr>,
  engine: QueryEngine,
  target: ResolveTarget,
): QueryResult<ResolveObjectsValue> {
  if (target.by === "uid" || target.by === "designation") {
    const resolved = engine.resolveObject(target);
    return resolved.ok
      ? { ok: true, value: { mode: "resolve", object: resolved.value } }
      : resolved;
  }
  return {
    ok: true,
    value:
      target.by === "type"
        ? searchByType(ir, engine, target.value)
        : searchByText(ir, engine, target.value),
  };
}

export function validateResolveRequest(
  request: unknown,
): FieldValidationResult<ResolveObjectsRequest> {
  const detached = detachAndFreezePlainJson("resolve", request);
  if (!detached.ok) return detached;
  const root = recordValue("resolve", detached.value as JsonValue, "");
  if (!root.ok) return root;
  const format = requiredString(
    "resolve",
    root.value,
    "format",
    "",
    REQUEST_FORMATS,
  );
  if (!format.ok) return format;
  const project = requiredString("resolve", root.value, "project");
  if (!project.ok) return project;
  const target = requiredRecord("resolve", root.value, "target");
  if (!target.ok) return target;
  const by = requiredString(
    "resolve",
    target.value,
    "by",
    "/target",
    TARGET_KINDS,
  );
  if (!by.ok) return by;
  const value = requiredString("resolve", target.value, "value", "/target");
  if (!value.ok) return value;
  const targetAdditional = firstAdditionalProperty(
    "resolve",
    target.value,
    TARGET_FIELDS,
    "/target",
  );
  if (targetAdditional !== undefined) {
    return { ok: false, error: targetAdditional };
  }
  const additional = firstAdditionalProperty(
    "resolve",
    root.value,
    REQUEST_FIELDS,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: detached.value as unknown as ResolveObjectsRequest,
  };
}
