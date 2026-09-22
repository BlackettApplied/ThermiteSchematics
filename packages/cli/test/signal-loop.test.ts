import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseHTML } from "linkedom";
import { afterEach, expect, it } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import {
  renderSchematicPacket,
  type SignalLoopViewRequest,
} from "@thermite/render";
import { selectSignalLoop } from "../../render/src/signal-loop.js";

const temporary: string[] = [],
  exec = promisify(execFile);
afterEach(async () => {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
});
async function fixture() {
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
async function compiled(p: string) {
  const c = await compileProject(p);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  return c.ir;
}
const view: SignalLoopViewRequest = {
  format: "signal-loop-view-request/0.1",
  from: { device: "PT1", function: "signal" },
  to: { device: "AI1", function: "ch0" },
};
const assemblyView: SignalLoopViewRequest = {
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
const packet = (v: SignalLoopViewRequest = view) => ({
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

it("keeps independent feed-through contacts and transmitter terminals on separate physical nets", async () => {
  const f = await fixture(),
    ir = await compiled(f.p),
    selected = selectSignalLoop(ir, view);
  expect(
    selected.stages.map((uid) => selected.devices.get(uid)!.designation),
  ).toEqual(["PT1", "XP1", "XT1", "AI1"]);
  expect(selected.conductors).toHaveLength(8);
  expect(selected.conductors.filter((c) => c.spare)).toHaveLength(2);
  const nets = ir.nets.filter((n) =>
    n.terminalIds.some(
      (t) =>
        t.deviceUid === ir.devices.find((d) => d.designation === "PT1")!.uid,
    ),
  );
  expect(nets.map((n) => n.terminalIds.length).sort()).toEqual([2, 2, 4, 4]);
  expect(new Set(selected.conductors.map((c) => c.net)).size).toBe(4);
  expect(
    buildDocumentation(ir, {
      format: "documentation-view-request/0.1",
      kind: "wires",
    }).rows,
  ).toHaveLength(8);
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "renders a complete, deterministic %s hookup",
  async (flow) => {
    const f = await fixture(),
      ir = await compiled(f.p),
      request = packet({ ...view, flow });
    const a = await renderSchematicPacket(ir, request),
      b = await renderSchematicPacket(ir, request);
    expect(a).toEqual(b);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    if (!a.ok) return;
    expect(a.value.sheets).toHaveLength(1);
    const sheet = a.value.sheets[0]!;
    expect(sheet.references.map((r) => r.designation)).toEqual([
      "PT1",
      "XP1",
      "XT1",
      "AI1",
    ]);
    expect(sheet.svg.match(/data-loop-conductor=/g)).toHaveLength(8);
    expect(sheet.svg.match(/stroke-dasharray="2 1"/g)).toHaveLength(2);
    for (const s of [
      "Loop supply +",
      "Loop return / I",
      "UV0",
      "2I0+",
      "CB1/A",
      "CB1/D",
      "Brown",
      "Black / spare",
      ">P</text>",
      ">I</text>",
    ])
      expect(sheet.svg).toContain(s);
    for (const r of sheet.references) {
      expect(r.xMm).toBeGreaterThan(0);
      expect(r.yMm).toBeGreaterThan(0);
      expect(r.xMm).toBeLessThan(a.value.page.widthMm);
      expect(r.yMm).toBeLessThan(a.value.page.heightMm - 30);
    }
  },
);

it.each([
  "missing-wire",
  "branch",
  "short",
  "active-spare",
  "loose-core",
  "unassigned-core",
  "extra-active",
  "spare-branch",
  "different-chain",
])("rejects %s without omitting electrical facts", async (problem) => {
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
  for (const mode of [view, assemblyView]) {
    const result = await renderSchematicPacket(ir, packet(mode));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("R006");
  }
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "draws one complete cable assembly with a cabinet wall in %s flow",
  async (flow) => {
    const f = await fixture(),
      ir = await compiled(f.p),
      before = structuredClone(ir);
    const request = packet({ ...assemblyView, flow }),
      result = await renderSchematicPacket(ir, request);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await renderSchematicPacket(ir, request)).toEqual(result);
    expect(ir).toEqual(before);
    if (!result.ok) return;
    expect(result.value.sheets).toHaveLength(1);
    const { document } = parseHTML(result.value.sheets[0]!.svg);
    const cable = document.querySelector("[data-cable-assembly]")!;
    expect(document.querySelectorAll("[data-cable-assembly]")).toHaveLength(1);
    expect(cable.querySelectorAll("path")).toHaveLength(1);
    expect(cable.hasAttribute("data-net-id")).toBe(false);
    const cores = JSON.parse(cable.querySelector("desc")!.textContent!) as {
      id: string;
      net: string;
      spare: boolean;
    }[];
    expect(cores.map((c) => JSON.parse(c.id).conductorId)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(new Set(cores.map((c) => c.net)).size).toBe(4);
    expect(cores.filter((c) => c.spare)).toHaveLength(2);
    expect(document.querySelectorAll("[data-loop-conductor]")).toHaveLength(4);
    expect(
      document.querySelectorAll('[data-connector-interface="assembly"]'),
    ).toHaveLength(2);
    const visible = [...document.querySelectorAll("text")]
      .map((t) => t.textContent)
      .join(" ");
    expect(visible).toContain("1-1, 2-2, 3-3 spare, 4-4 spare");
    for (const color of ["Brown", "White", "Blue", "Black"])
      expect(visible).not.toContain(color);
    expect(visible).toContain("Main electrical cabinet");
    expect(visible).toContain("Loop supply +");
    const enclosure = document.querySelector("[data-enclosure]")!,
      rect = enclosure.querySelector("rect")!;
    const box = {
      x: Number(rect.getAttribute("x")),
      y: Number(rect.getAttribute("y")),
      w: Number(rect.getAttribute("width")),
      h: Number(rect.getAttribute("height")),
    };
    const deviceBox = (tag: string) => {
      const uid = ir.devices.find((d) => d.designation === tag)!.uid;
      const group = document.querySelector(`[data-device-uid="${uid}"]`)!;
      const pos = group
        .getAttribute("transform")!
        .match(/translate\(([-.\d]+) ([-.\d]+)\)/)!;
      const body = group.querySelector("rect")!;
      return {
        x: Number(pos[1]),
        y: Number(pos[2]),
        w: Number(body.getAttribute("width")),
        h: Number(body.getAttribute("height")),
      };
    };
    const sensor = deviceBox("PT1"),
      wall = deviceBox("XP1");
    if (flow === "left-to-right") {
      expect(sensor.x + sensor.w).toBeLessThan(box.x);
      expect(wall.x).toBeLessThan(box.x);
      expect(wall.x + wall.w).toBeGreaterThan(box.x);
    } else {
      expect(sensor.y + sensor.h).toBeLessThan(box.y);
      expect(wall.y).toBeLessThan(box.y);
      expect(wall.y + wall.h).toBeGreaterThan(box.y);
    }
    for (const tag of ["XT1", "AI1"]) {
      const d = deviceBox(tag);
      expect(d.x).toBeGreaterThan(box.x);
      expect(d.y).toBeGreaterThan(box.y);
      expect(d.x + d.w).toBeLessThan(box.x + box.w);
      expect(d.y + d.h).toBeLessThan(box.y + box.h);
    }
    const reordered = structuredClone(ir);
    reordered.wires.reverse();
    reordered.cableConductors.reverse();
    expect(await renderSchematicPacket(reordered, request)).toEqual(result);
  },
);

it("preserves non-straight pin mapping and fully expanded cabinet detail", async () => {
  const f = await fixture();
  f.cable.conductors[2].endpoints[1].terminal = "4";
  f.cable.conductors[3].endpoints[1].terminal = "3";
  await f.write("source.json", f.source);
  const ir = await compiled(f.p),
    result = await renderSchematicPacket(ir, packet(assemblyView));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.sheets[0]!.svg).toContain("3-4 spare, 4-3 spare");
  }
  const detail = await renderSchematicPacket(
    ir,
    packet({ ...view, enclosures: assemblyView.enclosures }),
  );
  expect(detail.ok, JSON.stringify(detail)).toBe(true);
  if (detail.ok) {
    expect(
      detail.value.sheets[0]!.svg.match(/data-loop-conductor=/g),
    ).toHaveLength(8);
    expect(detail.value.sheets[0]!.svg).toContain("Black / spare");
    expect(detail.value.sheets[0]!.svg).toContain("data-enclosure=");
    expect(detail.value.sheets[0]!.svg).not.toContain("data-cable-assembly=");
  }
});

it("rejects ambiguous assemblies, misleading cabinet membership and malformed display options", async () => {
  const f = await fixture(),
    ir = await compiled(f.p),
    a = assemblyView.cableAssemblies![0]!,
    e = assemblyView.enclosures![0]!;
  const invalid = [
    { ...assemblyView, cableAssemblies: [{ ...a, cable: "missing" }] },
    { ...assemblyView, cableAssemblies: [a, { ...a, cable: f.cable.uid }] },
    {
      ...assemblyView,
      cableAssemblies: [{ ...a, description: "x".repeat(121) }],
    },
    { ...assemblyView, cableAssemblies: [{ ...a, typo: true }] },
    { ...assemblyView, cableAssemblies: null },
    {
      ...assemblyView,
      enclosures: [{ ...e, devices: ["XP1", "XT1", "missing"] }],
    },
    {
      ...assemblyView,
      enclosures: [{ ...e, devices: ["XP1", "XT1", "XT1", "AI1"] }],
    },
    { ...assemblyView, enclosures: [{ ...e, devices: ["XP1", "AI1"] }] },
    { ...assemblyView, enclosures: [{ ...e, wallDevice: "XT1" }] },
    { ...assemblyView, enclosures: [{ ...e, wallDevice: "PT1" }] },
    { ...assemblyView, enclosures: [{ ...e, devices: ["XP1"] }] },
    { ...assemblyView, enclosures: [e, { label: "Second", devices: ["AI1"] }] },
    { ...assemblyView, enclosures: [{ ...e, label: "Bad\u0000label" }] },
    { ...assemblyView, enclosures: [{ ...e, typo: true }] },
  ];
  for (const v of invalid) {
    const r = await renderSchematicPacket(
      ir,
      packet(v as SignalLoopViewRequest),
    );
    expect(r.ok, JSON.stringify(v)).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("R006");
  }
  const escaped = await renderSchematicPacket(
    ir,
    packet({ ...assemblyView, enclosures: [{ ...e, label: "Cabinet <A&B>" }] }),
  );
  expect(escaped.ok).toBe(true);
  if (escaped.ok)
    expect(escaped.value.sheets[0]!.svg).toContain("Cabinet &lt;A&amp;B&gt;");
});

it("rejects unsupported intermediate devices, wrong endpoints and malformed or unprintable requests", async () => {
  const f = await fixture(),
    ir = await compiled(f.p);
  for (const bad of [
    { ...view, to: { device: "AI1", function: "ch1" } },
    { ...view, from: { device: "PT1", function: "missing" } },
    { ...view, from: { device: "missing", function: "signal" } },
    { ...view, to: { device: "AI1", function: "supply" } },
    { ...view, extra: true },
    { ...view, flow: "up" },
    { ...view, notes: ["Bad\u0000label"] },
    { ...view, notes: ["W".repeat(241)] },
    { ...view, from: { device: "PT1", function: "signal", typo: true } },
  ])
    expect((await renderSchematicPacket(ir, packet(bad as any))).ok).toBe(
      false,
    );
  const unsupported = structuredClone(ir);
  unsupported.deviceTypes.find(
    (t) => t.id === "field-interfaces:m12-a4-bulkhead",
  )!.symbol = "unknown";
  expect((await renderSchematicPacket(unsupported, packet())).ok).toBe(false);
  expect(
    (await renderSchematicPacket(ir, { ...packet(), page: { size: "letter" } }))
      .ok,
  ).toBe(false);
  const escaped = structuredClone(ir);
  escaped.devices.find((d) => d.designation === "PT1")!.location =
    "<field & water>";
  const result = await renderSchematicPacket(escaped, packet());
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.value.sheets[0]!.svg).toContain("&lt;field &amp;");
});

it("uses the normal CLI packet output protections and preserves an earlier drawing on layout failure", async () => {
  const f = await fixture();
  await f.write("packet.json", packet());
  const args = [
    resolve("thermite.mjs"),
    "packet",
    "--project",
    f.p,
    "--input",
    join(f.p, "packet.json"),
    "-o",
  ];
  await exec(process.execPath, [...args, join(f.p, "loop.html")]);
  const before = await readFile(join(f.p, "loop.html"), "utf8");
  expect(before).toContain("PT1 - signal loop");
  const source = await readFile(join(f.p, "source.json"));
  await expect(
    exec(process.execPath, [...args, join(f.p, "source.json")]),
  ).rejects.toThrow();
  expect(await readFile(join(f.p, "source.json"))).toEqual(source);
  await f.write(
    "packet.json",
    packet({ ...view, to: { device: "AI1", function: "ch1" } }),
  );
  await expect(
    exec(process.execPath, [...args, join(f.p, "loop.html")]),
  ).rejects.toThrow();
  expect(await readFile(join(f.p, "loop.html"), "utf8")).toBe(before);
});
