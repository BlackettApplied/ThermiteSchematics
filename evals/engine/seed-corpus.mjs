// Maintainer-only deterministic fixture recipe. Run after a build, then format
// corpus JSON and refresh its reviewed manifest with seal-corpus.mjs.
import { mkdir, writeFile, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { lockProject } from "./engine.mjs";
import { corpus, json } from "./support.mjs";
import { uid } from "./generate.mjs";

export async function seedCorpus(destination = corpus) {
  const project = join(destination, "topology");
  const endpoint = (device, terminal) => ({ device, terminal });
  const object = (kind, designation, fields) => ({
    uid: uid(designation),
    kind,
    designation,
    ...fields,
  });
  const node = {
    kind: "device_type",
    id: "eval:node",
    description: "Synthetic rated test terminals; no equipment claim",
    terminals: {
      a: { rating: { nominal_voltage: 24, voltage_type: "DC" } },
      b: { rating: { nominal_voltage: 48, voltage_type: "AC" } },
      c: {},
      d: { connection_policy: "exclusive" },
      e: {},
      f: {},
    },
    functions: {
      contact: { kind: "contact", normal_state: "open", terminals: ["a", "b"] },
      // Generic interface drawing: E206 has no three-terminal bus mark. This
      // function grants no continuity; the three terminals remain isolated.
      isolatedBus: { kind: "other", terminals: ["c", "e", "f"] },
    },
    circuitSymbols: { isolatedBus: "interface" },
    internal_relations: [],
    symbol: "thermite:switch",
  };
  const documents = {
    "system.json": {
      format: "electrical-system/0.1",
      project: { name: "Synthetic continuity and guards" },
      sources: [
        "devices/*.json",
        "connections/*.json",
        "cables/*.json",
        "potentials/*.json",
      ],
      presentation: "presentation.json",
      libraries: [
        { name: "core", version: "0.1.0" },
        { name: "eval", version: "1.0.0", path: "library" },
      ],
    },
    "presentation.json": {
      format: "project-presentation/0.1",
      revision: "EVAL-1",
      backgroundColor: "#ffffff",
      titleBlock: { lines: ["Synthetic evaluation only"] },
    },
    "devices/equipment.json": {
      objects: [
        object("device", "PS1", {
          type: "core:psu-24vdc",
          description: "Synthetic control source",
        }),
        object("device", "X1", { type: "core:terminal-block-8" }),
        object("device", "X2", { type: "core:terminal-block-8" }),
        object("device", "N1", { type: "eval:node" }),
      ],
    },
    "connections/wires.json": {
      objects: [
        object("wire", "W1", {
          endpoints: [endpoint("PS1", "+"), endpoint("X1", "1")],
          properties: { label: "Synthetic wire" },
        }),
        object("wire", "W2", {
          endpoints: [endpoint("X1", "1"), endpoint("N1", "a")],
        }),
        object("wire", "W3", {
          endpoints: [endpoint("X1", "2"), endpoint("N1", "d")],
        }),
        object("jumper", "J1", {
          endpoints: [endpoint("X1", "1"), endpoint("X1", "3")],
        }),
        object("relation", "R1", {
          relation: "associated_with",
          from: { device: "PS1" },
          to: { device: "N1" },
        }),
      ],
    },
    "cables/cables.json": {
      objects: [
        object("cable", "C1", {
          type: "core:cable-2pair-shielded",
          conductors: [
            {
              id: "1+",
              endpoints: [endpoint("X1", "3"), endpoint("X2", "1")],
              usage: "in-use",
            },
            {
              id: "1-",
              endpoints: [endpoint("X1", "4"), endpoint("X2", "2")],
              usage: "in-use",
            },
            {
              id: "2+",
              endpoints: [endpoint("X2", "3"), null],
              usage: "spare",
            },
            { id: "2-", endpoints: [null, null], usage: "spare" },
          ],
        }),
      ],
    },
    "potentials/potentials.json": {
      objects: [
        object("potential", "P1", {
          name: "+24V",
          at: endpoint("PS1", "+"),
          electrical: { nominal_voltage: 24, voltage_type: "DC" },
        }),
      ],
    },
    "library/library.json": {
      name: "eval",
      version: "1.0.0",
      sources: ["types/*.json"],
    },
    "library/types/node.json": { types: [node] },
  };
  for (const [file, value] of Object.entries(documents)) {
    const destination = join(project, file);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, json(value));
  }
  let locked = await lockProject(project);
  if (!locked.ok) throw new Error(json(locked));
  const pair = join(destination, "ratings-pair");
  await mkdir(pair, { recursive: true });
  await cp(join(project, "library"), join(pair, "library"), {
    recursive: true,
  });
  await writeFile(
    join(pair, "system.json"),
    json({
      format: "electrical-system/0.1",
      project: { name: "Synthetic conflicting ratings without a potential" },
      sources: ["objects.json"],
      libraries: [{ name: "eval", version: "1.0.0", path: "library" }],
    }),
  );
  await writeFile(
    join(pair, "objects.json"),
    json({
      objects: [
        object("device", "N1", { type: "eval:node" }),
        object("wire", "W1", {
          endpoints: [endpoint("N1", "a"), endpoint("N1", "b")],
        }),
      ],
    }),
  );
  locked = await lockProject(pair);
  if (!locked.ok) throw new Error(json(locked));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await seedCorpus();
