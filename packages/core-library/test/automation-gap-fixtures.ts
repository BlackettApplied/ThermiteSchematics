import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";

type Gap = "loop" | "disconnect";
function gapObjects(kind: Gap) {
  let serial = 0;
  const objects: any[] = [];
  const uid = () =>
    `70000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
  const device = (designation: string, type: string) =>
    objects.push({
      kind: "device",
      uid: uid(),
      designation,
      type: `core:${type}`,
    });
  const wire = (a: string, at: string, b: string, bt: string) =>
    objects.push({
      kind: "wire",
      uid: uid(),
      designation: `W${serial}`,
      endpoints: [
        { device: a, terminal: at },
        { device: b, terminal: bt },
      ],
    });
  device("SRC1", "supply-480v-3ph");
  if (kind === "disconnect") {
    device("DS1", "disconnect-3p");
    device("M1", "motor-3ph");
    for (const [i, terminal] of ["U", "V", "W"].entries()) {
      wire("SRC1", `L${i + 1}`, "DS1", `${i * 2 + 1}/L${i + 1}`);
      wire("DS1", `${i * 2 + 2}/T${i + 1}`, "M1", terminal);
    }
    wire("SRC1", "PE", "M1", "PE");
  } else {
    for (const [name, type] of [
      ["PE1", "terminal-pe"],
      ["PS1", "psu-24vdc"],
      ["PLC1", "plc-8di-8do-2ai"],
      ["TX1", "transmitter-2wire-4-20ma"],
      ["TB1", "terminal-block-8"],
    ])
      device(name, type);
    wire("SRC1", "PE", "PE1", "PE");
    wire("SRC1", "L1", "PS1", "L");
    wire("SRC1", "L2", "PS1", "N");
    wire("PS1", "+", "PLC1", "L+");
    wire("PS1", "-", "PLC1", "M");
    wire("PS1", "+", "TB1", "5");
    wire("TB1", "5", "TX1", "+");
    wire("TX1", "-", "TB1", "6");
    wire("TB1", "6", "PLC1", "AI0+");
    wire("PLC1", "AI0-", "PS1", "-");
  }
  return objects;
}

export const signalPacket = (auxiliary = false, loopPower = false) => ({
  format: "schematic-packet-request/0.1" as const,
  views: [
    {
      format: "signal-loop-view-request/0.1" as const,
      from: { device: "TX1", function: "signal" },
      to: { device: "PLC1", function: "ai0" },
      ...(loopPower
        ? { loopPower: { device: "PS1", function: "dc_output" } }
        : {}),
      ...(auxiliary
        ? {
            auxiliary: [
              {
                from: { device: "PS1", function: "dc_output" },
                to: { device: "TX1", function: "signal" },
              },
            ],
          }
        : {}),
    },
  ],
});
export const disconnectCircuit = {
  format: "circuit-view-request/0.1" as const,
  title: "Disconnect identity gap",
  groups: [
    {
      id: "disconnect",
      functions: ["pole1", "pole2", "pole3"].map((key) => ({
        device: { by: "designation" as const, value: "DS1" },
        key,
      })),
      conductors: [],
    },
  ],
};

/** Minimal synthetic renderer reproductions; no selected hardware or pinout. */
export async function writeGapProject(root: string, kind: Gap) {
  await mkdir(root, { recursive: true });
  const files: Record<string, unknown> = {
    "system.json": {
      format: "electrical-system/0.1",
      project: { name: `${kind} render gap` },
      sources: ["source.json"],
      libraries: [{ name: "core", version: "0.2.0" }],
    },
    "source.json": { objects: gapObjects(kind) },
    ...(kind === "loop"
      ? { "packet.json": signalPacket(), "packet-aux.json": signalPacket(true) }
      : {
          "circuit.json": {
            format: "schematic-packet-request/0.1",
            views: [disconnectCircuit],
          },
        }),
  };
  for (const [path, value] of Object.entries(files))
    await writeFile(join(root, path), JSON.stringify(value, null, 2) + "\n");
  const lock = await lockProject(root);
  if (!lock.ok) throw Error(JSON.stringify(lock.diagnostics));
  const compiled = await compileProject(root);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  return compiled;
}
