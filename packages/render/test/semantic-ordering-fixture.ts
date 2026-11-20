import { createHash } from "node:crypto";
import type { ElectricalIr } from "@thermite/compiler";
import type { SchematicViewRequest } from "../src/types.js";
import { irSemanticOrder } from "../src/semantic-order.js";
import { expect } from "vitest";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { createSchematicRendererWithDependencies } from "../src/renderer.js";

export const flows = ["left-to-right", "top-to-bottom"] as const;

/** Reassign every instance identity, net hash and index reference together. Source
 * positions and type/function/terminal keys remain authored. Shuffle IR records
 * too: a producer's incidental collection order is not a layout constraint. */
export function reidentify(
  ir: ElectricalIr,
  seed: number,
  printedUids: readonly string[] = [],
): ElectricalIr {
  const names = new Map<string, string>();
  for (const item of [
    ...ir.devices,
    ...ir.wires,
    ...ir.cables,
    ...ir.jumpers,
    ...ir.potentials,
    ...ir.nets,
  ]) {
    const id = "uid" in item ? item.uid : item.id;
    if (printedUids.includes(id)) {
      names.set(id, id);
      continue;
    }
    const h = createHash("sha256").update(`${seed}:${id}`).digest("hex");
    names.set(
      id,
      id.startsWith("net:")
        ? `net:sha256:${h}`
        : `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
    );
  }
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") return names.get(v) ?? v;
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, v]) => [k, visit(v)]),
      );
    return v;
  };
  const copy = visit(ir) as ElectricalIr;
  for (const key of [
    "devices",
    "wires",
    "cables",
    "jumpers",
    "potentials",
    "nets",
    "functions",
    "cableConductors",
  ] as const) {
    (copy[key] as unknown[]).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return copy;
}

export function rootedRequests(ir: ElectricalIr): SchematicViewRequest[] {
  const by = (value: string) => ({ by: "designation" as const, value });
  const views: SchematicViewRequest[] = [];
  for (const d of ir.devices) {
    const fs = ir.functions.filter((f) => f.id.deviceUid === d.uid),
      root = by(d.designation);
    if (fs.some((f) => f.kind === "coil"))
      views.push({
        format: "schematic-view-request/0.1",
        root,
        family: "control",
      });
    if (fs.some((f) => f.kind === "load"))
      views.push({
        format: "schematic-view-request/0.1",
        root,
        family: "power",
      });
    if (fs.some((f) => f.kind === "source"))
      views.push({
        format: "schematic-view-request/0.2",
        root,
        intent: { kind: "loads" },
      });
    if (
      fs.some(
        (f) =>
          f.kind === "contact" ||
          (f.kind === "channel" && f.direction === "output"),
      )
    ) {
      for (const t of ir.devices.filter(
        (x) =>
          x.uid !== d.uid &&
          ir.functions.some(
            (f) =>
              f.id.deviceUid === x.uid &&
              f.kind === "channel" &&
              f.direction === "input",
          ),
      )) {
        for (const includePower of [true, false])
          views.push({
            format: "schematic-view-request/0.2",
            root,
            intent: { kind: "trace", to: by(t.designation), includePower },
          });
      }
    }
  }
  for (const c of ir.cables)
    views.push({
      format: "schematic-view-request/0.2",
      root: by(c.designation),
      intent: { kind: "conductors" },
    });
  return views;
}

/** Decode identities without changing any array, XML element or attribute order. */
const identityOrders = new WeakMap<
  ElectricalIr,
  ReturnType<typeof irSemanticOrder>
>();

export function semanticIdentities(ir: ElectricalIr, value: unknown): unknown {
  let order = identityOrders.get(ir);
  if (!order) {
    order = irSemanticOrder(ir);
    identityOrders.set(ir, order);
  }
  const semanticOrder = order;
  const ids = [
    ...ir.devices,
    ...ir.wires,
    ...ir.cables,
    ...ir.jumpers,
    ...ir.potentials,
  ]
    .map((o) => o.uid)
    .concat(ir.nets.map((n) => n.id));
  const unnamedJumpers = new Set(
    ir.jumpers.filter((j) => j.designation === undefined).map((j) => j.uid),
  );
  const visitString = (v: string): string => {
    // Dev's printed fallback is an identity-bearing value, just like a bare UID.
    // Normalize its declared jumper identity; preserve all geometry and ordering.
    if (v.startsWith("jumper:") && unnamedJumpers.has(v.slice(7)))
      return `jumper:${semanticOrder.key(v.slice(7))}`;
    const suffix = /_s[0-9]+$/u.exec(v)?.[0] ?? "";
    return suffix && v.startsWith("[")
      ? semanticOrder.key(v.slice(0, -suffix.length)) + suffix
      : semanticOrder.key(v);
  };
  const svg = (v: string) => {
    let result = v.replace(
      /\b(aggregate|boundary|cable-conductor|cable|clip|device|edge|function|junction|jumper|location|net|potential|port|rail|terminal|wire)-([0-9a-f]{4,}(?:--[0-9a-f]{4,})*)/gu,
      (_, prefix: string, encoded: string) =>
        `${prefix}-${JSON.stringify(encoded.split("--").map((p) => visitString(p.replace(/.{4}/gu, (c) => String.fromCharCode(parseInt(c, 16))))))}`,
    );
    for (const id of ids) result = result.replaceAll(id, semanticOrder.key(id));
    // Reassigning source UIDs changes this opaque locator, not native geometry.
    result = result.replace(
      /data-navigation-view="view\/1\/[a-f0-9]+"/gu,
      'data-navigation-view="UID-dependent-view-key"',
    );
    return result;
  };
  const visit = (v: unknown): unknown => {
    if (typeof v === "string")
      return v.startsWith("<svg") || v.startsWith("<?xml")
        ? svg(v)
        : visitString(v);
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => k !== "$H")
          .map(([k, v]) => [k, visit(v)]),
      );
    return v;
  };
  return visit(value);
}

export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function checkSeeds(
  name: string,
  base: ElectricalIr,
  requests: readonly SchematicViewRequest[],
  testFlows: readonly (typeof flows)[number][] = flows,
) {
  const expected = new Map<
    string,
    { inputs: string[]; svg: string | null; outcome: string }
  >();
  // An undesignated jumper's fallback label is its authored UID. Changing that
  // public label can legitimately change exact font metrics; mutate internal
  // identities while keeping these printed labels fixed in this matrix.
  const printed = base.jumpers.filter((j) => !j.designation).map((j) => j.uid);
  for (let seed = 0; seed < 30; seed++) {
    const ir = reidentify(base, seed, printed);
    for (const request of requests)
      for (const flow of testFlows) {
        const engine = createElkEngine(),
          layout = engine.layout.bind(engine),
          inputs: string[] = [];
        engine.layout = async (...args) => {
          inputs.push(digest(semanticIdentities(ir, args[0])));
          return layout(...args);
        };
        const r = await createSchematicRendererWithDependencies({
          layoutEngine: engine,
        }).render(ir, { ...request, flow });
        const key = JSON.stringify({ ...request, flow });
        const svg = r.ok ? r.value.svg : null;
        const svgHash = digest(semanticIdentities(ir, svg));
        const actual = {
          inputs,
          svg: svg === null ? null : svgHash,
          outcome: r.ok ? "ok" : r.error.code,
        };
        if (!expected.has(key)) expected.set(key, actual);
        expect(actual, `${name} seed=${seed} ${key}`).toEqual(
          expected.get(key),
        );
      }
  }
}
