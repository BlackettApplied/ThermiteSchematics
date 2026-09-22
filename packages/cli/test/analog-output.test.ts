import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseHTML } from "linkedom";
import { afterEach, expect, it } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { renderSchematicPacket } from "@thermite/render";
import { selectSignalLoop } from "../../render/src/signal-loop.js";

const temporary: string[] = [];
afterEach(async () => {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
});
async function fixture() {
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

it.each(["left-to-right", "top-to-bottom"])(
  "shows complete command and power nets with a cabinet exit in %s",
  async (flow) => {
    const f = await fixture();
    f.packet.views[0].flow = flow;
    f.packet.page.orientation =
      flow === "top-to-bottom" ? "portrait" : "landscape";
    const ir = await f.compile(),
      selected = selectSignalLoop(ir, f.packet.views[0]);
    expect(
      selected.stages.map((uid) => selected.devices.get(uid)!.designation),
    ).toEqual(["AQ1", "XT1", "XP1", "V1"]);
    expect(selected.conductors).toHaveLength(10);
    expect(new Set(selected.conductors.map((c) => c.net)).size).toBe(4);
    expect(
      buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind: "wires",
      }).rows,
    ).toHaveLength(10);
    const result = await renderSchematicPacket(ir, f.packet);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await renderSchematicPacket(ir, f.packet)).toEqual(result);
    if (!result.ok) return;
    expect(result.value.sheets).toHaveLength(1);
    const svg = result.value.sheets[0]!.svg;
    const { document } = parseHTML(svg);
    const jacket = document.querySelector("[data-cable-assembly]")!;
    expect(jacket.hasAttribute("data-net-id")).toBe(false);
    const members = JSON.parse(jacket.querySelector("desc")!.textContent!);
    expect(members).toHaveLength(4);
    expect(new Set(members.map((c: any) => c.net)).size).toBe(4);
    expect(document.querySelectorAll("[data-loop-conductor]")).toHaveLength(6);
    for (const value of [
      "V1 - analog output",
      "Q3+",
      "Q3-",
      "ch3 / selected channel",
      "1-1, 2-2, 3-3, 4-4",
    ])
      expect(svg).toContain(value);
    expect(svg).not.toContain(">unused</text>");
    if (flow === "left-to-right") {
      const valveUid = ir.devices.find((d) => d.designation === "V1")!.uid;
      const valve = document.querySelector(`[data-device-uid="${valveUid}"]`)!;
      const connectorLabel = valve.querySelector(
        "[data-connector-interface] text",
      )!;
      const commandLabel = [...valve.querySelectorAll("text")].find((t) =>
        /^2\s+Command/u.test(t.textContent!),
      )!;
      // A wrapped pin legend must clear the M12 label in its own column.
      expect(Number(commandLabel.getAttribute("x"))).toBeGreaterThan(
        Number(connectorLabel.getAttribute("x")) + 8,
      );
    }
    const refs = result.value.sheets[0]!.references;
    expect(refs.find((r) => r.designation === "XT1")!.functions).toEqual([
      "aux1",
    ]);
    // Inspect the actual boundary against placed device bodies in both flows.
    const box = document.querySelector("[data-enclosure] > rect")!;
    const at = (e: Element, name: string) => Number(e.getAttribute(name));
    const pos = (tag: string) => {
      const uid = ir.devices.find((d) => d.designation === tag)!.uid;
      const g = document.querySelector(`[data-device-uid="${uid}"]`)!;
      const [x, y] = g
        .getAttribute("transform")!
        .match(/[\d.-]+/g)!
        .map(Number);
      const rect = g.querySelector("rect")!;
      return { x: x!, y: y!, w: at(rect, "width"), h: at(rect, "height") };
    };
    const wall = pos("XP1"),
      actuator = pos("V1"),
      module = pos("AQ1");
    if (flow === "left-to-right") {
      expect(at(box, "x") + at(box, "width")).toBeCloseTo(
        wall.x + wall.w / 2,
        2,
      );
      expect(actuator.x).toBeGreaterThan(at(box, "x") + at(box, "width"));
      expect(module.x).toBeGreaterThan(at(box, "x"));
    } else {
      expect(at(box, "y") + at(box, "height")).toBeCloseTo(
        wall.y + wall.h / 2,
        2,
      );
      expect(actuator.y).toBeGreaterThan(at(box, "y") + at(box, "height"));
      expect(module.y).toBeGreaterThan(at(box, "y"));
    }
    delete f.packet.views[0].cableAssemblies;
    const detail = await renderSchematicPacket(ir, f.packet);
    expect(detail.ok, JSON.stringify(detail)).toBe(true);
    if (detail.ok)
      expect(
        detail.value.sheets[0]!.svg.match(/data-loop-conductor=/g),
      ).toHaveLength(10);
  },
);

it("uses the documented current pair on channel 2 without adding another module", async () => {
  const f = await fixture();
  f.source.objects.find((o: any) => o.designation === "V1").type =
    "field-interfaces:pressure-regulator-m12-proposed";
  f.source.objects.find(
    (o: any) => o.designation === "W1",
  ).endpoints[0].terminal = "3";
  f.source.objects.find(
    (o: any) => o.designation === "W2",
  ).endpoints[0].terminal = "7";
  f.packet.views[0].from.function = "ch2";
  const ir = await f.compile(),
    r = await renderSchematicPacket(ir, f.packet);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (r.ok)
    for (const label of ["Q2+", "Q2-", "4-20 mA"])
      expect(r.value.sheets[0]!.svg).toContain(label);
});

it.each([
  "omitted-power",
  "duplicate-pair",
  "reverse-pair",
  "short",
  "branch",
  "loose-power",
  "power-as-spare",
  "different-chain",
  "malformed",
])("rejects %s without hiding an active conductor", async (problem) => {
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
  const ir = await f.compile(),
    result = await renderSchematicPacket(ir, f.packet);
  expect(result.ok, problem).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("R006");
});
