import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import type { SchematicPacketRequest } from "../src/sheets.js";
import p4 from "./fixtures/dol-control-probes/p4.json";
import p5 from "./fixtures/dol-control-probes/p5.json";
import p6 from "./fixtures/dol-control-probes/p6.json";
import p7 from "./fixtures/dol-control-probes/p7.json";
import packet from "./fixtures/dol-control-probes/packet.json";

export const dolStarter = fileURLToPath(
  new URL("../../core-library/test/fixtures/dol-starter/", import.meta.url),
);
export const recipes = { p4, p5, p6, p7 };
export type DolProbe = "saved" | keyof typeof recipes;
export type DrawingProbe = Exclude<DolProbe, "p7">;
export type DolSource = { objects: any[] };

// Recipes replace only explicitly named endpoints and remove only named wires.
// No source IDs, device facts, library files or locks are generated here.
export function applyDolRecipe(source: DolSource, name: DolProbe): DolSource {
  const result = structuredClone(source);
  if (name === "saved") return result;
  const patch = recipes[name];
  const endpoints: Record<string, { device: string; terminal: string }[]> =
    patch.endpoints;
  for (const designation of [...patch.remove, ...Object.keys(endpoints)]) {
    if (
      !result.objects.some(
        (o) => o.kind === "wire" && o.designation === designation,
      )
    )
      throw Error(`Missing recipe wire: ${designation}`);
  }
  result.objects = result.objects.filter(
    (o) => !patch.remove.includes(o.designation),
  );
  for (const object of result.objects)
    if (endpoints[object.designation])
      object.endpoints = structuredClone(endpoints[object.designation]);
  return result;
}

export async function dolProbeFixture(name: DolProbe) {
  const root = await mkdtemp(join(tmpdir(), `thermite-dol-${name}-`));
  try {
    await cp(dolStarter, root, { recursive: true });
    const path = join(root, "source.json");
    const original: DolSource = JSON.parse(await readFile(path, "utf8"));
    const source = applyDolRecipe(original, name);
    await writeFile(path, JSON.stringify(source));
    const compiled = await compileProject(root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    return {
      ...compiled,
      root,
      source,
      original,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export function dolPackets(
  name: DrawingProbe,
  flow: "left-to-right" | "top-to-bottom",
) {
  const combined = structuredClone(packet) as SchematicPacketRequest;
  const removed = name === "saved" ? [] : recipes[name].remove;
  const views = combined.views.map((view) => {
    if (view.format !== "circuit-view-request/0.1") return { ...view, flow };
    return {
      ...view,
      flow,
      groups: view.groups.map((g) => ({
        ...g,
        conductors: g.conductors!.filter((w) => !removed.includes(w)),
      })),
    };
  });
  return {
    K1: { ...combined, views: views.slice(0, 1) },
    R1: { ...combined, views: views.slice(1, 2) },
    circuit: { ...combined, views: views.slice(2) },
    combined: { ...combined, views },
  };
}

// Independent of requests and rendering: authored wires incident to control
// devices, plus their non-mechanism type functions and the two shared devices'
// control functions. F1 remains in this inventory after its wires are bypassed.
export function dolControlInventory(source: DolSource, ir: ElectricalIr) {
  const controls = new Set(["T1", "PS1", "F1", "S0", "S1", "S2", "R1", "H1"]);
  const wires = source.objects.filter(
    (o) =>
      o.kind === "wire" &&
      o.endpoints.some((e: { device: string }) => controls.has(e.device)),
  );
  const functions = source.objects
    .filter((o) => o.kind === "device")
    .flatMap((o) => {
      const type = ir.deviceTypes.find((t) => t.id === o.type);
      if (!type) throw Error(`Missing authored type: ${o.type}`);
      return type.functions
        .filter(
          (f) =>
            f.kind !== "mechanism" &&
            (controls.has(o.designation) ||
              (o.designation === "K1" && f.key === "coil") ||
              (o.designation === "OL1" && f.key === "aux95")),
        )
        .map((f) => ({
          id: JSON.stringify([o.uid, f.key]),
          name: `${o.designation}.${f.key}`,
        }));
    });
  return {
    wires: wires.map((w) => ({
      id: w.uid as string,
      name: w.designation as string,
    })),
    functions,
  };
}
