import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { compileProject, lockProject } from "@thermite/compiler";
import {
  buildCommunicationInventory,
  buildDocumentation,
  createQueryEngine,
  createProjectSnapshot,
  reviewProject,
} from "@thermite/query";
import { renderSchematicPacket } from "@thermite/render";
import {
  compileCableLength,
  compileConnectionRejection,
  CONNECTION_REJECTIONS,
  fixture,
  INVALID_CABLE_LENGTHS,
  removeFixtures,
} from "./communication.cases.js";
const exec = promisify(execFile);
afterEach(removeFixtures);
async function compiled(p: string) {
  const c = await compileProject(p);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  return c;
}
const view = {
  format: "communication-view-request/0.1" as const,
  medium: "ethernet" as const,
};
describe("typed communication ports", () => {
  it("accepts sub-resolution ELK residue but still rejects a genuinely diagonal route", async () => {
    const f = await fixture(),
      c = await compiled(f.p);
    const prototype = (BundledElk as unknown as { prototype: ELK }).prototype;
    const original = prototype.layout;
    for (const delta of [1e-12, 0.5]) {
      const spy = vi
        .spyOn(prototype, "layout")
        .mockImplementationOnce(async function (this: ELK, graph: ElkNode) {
          const result = await original.call(this, graph);
          result.edges![0]!.sections![0]!.startPoint.y += delta;
          return result;
        });
      try {
        const result = await renderSchematicPacket(c.ir, {
          format: "schematic-packet-request/0.1",
          views: [view],
        });
        expect(result.ok).toBe(delta < 0.001);
        if (!result.ok)
          expect(result.error.message).toContain("not finite and orthogonal");
      } finally {
        spy.mockRestore();
      }
    }
  });
  it("keeps port links out of physical nets and preserves them in agent inspection and semantic review", async () => {
    const f = await fixture(),
      c = await compiled(f.p);
    expect(c.ir.nets).toHaveLength(6);
    expect(c.ir.nets.every((n) => n.terminalIds.length === 1)).toBe(true);
    expect(buildCommunicationInventory(c.ir).ports).toHaveLength(9);
    const inspected = createQueryEngine(c.ir).inspect({
      by: "designation",
      value: "A",
    });
    expect(inspected.ok && inspected.value.object).toMatchObject({
      ports: { ETH1: { medium: "ethernet" } },
      projectRelations: [{ relation: { connection: { fromPort: "ETH1" } } }],
    });
    const snapshot = createProjectSnapshot(c.ir);
    f.relation.connection.fromPort = "ETH2";
    await f.write("source.json", f.source);
    const after = await compiled(f.p);
    expect(after.ir.nets).toEqual(c.ir.nets);
    const review = reviewProject(snapshot, createProjectSnapshot(after.ir));
    expect(JSON.stringify(review)).toContain("connection/fromPort");
    expect(review.affectedDevices.map((d) => d.designation)).toEqual([
      "A",
      "B",
    ]);
  });
  it.each(CONNECTION_REJECTIONS)(
    "rejects %s with authored diagnostics",
    async (problem) => {
      const c = await compileConnectionRejection(problem);
      expect(c.ok).toBe(false);
      expect(
        c.diagnostics.some(
          (d) =>
            d.code === (problem === "missing-device" ? "E101" : "E204") &&
            d.file === "source.json",
        ),
      ).toBe(true);
    },
  );
  it("reports each link once and every unconnected port without inferring spare capacity", async () => {
    const f = await fixture(),
      c = await compiled(f.p);
    const table = buildDocumentation(c.ir, {
      format: "documentation-view-request/0.1",
      kind: "network",
    });
    expect(table.rows).toHaveLength(8);
    expect(table.rows.filter((r) => r.cells.includes("planned"))).toHaveLength(
      1,
    );
    expect(
      table.rows.filter((r) => r.cells.includes("Unconnected")),
    ).toHaveLength(7);
  });
  it("produces repeatable escaped port diagrams with explicit boundary devices and no net attributes", async () => {
    const f = await fixture(),
      c = await compiled(f.p);
    const request = {
      format: "schematic-packet-request/0.1" as const,
      views: [{ ...view, devices: ["A"] }],
    };
    const a = await renderSchematicPacket(c.ir, request),
      b = await renderSchematicPacket(c.ir, request);
    expect(a.ok).toBe(true);
    expect(a).toEqual(b);
    if (!a.ok) return;
    expect(a.value.sheets[0]!.references.map((r) => r.designation)).toEqual([
      "A",
      "B",
    ]);
    expect(a.value.sheets[0]!.svg).toContain("Boundary (schedule)");
    expect(a.value.sheets[0]!.svg).not.toContain("data-net-id=");
    const escaped = structuredClone(c.ir);
    escaped.deviceTypes[0]!.description = '<script>"&';
    const r = await renderSchematicPacket(escaped, request);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sheets[0]!.svg).toContain("&lt;script&gt;");
      expect(r.value.sheets[0]!.svg).not.toContain("<script>");
    }
  });
  it("rejects bad view selectors and excessive sheet layouts instead of clipping", async () => {
    const f = await fixture(),
      c = await compiled(f.p);
    for (const v of [
      { ...view, devices: ["missing"] },
      { ...view, medium: "serial" },
      { ...view, devices: ["A", "A"] },
      { ...view, typo: true },
    ]) {
      const r = await renderSchematicPacket(c.ir, {
        format: "schematic-packet-request/0.1",
        views: [v as any],
      });
      expect(r.ok).toBe(false);
    }
    c.ir.deviceTypes[0]!.description = "Long descriptive text ".repeat(100);
    const r = await renderSchematicPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      views: [view],
    });
    expect(r.ok).toBe(false);
  });
  it("exports through the regular CLI report and packet output protections", async () => {
    const f = await fixture();
    await f.write("packet.json", {
      format: "schematic-packet-request/0.1",
      views: [view],
    });
    await exec(process.execPath, [
      resolve("thermite.mjs"),
      "report",
      "network",
      "--project",
      f.p,
      "-o",
      join(f.p, "network.csv"),
    ]);
    expect(await readFile(join(f.p, "network.csv"), "utf8")).toContain(
      "A.ETH1",
    );
    await exec(process.execPath, [
      resolve("thermite.mjs"),
      "packet",
      "--project",
      f.p,
      "--input",
      join(f.p, "packet.json"),
      "-o",
      join(f.p, "network.html"),
    ]);
    expect(await readFile(join(f.p, "network.html"), "utf8")).toContain(
      "Ethernet connections",
    );
    await expect(
      exec(process.execPath, [
        resolve("thermite.mjs"),
        "report",
        "network",
        "--project",
        f.p,
        "-o",
        join(f.p, "source.json"),
      ]),
    ).rejects.toThrow();
  });
  it("packs short communication views while retaining every device reference and later report", async () => {
    const f = await fixture(),
      c = await compiled(f.p);
    const packet = await renderSchematicPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      layout: "compact",
      index: true,
      page: { size: "tabloid" },
      views: [
        { ...view, devices: ["A"] },
        { ...view, devices: ["B"] },
        { format: "documentation-view-request/0.1", kind: "network" },
      ],
    });
    expect(packet.ok).toBe(true);
    if (!packet.ok) return;
    const drawing = packet.value.sheets[0]!;
    expect(drawing.references.map((r) => r.designation)).toEqual([
      "A",
      "B",
      "A",
      "B",
    ]);
    expect(drawing.references[2]!.yMm).toBeGreaterThan(
      drawing.references[0]!.yMm! + 30,
    );
    expect(packet.value.sheets[1]!.view).toMatchObject({ kind: "network" });
    expect(drawing.svg.match(/data-communication-link=/g) ?? []).toHaveLength(
      2,
    );
    for (const r of drawing.references)
      expect(r.yMm).toBeLessThan(packet.value.page.heightMm - 30);
  });
  it("fails unsupported text and overlong port names instead of emitting clipped or invalid SVG", async () => {
    const f = await fixture(),
      c = await compiled(f.p);
    const request = {
      format: "schematic-packet-request/0.1" as const,
      views: [view],
    };
    const invalid = structuredClone(c.ir);
    invalid.deviceTypes[0]!.description = "Bad\u0000label";
    expect((await renderSchematicPacket(invalid, request)).ok).toBe(false);
    const long = "W".repeat(60);
    f.types.types[0]!.ports[long as "ETH1"] = {
      medium: "ethernet",
      connector: "RJ45",
    };
    f.relation.connection.fromPort = long;
    await f.write("lib/types.json", f.types);
    await f.write("source.json", f.source);
    expect((await lockProject(f.p)).ok).toBe(true);
    expect(
      (await renderSchematicPacket((await compiled(f.p)).ir, request)).ok,
    ).toBe(false);
  });
});

it.each(INVALID_CABLE_LENGTHS)(
  "rejects invalid physical communication cable length %j",
  async (lengthM) => {
    const c = await compileCableLength(lengthM);
    expect(c.ok).toBe(false);
    expect(
      c.diagnostics.some(
        (d) => d.code === (typeof lengthM === "number" ? "E015" : "E011"),
      ),
    ).toBe(true);
  },
);
