import type { CircuitViewRequest } from "../src/circuit.js";
import { compileProject, lockProject } from "@thermite/compiler";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const functions = (device: string, ...keys: string[]) =>
  keys.map((key) => ({
    device: { by: "designation" as const, value: device },
    key,
  }));

/** Portable core fixture: no machine-project, scanned PDF, or local path dependency. */
export function motorCircuitView(): CircuitViewRequest {
  return {
    format: "circuit-view-request/0.1",
    title: "Motor circuit",
    columns: 1,
    groups: [
      {
        id: "motor-power",
        lineReference: "100",
        label: "Three-phase motor power",
        functions: [
          ...functions("CB1", "pole1", "pole2", "pole3"),
          ...functions("K1", "pole1", "pole2", "pole3"),
          ...functions("OL1", "pole1", "pole2", "pole3"),
          ...functions("M1", "motor_load", "protective_earth"),
        ],
        conductors: Array.from(
          { length: 13 },
          (_, i) => `W-PWR-${String(i + 1).padStart(3, "0")}`,
        ),
      },
    ],
  };
}

export function controlCircuitView(): CircuitViewRequest {
  return {
    format: "circuit-view-request/0.1",
    title: "Motor control",
    groups: [
      {
        id: "motor-control",
        lineReference: "200",
        label: "Contactor command and interlocks",
        functions: [
          ...functions("PLC1", "do0"),
          ...functions("PB1", "contact11"),
          ...functions("OL1", "aux95"),
          ...functions("K1", "coil"),
        ],
        conductors: ["W-CTL-005", "W-CTL-006", "W-CTL-007", "W-CTL-008"],
      },
    ],
  };
}

export async function parallelCircuitFixture(reverseCommon = false) {
  const directory = await mkdtemp(join(tmpdir(), "thermite-circuit-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const write = (path: string, value: unknown) =>
      writeFile(join(directory, path), JSON.stringify(value));
    await mkdir(join(directory, "library"));
    await write("system.json", {
      format: "electrical-system/0.1",
      project: { name: "Parallel control circuit" },
      sources: ["source.json"],
      libraries: [
        { name: "circuit-fixture", version: "0.1.0", path: "library" },
      ],
    });
    await write("library/library.json", {
      name: "circuit-fixture",
      version: "0.1.0",
      sources: ["types.json"],
    });
    const terminals = (...keys: string[]) =>
      Object.fromEntries(keys.map((k) => [k, { connection_policy: "shared" }]));
    await write("library/types.json", {
      types: [
        {
          kind: "device_type",
          id: "circuit-fixture:supply",
          symbol: "thermite:dc-supply",
          terminals: terminals("+", "-"),
          functions: { output: { kind: "source", terminals: ["+", "-"] } },
        },
        {
          kind: "device_type",
          id: "circuit-fixture:button",
          symbol: "thermite:pushbutton",
          terminals: terminals("1", "2"),
          functions: {
            contact: {
              kind: "contact",
              normal_state: "open",
              terminals: ["1", "2"],
            },
          },
        },
        {
          kind: "device_type",
          id: "circuit-fixture:relay",
          symbol: "thermite:relay",
          terminals: terminals("A1", "A2", "11", "12", "14"),
          functions: {
            coil: { kind: "coil", terminals: ["A1", "A2"] },
            no: {
              kind: "contact",
              normal_state: "open",
              terminals: ["11", "14"],
            },
            nc: {
              kind: "contact",
              normal_state: "closed",
              terminals: reverseCommon ? ["12", "11"] : ["11", "12"],
            },
          },
          internal_relations: [
            { relation: "actuates", from: "coil", to: "no" },
            { relation: "actuates", from: "coil", to: "nc" },
          ],
        },
        {
          kind: "device_type",
          id: "circuit-fixture:lamp",
          symbol: "thermite:lamp",
          terminals: terminals("1", "2"),
          functions: { light: { kind: "load", terminals: ["1", "2"] } },
        },
      ],
    });
    let serial = 0;
    const uid = () =>
      `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
    const devices = [
      ["PS1", "supply"],
      ["PB1", "button"],
      ["K1", "relay"],
      ["H1", "lamp"],
    ].map(([designation, type]) => ({
      kind: "device",
      uid: uid(),
      designation,
      type: `circuit-fixture:${type}`,
    }));
    const links = [
      [["PS1", "+"], ["PB1", "1"], "100"],
      [["PS1", "+"], ["K1", "11"], "100"],
      [["PB1", "2"], ["K1", "A1"], "101"],
      [["K1", "14"], ["K1", "A1"], "101"],
      [["K1", "A2"], ["PS1", "-"], "0V"],
      [["K1", "12"], ["H1", "1"], "102"],
      [["H1", "2"], ["PS1", "-"], "0V"],
    ] as const;
    const wires = links.map(([a, b, label], i) => ({
      kind: "wire",
      uid: uid(),
      designation: `W${i + 1}`,
      endpoints: [
        { device: a[0], terminal: a[1] },
        { device: b[0], terminal: b[1] },
      ],
      properties: { label },
    }));
    await write("source.json", { objects: [...devices, ...wires] });
    const lock = await lockProject(directory);
    if (!lock.ok) throw new Error(JSON.stringify(lock.diagnostics));
    const compiled = await compileProject(directory);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const view: CircuitViewRequest = {
      format: "circuit-view-request/0.1",
      title: "Seal-in and shared relay common",
      groups: [
        {
          id: "seal-in",
          functions: [
            ...functions("PB1", "contact"),
            ...functions("K1", "no", "nc", "coil"),
            ...functions("H1", "light"),
          ],
          conductors: wires.map((w) => w.designation),
        },
      ],
    };
    return { ir: compiled.ir, view, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/** A supply feeds a module whose external jumpers link three contact commons. */
export async function jumperChainCircuitFixture() {
  const directory = await mkdtemp(join(tmpdir(), "thermite-jumper-labels-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const write = (path: string, value: unknown) =>
      writeFile(join(directory, path), JSON.stringify(value));
    await mkdir(join(directory, "library"));
    await write("system.json", {
      format: "electrical-system/0.1",
      project: { name: "Module jumper labels" },
      sources: ["source.json"],
      libraries: [
        { name: "jumper-fixture", version: "0.1.0", path: "library" },
      ],
    });
    await write("library/library.json", {
      name: "jumper-fixture",
      version: "0.1.0",
      sources: ["types.json"],
    });
    const terminals = (...keys: string[]) =>
      Object.fromEntries(
        keys.map((key) => [key, { connection_policy: "shared" }]),
      );
    await write("library/types.json", {
      types: [
        {
          kind: "device_type",
          id: "jumper-fixture:strip",
          symbol: "thermite:terminal-strip",
          terminals: terminals("DC1", "COM.1"),
          functions: {
            positive: { kind: "bus", terminals: ["DC1"] },
            negative: { kind: "bus", terminals: ["COM.1"] },
          },
        },
        {
          kind: "device_type",
          id: "jumper-fixture:fuse",
          symbol: "thermite:fuse",
          terminals: terminals("I1", "O1"),
          functions: {
            pole1: {
              kind: "contact",
              normal_state: "closed",
              terminals: ["I1", "O1"],
            },
          },
        },
        {
          kind: "device_type",
          id: "jumper-fixture:module",
          symbol: "thermite:io-module",
          terminals: terminals("A1", "A2", "23", "24", "33", "34", "41", "42"),
          functions: {
            power: { kind: "load", terminals: ["A1", "A2"] },
            contact23: {
              kind: "contact",
              normal_state: "open",
              terminals: ["23", "24"],
            },
            contact33: {
              kind: "contact",
              normal_state: "open",
              terminals: ["33", "34"],
            },
            contact41: {
              kind: "contact",
              normal_state: "closed",
              terminals: ["41", "42"],
            },
          },
        },
      ],
    });
    const uid = (i: number) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const devices = [
      ["XT1-S01", "strip"],
      ["FU5102", "fuse"],
      ["SCN5102", "module"],
    ].map(([designation, type], i) => ({
      uid: uid(i + 1),
      kind: "device",
      designation,
      type: `jumper-fixture:${type}`,
    }));
    const links = [
      ["XT1-S01", "DC1", "FU5102", "I1", "DC1", "Blue"],
      ["FU5102", "O1", "SCN5102", "A1", "5102", ""],
      ["SCN5102", "A2", "XT1-S01", "COM.1", "COM", "Blue/White"],
      ["SCN5102", "A1", "SCN5102", "23", "5102", ""],
      ["SCN5102", "23", "SCN5102", "33", "5102", ""],
      ["SCN5102", "33", "SCN5102", "41", "5102", ""],
    ];
    const wires = links.map(([a, at, b, bt, label, color], i) => ({
      uid: uid([12, 11, 15, 13, 14, 16][i]!),
      kind: "wire",
      designation: `W${i + 1}`,
      endpoints: [
        { device: a, terminal: at },
        { device: b, terminal: bt },
      ],
      properties: { label, ...(color ? { color, size: "18 AWG" } : {}) },
    }));
    await write("source.json", { objects: [...devices, ...wires] });
    const lock = await lockProject(directory);
    if (!lock.ok) throw new Error(JSON.stringify(lock.diagnostics));
    const compiled = await compileProject(directory);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const view: CircuitViewRequest = {
      format: "circuit-view-request/0.1",
      title: "Power and external contact jumpers",
      terminalLayout: "distributed",
      groups: [
        {
          id: "jumper-chain",
          conductors: wires.map((w) => w.designation),
          functions: [
            ...functions("XT1-S01", "positive", "negative"),
            ...functions("FU5102", "pole1"),
            ...functions(
              "SCN5102",
              "power",
              "contact23",
              "contact33",
              "contact41",
            ),
          ],
        },
      ],
    };
    return { ir: compiled.ir, view, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
