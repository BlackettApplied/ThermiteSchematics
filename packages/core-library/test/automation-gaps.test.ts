import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { renderSchematic } from "../../render/src/renderer.js";
import { prepareCircuitView } from "../../render/src/circuit.js";
import { selectSignalLoop } from "../../render/src/signal-loop.js";
import {
  disconnectCircuit,
  signalPacket,
  writeGapProject,
} from "./automation-gap-fixtures.js";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "pins R006 for a series-powered passive-input loop, with and without an auxiliary pair, in %s",
  async (flow) => {
    const root = await mkdtemp(join(tmpdir(), "thermite-loop-gap-"));
    try {
      const compiled = await writeGapProject(root, "loop");
      expect(compiled.diagnostics.filter((d) => d.severity !== "info")).toEqual(
        [],
      );
      for (const auxiliary of [false, true]) {
        const request = signalPacket(auxiliary);
        const result = await renderSchematicPacket(compiled.ir, {
          ...request,
          views: request.views.map((v) => ({ ...v, flow })),
        });
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            reason: "unprintable-layout",
            message:
              'Packet view[0] "Untitled view": No complete conductive path from TX1.+ to the selected destination function.',
          },
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "selects the series-powered reproduction but refuses drawing in %s",
  async (flow) => {
    const root = await mkdtemp(join(tmpdir(), "thermite-series-gap-"));
    try {
      const compiled = await writeGapProject(root, "loop");
      const request = signalPacket(false, true);
      const view = { ...request.views[0]!, flow };
      const selected = selectSignalLoop(compiled.ir, view);
      expect(selected.series?.supplyBranches).toHaveLength(2);
      expect(
        new Set(selected.series?.legs.map((p) => p.edges[0]?.net)).size,
      ).toBe(3);
      const result = await renderSchematicPacket(compiled.ir, {
        ...request,
        views: [view],
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "R006",
          reason: "unprintable-layout",
          message:
            'Packet view[0] "TX1 - signal loop": Series loop drawing is not available in this increment; use an explicit circuit view.',
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "renders the disconnect identity in circuit and power views in %s",
  async (flow) => {
    const root = await mkdtemp(join(tmpdir(), "thermite-disconnect-gap-"));
    try {
      const compiled = await writeGapProject(root, "disconnect");
      expect(compiled.diagnostics.filter((d) => d.severity !== "info")).toEqual(
        [],
      );
      const circuit = await prepareCircuitView(compiled.ir, {
        ...disconnectCircuit,
        flow,
      });
      expect(
        circuit.groups.flatMap((g) =>
          [...g.content.matchAll(/data-circuit-mark="([^"]+)"/g)].map(
            (m) => m[1],
          ),
        ),
      ).toEqual(["disconnector", "disconnector", "disconnector"]);
      const power = await renderSchematic(compiled.ir, {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "M1" },
        family: "power",
        flow,
      });
      expect(power.ok, JSON.stringify(power)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
