import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import {
  projectDeviceTypeSymbolMappings,
  type FunctionSymbolRule,
} from "../src/symbols/mappings.js";

const uid = (n: number) =>
  `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const DUT = uid(1);

async function writeProbe(root: string, type: any, motor: boolean) {
  await mkdir(join(root, "local"));
  await writeFile(
    join(root, "local/library.json"),
    JSON.stringify({
      name: type.id.split(":")[0],
      version: "0.1.0",
      sources: ["types.json"],
    }),
  );
  await writeFile(
    join(root, "local/types.json"),
    JSON.stringify({ types: [type] }),
  );
  const libraries: any[] = [
    { name: type.id.split(":")[0], version: "0.1.0", path: "local" },
  ];
  const objects: any[] = [
    { kind: "device", uid: DUT, designation: "DUT", type: type.id },
  ];
  if (motor) {
    libraries.push({ name: "core", version: "0.2.0" });
    objects.push(
      {
        kind: "device",
        uid: uid(2),
        designation: "SRC",
        type: "core:supply-480v-3ph",
      },
      {
        kind: "device",
        uid: uid(3),
        designation: "M1",
        type: "core:motor-3ph",
      },
    );
    const keys = [
      ...new Set<string>(
        type.internal_relations
          .filter((r: any) => r.relation === "ganged_with")
          .flatMap((r: any) => [r.from, r.to]),
      ),
    ];
    const wire = (a: string[], b: string[]) =>
      objects.push({
        kind: "wire",
        uid: uid(objects.length + 1),
        designation: `W${objects.length}`,
        endpoints: [a, b].map(([device, terminal]) => ({ device, terminal })),
      });
    for (const [i, key] of keys.entries()) {
      const [a, b] = type.functions[key].terminals;
      wire(["SRC", `L${i + 1}`], ["DUT", a]);
      wire(["DUT", b], ["M1", ["U", "V", "W"][i]!]);
    }
    wire(["SRC", "PE"], ["M1", "PE"]);
  }
  await writeFile(join(root, "source.json"), JSON.stringify({ objects }));
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Library gang geometry probe" },
      sources: ["source.json"],
      libraries,
    }),
  );
}

export async function libraryGangFixture(
  source: string,
  motor = false,
  typeId?: string,
) {
  const json = JSON.parse(await readFile(source, "utf8"));
  const type = (json.types ?? [json]).find(
    (t: any) => !typeId || t.id === typeId,
  );
  const root = await mkdtemp(join(tmpdir(), "thermite-library-gang-"));
  await writeProbe(root, type, motor);
  const locked = await lockProject(root);
  if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
  const compiled = await compileProject(root);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return {
    ir: compiled.ir,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/** Explicit display projection exercises the public mapping extension point.
 * Native profile admission is intentionally unchanged. Every mark and terminal
 * comes from source; no device, terminal role or electrical relation is edited. */
export function authoredPowerMapping(ir: ElectricalIr) {
  const mappings = projectDeviceTypeSymbolMappings(ir);
  const type = ir.deviceTypes.find(
    (t) => t.id === ir.devices.find((d) => d.uid === DUT)!.typeId,
  )!;
  const functions: FunctionSymbolRule[] = type.functions
    .filter((f) => f.kind === "contact")
    .map((f) => ({
      functionKey: f.key,
      families: ["power"],
      symbolId:
        mappings
          .find((m) => m.typeId === type.id)
          ?.functions.find(
            (r) => r.functionKey === f.key && r.families.includes("power"),
          )?.symbolId ??
        `ais:${type.circuitSymbols?.[f.key] ?? (f.normal_state === "open" ? "contact-no" : "contact-nc")}`,
      bindings: f.terminalKeys.map((terminalKey, i) => ({
        portId: i ? "out" : "in",
        terminalKey,
      })),
      classification:
        mappings
          .find((m) => m.typeId === type.id)
          ?.functions.find(
            (r) => r.functionKey === f.key && r.families.includes("power"),
          )?.classification ??
        mappings
          .find((m) => m.typeId === type.id)
          ?.functions.find((r) => r.functionKey === f.key)?.classification ??
        "power-contact",
      traversalRole: "power-contact",
    }));
  return [
    ...mappings.filter((m) => m.typeId !== type.id),
    {
      typeId: type.id,
      functions,
      aggregates: [],
      omissions: [],
      boundaryTerminals: [],
    },
  ];
}
