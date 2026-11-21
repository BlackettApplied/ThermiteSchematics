// Signal-loop cases shared by signal-loop.test.ts and the generated project
// guide's test (project-guide.test.ts), which executes the rows its sentences
// claim.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import {
  renderSchematicPacket,
  type SignalLoopViewRequest,
} from "@thermite/render";

const temporary: string[] = [];
/** Removes every fixture made since the last call. */
export async function removeFixtures() {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
}
export async function fixture() {
  const p = await mkdtemp(join(tmpdir(), "thermite-loop-"));
  temporary.push(p);
  for (const name of ["field-interfaces", "industrial-pilot"])
    await cp(resolve("libraries", name), join(p, name), { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFile(join(p, name), JSON.stringify(value));
  await write("system.json", {
    format: "electrical-system/0.1",
    project: { name: "Pressure hookup fixture" },
    sources: ["source.json"],
    libraries: ["field-interfaces", "industrial-pilot"].map((name) => ({
      name,
      version: "0.1.0",
      path: name,
    })),
  });
  const source = JSON.parse(
    await readFile(
      resolve("packages/cli/fixtures/signal-loop/source.json"),
      "utf8",
    ),
  );
  await write("source.json", source);
  expect((await lockProject(p)).ok).toBe(true);
  return {
    p,
    write,
    source,
    cable: source.objects.find((o: any) => o.kind === "cable"),
  };
}
export async function compiled(p: string) {
  const c = await compileProject(p);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  return c.ir;
}
export const view: SignalLoopViewRequest = {
  format: "signal-loop-view-request/0.1",
  from: { device: "PT1", function: "signal" },
  to: { device: "AI1", function: "ch0" },
};
export const assemblyView: SignalLoopViewRequest = {
  ...view,
  cableAssemblies: [
    {
      cable: "CB1",
      connector: "M12",
      description: "4-pole A-coded molded cordset (proposed)",
    },
  ],
  enclosures: [
    {
      label: "Main electrical cabinet",
      devices: ["XP1", "XT1", "AI1"],
      wallDevice: "XP1",
    },
  ],
};
export const packet = (v: SignalLoopViewRequest = view) => ({
  format: "schematic-packet-request/0.1" as const,
  page: {
    size: "tabloid" as const,
    orientation:
      v.flow === "top-to-bottom"
        ? ("portrait" as const)
        : ("landscape" as const),
  },
  views: [v],
});

/** Source faults that must fail R006 rather than omit an electrical fact. */
export const LOOP_REJECTIONS = [
  "missing-wire",
  "branch",
  "short",
  "active-spare",
  "loose-core",
  "unassigned-core",
  "extra-active",
  "spare-branch",
  "different-chain",
] as const;
export type LoopRejection = (typeof LOOP_REJECTIONS)[number];
/** Applies one fault to a fresh fixture and renders it plain and grouped. */
export async function renderLoopRejection(problem: LoopRejection) {
  const f = await fixture(),
    objects = f.source.objects;
  const wire = (a: string, ap: string, b: string, bp: string) => ({
    kind: "wire",
    uid: randomUUID(),
    designation: "EXTRA",
    endpoints: [
      { device: a, terminal: ap },
      { device: b, terminal: bp },
    ],
  });
  if (problem === "missing-wire") objects.pop();
  if (problem === "branch") objects.push(wire("XT1", "1", "XT1", "5"));
  if (problem === "short") objects.push(wire("XT1", "1", "XT1", "2"));
  if (problem === "active-spare") f.cable.conductors[0].usage = "spare";
  if (problem === "loose-core") f.cable.conductors[3].endpoints[1] = null;
  if (problem === "unassigned-core") f.cable.conductors.pop();
  if (problem === "extra-active") f.cable.conductors[3].usage = "in-use";
  if (problem === "spare-branch") objects.push(wire("XP1", "3", "XT1", "5"));
  if (problem === "different-chain") {
    const onward = objects.find((o: any) => o.designation === "W4");
    onward.endpoints[0] = { device: "XP1", terminal: "2" };
    objects.splice(
      objects.findIndex((o: any) => o.designation === "W3"),
      1,
    );
  }
  await f.write("source.json", f.source);
  const ir = await compiled(f.p);
  const results = [];
  for (const mode of [view, assemblyView])
    results.push(await renderSchematicPacket(ir, packet(mode)));
  return results;
}
