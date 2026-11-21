// Analog-output cases shared by analog-output.test.ts and the generated
// project guide's test (project-guide.test.ts), which executes the rows its
// sentences claim.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";

const temporary: string[] = [];
/** Removes every fixture made since the last call. */
export async function removeFixtures() {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
}
export async function fixture() {
  const p = await mkdtemp(join(tmpdir(), "thermite-output-"));
  temporary.push(p);
  for (const name of ["field-interfaces", "industrial-pilot"])
    await cp(resolve("libraries", name), join(p, name), { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFile(join(p, name), JSON.stringify(value));
  await write("system.json", {
    format: "electrical-system/0.1",
    project: { name: "Analog actuator fixture" },
    sources: ["source.json"],
    libraries: ["field-interfaces", "industrial-pilot"].map((name) => ({
      name,
      version: "0.1.0",
      path: name,
    })),
  });
  const source = JSON.parse(
    await readFile("packages/cli/fixtures/analog-output/source.json", "utf8"),
  );
  const packet = JSON.parse(
    await readFile(
      "packages/cli/fixtures/analog-output/packet.request.json",
      "utf8",
    ),
  );
  await write("source.json", source);
  expect((await lockProject(p)).ok).toBe(true);
  async function compile() {
    await write("source.json", source);
    const c = await compileProject(p);
    if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
    return c.ir;
  }
  return { source, packet, compile };
}

/** Request and source faults that must fail R006 rather than hide a conductor. */
export const OUTPUT_REJECTIONS = [
  "omitted-power",
  "duplicate-pair",
  "reverse-pair",
  "short",
  "branch",
  "loose-power",
  "power-as-spare",
  "different-chain",
  "malformed",
] as const;
export type OutputRejection = (typeof OUTPUT_REJECTIONS)[number];
/** Applies one fault to a fresh fixture and renders its packet. */
export async function renderOutputRejection(problem: OutputRejection) {
  const f = await fixture(),
    view = f.packet.views[0];
  const objects = f.source.objects,
    cable = objects.find((o: any) => o.kind === "cable");
  if (problem === "omitted-power") delete view.auxiliary;
  if (problem === "duplicate-pair") view.auxiliary.push(view.auxiliary[0]);
  if (problem === "reverse-pair")
    [view.auxiliary[0].from, view.auxiliary[0].to] = [
      view.auxiliary[0].to,
      view.auxiliary[0].from,
    ];
  if (problem === "loose-power") {
    cable.conductors[0].endpoints[0] = null;
    cable.conductors[0].usage = "spare";
  }
  if (problem === "power-as-spare") cable.conductors[0].usage = "spare";
  if (problem === "malformed")
    view.auxiliary = [{ ...view.auxiliary[0], typo: true }];
  if (problem === "different-chain")
    view.auxiliary[0].from = { device: "AQ1", function: "supply" };
  if (problem === "short" || problem === "branch")
    objects.push({
      kind: "wire",
      uid: randomUUID(),
      designation: "EXTRA",
      endpoints: [
        { device: "XT1", terminal: "3" },
        { device: "XT1", terminal: problem === "short" ? "1" : "8" },
      ],
    });
  return renderSchematicPacket(await f.compile(), f.packet);
}
