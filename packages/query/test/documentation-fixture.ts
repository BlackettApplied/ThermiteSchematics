import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";

/** Small synthetic pump/conveyor inventory; no installed project is copied or edited. */
export async function documentationFixture(nonProcurement = false) {
  const root = await mkdtemp(join(tmpdir(), "thermite-documentation-"));
  const uid = (n: number) =>
    `56000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const devices = [
    [
      "M1",
      "motor",
      "5 HP pump motor, 480 VAC three phase; nameplate and FLA unselected",
    ],
    ["M2", "motor", "Conveyor drive motor, 2 HP, 480 VAC 3-phase"],
    [
      "LS1",
      "switch",
      "Level switch proposed NO dry contact; limit-switch symbol substitution",
    ],
    ["SUP1", "source", "Incoming utility boundary"],
    ["GEN1", "source", "Generator to select"],
    ["PLC1", "controller", undefined],
    ["B1", "sensor", "Conveyor discharge part-present sensor, PNP 3-wire"],
  ].map(([designation, type, description], i) => ({
    uid: uid(i + 1),
    kind: "device",
    designation,
    type: `report-fixture:${type}`,
    ...(description === undefined ? {} : { description }),
    ...(designation === "PLC1"
      ? {
          io: { addressSpace: "PLC1", channels: { input: { usage: "spare" } } },
        }
      : {}),
    ...(nonProcurement && designation === "SUP1"
      ? {
          nonProcurement: {
            reason: "Existing site utility; outside purchasing scope",
          },
        }
      : {}),
  }));
  const types = ["motor", "switch", "source", "controller", "sensor"].map(
    (id) => ({
      kind: "device_type",
      id: `report-fixture:${id}`,
      description:
        id === "motor"
          ? "Three-phase induction motor load with protective earth"
          : `Generic ${id}`,
      terminals: { T: {} },
      functions:
        id === "controller" || id === "sensor"
          ? {
              [id === "controller" ? "input" : "output"]: {
                kind: "channel",
                direction: id === "controller" ? "input" : "output",
                terminals: ["T"],
              },
            }
          : {},
    }),
  );
  try {
    await mkdir(join(root, "library"));
    const json = (path: string, value: unknown) =>
      writeFile(join(root, path), JSON.stringify(value));
    await json("system.json", {
      format: "electrical-system/0.1",
      project: { name: "Synthetic report meaning" },
      sources: ["source.json"],
      libraries: [
        { name: "report-fixture", version: "0.1.0", path: "library" },
      ],
    });
    await json("library/library.json", {
      name: "report-fixture",
      version: "0.1.0",
      sources: ["types.json"],
    });
    await json("library/types.json", {
      types: [
        ...types,
        {
          kind: "cable_type",
          id: "report-fixture:cable",
          description: "Shielded two-pair instrumentation cable",
          conductors: [
            { id: "1", color: "black" },
            { id: "2", color: "white" },
          ],
        },
      ],
    });
    await json("source.json", {
      objects: [
        ...devices,
        {
          uid: uid(20),
          kind: "wire",
          designation: "W1",
          endpoints: [
            { device: "M1", terminal: "T" },
            { device: "PLC1", terminal: "T" },
          ],
        },
        {
          uid: uid(23),
          kind: "jumper",
          designation: "J1",
          endpoints: [
            { device: "M2", terminal: "T" },
            { device: "SUP1", terminal: "T" },
          ],
        },
        ...["CBL1", "LOOSE"].map((designation, i) => ({
          uid: uid(21 + i),
          kind: "cable",
          designation,
          type: "report-fixture:cable",
          ...(i === 0
            ? {
                description: "Field cable; spare core retained",
                conductors: [
                  {
                    id: "1",
                    usage: "in-use",
                    endpoints: [
                      { device: "LS1", terminal: "T" },
                      { device: "B1", terminal: "T" },
                    ],
                  },
                  { id: "2", usage: "spare", endpoints: [null, null] },
                ],
              }
            : { conductors: [] }),
        })),
      ],
    });
    const locked = await lockProject(root);
    if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
    const result = await compileProject(root);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    return result.ir;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
