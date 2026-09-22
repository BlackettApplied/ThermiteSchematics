import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import { buildCableSchedule, createQueryEngine } from "@thermite/query";
import {
  normalizePaperPage,
  renderSchematicPacket,
  renderSchematicSheets,
  type PageSettings,
  type SchematicViewRequest,
} from "@thermite/render";
import { initializeAlphaProject } from "../src/alpha-init.js";
import { writeAlphaOutput } from "../src/alpha-output.js";
const execFile = promisify(execFileCallback);
const temporary: string[] = [];
const cli = resolve("packages/cli/dist/thermite-bin.js");
const cableView = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "CBL1" },
  intent: { kind: "conductors" },
} as const;
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function project() {
  const root = await mkdtemp(join(tmpdir(), "thermite-alpha-"));
  temporary.push(root);
  const path = join(root, "electrical");
  await initializeAlphaProject(path, {
    template: "cabinets",
    name: "Cabinet <A> & B",
  });
  return path;
}
async function compile(path: string) {
  const result = await compileProject(path);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}
async function editCable(path: string, edit: (value: any) => void) {
  const file = join(path, "devices/equipment.json"),
    value = JSON.parse(await readFile(file, "utf8"));
  edit(value.objects.find((object: any) => object.kind === "cable"));
  await writeFile(file, JSON.stringify(value));
}
describe("Thermite alpha physical cable semantics", () => {
  it("initializes visible pinned libraries and reports every core through query and CLI", async () => {
    const path = await project(),
      result = await compile(path);
    const manifest = JSON.parse(
      await readFile(join(path, "system.json"), "utf8"),
    );
    expect(manifest.libraries[0].path).toBe("libraries/core");
    const cable = result.ir.cables[0]!;
    const schedule = buildCableSchedule(result.ir, cable.uid);
    expect(schedule.counts).toEqual({
      total: 4,
      connected: 2,
      spare: 2,
      unassigned: 0,
    });
    expect(result.ir.cableConductors).toHaveLength(2);
    expect(result.ir.nets).toHaveLength(14);
    const query = createQueryEngine(result.ir).cable({
      by: "uid",
      value: cable.uid,
    });
    expect(query.ok && query.value.schedule).toEqual(schedule);
    const { stdout, stderr } = await execFile(process.execPath, [
      cli,
      "cable",
      "CBL1",
      "--project",
      path,
      "--json",
    ]);
    expect(JSON.parse(stdout)).toEqual(schedule);
    expect(JSON.parse(stderr).diagnostics).toEqual([]);
    await expect(initializeAlphaProject(path)).rejects.toThrow(
      "already exists",
    );
  });
  it("keeps one-ended spares out of connectivity while counting exclusive terminal occupancy", async () => {
    const path = await project();
    await editCable(path, (cable) => {
      cable.conductors[2].endpoints[0] = { device: "TB1", terminal: "3" };
    });
    let compiled = await compile(path);
    expect(compiled.ir.cableConductors).toHaveLength(2);
    const core = buildCableSchedule(compiled.ir, compiled.ir.cables[0]!.uid)
      .cores[2]!;
    expect(core.status).toBe("partially-terminated");
    expect(core.netId).toBeNull();
    const libraryFile = join(
      path,
      "libraries/core/types/terminal-block-8.json",
    );
    const library = JSON.parse(await readFile(libraryFile, "utf8"));
    library.types[0].terminals["3"].connection_policy = "exclusive";
    await writeFile(libraryFile, JSON.stringify(library));
    expect((await lockProject(path)).ok).toBe(true);
    await editCable(path, (cable) => {
      cable.conductors[3].endpoints[1] = { device: "TB1", terminal: "3" };
    });
    const invalid = await compileProject(path);
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics.filter((d) => d.code === "E201")).toHaveLength(
      1,
    );
    await editCable(path, (cable) => {
      cable.conductors[3].id = "unknown";
    });
    const unknown = await compileProject(path);
    expect(unknown.diagnostics.filter((d) => d.code === "E200")).toHaveLength(
      1,
    );
    expect(unknown.diagnostics.filter((d) => d.code === "E201")).toHaveLength(
      0,
    );
  });
  it("joins terminated spares, preserves A/B ordering, and does not infer unassigned cores as spare", async () => {
    const path = await project();
    await editCable(path, (cable) => {
      cable.conductors[2].endpoints = [
        { device: "TB2", terminal: "3" },
        { device: "TB1", terminal: "3" },
      ];
      cable.conductors.pop();
    });
    const compiled = await compile(path),
      schedule = buildCableSchedule(compiled.ir, compiled.ir.cables[0]!.uid);
    expect(compiled.ir.nets).toHaveLength(13);
    expect(schedule.cores[2]!.endpoints[0]!.display).toBe("TB2.3");
    expect(schedule.cores[2]!.usage).toBe("spare");
    expect(schedule.cores[2]!.netId).toMatch(/^net:sha256:/);
    expect(schedule.cores[3]!.usage).toBe("unassigned");
    expect(schedule.counts).toEqual({
      total: 4,
      connected: 3,
      spare: 1,
      unassigned: 1,
    });
    await editCable(path, (cable) => {
      cable.conductors[2].usage = "in-use";
      cable.conductors[2].endpoints[1] = null;
    });
    expect((await compileProject(path)).ok).toBe(false);
  });
});
describe("Thermite alpha printable sheets", () => {
  it("prints every paper/orientation combination and explicit loose spare ends", async () => {
    const path = await project(),
      compiled = await compile(path);
    for (const size of ["letter", "tabloid", "a3", "a4"] as const)
      for (const orientation of ["landscape", "portrait"] as const) {
        const page = { size, orientation };
        const result = await renderSchematicSheets(
          compiled.ir,
          cableView,
          compiled.presentation,
          page,
        );
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) continue;
        const svg = result.value.sheets[0]!.svg;
        expect(svg).toContain(`width="${result.value.page.widthMm}mm"`);
        expect(svg).toContain(`height="${result.value.page.heightMm}mm"`);
        expect(svg).toContain('data-usage="spare" data-status="unterminated"');
        expect(svg).toContain("X UNTERMINATED");
        expect(svg).toContain("CONTROL CABINET");
        expect(svg).toContain("Cabinet &lt;A&gt; &amp; B");
        expect(result.value.html).toContain("width:100%;height:auto");
      }
  });
  it("retains ELK symbols and paired conductor references throughout a numbered packet", async () => {
    const compiled = await compile(resolve("examples/motor-starter"));
    const power = {
      format: "schematic-view-request/0.1",
      family: "power",
      root: { by: "designation", value: "M1" },
    } as const;
    const result = await renderSchematicPacket(
      compiled.ir,
      {
        format: "schematic-packet-request/0.1",
        views: [cableView, power, power],
      },
      compiled.presentation,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const sheets = result.value.sheets;
    expect(sheets).toHaveLength(5);
    expect(sheets.map((sheet) => sheet.number)).toEqual([1, 2, 3, 4, 5]);
    expect(sheets[1]!.svg).toContain("function-symbol");
    expect(sheets[1]!.svg).toContain("data-layout-config-version");
    const links = sheets.flatMap((sheet) =>
      sheet.continuations.map((link) => ({ ...link, from: sheet.number })),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const reverse = links.filter(
        (other) => other.id === link.id && other.from !== link.from,
      );
      expect(reverse).toHaveLength(1);
      expect(reverse[0]).toMatchObject({
        from: link.toSheet,
        toSheet: link.from,
        conductor: link.conductor,
        netId: link.netId,
      });
    }
    const ids = [...result.value.html.matchAll(/(?<=\s)id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
    const again = await renderSchematicPacket(
      compiled.ir,
      {
        format: "schematic-packet-request/0.1",
        views: [cableView, power, power],
      },
      compiled.presentation,
    );
    expect(again).toEqual(result);
  });
  it("rejects malformed page and packet requests without producing a partial drawing", async () => {
    for (const page of [
      null,
      [],
      { size: "a0" },
      { orientation: "sideways" },
      { marginMm: 0 },
      { size: null },
      { marginMm: Infinity },
      { extra: true },
    ])
      expect(normalizePaperPage(page).ok).toBe(false);
    const path = await project(),
      compiled = await compile(path);
    for (const request of [
      { format: "wrong", views: [cableView] },
      { format: "schematic-packet-request/0.1", views: [] },
      {
        format: "schematic-packet-request/0.1",
        views: [cableView],
        page: null,
      },
      {
        format: "schematic-packet-request/0.1",
        views: [{ ...cableView, page: { size: "letter" } }],
      },
    ]) {
      expect(
        (
          await renderSchematicPacket(
            compiled.ir,
            request as any,
            compiled.presentation,
          )
        ).ok,
      ).toBe(false);
    }
  });
  it("accepts strict-parser packet files and exposes spare cores through the guarded agent", async () => {
    const path = await project();
    const input = join(path, "packet.request.json");
    const output = join(path, "packet.html");
    await writeFile(
      input,
      JSON.stringify({
        format: "schematic-packet-request/0.1",
        page: { size: "letter" },
        views: [cableView],
      }),
    );
    await execFile(process.execPath, [
      cli,
      "packet",
      "--project",
      path,
      "--input",
      input,
      "-o",
      output,
    ]);
    expect(await readFile(output, "utf8")).toContain("2 spare");
    const agentRequest = join(path, "view.request.json");
    await writeFile(
      agentRequest,
      JSON.stringify({
        format: "agent-tool-request/0.1",
        project: path,
        spec: cableView,
      }),
    );
    const result = await execFile(process.execPath, [
      cli,
      "agent",
      "create-view",
      "--input",
      agentRequest,
    ]);
    expect(JSON.parse(result.stdout).value.svg).toContain('data-usage="spare"');
    expect(JSON.parse(result.stderr).error).toBeNull();
  });
  it("paginates a complete loose-core inventory without dropping or rewriting labels", async () => {
    const path = await project();
    const libraryPath = join(
      path,
      "libraries/core/types/cable-2pair-shielded.json",
    );
    const library = JSON.parse(await readFile(libraryPath, "utf8"));
    const type = library.types[0];
    type.id = "core:test-cable-32";
    type.description = "32-core pagination fixture";
    delete type.construction;
    type.conductors = Array.from({ length: 32 }, (_, index) => ({
      id: String(index + 1).padStart(2, "0"),
      color: 'blue id="original" url(#original)',
      size: "18AWG",
    }));
    await writeFile(libraryPath, JSON.stringify(library));
    expect((await lockProject(path)).ok).toBe(true);
    await editCable(path, (cable) => {
      cable.type = type.id;
      cable.conductors = type.conductors.map((core: any) => ({
        id: core.id,
        usage: "spare",
        endpoints: [null, null],
      }));
    });
    const compiled = await compile(path);
    const packet = await renderSchematicSheets(
      compiled.ir,
      cableView,
      compiled.presentation,
      { size: "letter" },
    );
    expect(packet.ok, JSON.stringify(packet)).toBe(true);
    if (!packet.ok) return;
    expect(packet.value.sheets.length).toBeGreaterThan(1);
    const allSvg = packet.value.sheets.map((sheet) => sheet.svg).join("");
    const cores = [...allSvg.matchAll(/data-conductor-id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(cores).toEqual(type.conductors.map((core: any) => core.id));
    expect(allSvg).toContain('id="original"');
    expect(allSvg).toContain("url(#original)");
    expect(allSvg).not.toContain('id="sheet-1-original"');
  });
  it("inherits project paper fields and applies CLI overrides individually", async () => {
    const path = await project();
    const file = join(path, "presentation.json");
    const presentation = JSON.parse(await readFile(file, "utf8"));
    presentation.page = { size: "a3", orientation: "portrait", marginMm: 15 };
    await writeFile(file, JSON.stringify(presentation));
    const input = join(path, "paper.request.json");
    await writeFile(
      input,
      JSON.stringify({
        format: "schematic-packet-request/0.1",
        page: { orientation: "landscape" },
        views: [cableView],
      }),
    );
    const result = await execFile(process.execPath, [
      cli,
      "packet",
      "--project",
      path,
      "--input",
      input,
      "--paper",
      "letter",
      "--json",
    ]);
    expect(JSON.parse(result.stdout).page).toEqual({
      size: "letter",
      orientation: "landscape",
      marginMm: 15,
      widthMm: 279.4,
      heightMm: 215.9,
    });
    const view = await execFile(process.execPath, [
      cli,
      "view",
      "CBL1",
      "--conductors",
      "--project",
      path,
      "--paper",
      "a4",
      "--json",
    ]);
    expect(JSON.parse(view.stdout).page).toMatchObject({
      size: "a4",
      orientation: "portrait",
      marginMm: 15,
    });
  });
  it("protects source, request, library and linked targets and refuses multi-sheet SVG truncation", async () => {
    const path = await project();
    const source = join(path, "devices/equipment.json"),
      before = await readFile(source);
    for (const target of [
      source,
      join(path, "SYSTEM.JSON"),
      join(path, "libraries/core/new.svg"),
      join(path, ".git/drawing.svg"),
    ])
      await expect(writeAlphaOutput(path, target, "bad")).rejects.toThrow();
    const linked = join(path, "linked.svg");
    await symlink(source, linked);
    await expect(writeAlphaOutput(path, linked, "bad")).rejects.toThrow();
    const request = join(path, "packet.json");
    await writeFile(request, "{}");
    await expect(
      writeAlphaOutput(path, request, "bad", [request]),
    ).rejects.toThrow();
    expect(await readFile(source)).toEqual(before);
    const output = join(path, "motor.svg");
    await writeFile(output, "keep me");
    await expect(
      execFile(process.execPath, [
        cli,
        "view",
        "M1",
        "--power",
        "--project",
        resolve("examples/motor-starter"),
        "-o",
        output,
      ]),
    ).rejects.toMatchObject({ code: 1 });
    expect(await readFile(output, "utf8")).toBe("keep me");
  });
});
