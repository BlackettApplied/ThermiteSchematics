// Communication cases shared by communication.test.ts and the generated
// project guide's test (project-guide.test.ts), which executes the rows its
// sentences claim.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";

const temporary: string[] = [];
/** Removes every fixture made since the last call. */
export async function removeFixtures() {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
}
export async function fixture() {
  const p = await mkdtemp(join(tmpdir(), "thermite-ports-"));
  temporary.push(p);
  await mkdir(join(p, "lib"));
  const write = async (name: string, value: unknown) =>
    writeFile(join(p, name), JSON.stringify(value));
  await write("system.json", {
    format: "electrical-system/0.1",
    project: { name: "Port topology" },
    sources: ["source.json"],
    libraries: [{ name: "test", version: "1.0.0", path: "lib" }],
  });
  await write("lib/library.json", {
    name: "test",
    version: "1.0.0",
    sources: ["types.json"],
  });
  const types = {
    types: [
      {
        kind: "device_type",
        id: "test:node",
        description: "Communication node",
        terminals: { P: {}, M: {} },
        functions: {},
        ports: {
          ETH1: { medium: "ethernet", connector: "RJ45" },
          ETH2: { medium: "ethernet", connector: "RJ45" },
          BUS: { medium: "nrg-bus", connector: "Proprietary" },
        },
      },
    ],
  };
  await write("lib/types.json", types);
  const devices = ["A", "B", "C"].map((designation) => ({
    uid: randomUUID(),
    kind: "device",
    designation,
    type: "test:node",
    location: "Cabinet",
  }));
  const relation = {
    uid: randomUUID(),
    kind: "relation",
    designation: "NET1",
    relation: "associated_with",
    from: { device: "A" },
    to: { device: "B" },
    connection: {
      fromPort: "ETH1",
      toPort: "ETH1",
      medium: "ethernet",
      protocol: "PROFINET",
      status: "planned",
    },
  };
  const source = { objects: [...devices, relation] as any[] };
  await write("source.json", source);
  expect((await lockProject(p)).ok).toBe(true);
  return { p, write, source, relation, devices, types };
}

/** Relation faults that fail with authored diagnostics. */
export const CONNECTION_REJECTIONS = [
  "missing-port",
  "medium",
  "occupied",
  "verb",
  "self",
  "missing-device",
] as const;
export type ConnectionRejection = (typeof CONNECTION_REJECTIONS)[number];
/** Applies one fault to a fresh fixture and compiles it. */
export async function compileConnectionRejection(problem: ConnectionRejection) {
  const f = await fixture();
  if (problem === "missing-port") f.relation.connection.fromPort = "MISSING";
  if (problem === "medium") f.relation.connection.fromPort = "BUS";
  if (problem === "verb") f.relation.relation = "controls";
  if (problem === "self") {
    f.relation.to.device = "A";
    f.relation.connection.toPort = "ETH2";
  }
  if (problem === "missing-device") f.relation.to.device = "MISSING";
  if (problem === "occupied")
    f.source.objects.push({
      ...structuredClone(f.relation),
      uid: randomUUID(),
      designation: "NET2",
      to: { device: "C" },
    });
  await f.write("source.json", f.source);
  return compileProject(f.p);
}

/** Physical cable lengths a communication relation refuses. */
export const INVALID_CABLE_LENGTHS = [0, -1, "eight", null] as const;
/** Gives the fixture's relation one cable length and compiles it. */
export async function compileCableLength(
  lengthM: (typeof INVALID_CABLE_LENGTHS)[number],
) {
  const f = await fixture();
  (f.relation.connection as any).cable = { specification: "Cat5e", lengthM };
  await f.write("source.json", f.source);
  return compileProject(f.p);
}
