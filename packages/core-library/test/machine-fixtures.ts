import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";
import { SHIPPED_CORE_VERSIONS } from "../src/index.js";

export const coreFiles = SHIPPED_CORE_VERSIONS["0.2.0"]!.fileInventory.slice(1);
export async function coreTypes() {
  return Promise.all(
    coreFiles.map(
      async (file) =>
        JSON.parse(await readFile(`packages/core-library/${file}`, "utf8"))
          .types[0],
    ),
  );
}
export type Family = "power" | "control" | "loads";
/** Synthetic shape probes, not suggested electrical circuits or rating claims.
 * Like P4's contractProject, control load bindings are exercised through loads
 * selection, since the legacy control root contract requires a coil. */
export async function machineProbe(type: any, family: Family, key: string) {
  const root = await mkdtemp(join(tmpdir(), "thermite-machine-matrix-"));
  let n = 0;
  const objects: any[] = [];
  const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const device = (designation: string, type: string) =>
    objects.push({ uid: uid(), kind: "device", designation, type });
  const endpoint = (s: string) => {
    const i = s.indexOf(".");
    return { device: s.slice(0, i), terminal: s.slice(i + 1) };
  };
  const wire = (a: string, b: string) =>
    objects.push({
      uid: uid(),
      kind: "wire",
      designation: `W${n}`,
      endpoints: [a, b].map(endpoint),
    });
  if (type.kind === "device_type") device("DUT", type.id);
  device("SRC", "core:supply-480v-3ph");
  device("PS1", "core:psu-24vdc");
  device("K1", "core:contactor-3p-1no");
  device("M1", "core:motor-3ph");
  device("PLC1", "core:plc-compact");
  const f =
      type.kind === "cable_type"
        ? { kind: "physical-cable", terminals: [] }
        : type.functions[key],
    [a, b, c] = f.terminals;
  const request: any = {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: family === "power" ? "M1" : "K1" },
    family: family === "power" ? "power" : "control",
  };
  const loads = () => {
    request.format = "schematic-view-request/0.2";
    request.root.value = "PS1";
    delete request.family;
    request.intent = { kind: "loads" };
  };
  if (type.kind === "cable_type") {
    const pairs =
      family === "power"
        ? [
            ["SRC.L1", "M1.U"],
            ["SRC.L2", "M1.V"],
            ["SRC.L3", "M1.W"],
            ["SRC.PE", "M1.PE"],
          ]
        : [
            ["PS1.+", family === "loads" ? "PLC1.L+" : "K1.A1"],
            ["PS1.-", family === "loads" ? "PLC1.M" : "K1.A2"],
          ];
    objects.push({
      uid: uid(),
      kind: "cable",
      designation: "CBL1",
      type: type.id,
      conductors: type.conductors.map((c: any, i: number) => ({
        id: c.id,
        endpoints: pairs[i] ? pairs[i].map(endpoint) : [null, null],
        ...(pairs[i] ? {} : { usage: "spare" }),
      })),
    });
    // A pair cable carries only two lanes; complete the other physical lanes
    // with wires so cable rendering is tested independently of a missing phase.
    for (const pair of pairs.slice(type.conductors.length))
      wire(pair[0], pair[1]);
    if (family === "loads") loads();
  } else if (family === "power") {
    wire("SRC.L2", "M1.V");
    wire("SRC.L3", "M1.W");
    if (!(f.kind === "bus" && type.terminals[a].role === "protective_earth"))
      wire("SRC.PE", "M1.PE");
    if (f.kind === "source") {
      wire(`DUT.${a}`, "M1.U");
      if (c) {
        wire(`DUT.${b}`, "M1.V");
        wire(`DUT.${c}`, "M1.W");
      }
    } else if (
      f.kind === "load" &&
      (type.symbol === "thermite:motor-3ph" ||
        type.symbol === "thermite:dc-supply")
    ) {
      wire("SRC.L1", `DUT.${a}`);
      wire("SRC.L2", `DUT.${b}`);
      if (c) wire("SRC.L3", `DUT.${c}`);
      if (type.terminals.PE) wire("SRC.PE", "DUT.PE");
      request.root.value = "DUT";
    } else if (
      f.kind === "bus" &&
      type.terminals[a].role === "protective_earth"
    ) {
      wire("SRC.L1", "M1.U");
      wire("SRC.PE", `DUT.${a}`);
      wire(`DUT.${a}`, "M1.PE");
    } else {
      wire("SRC.L1", `DUT.${a}`);
      wire(`DUT.${b ?? a}`, "M1.U");
    }
  } else if (f.kind === "source") {
    wire(`DUT.${a}`, "K1.A1");
    wire(`DUT.${b}`, "K1.A2");
    if (family === "loads" && f.terminals.length > 2) {
      loads();
      wire("PS1.+", `DUT.${a}`);
      wire("PS1.-", `DUT.${b}`);
    } else if (family === "loads") {
      loads();
      request.root.value = "DUT";
      wire(`DUT.${a}`, "PLC1.L+");
      wire(`DUT.${b}`, "PLC1.M");
    }
  } else if (f.kind === "load") {
    wire("PS1.+", `DUT.${a}`);
    wire("PS1.-", `DUT.${b}`);
    loads();
  } else if (f.kind === "coil") {
    wire("PS1.+", `DUT.${a}`);
    wire("PS1.-", `DUT.${b}`);
    if (family === "loads") loads();
    else request.root.value = "DUT";
  } else if (
    f.kind === "channel" &&
    f.direction === "output" &&
    f.terminals.length === 1 &&
    type.symbol === "thermite:io-module"
  ) {
    wire("PS1.+", "DUT.L+");
    wire("PS1.-", "DUT.M");
    wire(`DUT.${a}`, "K1.A1");
    wire("PS1.-", "K1.A2");
    if (family === "loads") loads();
  } else if (f.kind === "channel" && type.symbol === "thermite:sensor-3wire") {
    wire("PS1.+", "DUT.1");
    wire("PS1.-", "DUT.3");
    wire(`DUT.${a}`, "PLC1.X1.0");
    if (family === "loads") loads();
    else {
      request.format = "schematic-view-request/0.2";
      request.root.value = "DUT";
      delete request.family;
      request.intent = {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: true,
      };
    }
  } else {
    const target = family === "loads" ? "PLC1.L+" : "K1.A1";
    wire("PS1.+", `DUT.${a}`);
    wire(`DUT.${b ?? a}`, target);
    wire("PS1.-", family === "loads" ? "PLC1.M" : "K1.A2");
    if (family === "loads") loads();
  }
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Core machine shape probe" },
      sources: ["source.json"],
      libraries: [{ name: "core", version: "0.2.0" }],
    }),
  );
  await writeFile(join(root, "source.json"), JSON.stringify({ objects }));
  const locked = await lockProject(root);
  if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
  const compiled = await compileProject(root);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return {
    ir: compiled.ir,
    request,
    root,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

export async function isolatedMachine(type: any) {
  const root = await mkdtemp(join(tmpdir(), "thermite-core-interface-"));
  const objects: any[] = [];
  if (type.kind === "device_type") {
    objects.push({
      uid: "00000000-0000-4000-8000-000000000001",
      kind: "device",
      designation: "DUT",
      type: type.id,
    });
  } else {
    for (const [i, d] of ["TB1", "TB2"].entries())
      objects.push({
        uid: `00000000-0000-4000-8000-00000000000${i + 1}`,
        kind: "device",
        designation: d,
        type: "core:terminal-block-8",
      });
    objects.push({
      uid: "00000000-0000-4000-8000-000000000003",
      kind: "cable",
      designation: "CBL1",
      type: type.id,
      conductors: type.conductors.map((c: any, i: number) => ({
        id: c.id,
        endpoints: ["TB1", "TB2"].map((device) => ({
          device,
          terminal: String(i + 1),
        })),
      })),
    });
  }
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Generic interface inventory" },
      sources: ["source.json"],
      libraries: [{ name: "core", version: "0.2.0" }],
    }),
  );
  await writeFile(join(root, "source.json"), JSON.stringify({ objects }));
  const locked = await lockProject(root);
  if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
  const compiled = await compileProject(root);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return {
    ir: compiled.ir,
    diagnostics: compiled.diagnostics,
    root,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
