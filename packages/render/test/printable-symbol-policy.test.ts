import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematic } from "../src/renderer.js";
import { prepareCircuitView } from "../src/circuit.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  SYMBOL_CATALOG,
  orientSymbolDefinition,
} from "../src/symbols/catalog.js";
import {
  circuitBlock,
  circuitInterfaceMark,
  composedCircuitMark,
  emitCircuitMark,
  circuitMarkLegendInk,
  circuitLegendReservation,
} from "../src/symbols/circuit.js";
import {
  PRINTABLE_SYMBOL_POLICY,
  printableCaption,
  sourceEnclosure,
  sourceEnclosureInk,
} from "../src/symbols/printable-policy.js";
import type {
  SymbolDefinition,
  SymbolPrimitive,
} from "../src/symbols/types.js";
import {
  assertSourceIsolation,
  catalogGeometry,
  svgGeometry,
  svgTextGeometry,
  inkClearance,
} from "./source-isolation.js";
import { compileCoreFixture } from "./fixtures.js";
import { CORE_DEVICE_TYPE_SYMBOL_MAPPINGS } from "../src/symbols/mappings.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
const source = (id: SymbolDefinition["id"]) =>
  SYMBOL_CATALOG.find((s) => s.id === id)!;
const sources = ["ais:power-source-dc", "ais:power-source-3ph"] as const;
function circuitSource(mark: "source" | "dc-output", vertical = false) {
  const pins = vertical
    ? [
        { x: 16.5, y: 40, side: "SOUTH" as const },
        { x: 23.5, y: 40, side: "SOUTH" as const },
      ]
    : [
        { x: 40, y: 16.5, side: "EAST" as const },
        { x: 40, y: 23.5, side: "EAST" as const },
      ];
  return `<svg>${circuitBlock(40, 40, pins)}${circuitInterfaceMark(mark, 20, 20, pins, vertical, true)}${pins.map((pin) => `<g data-terminal-id="${pin.x},${pin.y}"><circle cx="${pin.x}" cy="${pin.y}" r=".65" stroke="black" stroke-width=".3"/></g>`).join("")}</svg>`;
}
const geometry = (svg: string) =>
  svgGeometry(parseHTML(svg).document.querySelector("svg")!);

describe("printable symbol policy", () => {
  it.each([false, true])(
    "keeps all text-bearing catalog marks printable at native and composed scales (vertical=%s)",
    (vertical) => {
      // These are all three text-bearing entries in the closed mark catalog.
      for (const mark of ["source", "load", "motor"] as const) {
        for (const svg of [
          emitCircuitMark(mark, vertical, 1),
          composedCircuitMark(mark, 20, 20, vertical),
        ]) {
          const texts = svgTextGeometry(
            parseHTML(`<svg>${svg}</svg>`).document.querySelector("svg")!,
          );
          expect(texts).toHaveLength(1);
          expect(texts[0]!.em).toBeGreaterThanOrEqual(2.5);
          const ink = texts[0]!.corners;
          // Bound actual transformed glyph ink against every own-mark stroke,
          // including the circular motor outline; an owner-box fit is insufficient.
          for (const stroke of geometry(`<svg>${svg}</svg>`).shapes)
            expect(
              inkClearance(
                { points: [...ink, ink[0]!], stroke: 0, solid: true },
                stroke,
              ),
              `${mark}: legend clearance`,
            ).toBeGreaterThanOrEqual(0.3);
        }
      }
      // The series-loop emitter uses this unscaled, text-free mark.
      expect(emitCircuitMark("dc-output", false, 1)).not.toContain("<text");
    },
  );
  it.each([false, true])(
    "reserves source/load ink plus 2 mm on both layout axes (vertical=%s)",
    (vertical) => {
      for (const mark of ["source", "load"] as const) {
        const ink = circuitMarkLegendInk(mark, 0, 0)[0]!;
        const reservation = circuitLegendReservation(mark, vertical);
        const width = ink.right - ink.left;
        const height = ink.bottom - ink.top;
        expect(reservation.row).toBeGreaterThanOrEqual(
          (vertical ? width : height) + 2,
        );
        expect(reservation.block).toBeGreaterThanOrEqual(
          (vertical ? height : width) + 2,
        );
        // The pre-layout estimate must match the emitted composed transform.
        const svg = `<svg>${composedCircuitMark(mark, 0, 0, vertical)}</svg>`;
        const corners = svgTextGeometry(
          parseHTML(svg).document.querySelector("svg")!,
        )[0]!.corners;
        expect(Math.min(...corners.map((p) => p.x))).toBeCloseTo(ink.left, 6);
        expect(Math.max(...corners.map((p) => p.x))).toBeCloseTo(ink.right, 6);
        expect(Math.min(...corners.map((p) => p.y))).toBeCloseTo(ink.top, 6);
        expect(Math.max(...corners.map((p) => p.y))).toBeCloseTo(ink.bottom, 6);
      }
    },
  );
  it("uses physical ink sizes and can retire individual fact words per mark", () => {
    expect(sourceEnclosureInk()).toEqual({
      strokeWidth: 0.18,
      dash: "0.6 0.6",
      color: "#17212b",
    });
    expect(sourceEnclosureInk(0.25).strokeWidth * 0.25).toBe(0.18);
    expect(printableCaption({ kind: "internal-key" })).toBe("");
    const fn = ir.functions.find(
      (f) => f.kind === "contact" && f.normal_state === "closed",
    )!;
    const type = ir.deviceTypes.find(
      (t) => t.id === ir.devices.find((d) => d.uid === fn.id.deviceUid)!.typeId,
    )!;
    const fact = {
      kind: "function" as const,
      fn,
      type,
      mark: "ais:contact-nc" as const,
    };
    expect(printableCaption(fact)).toBe("NC");
    expect(printableCaption(fact, { "ais:contact-nc": ["NC"] })).toBe("");
  });
  it("audits all aggregate meanings and every sourcing/sinking-specific catalog mark", () => {
    const expected = new Map([
      ["ais:power-source-3ph", "source"],
      ["ais:motor-3ph", ""],
      ["ais:switch-sensor-pnp", "PNP"],
    ]);
    const marks = new Set(
      CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.flatMap((m) =>
        m.aggregates.map((a) => a.symbolId),
      ),
    );
    expect([...marks].sort()).toEqual([...expected.keys()].sort());
    for (const mark of marks)
      expect(printableCaption({ kind: "aggregate", mark })).toBe(
        expected.get(mark),
      );
    expect(
      SYMBOL_CATALOG.filter((s) =>
        /pnp|npn|sourcing|sinking|push-pull/.test(s.id),
      ).map((s) => [s.id, printableCaption({ kind: "aggregate", mark: s.id })]),
    ).toEqual([["ais:switch-sensor-pnp", "PNP"]]);
  });
  it("merges overlapping source openings without recreating ink across a stub", () => {
    const lines = sourceEnclosure(
      { x: 0, y: 0, width: 20, height: 40 },
      [
        { side: "east", at: 10 },
        { side: "east", at: 11 },
        { side: "east", at: 10 },
        { side: "east", at: 30 },
      ],
      2,
    );
    expect(
      lines
        .filter((p) => p.from.x === 20 && p.to.x === 20)
        .map((p) => [p.from.y, p.to.y]),
    ).toEqual([
      [0, 8],
      [13, 28],
      [32, 40],
    ]);
  });
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    it.each(sources)(
      `isolates catalog %s with a visible ink gap in ${flow}`,
      (id) => {
        for (const mmPerUnit of [0.25, 0.32])
          assertSourceIsolation(
            catalogGeometry(
              orientSymbolDefinition(source(id), flow),
              mmPerUnit,
            ),
          );
      },
    );
    it.each(["source", "dc-output"] as const)(
      `isolates every transformed circuit %s primitive in ${flow}`,
      (mark) => {
        assertSourceIsolation(
          geometry(circuitSource(mark, flow === "top-to-bottom")),
        );
      },
    );
    it.each([
      ["M1", "power", "ais:power-source-3ph"],
      ["PS1", "loads", "ais:power-source-dc"],
    ] as const)(
      `keeps source identity and printable labels for %s in ${flow}`,
      async (root, intent, symbol) => {
        const result = await renderSchematic(
          ir,
          intent === "power"
            ? {
                format: "schematic-view-request/0.1",
                root: { by: "designation", value: root },
                family: "power",
                flow,
              }
            : {
                format: "schematic-view-request/0.2",
                root: { by: "designation", value: root },
                intent: { kind: "loads" },
                flow,
              },
        );
        if (!result.ok) throw new Error(result.error.message);
        const doc = parseHTML(result.value.svg).document;
        expect(doc.querySelectorAll("svg")).toHaveLength(1);
        expect(
          doc.querySelector(`[data-symbol-id="${symbol}"]`)!.getAttribute("id"),
        ).toBeTruthy();
        assertSourceIsolation(
          svgGeometry(
            doc.querySelector(`[data-symbol-id="${symbol}"]`)!,
            PRINTABLE_SYMBOL_POLICY.rootedMmPerUnit,
          ),
        );
        expect(
          doc.querySelectorAll("text.label-device").length,
        ).toBeGreaterThan(0);
        expect(
          doc.querySelectorAll("text.label-terminal").length,
        ).toBeGreaterThan(0);
        expect(
          doc.querySelectorAll("text.label-conductor").length,
        ).toBeGreaterThan(0);
        expect(
          [...doc.querySelectorAll("text")].some((t) =>
            /pole\d|dc_output|three-phase-source/.test(t.textContent ?? ""),
          ),
        ).toBe(false);
      },
    );
    it.each([
      ["SRC1", "three_phase_source"],
      ["PS1", "dc_output"],
    ])(
      `checks every actual source node descendant for %s in ${flow}`,
      async (device, key) => {
        const result = await prepareCircuitView(ir, {
          format: "circuit-view-request/0.1",
          title: "Source",
          flow,
          groups: [
            {
              id: "source",
              functions: [
                { device: { by: "designation", value: device! }, key: key! },
              ],
              conductors: [],
            },
          ],
        });
        const node = parseHTML(
          result.groups[0]!.content,
        ).document.querySelector("[data-device-uid]")!;
        assertSourceIsolation(svgGeometry(node));
      },
    );
  }
  it.each([
    [
      "arc from + to minus",
      "ais:power-source-dc",
      {
        kind: "arc",
        from: { x: 13, y: 8 },
        to: { x: 13, y: 56 },
        radiusX: 8,
        radiusY: 8,
        clockwise: false,
        style: "body",
      },
    ],
    [
      "circle touching L2 and L3",
      "ais:power-source-3ph",
      { kind: "circle", center: { x: 20, y: 48 }, radius: 12, style: "body" },
    ],
  ] satisfies readonly [string, SymbolDefinition["id"], SymbolPrimitive][])(
    "rejects the review mutation: %s",
    (_name, id, primitive) => {
      const changed = {
        ...source(id),
        primitives: [...source(id).primitives, primitive],
      };
      for (const flow of ["left-to-right", "top-to-bottom"] as const)
        expect(() =>
          assertSourceIsolation(
            catalogGeometry(orientSymbolDefinition(changed, flow), 0.25),
          ),
        ).toThrow(/Source/);
    },
  );
  it.each(["left-to-right", "top-to-bottom"] as const)(
    "keeps the physical enclosure stroke on composed %s sheets",
    async (flow) => {
      const result = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        layout: "compact",
        views: [
          {
            format: "schematic-view-request/0.2",
            root: { by: "designation", value: "PS1" },
            intent: { kind: "loads" },
            flow,
          },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      const outlines = result.value.sheets.flatMap((sheet) =>
        svgGeometry(
          parseHTML(sheet.svg).document.querySelector("svg")!,
        ).shapes.filter((s) => s.enclosure),
      );
      expect(outlines.length).toBeGreaterThan(0);
      for (const outline of outlines)
        expect(outline.stroke).toBeCloseTo(
          PRINTABLE_SYMBOL_POLICY.enclosureStrokeMm,
          3,
        );
    },
  );
  it("rejects rooted opening clearance reduced from 3 to 1", () => {
    const dc = source("ais:power-source-dc");
    const changed = {
      ...dc,
      primitives: [
        ...dc.primitives.filter((p) => p.style !== "enclosure"),
        ...sourceEnclosure(
          { x: 2, y: 1, width: 28, height: 62 },
          dc.ports.map((p) => ({
            side: p.side,
            at: dc.size.height * p.offset,
          })),
          1,
        ),
      ],
    };
    expect(() => assertSourceIsolation(catalogGeometry(changed, 0.25))).toThrow(
      /clearance/,
    );
  });
  it("rejects circuit enclosure clearance 0.01", () => {
    const svg = circuitSource("dc-output");
    const doc = parseHTML(svg).document,
      group = doc.querySelector("[data-source-enclosure]")!;
    const outline = sourceEnclosure(
      { x: 0, y: 0, width: 40, height: 40 },
      geometry(svg).ports.map((port) => ({
        side: "east" as const,
        at: port.point.y,
      })),
      0.01,
    );
    group.innerHTML = outline
      .map(
        (p) =>
          `<line x1="${p.from.x}" y1="${p.from.y}" x2="${p.to.x}" y2="${p.to.y}" stroke="black" stroke-width=".18"/>`,
      )
      .join("");
    expect(() =>
      assertSourceIsolation(svgGeometry(doc.querySelector("svg")!)),
    ).toThrow(/clearance/);
  });
  it("rejects leadEnd reduced from 6 to 3 inside a transformed mark", () => {
    for (const vertical of [false, true]) {
      const doc = parseHTML(circuitSource("dc-output", vertical)).document;
      for (const line of doc.querySelectorAll("[data-source-stub]"))
        line.setAttribute(vertical ? "y2" : "x2", "23");
      expect(() =>
        assertSourceIsolation(svgGeometry(doc.querySelector("svg")!)),
      ).toThrow(/Source/);
    }
  });
  it.each([false, true])(
    "rejects filled ink across source pins, including containment (vertical=%s)",
    (vertical) => {
      for (const covering of [false, true]) {
        const doc = parseHTML(circuitSource("dc-output", vertical)).document;
        const bounds = covering
          ? 'x="-10" y="-10" width="80" height="80"'
          : vertical
            ? 'x="0" y="38" width="40" height="2"'
            : 'x="38" y="0" width="2" height="40"';
        doc
          .querySelector("svg")!
          .insertAdjacentHTML(
            "beforeend",
            `<rect ${bounds} fill="#17212b" stroke="none"/>`,
          );
        expect(() =>
          assertSourceIsolation(svgGeometry(doc.querySelector("svg")!)),
        ).toThrow(/Source/);
      }
    },
  );
  it("sees SVG paths, nested rotations/scales, and fails closed on unknown geometry", () => {
    const doc = parseHTML(circuitSource("dc-output")).document;
    doc
      .querySelector("svg")!
      .insertAdjacentHTML(
        "beforeend",
        '<g transform="translate(0 0) scale(2)"><path d="M 20 8.25 A 4 4 0 0 0 20 11.75" stroke="black" stroke-width=".2"/></g>',
      );
    expect(() =>
      assertSourceIsolation(svgGeometry(doc.querySelector("svg")!)),
    ).toThrow(/Source/);
    expect(() => geometry("<svg><image/></svg>")).toThrow(
      /Unsupported SVG geometry/,
    );
  });
  it.each(["left-to-right", "top-to-bottom"] as const)(
    "isolates boundary source terminals and preserves the converter input outline in %s",
    async (flow) => {
      const compiled = await compileProject("examples/functional-symbols");
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      const request = JSON.parse(
        await (
          await import("node:fs/promises")
        ).readFile(
          `examples/functional-symbols/packet-${flow}.request.json`,
          "utf8",
        ),
      );
      let boundaryChecks = 0,
        converterChecks = 0;
      for (const view of request.views.filter(
        (v: { format: string }) => v.format === "circuit-view-request/0.1",
      )) {
        const result = await prepareCircuitView(compiled.ir, view);
        for (const group of result.groups) {
          const doc = parseHTML(group.content).document;
          for (const node of doc.querySelectorAll("[data-device-uid]")) {
            const uid = node.getAttribute("data-device-uid")!,
              device = compiled.ir.devices.find((d) => d.uid === uid)!;
            const type = compiled.ir.deviceTypes.find(
              (t) => t.id === device.typeId,
            )!;
            const sourceKeys = compiled.ir.functions
              // Windings intentionally carry their two terminals through an
              // impedance glyph; they are not independent supply outputs.
              .filter(
                (f) =>
                  f.id.deviceUid === uid &&
                  f.kind === "source" &&
                  type.symbol !== "thermite:transformer" &&
                  type.circuitSymbols?.[f.id.functionKey] !== "winding",
              )
              .flatMap((f) =>
                f.terminals.map((t) => JSON.stringify([uid, t.terminalKey])),
              );
            const geo = svgGeometry(node),
              ports = geo.ports.filter((p) => sourceKeys.includes(p.id));
            if (ports.length >= 2) {
              expect(
                node.querySelector("[data-source-enclosure]"),
              ).not.toBeNull();
              assertSourceIsolation({ ...geo, ports });
              if (
                [...node.querySelectorAll("text")].some(
                  (t) => t.textContent === "BOUNDARY",
                )
              )
                boundaryChecks++;
            }
            if (
              device.designation === "PS1" &&
              node.querySelector('[data-function-key="input"]')
            ) {
              converterChecks++;
              expect(
                node.querySelector(
                  "[data-source-enclosure] line:not([stroke-dasharray])",
                ),
              ).not.toBeNull();
            }
          }
        }
      }
      expect(boundaryChecks).toBeGreaterThan(0);
      expect(converterChecks).toBeGreaterThan(0);
    },
  );
});
