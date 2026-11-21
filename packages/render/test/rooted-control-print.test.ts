import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import { renderSchematicPacket, renderSchematicSheets } from "../src/index.js";
import { renderSchematicPacket as ordinaryPacket } from "../src/sheets.js";

const page = {
  size: "tabloid",
  orientation: "landscape",
  marginMm: 10,
} as const;
const uid = (n: number) =>
  `75127a81-3dad-45cb-988d-${String(n).padStart(12, "0")}`;
const deviceTypes = {
  V1: "psu-24vdc",
  F2: "fuse-1p",
  B1: "estop-nc",
  B2: "pushbutton-nc",
  X1: "overload-3p-1nc",
  B3: "pushbutton-no",
  Y1: "relay-1co",
  Y2: "contactor-3p-1no",
  P1: "pilot-light",
};
const pairs = [
  ["V1.+", "F2.1/L1"],
  ["F2.2/T1", "B1.11"],
  ["B1.12", "B2.11"],
  ["B2.12", "X1.95"],
  ["X1.96", "B3.13"],
  ["X1.96", "Y1.11"],
  ["B3.14", "Y1.A1"],
  ["Y1.14", "Y1.A1"],
  ["Y1.A1", "Y2.A1"],
  ["Y2.A1", "P1.X1"],
  ["V1.-", "Y1.A2"],
  ["V1.-", "Y2.A2"],
  ["V1.-", "P1.X2"],
];
const devices = Object.entries(deviceTypes).map(([designation, type], i) => ({
  uid: uid(i + 1),
  kind: "device",
  designation,
  type: `core:${type}`,
  ...(designation === "Y1"
    ? {
        connectionReview: {
          terminals: {
            12: { status: "intentionally-unused", reason: "Unused throw." },
          },
        },
      }
    : {}),
}));

async function controlFixture(byPass = false) {
  const project = await mkdtemp(join(tmpdir(), "thermite-parallel-"));
  const dispose = () => rm(project, { recursive: true, force: true });
  try {
    const wires = pairs
      .map((ends, i) => ({
        uid: uid(i + 100),
        kind: "wire",
        designation: `L${10 + i}`,
        endpoints: ends.map((end) => {
          const [device, terminal] = end.split(".");
          return { device, terminal };
        }),
      }))
      .filter(
        ({ designation }) => !byPass || !["L15", "L17"].includes(designation),
      );
    await writeFile(
      join(project, "source.json"),
      JSON.stringify({ objects: [...devices, ...wires] }),
    );
    await writeFile(
      join(project, "system.json"),
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: "Synthetic parallel control" },
        sources: ["source.json"],
        libraries: [{ name: "core", version: "0.2.0" }],
      }),
    );
    const lock = await lockProject(project);
    assert.ok(lock.ok, JSON.stringify(lock.diagnostics));
    const c = await compileProject(project);
    assert.ok(c.ok, JSON.stringify(c.diagnostics));
    return { ...c, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function controlView(root: string, flow: "left-to-right" | "top-to-bottom") {
  return {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: root },
    family: "control",
    flow,
  } as const;
}
function wires(svg: string) {
  return new Map(
    [...svg.matchAll(/<path [^>]*data-wire-uid="([^"]+)"[^>]*>/g)].map(
      ([path, id]) => {
        assert.ok(id);
        const attr = (key: string) =>
          new RegExp(` ${key}="([^"]+)"`).exec(path)?.[1];
        return [
          id,
          {
            geometry: attr("d"),
            net: attr("data-net-id"),
            source: attr("data-route-source-port-key"),
            target: attr("data-route-target-port-key"),
          },
        ];
      },
    ),
  );
}
const connectivity = (svg: string) =>
  [...wires(svg)].map(([id, { geometry: _geometry, ...w }]) => [id, w]).sort();

it.each(["left-to-right", "top-to-bottom"] as const)(
  "routes a two-arm join before the receiving symbol in %s",
  async (flow) => {
    const c = await controlFixture();
    try {
      const view = controlView("Y1", flow);
      const request = {
        format: "schematic-packet-request/0.1",
        page,
        views: [view],
        index: false,
      } as const;
      const before = await ordinaryPacket(c.ir, request);
      const result = await renderSchematicPacket(c.ir, request);
      assert.ok(
        before.ok && result.ok,
        JSON.stringify({ before: before.ok, result: result.ok }),
      );
      const [base] = before.value.sheets;
      const [sheet] = result.value.sheets;
      assert.ok(base && sheet);
      expect(result.value.sheets).toHaveLength(1);
      expect(connectivity(sheet.svg)).toEqual(connectivity(base.svg));
      const original = wires(base.svg).get(uid(107))?.geometry;
      expect(original).toMatch(/ [VH] .* [VH] .* [VH] /);
      expect(wires(sheet.svg).get(uid(107))?.geometry).toMatch(
        flow === "left-to-right"
          ? /^M [\d.]+ [\d.]+ H [\d.]+$/
          : /^M [\d.]+ [\d.]+ V [\d.]+$/,
      );
      const standalone = await renderSchematicSheets(
        c.ir,
        view,
        undefined,
        page,
      );
      assert.ok(standalone.ok);
      expect(
        wires(standalone.value.sheets[0]?.svg ?? "").get(uid(107))?.geometry,
      ).toEqual(wires(sheet.svg).get(uid(107))?.geometry);
    } finally {
      await c.dispose();
    }
  },
);

it("leaves a single forward branch alone", async () => {
  const c = await controlFixture(true);
  try {
    const view = controlView("Y1", "top-to-bottom");
    const request = {
      format: "schematic-packet-request/0.1",
      page,
      views: [view],
    } as const;
    const before = await ordinaryPacket(c.ir, request);
    const after = await renderSchematicPacket(c.ir, request);
    assert.ok(before.ok && after.ok);
    expect(after.value.sheets).toEqual(before.value.sheets);
  } finally {
    await c.dispose();
  }
});

it("keeps printable sheets when a horizontal refold has no accepted saving", async () => {
  const c = await controlFixture();
  try {
    const view = controlView("Y2", "left-to-right");
    const request = {
      format: "schematic-packet-request/0.1",
      page,
      views: [view],
      index: false,
    } as const;
    const before = await ordinaryPacket(c.ir, request);
    const after = await renderSchematicPacket(c.ir, request);
    assert.ok(before.ok && after.ok);
    expect(before.value.sheets).toHaveLength(2);
    expect(after.value.sheets).toEqual(before.value.sheets);
  } finally {
    await c.dispose();
  }
});
