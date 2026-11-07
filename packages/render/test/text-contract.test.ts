import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import {
  createSchematicRendererWithDependencies,
  renderSchematic,
} from "../src/renderer.js";
import { compileCoreProjectFixture } from "./fixtures.js";
import {
  robustnessFixture,
  byDesignation,
} from "./render-robustness-fixture.js";

let fixture: Awaited<ReturnType<typeof robustnessFixture>>;
let ir: ElectricalIr;
let jumperUid: string;
beforeAll(async () => {
  fixture = await robustnessFixture();
  await fixture.compile("minimal", 0);
  const path = join(fixture.root, "connections/control-power.json");
  const document = JSON.parse(await readFile(path, "utf8"));
  const jumper = document.objects.find(
    (o: { designation?: string }) => o.designation === "W-PLC2-1",
  );
  jumper.kind = "jumper";
  delete jumper.designation;
  jumperUid = jumper.uid;
  await writeFile(path, JSON.stringify(document));
  const compiled = await compileProject(fixture.root);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  ir = compiled.ir;
});
afterAll(async () => {
  await fixture.close();
});
const loads = {
  format: "schematic-view-request/0.2",
  root: byDesignation("PS1"),
  intent: { kind: "loads" },
} as const;

it("preserves the query-compatible unnamed-jumper label and data designation", async () => {
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    const result = await renderSchematic(ir, { ...loads, flow });
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(
      true,
    );
    if (!result.ok) throw Error(result.error.message);
    expect(result.value.svg).toContain(`>jumper:${jumperUid}</text>`);
    expect(result.value.svg).toContain(
      `data-designation="jumper:${jumperUid}"`,
    );
  }
});

it("preserves the unnamed-jumper designation in an injected R004", async () => {
  const engine = createElkEngine(),
    layout = engine.layout.bind(engine);
  engine.layout = async (...args) => {
    const output = await layout(...args);
    const edge = output.edges!.find(
      (e) => e.id === JSON.stringify(["jumper", jumperUid]),
    )!;
    edge.sections![0]!.startPoint.x += 1;
    return output;
  };
  const result = await createSchematicRendererWithDependencies({
    layoutEngine: engine,
  }).render(ir, loads);
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("Expected injected anchor failure");
  expect(result.error.code).toBe("R004");
  expect(result.error.message).toContain(`jumper:${jumperUid}`);
  expect(result.error.details?.conductors).toContainEqual(
    expect.objectContaining({
      id: JSON.stringify(["jumper", jumperUid]),
      designation: `jumper:${jumperUid}`,
    }),
  );
});

// Exact dev messages from the review's three unchanged-geometry injections.
const devMessages = [
  'Invalid layout: label ["label","edge","[\\"wire\\",\\"70dc52cc-2b19-4f80-aa32-ef9a1dd61f07\\"]","conductor"] overlaps edge W-CTL-007 (OL1.96 / aux95 → K1.A1 / coil).',
  'Invalid layout: label ["label","edge","[\\"wire\\",\\"71881aaf-f3a4-41fd-8d3d-1afe88f122ce\\"]","conductor"] overlaps symbol ["function","PB1","contact11"].',
  'Invalid layout: label ["label","edge","[\\"wire\\",\\"74280b71-4394-4895-b34b-6c159bb9748d\\"]","conductor"] overlaps edge W-CTL-008 (33a15867-296b-40e4-a56b-15282f131b4c.- → K1.A2 / coil).',
];
it.each([0, 1, 2])(
  "keeps the dev label-collision message for injected target %s",
  async (target) => {
    const compiled = await compileCoreProjectFixture();
    const engine = createElkEngine(),
      layout = engine.layout.bind(engine);
    let calls = 0;
    engine.layout = async (...args) => {
      calls++;
      const output = await layout(...args);
      const edges = output
        .edges!.filter((e) => e.labels?.length && e.sections?.length)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const source = edges[target]!,
        destination = edges[(target + 1) % edges.length]!;
      const section = destination.sections![0]!,
        point = section.bendPoints?.[0] ?? section.endPoint;
      const label = source.labels![0]!;
      label.x = (section.startPoint.x + point.x) / 2 - label.width! / 2;
      label.y = (section.startPoint.y + point.y) / 2 - label.height! / 2;
      return output;
    };
    const result = await createSchematicRendererWithDependencies({
      layoutEngine: engine,
    }).render(
      compiled.ir,
      {
        format: "schematic-view-request/0.1",
        root: byDesignation("K1"),
        family: "control",
        flow: "left-to-right",
      },
      compiled.presentation,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("Expected injected label collision");
    expect(result.error.code).toBe("R004");
    expect(result.error.message).toBe(devMessages[target]);
    expect(calls).toBe(1);
  },
);
