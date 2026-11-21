import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lockProject, compileProject } from "@thermite/compiler";
export const loopRequest = {
  format: "signal-loop-view-request/0.1" as const,
  from: { device: "TX1", function: "signal" },
  to: { device: "PLC1", function: "ai0" },
  cableAssemblies: [
    { cable: "CB1", connector: "X", description: "Synthetic assembly" },
  ],
};
const uid = (n: number) =>
  `69000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function library(root: string) {
  await mkdir(join(root, "library"));
  const types = await Promise.all(
    ["transmitter-2wire-4-20ma", "plc-8di-8do-2ai", "cordset-sensor-4core"].map(
      async (name, i) => {
        const source = JSON.parse(
          await readFile(
            resolve(`packages/core-library/versions/0.2.0/types/${name}.json`),
            "utf8",
          ),
        ).types[0];
        source.id = `doc-fixture:type-${i}`;
        if (i < 2) {
          source.connectorPorts = {
            C: { connector: "Synthetic connector, mapping absent" },
          };
          source.terminals.S3 = {};
          source.terminals.S4 = {};
          if (source.terminalOrder) source.terminalOrder.push("S3", "S4");
        }
        return source;
      },
    ),
  );
  await writeFile(join(root, "library/types.json"), JSON.stringify({ types }));
  await writeFile(
    join(root, "library/library.json"),
    JSON.stringify({
      name: "doc-fixture",
      version: "0.1.0",
      sources: ["types.json"],
    }),
  );
}
function objects(loose: boolean) {
  const endpoint = (device: string, terminal: string) => ({ device, terminal });
  return [
    {
      kind: "device",
      uid: uid(1),
      designation: "TX1",
      type: "doc-fixture:type-0",
      description: "Synthetic transmitter",
    },
    {
      kind: "device",
      uid: uid(2),
      designation: "PLC1",
      type: "doc-fixture:type-1",
      description: "Synthetic receiver",
    },
    {
      kind: "cable",
      uid: uid(3),
      designation: "CB1",
      type: "doc-fixture:type-2",
      conductors: [
        {
          id: "1",
          endpoints: [endpoint("TX1", "+"), endpoint("PLC1", "AI0+")],
        },
        {
          id: "2",
          endpoints: [endpoint("TX1", "-"), endpoint("PLC1", "AI0-")],
        },
        {
          id: "3",
          usage: "spare",
          endpoints: loose
            ? [null, null]
            : [endpoint("TX1", "S3"), endpoint("PLC1", "S3")],
        },
        ...(loose
          ? []
          : [
              {
                id: "4",
                usage: "spare",
                endpoints: [endpoint("TX1", "S4"), endpoint("PLC1", "S4")],
              },
            ]),
      ],
    },
    {
      kind: "relation",
      uid: uid(4),
      designation: "A1",
      relation: "associated_with",
      from: { device: "TX1" },
      to: { device: "PLC1" },
      assembly: {
        kind: "cable",
        fromPort: "C",
        toPort: "C",
        status: "planned",
        cable: { specification: "Synthetic assembly" },
        pinMapping: {
          status: "unresolved",
          reason: "Synthetic mapping deliberately unresolved.",
        },
      },
    },
  ];
}
export async function documentLoopFixture(loose = false) {
  const root = await mkdtemp(join(tmpdir(), "thermite-document-loop-"));
  try {
    await library(root);
    await writeFile(
      join(root, "system.json"),
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: "Synthetic document loop" },
        sources: ["source.json"],
        libraries: [{ name: "doc-fixture", version: "0.1.0", path: "library" }],
      }),
    );
    await writeFile(
      join(root, "source.json"),
      JSON.stringify({ objects: objects(loose) }),
    );
    const lock = await lockProject(root);
    if (!lock.ok) throw Error(JSON.stringify(lock.diagnostics));
    const compiled = await compileProject(root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    return {
      ...compiled,
      root,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}
