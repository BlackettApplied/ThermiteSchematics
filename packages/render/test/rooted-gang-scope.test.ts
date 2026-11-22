import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { prepareSchematicDrawing, renderSchematic } from "../src/renderer.js";
import { rootedGangSegments } from "../src/symbols/rooted-gangs.js";

let root: string, ir: ElectricalIr;
const request = {
  format: "schematic-view-request/0.1",
  root: { by: "designation", value: "K1" },
  family: "control",
} as const;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "thermite-control-gangs-"));
  await mkdir(join(root, "local"));
  await cp(
    resolve("packages/core-library/versions/0.2.0"),
    join(root, "core"),
    { recursive: true },
  );
  const contact = (state: string, terminals: string[]) => ({
    kind: "contact",
    normal_state: state,
    terminals,
  });
  const block = (id: string, symbol: string) => ({
    kind: "device_type",
    id,
    symbol,
    terminals: {
      "13": { role: "no_contact" },
      "14": { role: "no_contact" },
      "21": { role: "nc_contact" },
      "22": { role: "nc_contact" },
    },
    functions: {
      no: contact("open", ["13", "14"]),
      nc: contact("closed", ["21", "22"]),
    },
    internal_relations: [{ relation: "ganged_with", from: "no", to: "nc" }],
  });
  await writeFile(
    join(root, "local/library.json"),
    JSON.stringify({
      name: "synthetic",
      version: "0.1.0",
      sources: ["types.json"],
    }),
  );
  await writeFile(
    join(root, "local/types.json"),
    JSON.stringify({
      types: [
        block("synthetic:aux", "thermite:relay"),
        block("synthetic:button", "thermite:pushbutton"),
      ],
    }),
  );
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Synthetic separate control rungs" },
      sources: ["source.json"],
      libraries: [
        {
          name: "core",
          version: "0.2.0",
          path: "core",
        },
        { name: "synthetic", version: "0.1.0", path: "local" },
      ],
    }),
  );
  let seq = 1;
  const uid = () =>
    `87000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
  const device = (designation: string, type: string) => ({
    kind: "device",
    uid: uid(),
    designation,
    type,
  });
  const end = (s: string) => {
    const [device, terminal] = s.split(".");
    return { device, terminal };
  };
  const wire = (a: string, b: string) => ({
    kind: "wire",
    uid: uid(),
    designation: `W${seq}`,
    endpoints: [end(a), end(b)],
  });
  const objects: any[] = [
    device("PS1", "core:psu-24vdc"),
    device("AUX", "synthetic:aux"),
    device("PB", "synthetic:button"),
    device("K1", "core:contactor-3p-1no"),
  ];
  objects.push(
    wire("PS1.+", "AUX.13"),
    wire("AUX.14", "PB.13"),
    wire("PB.14", "K1.A1"),
    wire("K1.A2", "PB.21"),
    wire("PB.22", "AUX.21"),
    wire("AUX.22", "PS1.-"),
  );
  await writeFile(join(root, "source.json"), JSON.stringify({ objects }));
  const lock = await lockProject(root);
  if (!lock.ok) throw Error(JSON.stringify(lock.diagnostics));
  const compiled = await compileProject(root);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  ir = compiled.ir;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps NO/NC control rungs and unsupported pushbutton gangs printable in %s",
  async (flow) => {
    const before = JSON.stringify(ir),
      r = await renderSchematic(ir, { ...request, flow });
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const drawing = await prepareSchematicDrawing(ir, { ...request, flow });
    if (!drawing.ok) throw Error(JSON.stringify(drawing.error));
    const { graph, layout } = drawing.value;
    for (const name of ["AUX", "PB"]) {
      const uid = ir.devices.find((d) => d.designation === name)!.uid;
      expect(
        graph.nodes.filter((n) => n.kind === "symbol" && n.deviceUid === uid),
      ).toHaveLength(2);
      expect(r.value.svg).toContain(name);
    }
    const doc = parseHTML(r.value.svg).document;
    expect(
      doc.querySelectorAll('[data-symbol-id="ais:contact-no"]'),
    ).toHaveLength(1);
    expect(
      doc.querySelectorAll('[data-symbol-id="ais:contact-nc"]'),
    ).toHaveLength(1);
    expect(
      doc.querySelectorAll('[data-symbol-id="ais:pushbutton-no"]'),
    ).toHaveLength(1);
    expect(
      doc.querySelectorAll('[data-symbol-id="ais:pushbutton-nc"]'),
    ).toHaveLength(1);
    expect(
      doc.querySelectorAll('line[data-mechanical-association="ganged"]'),
    ).toHaveLength(0);
    // A deliberately misaligned control member is optional, never a power refusal.
    const shifted = structuredClone(layout),
      aux = graph.nodes.find(
        (n) => n.kind === "symbol" && n.designation === "AUX",
      )!;
    const origin = shifted.nodes.find((n) => n.id === aux.id)!.primitiveOrigin!;
    origin[flow === "left-to-right" ? "x" : "y"] += 7;
    expect(rootedGangSegments(ir, graph, shifted)).toEqual({
      ok: true,
      value: [],
    });
    expect(JSON.stringify(ir)).toBe(before);
  },
);
