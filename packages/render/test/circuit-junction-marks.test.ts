import assert from "node:assert/strict";
import { threeWayCircuit } from "./helpers/circuit-junction-state.js";
import { circuitJunctionSvg } from "../src/circuit/junction-identity.js";
import { readFile } from "node:fs/promises";
import { compileProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import { prepareCircuitView } from "../src/circuit.js";
import {
  circuitDocument,
  nativeJunctionRays,
} from "./helpers/junction-rays.js";

for (const flow of ["left-to-right", "top-to-bottom"] as const) {
  it(`prints ordinary circuit endpoints hollow in ${flow}`, async () => {
    const c = await compileProject("examples/functional-symbols");
    assert.ok(c.ok);
    const request = JSON.parse(
      await readFile(
        "examples/functional-symbols/packet-left-to-right.request.json",
        "utf8",
      ),
    ).views[0];
    const drawing = await prepareCircuitView(c.ir, { ...request, flow });
    const markers = drawing.groups.flatMap((g) => [
      ...circuitDocument(g.content).querySelectorAll(
        "[data-terminal-id] > circle",
      ),
    ]);
    expect(markers.length).toBeGreaterThan(0);
    expect([...new Set(markers.map((m) => m.getAttribute("fill")))]).toEqual([
      "white",
    ]);
    expect([
      ...new Set(markers.map((m) => m.getAttribute("stroke-width"))),
    ]).toEqual([".3"]);
  });

  it(`retains a measured three-way native junction and rejects false owners in ${flow}`, () => {
    const state = threeWayCircuit(flow === "top-to-bottom");
    expect([...state.dots.values()]).toEqual([{ x: 10, y: 10 }]);
    const p = state.dots.values().next().value;
    assert.ok(p);
    const paths = state.routes
      .map(
        (r) =>
          `<g data-circuit-conductor="${r.index}" data-endpoints='${JSON.stringify(state.cs[r.index]?.ends)}'><path stroke="#17212b" d="${r.points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")}"/></g>`,
      )
      .join("");
    const doc = circuitDocument(paths + circuitJunctionSvg(p, state));
    const dot = doc.querySelector("[data-circuit-junction]");
    assert.ok(dot);
    expect(dot.getAttribute("fill")).toBe("#17212b");
    expect(dot.getAttribute("data-terminal-key")).toBe("T");
    expect(nativeJunctionRays(dot, doc)).toEqual(
      flow === "left-to-right"
        ? ["east", "south", "west"]
        : ["north", "south", "west"],
    );
    const route = doc.querySelector('[data-circuit-conductor="0"]');
    assert.ok(route);
    route.remove();
    expect(nativeJunctionRays(dot, doc)).toEqual(
      flow === "left-to-right" ? ["east", "south"] : ["south", "west"],
    );
    dot.setAttribute("data-terminal-key", "foreign");
    expect(nativeJunctionRays(dot, doc)).toEqual([]);
    expect(threeWayCircuit(flow === "top-to-bottom", true).dots.size).toBe(0);
  });
}
