import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Device, DeviceType, Relation } from "@thermite/schema";
import { lockProject, compileProject } from "../src/index.js";
const id = (i: number) =>
  `42000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
export async function connectorFixture(
  change?: (types: DeviceType[], objects: (Device | Relation)[]) => void,
) {
  const root = await mkdtemp(join(tmpdir(), "thermite-connector-"));
  const dispose = () => rm(root, { recursive: true, force: true });
  const port = (description: string) => ({
    connector: "M12 A-coded, 5-pin",
    description,
  });
  const powerType = (name: string): DeviceType => ({
    kind: "device_type",
    id: `connector-fixture:${name}`,
    description: name,
    terminals: { P: { required: true }, M: { required: true } },
    functions: { power: { kind: "load", terminals: ["P", "M"] } },
    connectorPorts: {
      M12: {
        ...port("Power and signal"),
        pins: {
          "1": { terminal: "P", description: "24 V" },
          "3": { terminal: "M", description: "0 V" },
          "5": { terminal: "M", description: "Documented shared return" },
        },
      },
    },
    connectionCoverage: {
      status: "partial",
      notes: "Connector occupancy does not document cable pin wiring.",
    },
  });
  const rack = powerType("rack");
  rack.connectorPorts = {
    X1: port("Pressure input"),
    X2: port("Capped input"),
    X3: port("Unoccupied input"),
    X4: port("Splitter input"),
  };
  const types: DeviceType[] = [
    rack,
    powerType("sensor"),
    {
      kind: "device_type",
      id: "connector-fixture:cap",
      description: "Protective dust cap",
      terminals: {},
      functions: {},
      connectorPorts: { P: { connector: "M12 cap" } },
    },
    {
      kind: "device_type",
      id: "connector-fixture:splitter",
      description: "Y splitter",
      terminals: {},
      functions: {},
      connectorPorts: {
        IN: port("Trunk"),
        A: port("Branch A"),
        B: port("Branch B"),
      },
    },
  ];
  const objects: (Device | Relation)[] = [
    {
      uid: id(1),
      kind: "device",
      designation: "R1",
      description: "Remote I/O rack",
      type: rack.id,
      location: "Main machine",
    },
    {
      uid: id(2),
      kind: "device",
      designation: "S1",
      description: "Main hydraulic pressure sensor",
      type: types[1]!.id,
      location: "Field",
    },
    { uid: id(3), kind: "device", designation: "CAP1", type: types[2]!.id },
    { uid: id(4), kind: "device", designation: "Y1", type: types[3]!.id },
    {
      uid: id(5),
      kind: "device",
      designation: "S2",
      description: "Platen position switch",
      type: types[1]!.id,
      location: "Field",
    },
  ];
  const link = (
    i: number,
    name: string,
    from: number,
    fromPort: string,
    to: number,
    toPort: string,
    kind: "cable" | "cap" = "cable",
  ): Relation => ({
    uid: id(i),
    kind: "relation",
    designation: name,
    relation: "associated_with",
    from: { device: ["", "R1", "S1", "CAP1", "Y1", "S2"][from]! },
    to: { device: ["", "R1", "S1", "CAP1", "Y1", "S2"][to]! },
    assembly: {
      kind,
      fromPort,
      toPort,
      status: "documented",
      pinMapping: {
        status: kind === "cap" ? "not-applicable" : "unresolved",
        reason:
          kind === "cap"
            ? "Protective cap, no electrical pins."
            : "Reference drawing identifies the cordset but omits conductor mapping.",
      },
      ...(kind === "cable"
        ? {
            cable: {
              specification: "M12 molded cordset",
              manufacturer: "Fixture vendor",
              orderNumber: "CBL-5",
              lengthM: 2,
            },
          }
        : {}),
    },
  });
  objects.push(
    link(11, "W1", 1, "X1", 2, "M12"),
    link(12, "CAP-X2", 1, "X2", 3, "P", "cap"),
    link(13, "W2", 1, "X4", 4, "IN"),
    link(14, "W3", 4, "A", 5, "M12"),
  );
  change?.(types, objects);
  try {
    await mkdir(join(root, "library"));
    const write = (p: string, v: unknown) =>
      writeFile(join(root, p), JSON.stringify(v, null, 2));
    await write("system.json", {
      format: "electrical-system/0.1",
      project: { name: "Connector assembly fixture" },
      sources: ["source.json"],
      libraries: [
        { name: "connector-fixture", version: "0.1.0", path: "library" },
      ],
    });
    await write("source.json", { objects });
    await write("library/library.json", {
      name: "connector-fixture",
      version: "0.1.0",
      sources: ["types.json"],
    });
    await write("library/types.json", { types });
    const lock = await lockProject(root);
    if (!lock.ok) return { root, dispose, result: lock, types, objects };
    return {
      root,
      dispose,
      result: await compileProject(root),
      types,
      objects,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
