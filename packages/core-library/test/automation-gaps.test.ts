import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  writeSeriesProject,
} from "./automation-gap-fixtures.js";
import { rm3SeriesLoopView } from "./rm3-drawings.js";
import { compileProject } from "@thermite/compiler";

it.each([
  ["second PSU", "core:psu-24vdc", "-"],
  ["transformer X2", "core:control-transformer", "X2"],
])(
  "refuses a %s sharing the authored PS return/PE connection",
  async (_name, type, terminal) => {
    const root = await mkdtemp(join(tmpdir(), "thermite-series-shared-pe-"));
    try {
      const { requests } = await writeSeriesProject(root),
        source = JSON.parse(await readFile(join(root, "source.json"), "utf8"));
      source.objects.push({
        kind: "device",
        uid: "740c0000-0000-4000-8000-000000000002",
        designation: "OTHER1",
        type,
      });
      for (const [i, endpoints] of [
        [
          { device: "PS1", terminal: "-" },
          { device: "PE1", terminal: "PE" },
        ],
        [
          { device: "PE1", terminal: "PE" },
          { device: "OTHER1", terminal },
        ],
      ].entries())
        source.objects.push({
          kind: "wire",
          uid: `740c0000-0000-4000-8000-00000000000${i + 3}`,
          designation: `W-PE-${i + 1}`,
          endpoints,
        });
      await writeFile(join(root, "source.json"), JSON.stringify(source));
      const compiled = await compileProject(root);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const request = requests[0],
          result = await renderSchematicPacket(compiled.ir, {
            ...request,
            views: [{ ...request.views[0], flow }],
          });
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            message:
              'Packet view[0] "Untitled view": Series loop has an additional connection at PS1.-; use a circuit view that includes the branch.',
          },
        });
        expect(result).not.toHaveProperty("value");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "runs both committed opt-in requests against a new normally locked series copy in %s",
  async (flow) => {
    const root = await mkdtemp(join(tmpdir(), "thermite-series-copy-"));
    try {
      const compiled = await writeSeriesProject(root);
      expect(compiled.diagnostics.filter((d) => d.severity !== "info")).toEqual(
        [],
      );
      expect(
        JSON.parse(
          await readFile(join(root, "electrical-system.lock.json"), "utf8"),
        ),
      ).toEqual(
        JSON.parse(
          await readFile(
            new URL(
              "./fixtures/series-loop/electrical-system.lock.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
      for (const request of compiled.requests) {
        const view = await rm3SeriesLoopView(compiled.ir, request, flow),
          selected = selectSignalLoop(compiled.ir, view);
        expect(selected.series?.supplyBranches).toHaveLength(14);
        expect(
          new Set(selected.series?.legs.map((p) => p.edges[0]?.net)).size,
        ).toBe(3);
        const result = await renderSchematicPacket(compiled.ir, {
          ...request,
          page: {
            size: "tabloid",
            orientation: flow === "top-to-bottom" ? "portrait" : "landscape",
          },
          views: [view],
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (result.ok) expect(result.value.sheets).toHaveLength(1);
      }
      const committed = await compileProject(
        "packages/core-library/test/fixtures/series-loop",
      );
      expect(committed.ok, JSON.stringify(committed.diagnostics)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

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
  "draws the selected series-powered reproduction in %s",
  async (flow) => {
    const root = await mkdtemp(join(tmpdir(), "thermite-series-gap-"));
    try {
      const compiled = await writeGapProject(root, "loop");
      const request = JSON.parse(
        await readFile(
          new URL("./fixtures/series-loop/rm2.request.json", import.meta.url),
          "utf8",
        ),
      );
      const view = { ...request.views[0]!, flow };
      const selected = selectSignalLoop(compiled.ir, view);
      expect(selected.series?.supplyBranches).toHaveLength(2);
      expect(
        new Set(selected.series?.legs.map((p) => p.edges[0]?.net)).size,
      ).toBe(3);
      const result = await renderSchematicPacket(compiled.ir, {
        ...request,
        page: {
          size: "tabloid",
          orientation: flow === "top-to-bottom" ? "portrait" : "landscape",
        },
        views: [view],
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok) {
        expect(result.value.sheets[0]!.svg).toContain(
          "Three separate loop nets",
        );
        expect(result.value.sheets[0]!.svg).toContain(
          "Outside selected loop at PS1.+: 1 authored connections:",
        );
        expect(result.value.sheets[0]!.svg).toContain(
          "Outside selected loop at PS1.-: 1 authored connections:",
        );
      }
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
