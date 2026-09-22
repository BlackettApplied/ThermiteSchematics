import { createHash } from "node:crypto";
import type { ElectricalIr } from "@thermite/compiler";

export interface ReviewEntity {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly deviceUids: readonly string[];
  readonly value: unknown;
}
export interface ProjectSnapshot {
  readonly format: "thermite-snapshot/0.1";
  readonly project: string;
  readonly digest: string;
  readonly entities: readonly ReviewEntity[];
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ignored = new Set([
  "source",
  "sourceOrigins",
  "fromSource",
  "toSource",
  "terminalSource",
  "manifestSource",
]);
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !ignored.has(k))
        .sort(([a], [b]) => compare(a, b))
        .map(([k, v]) => [k, semantic(v)]),
    );
  return value;
}
function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(semantic(value)))
    .digest("hex");
}
export function createProjectSnapshot(
  ir: Readonly<ElectricalIr>,
): ProjectSnapshot {
  const entities: ReviewEntity[] = [];
  const add = (
    kind: string,
    id: string,
    label: string,
    value: unknown,
    deviceUids: readonly string[] = [],
  ) =>
    entities.push({
      kind,
      id,
      label,
      value: semantic(value),
      deviceUids: [...new Set(deviceUids)].sort(compare),
    });
  const deviceName = new Map(ir.devices.map((d) => [d.uid, d.designation]));
  add("project", "project", ir.project.name, ir.project);
  for (const t of [...ir.deviceTypes, ...ir.cableTypes])
    add(
      "type",
      t.id,
      t.id,
      t,
      ir.devices.filter((d) => d.typeId === t.id).map((d) => d.uid),
    );
  for (const d of ir.devices) add("device", d.uid, d.designation, d, [d.uid]);
  for (const c of ir.cables)
    add("cable", c.uid, c.designation, c, [
      ...ir.cableConductors
        .filter((k) => k.cableUid === c.uid)
        .flatMap((k) => k.endpoints.map((e) => e.terminal.deviceUid)),
      ...(c.assignments ?? []).flatMap((k) =>
        k.endpoints.flatMap((e) => (e ? [e.terminal.deviceUid] : [])),
      ),
    ]);
  for (const w of ir.wires)
    add(
      "wire",
      w.uid,
      w.designation,
      w,
      w.endpoints.map((e) => e.terminal.deviceUid),
    );
  for (const j of ir.jumpers)
    add(
      "jumper",
      j.uid,
      j.designation ?? j.uid,
      j,
      j.endpoints.map((e) => e.terminal.deviceUid),
    );
  for (const c of ir.cableConductors)
    add(
      "core",
      JSON.stringify([c.cableUid, c.id.conductorId]),
      `${ir.cables.find((k) => k.uid === c.cableUid)!.designation}/${c.id.conductorId}`,
      c,
      c.endpoints.map((e) => e.terminal.deviceUid),
    );
  for (const p of ir.potentials) {
    const { netId: _, ...authored } = p;
    add("potential", p.uid, p.name, authored, [p.terminal.deviceUid]);
  }
  for (const r of ir.relations)
    add(
      "relation",
      r.uid,
      r.designation ??
        `${deviceName.get(r.fromDeviceUid)} ${r.verb} ${deviceName.get(r.toDeviceUid)}`,
      r,
      [r.fromDeviceUid, r.toDeviceUid],
    );
  entities.sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id));
  return {
    format: "thermite-snapshot/0.1",
    project: ir.project.name,
    entities,
    digest: hash(entities),
  };
}
export function parseProjectSnapshot(input: unknown): ProjectSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid snapshot.");
  const v = input as ProjectSnapshot;
  if (
    v.format !== "thermite-snapshot/0.1" ||
    typeof v.project !== "string" ||
    typeof v.digest !== "string" ||
    !Array.isArray(v.entities) ||
    v.entities.length > 100000 ||
    Object.keys(v).some(
      (k) => !["format", "project", "digest", "entities"].includes(k),
    )
  )
    throw new Error("Invalid snapshot header.");
  const keys = new Set<string>();
  for (const e of v.entities) {
    if (
      !e ||
      typeof e !== "object" ||
      typeof e.id !== "string" ||
      typeof e.kind !== "string" ||
      typeof e.label !== "string" ||
      !Array.isArray(e.deviceUids) ||
      e.deviceUids.some((u: unknown) => typeof u !== "string") ||
      !Object.hasOwn(e, "value") ||
      Object.keys(e).some(
        (k) => !["kind", "id", "label", "deviceUids", "value"].includes(k),
      )
    )
      throw new Error("Invalid snapshot entity.");
    const key = JSON.stringify([e.kind, e.id]);
    if (keys.has(key)) throw new Error("Duplicate snapshot identity.");
    keys.add(key);
  }
  if (hash(v.entities) !== v.digest)
    throw new Error("Snapshot digest does not match its content.");
  return v;
}
export interface ProjectReview {
  readonly format: "thermite-review/0.1";
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly changes: readonly {
    readonly kind: string;
    readonly id: string;
    readonly label: string;
    readonly operation: "added" | "removed" | "changed";
    readonly fields: readonly string[];
    readonly summary: string;
    readonly before: unknown;
    readonly after: unknown;
  }[];
  readonly affectedDevices: readonly {
    readonly uid: string;
    readonly designation: string;
  }[];
}
function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(semantic(a)) === JSON.stringify(semantic(b))) return [];
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  )
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort(compare)
      .flatMap((k) =>
        changedPaths(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          `${path}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        ),
      );
  return [path || "/"];
}
export function reviewProject(
  before: ProjectSnapshot,
  after: ProjectSnapshot,
): ProjectReview {
  parseProjectSnapshot(before);
  parseProjectSnapshot(after);
  const key = (e: ReviewEntity) => JSON.stringify([e.kind, e.id]);
  const old = new Map(before.entities.map((e) => [key(e), e])),
    current = new Map(after.entities.map((e) => [key(e), e]));
  const changes: ProjectReview["changes"][number][] = [],
    affected = new Set<string>();
  const display = (value: unknown, snapshot: ProjectSnapshot): string => {
    if (value === undefined) return "Unspecified";
    if (Array.isArray(value))
      return value.map((v) => display(v, snapshot)).join("; ");
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if (typeof v.deviceUid === "string" && typeof v.terminalKey === "string")
        return `${snapshot.entities.find((e) => e.kind === "device" && e.id === v.deviceUid)?.label ?? v.deviceUid}.${v.terminalKey}`;
      if (v.terminal) return display(v.terminal, snapshot);
      return JSON.stringify(value);
    }
    return String(value);
  };
  const at = (value: unknown, path: string): unknown =>
    path === "/"
      ? value
      : path
          .slice(1)
          .split("/")
          .reduce<unknown>(
            (v, k) =>
              v &&
              typeof v === "object" &&
              Object.hasOwn(v, k.replaceAll("~1", "/").replaceAll("~0", "~"))
                ? (v as Record<string, unknown>)[
                    k.replaceAll("~1", "/").replaceAll("~0", "~")
                  ]
                : undefined,
            value,
          );
  for (const id of [...new Set([...old.keys(), ...current.keys()])].sort(
    compare,
  )) {
    const a = old.get(id),
      b = current.get(id);
    const fields = changedPaths(a?.value, b?.value);
    if (!fields.length) continue;
    [...(a?.deviceUids ?? []), ...(b?.deviceUids ?? [])].forEach((u) =>
      affected.add(u),
    );
    changes.push({
      kind: (b ?? a)!.kind,
      id: (b ?? a)!.id,
      label: (b ?? a)!.label,
      operation: a ? (b ? "changed" : "removed") : "added",
      fields,
      summary: fields
        .map(
          (p) =>
            `${p}: ${display(at(a?.value, p), before)} -> ${display(at(b?.value, p), after)}`,
        )
        .join("; "),
      before: a?.value ?? null,
      after: b?.value ?? null,
    });
  }
  const names = new Map(
    [...before.entities, ...after.entities]
      .filter((e) => e.kind === "device")
      .map((e) => [e.id, e.label]),
  );
  return {
    format: "thermite-review/0.1",
    beforeDigest: before.digest,
    afterDigest: after.digest,
    changes,
    affectedDevices: [...affected]
      .map((uid) => ({ uid, designation: names.get(uid) ?? uid }))
      .sort((a, b) => compare(a.designation, b.designation)),
  };
}
