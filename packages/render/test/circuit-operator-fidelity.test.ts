import { readFile } from "node:fs/promises";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { beforeAll, describe, expect, it } from "vitest";
import {
  renderSchematicPacket,
  type SchematicPacketRequest,
} from "../src/sheets.js";
import {
  composedCircuitMark,
  circuitLegendReservation,
  circuitMarkInkBounds,
  circuitMarkSegments,
} from "../src/symbols/circuit-mark.js";
import {
  paintedShape,
  auditOperatingLink,
  auditEarth,
} from "./circuit-fidelity-oracle.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const result = await compileProject("examples/functional-symbols");
  if (!result.ok) throw Error(JSON.stringify(result));
  ir = result.ir;
});
const standalone = (
  mark: Parameters<typeof composedCircuitMark>[0],
  vertical: boolean,
) =>
  parseHTML(
    `<svg>${composedCircuitMark(mark, 0, 0, vertical)}</svg>`,
  ).document.querySelector("svg")!;

function auditFunctions(root: Element, source: ElectricalIr) {
  for (const fn of root.querySelectorAll("g[data-function-id]")) {
    const [uid, key] = JSON.parse(fn.getAttribute("data-function-id")!);
    const f = source.functions.find(
      (f) => f.id.deviceUid === uid && f.id.functionKey === key,
    )!;
    expect(f).toBeTruthy();
    const type = source.deviceTypes.find(
      (t) => t.id === source.devices.find((d) => d.uid === uid)!.typeId,
    )!;
    if (
      ["thermite:pressure-switch", "thermite:level-switch"].includes(
        type.symbol!,
      )
    ) {
      expect(f.kind).toBe("contact");
      auditOperatingLink(
        root,
        fn,
        f.kind === "contact" && f.normal_state === "closed",
      );
    } else
      expect(
        fn.querySelectorAll('[data-circuit-role="operating-link"]'),
      ).toHaveLength(0);
    if (fn.querySelector('[data-circuit-mark="earth"]')) {
      const attachment = fn.querySelector("[data-terminal-attachment]")!;
      expect(
        JSON.parse(attachment.getAttribute("data-terminal-attachment")!),
      ).toEqual([f.terminals[0]!.deviceUid, f.terminals[0]!.terminalKey]);
      const path = attachment.querySelector('path[stroke="#17212b"]')!;
      // Measure the actual attachment endpoint, rather than its claimed target.
      const points = paintedShape(root, path).points;
      const terminal = [
        ...fn
          .closest("[data-layout-width]")!
          .querySelectorAll("[data-terminal-id]"),
      ].find(
        (e) =>
          e.getAttribute("data-terminal-id") ===
          attachment.getAttribute("data-terminal-attachment"),
      )!;
      const port = paintedShape(root, terminal.querySelector("circle")!).points;
      const centre = {
        x:
          (Math.min(...port.map((p) => p.x)) +
            Math.max(...port.map((p) => p.x))) /
          2,
        y:
          (Math.min(...port.map((p) => p.y)) +
            Math.max(...port.map((p) => p.y))) /
          2,
      };
      expect(
        Math.hypot(points[0]!.x - centre.x, points[0]!.y - centre.y),
      ).toBeLessThan(0.001);
      auditEarth(root, fn, points.at(-1)!);
    }
  }
}

function checkReservation(
  root: Element,
  mark: Parameters<typeof composedCircuitMark>[0],
  vertical: boolean,
) {
  const reservation = circuitLegendReservation(mark, vertical),
    bounds = circuitMarkInkBounds(mark, vertical);
  const strokes = [...root.querySelectorAll("line,polyline")].map((e) =>
    paintedShape(root, e),
  );
  const segments = circuitMarkSegments(mark, 0, 0, vertical);
  for (const [edge, axis, sign] of [
    ["left", "x", -1],
    ["right", "x", 1],
    ["top", "y", -1],
    ["bottom", "y", 1],
  ] as const) {
    const values = strokes.flatMap((stroke) =>
      stroke.points.map((p) => p[axis] + (sign * stroke.stroke) / 2),
    );
    expect(bounds[edge]).toBeCloseTo(
      sign < 0 ? Math.min(...values) : Math.max(...values),
      6,
    );
  }
  for (const stroke of strokes)
    for (const p of stroke.points) {
      const half = stroke.stroke / 2;
      expect(p.x - half).toBeGreaterThanOrEqual(bounds.left - 0.001);
      expect(p.x + half).toBeLessThanOrEqual(bounds.right + 0.001);
      expect(p.y - half).toBeGreaterThanOrEqual(bounds.top - 0.001);
      expect(p.y + half).toBeLessThanOrEqual(bounds.bottom + 0.001);
      expect(
        segments.some((s) =>
          s.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < 0.001),
        ),
      ).toBe(true);
      const row = vertical ? p.x : p.y,
        block = vertical ? p.y : p.x;
      expect(Math.abs(row) + half + 1).toBeLessThanOrEqual(
        reservation.row / 2 + 0.001,
      );
      expect(Math.abs(block) + half + 1).toBeLessThanOrEqual(
        reservation.block / 2 + 0.001,
      );
    }
}

describe("pressure/level operating links and upright earth", () => {
  it.each([false, true])(
    "measures all contact states and mutations (vertical=%s)",
    (vertical) => {
      for (const mark of [
        "pressure-no",
        "pressure-nc",
        "level-no",
        "level-nc",
      ] as const) {
        const root = standalone(mark, vertical),
          owner = root.querySelector("[data-circuit-mark]")!;
        auditOperatingLink(root, owner, mark.endsWith("-nc"));
        checkReservation(root, mark, vertical);
        const link = owner.querySelector(
          '[data-circuit-role="operating-link"]',
        )!;
        // Commit 2's dash repeats merged into neighbouring collinear solids.
        // Restore that whole geometry: visible-ink union must reject it.
        const previous = owner.cloneNode(true) as Element;
        previous
          .querySelector('[data-circuit-role="operating-link"]')!
          .setAttribute("transform", "translate(0 1)");
        for (const operator of previous.querySelectorAll(
          '[data-circuit-role="operator"]',
        ))
          operator.setAttribute("transform", "translate(0 2)");
        owner.replaceWith(previous);
        expect(() =>
          auditOperatingLink(root, previous, mark.endsWith("-nc")),
        ).toThrow();
        previous.replaceWith(owner);
        link.remove();
        expect(() =>
          auditOperatingLink(root, owner, mark.endsWith("-nc")),
        ).toThrow();
        owner.append(link);
        link.setAttribute("stroke-dasharray", ".5 .5");
        expect(() =>
          auditOperatingLink(root, owner, mark.endsWith("-nc")),
        ).toThrow();
        link.setAttribute("stroke-dasharray", "2.25 1.5");
        link.setAttribute("x2", "8");
        expect(() =>
          auditOperatingLink(root, owner, mark.endsWith("-nc")),
        ).toThrow();
        link.setAttribute("x2", "4");
        const state = owner.querySelector(
          '[data-circuit-role="contact-state"]',
        );
        if (state) {
          for (const transform of ["translate(20 20)", "translate(4 0)"]) {
            state.setAttribute("transform", transform);
            expect(() => auditOperatingLink(root, owner, true)).toThrow();
          }
          state.removeAttribute("transform");
        }
        if (state) state.remove();
        else
          owner.append(
            standalone("pressure-nc", false)
              .querySelector('[data-circuit-role="contact-state"]')!
              .cloneNode(true),
          );
        // Keep the mark ID/claimed state intact; only swap the physical state ink.
        expect(() =>
          auditOperatingLink(root, owner, mark.endsWith("-nc")),
        ).toThrow();
      }
    },
  );

  it.each([false, true])(
    "measures the original earth anchor, stem and bars (vertical=%s)",
    (vertical) => {
      const root = standalone("earth", vertical),
        owner = root.querySelector("[data-circuit-mark]")!;
      const anchor = vertical ? { x: 0, y: -4 } : { x: -4, y: 0 };
      auditEarth(root, owner, anchor);
      if (!vertical) checkReservation(root, "earth", false);
      else
        expect(
          [...owner.querySelectorAll("line")].map((line) =>
            ["x1", "y1", "x2", "y2"].map((a) => Number(line.getAttribute(a))),
          ),
        ).toEqual([
          [0, 6, 4, 6],
          [4, 2, 4, 10],
          [7, 3, 7, 9],
          [10, 4, 10, 8],
        ]);
      const lead = owner.querySelector('[data-circuit-role="lead"]')!;
      lead.setAttribute("x1", "1");
      expect(() => auditEarth(root, owner, anchor)).toThrow();
      lead.setAttribute("x1", "0");
      const bar = owner.querySelector('[data-circuit-role="earth-bar"]')!;
      bar.setAttribute("x2", String(Number(bar.getAttribute("x2")) + 2));
      expect(() => auditEarth(root, owner, anchor)).toThrow();
    },
  );

  it.each(["left-to-right", "top-to-bottom"] as const)(
    "checks function ownership, state swaps and allocated ink in %s packets",
    async (flow) => {
      const request = JSON.parse(
        await readFile(
          `examples/functional-symbols/packet-${flow}.request.json`,
          "utf8",
        ),
      ) as SchematicPacketRequest;
      for (const swapped of [false, true]) {
        const source = structuredClone(ir);
        for (const f of source.functions)
          if (
            f.kind === "contact" &&
            ["SP1", "SL1"].some(
              (tag) =>
                source.devices.find((d) => d.uid === f.id.deviceUid)!
                  .designation === tag,
            ) &&
            swapped
          ) {
            f.normal_state = f.normal_state === "open" ? "closed" : "open";
            const type = source.deviceTypes.find(
              (t) =>
                t.id ===
                source.devices.find((d) => d.uid === f.id.deviceUid)!.typeId,
            )!;
            const definition = type.functions.find(
              (d) => d.key === f.id.functionKey,
            )!;
            if (definition.kind === "contact")
              definition.normal_state = f.normal_state;
          }
        const before = JSON.stringify(source),
          result = await renderSchematicPacket(source, request);
        if (!result.ok) throw Error(JSON.stringify(result.error));
        expect(JSON.stringify(source)).toBe(before);
        expect(result.value.coverage.counts.conductors).toEqual({
          total: 15,
          represented: 15,
          outsideAuditedViews: 0,
        });
        expect(result.value.coverage.counts.functions).toEqual({
          total: 15,
          represented: 15,
          outsideAuditedViews: 0,
        });
        for (const sheet of result.value.sheets) {
          const root = parseHTML(sheet.svg).document.querySelector("svg")!;
          auditFunctions(root, source);
          for (const earth of root.querySelectorAll(
            '[data-circuit-mark="earth"]',
          )) {
            const lead = earth.querySelector('[data-circuit-role="lead"]')!;
            lead.setAttribute("x1", "1");
            expect(() => auditFunctions(root, source)).toThrow();
            lead.setAttribute("x1", "0");
          }
          for (const node of root.querySelectorAll("[data-layout-width]")) {
            const width = Number(node.getAttribute("data-layout-width")),
              height = Number(node.getAttribute("data-layout-height"));
            for (const ink of [
              ...node.querySelectorAll("[data-circuit-role]"),
            ].map((e) => paintedShape(node, e)))
              for (const point of ink.points) {
                expect(point.x - ink.stroke / 2).toBeGreaterThanOrEqual(-0.001);
                expect(point.y - ink.stroke / 2).toBeGreaterThanOrEqual(-0.001);
                expect(point.x + ink.stroke / 2).toBeLessThanOrEqual(
                  width + 0.001,
                );
                expect(point.y + ink.stroke / 2).toBeLessThanOrEqual(
                  height + 0.001,
                );
              }
          }

          const functions = [
            ...root.querySelectorAll("g[data-function-id]"),
          ].filter((f) =>
            f.querySelector('[data-circuit-role="operating-link"]'),
          );
          if (functions.length === 2) {
            const link = functions[0]!.querySelector(
              '[data-circuit-role="operating-link"]',
            )!;
            functions[1]!.append(link);
            expect(() => auditFunctions(root, source)).toThrow();
          }
        }
      }
    },
  );
});
