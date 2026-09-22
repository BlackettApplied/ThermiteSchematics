import { spawn, execFile as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import {
  buildDocumentation,
  documentationCsv,
  createProjectSnapshot,
  reviewProject,
  parseProjectSnapshot,
} from "@thermite/query";
import { renderSchematicPacket, renderSchematicSheets } from "@thermite/render";
import { packetPdf } from "../src/alpha-pdf.js";
import { writeAlphaOutput } from "../src/alpha-output.js";
import { PACKET_VIEWER_SCRIPT } from "../../render/src/packet-viewer.js";
const exec = promisify(execCallback),
  temporary: string[] = [];
const demo = resolve("examples/machine-demo"),
  cli = resolve("thermite.mjs");
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function compile(path = demo) {
  const c = await compileProject(path);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  return c;
}
async function copy() {
  const root = await mkdtemp(join(tmpdir(), "machine-"));
  temporary.push(root);
  const path = join(root, "project");
  await cp(demo, path, { recursive: true });
  return path;
}
const request = (kind: any, device?: string) => ({
  format: "documentation-view-request/0.1" as const,
  kind,
  ...(device ? { device } : {}),
});
const power = {
  format: "schematic-view-request/0.1" as const,
  root: { by: "designation" as const, value: "M1" },
  family: "power" as const,
  flow: "left-to-right" as const,
};

describe("Machine documentation pilot", () => {
  it("reports all channels, terminals, material quantities and loose cable cores from the same compiled model", async () => {
    const { ir } = await compile();
    const io = buildDocumentation(ir, request("io"));
    expect(io.rows).toHaveLength(32);
    expect(
      io.rows.find((r) => r.cells[0] === "PLC1" && r.cells[1] === "di0")?.cells,
    ).toContain("I0.0");
    expect(
      io.rows
        .find((r) => r.cells[0] === "RIO2" && r.cells[1] === "do7")
        ?.cells.at(-1),
    ).toBe("spare; unconnected");
    expect(buildDocumentation(ir, request("terminals")).rows).toHaveLength(16);
    expect(
      buildDocumentation(ir, request("terminals", "PLC1")).rows,
    ).toHaveLength(25);
    const wires = buildDocumentation(ir, request("wires"));
    expect(wires.rows).toHaveLength(ir.wires.length + ir.jumpers.length + 4);
    expect(
      wires.rows.filter((r) => r.cells[4] === "spare; unterminated"),
    ).toHaveLength(2);
    const bom = buildDocumentation(ir, request("bom"));
    expect(bom.rows.reduce((n, r) => n + Number(r.cells[0]), 0)).toBe(
      ir.devices.length + ir.cables.length,
    );
    expect(bom.rows.some((r) => r.cells.includes("6ES7212-1AE40-0XB0"))).toBe(
      true,
    );
    expect(() => buildDocumentation(ir, request("io", "Missing"))).toThrow(
      "does not resolve",
    );
    expect(() => buildDocumentation(ir, request("bom", "PLC1"))).toThrow(
      "Only terminal",
    );
  });
  it("rejects invalid channel keys and duplicate addresses while allowing independent address spaces", async () => {
    const path = await copy(),
      file = join(path, "devices/equipment.json"),
      data = JSON.parse(await readFile(file, "utf8"));
    const plc = data.objects.find((o: any) => o.designation === "PLC1"),
      rio = data.objects.find((o: any) => o.designation === "RIO1");
    plc.io.channels.missing = { address: "I99.0" };
    await writeFile(file, JSON.stringify(data));
    expect(
      (await compileProject(path)).diagnostics.map((d) => d.code),
    ).toContain("E202");
    delete plc.io.channels.missing;
    rio.io.channels.di0.address = "i0.0";
    await writeFile(file, JSON.stringify(data));
    expect(
      (await compileProject(path)).diagnostics.find((d) => d.code === "E202")
        ?.message,
    ).toContain("assigned to both");
    rio.io.addressSpace = "PLC2";
    await writeFile(file, JSON.stringify(data));
    expect((await compileProject(path)).ok).toBe(true);
  });
  it("requires a complete terminal order, then uses the authored ordering", async () => {
    const path = await copy(),
      file = join(path, "libraries/core/types/terminal-block-8.json"),
      data = JSON.parse(await readFile(file, "utf8"));
    data.types[0].terminalOrder = ["1", "1"];
    await writeFile(file, JSON.stringify(data));
    await lockProject(path);
    expect(
      (await compileProject(path)).diagnostics.map((d) => d.code),
    ).toContain("E203");
    data.types[0].terminalOrder = ["8", "7", "6", "5", "4", "3", "2", "1"];
    await writeFile(file, JSON.stringify(data));
    await lockProject(path);
    const c = await compile(path);
    expect(
      buildDocumentation(c.ir, request("terminals", "TB1")).rows.map(
        (r) => r.cells[2],
      ),
    ).toEqual(data.types[0].terminalOrder);
  });
  it("produces stable semantic reviews with human-readable endpoint changes, ignoring source line movement", async () => {
    const path = await copy(),
      before = createProjectSnapshot((await compile(path)).ir),
      file = join(path, "connections/wiring.json"),
      data = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify(data, null, 4));
    expect(createProjectSnapshot((await compile(path)).ir)).toEqual(before);
    const wire = data.objects.find((o: any) => o.designation === "W-FLD-001");
    wire.endpoints.find((e: any) => e.device === "PLC1").terminal = "X10.8";
    await writeFile(file, JSON.stringify(data));
    const after = createProjectSnapshot((await compile(path)).ir),
      review = reviewProject(before, after);
    expect(review.changes).toHaveLength(1);
    expect(review.changes[0]?.summary).toContain("PLC1.X10.7");
    expect(review.changes[0]?.summary).toContain("PLC1.X10.8");
    expect(review.affectedDevices.map((d) => d.designation)).toEqual([
      "PLC1",
      "TB1",
    ]);
    expect(reviewProject(before, before).changes).toEqual([]);
    expect(() => parseProjectSnapshot({ ...before, digest: "bad" })).toThrow(
      "digest",
    );
  });
  it("escapes CSV formulas without changing the model or omitting quoted/newline text", async () => {
    const { ir } = await compile();
    const altered = structuredClone(ir);
    altered.devices[0]!.description = '=HYPERLINK("bad")\nline 2';
    const table = buildDocumentation(altered, request("bom"));
    const row = {
      key: "test",
      cells: ["=1+1", " +2", "@cmd", "-3", 'a,"b"\nc'],
      deviceUids: [],
    };
    const csv = documentationCsv({ ...table, rows: [row] });
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\' +2"');
    expect(csv).toContain('"a,""b""\nc"');
    expect(row.cells[0]).toBe("=1+1");
  });
  it("reduces page count with complete function references and paired continuations, deterministically", async () => {
    const c = await compile();
    const packet = {
      format: "schematic-packet-request/0.1" as const,
      views: [power],
    };
    const baseline = await renderSchematicPacket(c.ir, packet, c.presentation),
      compact = await renderSchematicPacket(
        c.ir,
        { ...packet, layout: "compact" },
        c.presentation,
      );
    if (!baseline.ok || !compact.ok)
      throw new Error(JSON.stringify({ baseline, compact }));
    expect(compact.value.sheets.length).toBeLessThan(
      baseline.value.sheets.length,
    );
    const refs = (s: typeof baseline.value.sheets) =>
      [
        ...new Set(
          s.flatMap((p) =>
            p.references.map((r) => JSON.stringify([r.deviceUid, r.functions])),
          ),
        ),
      ].sort();
    expect(refs(compact.value.sheets)).toEqual(refs(baseline.value.sheets));
    expect(compact.value.sheets[0]!.svg).toContain("Folded circuit sections");
    const links = compact.value.sheets.flatMap((p) => p.continuations);
    for (const l of links)
      expect(links.filter((x) => x.id === l.id)).toHaveLength(2);
    const ids = compact.value.html.match(/\sid="[^"]+"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      await renderSchematicPacket(
        c.ir,
        { ...packet, layout: "compact" },
        c.presentation,
      ),
    ).toEqual(compact);
  });
  it("recovers a vertical continuation collision without changing flow or dropping functions", async () => {
    const c = await compile();
    const packet = {
      format: "schematic-packet-request/0.1" as const,
      views: [{ ...power, flow: "top-to-bottom" as const }],
    };
    const baseline = await renderSchematicPacket(c.ir, packet, c.presentation);
    expect(baseline.ok).toBe(false);
    if (!baseline.ok) expect(baseline.error.code).toBe("R006");
    const result = await renderSchematicPacket(
      c.ir,
      { ...packet, layout: "compact" },
      c.presentation,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.sheets).toHaveLength(2);
    const designations = new Set(
      result.value.sheets.flatMap((s) =>
        s.references.map((r) => r.designation),
      ),
    );
    expect([...designations].sort()).toEqual([
      "CB1",
      "K1",
      "M1",
      "OL1",
      "SRC1",
    ]);
    const pdf = await packetPdf(result.value, "Vertical motor power");
    expect(pdf.toString("latin1")).toContain("/S /GoTo");
    expect(pdf.toString("latin1")).not.toContain("/S /URI");
    for (const sheet of result.value.sheets) {
      expect(sheet.view).toHaveProperty("flow", "top-to-bottom");
      for (const link of sheet.continuations)
        expect(
          result.value.sheets[link.toSheet - 1]!.continuations.some(
            (peer) => peer.id === link.id && peer.toSheet === sheet.number,
          ),
        ).toBe(true);
    }
  });

  it.each(["letter", "tabloid", "a4", "a3"] as const)(
    "keeps all report rows on %s in both orientations",
    async (size) => {
      const c = await compile(),
        table = buildDocumentation(c.ir, request("io"));
      for (const orientation of ["landscape", "portrait"] as const) {
        const result = await renderSchematicPacket(
          c.ir,
          {
            format: "schematic-packet-request/0.1",
            page: { size, orientation },
            views: [request("io")],
          },
          c.presentation,
        );
        if (!result.ok) throw new Error(result.error.message);
        expect(
          result.value.sheets.flatMap(
            (s) => s.svg.match(/data-report-row=/g) ?? [],
          ),
        ).toHaveLength(table.rows.length);
      }
    },
  );
  it("embeds fonts, exports deterministic physical PDF pages, and rejects unsupported glyphs", async () => {
    const c = await compile();
    const r = await renderSchematicPacket(
      c.ir,
      { format: "schematic-packet-request/0.1", views: [request("cables")] },
      c.presentation,
    );
    if (!r.ok) throw new Error(r.error.message);
    const pdf = await packetPdf(r.value, c.ir.project.name);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 1224 792]");
    expect(pdf.toString("latin1")).toContain("/FontFile2");
    expect(await packetPdf(r.value, c.ir.project.name)).toEqual(pdf);
    await expect(
      packetPdf(
        {
          ...r.value,
          sheets: r.value.sheets.map((s) => ({
            ...s,
            svg: s.svg.replaceAll("Cable schedule", "Cable 🚀 schedule"),
          })),
        },
        "Unsupported",
      ),
    ).rejects.toThrow("does not support");
  });
  it("filters designation search and follows a continuation to a hidden sheet without inserting authored HTML", async () => {
    const c = await compile();
    const r = await renderSchematicPacket(
      c.ir,
      {
        format: "schematic-packet-request/0.1",
        views: [power, request("io")],
        index: true,
      },
      c.presentation,
    );
    if (!r.ok) throw new Error(r.error.message);
    const { document, window } = parseHTML(r.value.html);
    const jumped: string[] = [];
    for (const section of document.querySelectorAll("main > section")) {
      section.scrollIntoView = () => jumped.push(section.id);
      section.focus = () => {};
    }
    vm.runInNewContext(PACKET_VIEWER_SCRIPT, {
      document,
      window: { print: () => {} },
    });
    const search = document.getElementById("packet-search") as any;
    search.value = "not-a-device";
    search.dispatchEvent(new window.Event("input"));
    expect(
      [...document.querySelectorAll("main > section")].every((s) => s.hidden),
    ).toBe(true);
    const link = document.querySelector('a[href^="#sheet-"]')!;
    link.dispatchEvent(new window.Event("click", { bubbles: true }));
    expect(jumped.length).toBe(1);
    expect(search.value).toBe("");
    expect(r.value.html).toContain("section[hidden]{display:block!important}");
  });
  it("exports schedules through the CLI and guards new output formats", async () => {
    const path = await copy(),
      csv = join(path, "out", "io.csv"),
      snap = join(path, "out", "before.json");
    const out = await exec(process.execPath, [
      cli,
      "report",
      "io",
      "--project",
      path,
      "-o",
      csv,
    ]);
    expect(JSON.parse(out.stderr).diagnostics).toEqual([]);
    expect(await readFile(csv, "utf8")).toContain("I0.0");
    await exec(process.execPath, [
      cli,
      "snapshot",
      "--project",
      path,
      "-o",
      snap,
    ]);
    const result = await exec(process.execPath, [
      cli,
      "review",
      "--project",
      path,
      "--before",
      snap,
      "--json",
    ]);
    expect(JSON.parse(result.stdout).changes).toEqual([]);
    await expect(
      writeAlphaOutput(
        path,
        join(path, "libraries/core/bad.pdf"),
        Buffer.from("bad"),
      ),
    ).rejects.toThrow("library");
    await expect(writeAlphaOutput(path, snap, "bad", [snap])).rejects.toThrow(
      "request",
    );
  });
  it("watches JSON edits, preserves the last good output on invalid source, and recovers", async () => {
    const path = await copy(),
      output = join(path, "out", "watch.html");
    const child = spawn(
      process.execPath,
      [
        cli,
        "watch",
        "--project",
        path,
        "--input",
        join(path, "packet.request.json"),
        "-o",
        output,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    child.stdout.on("data", (c) => {
      log += c;
    });
    child.stderr.on("data", (c) => {
      log += c;
    });
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 15000;
      while (!predicate()) {
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error(log);
        await new Promise((r) => setTimeout(r, 30));
      }
    };
    try {
      await waitFor(() => log.includes("Wrote"));
      const first = await readFile(output),
        source = join(path, "devices/equipment.json"),
        original = await readFile(source, "utf8");
      await writeFile(source, "{");
      await waitFor(() => log.includes('"E002"'));
      expect(await readFile(output)).toEqual(first);
      const data = JSON.parse(original);
      data.objects.find(
        (o: any) => o.designation === "PLC1",
      ).io.channels.di0.signal = "Updated watch signal";
      await writeFile(source, JSON.stringify(data));
      await waitFor(() => (log.match(/Wrote/g) ?? []).length >= 2);
      expect(await readFile(output, "utf8")).toContain("Updated watch signal");
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((r) => {
        if (child.exitCode !== null) r();
        else child.once("exit", () => r());
      });
    }
  });
});
