import { cp, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { compileProject, lockProject } from "@thermite/compiler";
import { resolve, join } from "node:path";

/** The same electrical facts are run on clean dev to record its public fields. */
export async function errorContractCases() {
  const compile = async (project: string) => {
    const c = await compileProject(resolve(project));
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    return c.ir;
  };
  const core = await compile("examples/motor-starter");
  const d = (value: string) => ({ by: "designation" as const, value });
  const trace = {
    format: "schematic-view-request/0.2",
    root: d("LS1"),
    intent: { kind: "trace", to: d("PLC1"), includePower: false },
  } as const;
  const target = structuredClone(core);
  target.deviceTypes.find((t) => t.id === "core:plc-compact")!.symbol =
    "iec:indicator-light";
  const path = structuredClone(core);
  path.deviceTypes.find((t) => t.id === "core:terminal-block-8")!.symbol =
    "thermite:lamp";
  const text = structuredClone(core);
  text.project.name = "bad\u0001name";
  const sensor = await compile("examples/conveyor-line");
  sensor.deviceTypes
    .find((t) => t.id === "core:prox-pnp-3wire")!
    .terminals.find((t) => t.key === "3")!.role = "0v";
  return [
    { code: "R001", ir: target, view: trace },
    {
      code: "R002",
      ir: await compile("packages/cli/templates/starter-default"),
      view: {
        format: "schematic-view-request/0.1",
        root: d("PS1"),
        family: "power",
      },
    },
    { code: "R003", ir: path, view: trace },
    {
      code: "R004",
      ir: await compile("examples/machine-demo"),
      view: {
        format: "schematic-view-request/0.2",
        root: d("PS1"),
        intent: { kind: "loads" },
      },
    },
    {
      code: "R005",
      ir: text,
      view: {
        format: "schematic-view-request/0.1",
        root: d("K1"),
        family: "control",
      },
    },
    {
      code: "R006",
      ir: sensor,
      packet: {
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "circuit-view-request/0.1",
            title: "Sensor",
            groups: [
              {
                id: "sensor",
                conductors: [],
                functions: [
                  { device: d("PX1"), key: "supply" },
                  { device: d("PX1"), key: "output" },
                ],
              },
            ],
          },
        ],
      },
    },
  ] as const;
}

export async function signalLoopFixture() {
  const root = await mkdtemp(join(tmpdir(), "thermite-loop-title-"));
  try {
    for (const library of ["field-interfaces", "industrial-pilot"])
      await cp(resolve("libraries", library), join(root, library), {
        recursive: true,
      });
    await writeFile(
      join(root, "system.json"),
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: "Loop title" },
        sources: ["source.json"],
        libraries: ["field-interfaces", "industrial-pilot"].map((name) => ({
          name,
          version: "0.1.0",
          path: name,
        })),
      }),
    );
    await cp(
      resolve("packages/cli/fixtures/signal-loop/source.json"),
      join(root, "source.json"),
    );
    const locked = await lockProject(root);
    if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
    const c = await compileProject(root);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    return c;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
