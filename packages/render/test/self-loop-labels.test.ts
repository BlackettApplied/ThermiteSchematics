import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { prepareCircuitView, type CircuitViewRequest } from "../src/circuit.js";
import { renderSchematicPacket } from "../src/sheets.js";

let ir: ElectricalIr;
let view: CircuitViewRequest;
beforeAll(async () => {
  const directory = resolve("examples/self-loop-labels");
  const compiled = await compileProject(directory);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  expect(compiled.diagnostics.every((d) => d.code === "W904")).toBe(true);
  ir = compiled.ir;
  view = JSON.parse(await readFile(resolve(directory, "packet.json"), "utf8"))
    .views[0];
});

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.01 &&
  a.x + a.width > b.x + 0.01 &&
  a.y < b.y + b.height - 0.01 &&
  a.y + a.height > b.y + 0.01;
const numbers = (text: string) => text.match(/-?\d+(?:\.\d+)?/g)!.map(Number);

describe("nested external bridge labels", () => {
  it.each([
    ["left-to-right", false],
    ["top-to-bottom", false],
    ["left-to-right", true],
    ["top-to-bottom", true],
  ] as const)(
    "keeps %s labels readable and conserves ELK routes (conductor details: %s)",
    async (flow, details) => {
      const source = structuredClone(ir);
      if (details)
        source.wires.find((w) => w.designation === "W1")!.properties = {
          label: "BRIDGE",
          size: "18 AWG",
          color: "Blue",
        };
      const before = JSON.stringify(source);
      const prototype = (BundledElk as unknown as { prototype: ELK }).prototype;
      const original = prototype.layout;
      let elk: ElkNode;
      const spy = vi
        .spyOn(prototype, "layout")
        .mockImplementation(async function (this: ELK, graph: ElkNode) {
          const output = await original.call(this, graph);
          elk = structuredClone(output);
          return output;
        });
      try {
        const result = await prepareCircuitView(source, { ...view, flow });
        const group = result.groups[0]!;
        const document = parseHTML(group.content).document;
        const wires = [...source.wires].sort((a, b) =>
          a.uid < b.uid ? -1 : 1,
        );
        expect(group.coverage.conductorIds).toEqual(wires.map((w) => w.uid));
        expect(group.coverage.functionIds).toHaveLength(3);
        const routes = wires.map((wire, i) => {
          const element = [
            ...document.querySelectorAll("[data-circuit-conductor]"),
          ].find((e) => e.getAttribute("data-circuit-conductor") === wire.uid)!;
          expect(JSON.parse(element.getAttribute("data-endpoints")!)).toEqual(
            wire.endpoints.map((e) => e.terminal),
          );
          const coordinates = numbers(
            element.querySelector("path")!.getAttribute("d")!,
          );
          const points = Array.from(
            { length: coordinates.length / 2 },
            (_, p) => ({ x: coordinates[2 * p]!, y: coordinates[2 * p + 1]! }),
          );
          const section = elk!.edges!.find((e) => e.id === `e${i}`)!
            .sections![0]!;
          const expected = [
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          ];
          expect(points).toHaveLength(expected.length);
          points.forEach((point, p) => {
            expect(point.x).toBeCloseTo(expected[p]!.x, 3);
            expect(point.y).toBeCloseTo(expected[p]!.y, 3);
          });
          return {
            id: wire.uid,
            segments: points.slice(1).map((b, p) => ({
              x: Math.min(points[p]!.x, b.x),
              y: Math.min(points[p]!.y, b.y),
              width: Math.abs(points[p]!.x - b.x),
              height: Math.abs(points[p]!.y - b.y),
            })),
          };
        });
        const deviceBoxes = [
          ...document.querySelectorAll("[data-device-uid]"),
        ].map((e) => {
          const [x, y] = numbers(e.getAttribute("transform")!);
          return {
            x: x!,
            y: y!,
            width: Number(e.getAttribute("data-layout-width")),
            height: Number(e.getAttribute("data-layout-height")),
          };
        });
        const labels = [...document.querySelectorAll("[data-wire-label]")].map(
          (e) => {
            const rect = e.querySelector("rect")!;
            return {
              id: e.getAttribute("data-wire-label")!,
              ...Object.fromEntries(
                ["x", "y", "width", "height"].map((k) => [
                  k,
                  Number(rect.getAttribute(k)),
                ]),
              ),
              element: e,
            } as Box & { id: string; element: typeof e };
          },
        );
        expect(labels).toHaveLength(wires.length);
        for (const [i, label] of labels.entries()) {
          expect(label.x).toBeGreaterThanOrEqual(0);
          expect(label.y).toBeGreaterThanOrEqual(0);
          expect(label.x + label.width).toBeLessThanOrEqual(
            group.width + 0.001,
          );
          expect(label.y + label.height).toBeLessThanOrEqual(
            group.height + 0.001,
          );
          expect(deviceBoxes.some((box) => overlap(label, box))).toBe(false);
          expect(labels.slice(i + 1).some((box) => overlap(label, box))).toBe(
            false,
          );
          expect(
            routes
              .filter((r) => r.id !== label.id)
              .some((r) => r.segments.some((s) => overlap(label, s))),
          ).toBe(false);
          for (const text of label.element.querySelectorAll("text"))
            expect(Number(text.getAttribute("font-size"))).toBe(2.5);
        }
        const bridge = labels.find((l) => l.id === wires[0]!.uid)!;
        expect(
          [...bridge.element.querySelectorAll("text")].map(
            (e) => e.textContent,
          ),
        ).toEqual(details ? ["BRIDGE", "18 AWG / Blue"] : ["BRIDGE"]);
        // A recovered self-loop caption stays beside an actual routed segment,
        // including centered overhang on a short segment in the vertical flow.
        expect(
          routes[0]!.segments.some((s) => {
            const cx = bridge.x + bridge.width / 2;
            const cy = bridge.y + bridge.height / 2;
            return s.width === 0
              ? cy >= s.y &&
                  cy <= s.y + s.height &&
                  Math.min(
                    Math.abs(bridge.x - s.x),
                    Math.abs(bridge.x + bridge.width - s.x),
                  ) <= 1.001
              : cx >= s.x &&
                  cx <= s.x + s.width &&
                  Math.min(
                    Math.abs(bridge.y - s.y),
                    Math.abs(bridge.y + bridge.height - s.y),
                  ) <= 1.001;
          }),
        ).toBe(true);
        expect(await prepareCircuitView(source, { ...view, flow })).toEqual(
          result,
        );
        expect(JSON.stringify(source)).toBe(before);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("retains R006 when a wide vertical-loop label cannot clear the neighboring routes", async () => {
    const source = structuredClone(ir);
    source.wires.find((w) => w.designation === "W1")!.properties = {
      label: "LONG-BRIDGE-ALPHA",
    };
    const result = await renderSchematicPacket(source, {
      format: "schematic-packet-request/0.1",
      views: [{ ...view, flow: "top-to-bottom" }],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "R006", reason: "unprintable-layout" },
    });
    if (!result.ok)
      expect(result.error.message).toContain("self-loop wire label cannot fit");
    expect(result).not.toHaveProperty("value");
  });
});
