import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { prepareCircuitView } from "../src/circuit.js";
import { points, lengths } from "./helpers/route-quality.js";

it("routes the synthetic transformer without the inline-label 0.8 mm tick in either flow", async () => {
  const c = await compileProject("examples/functional-symbols");
  if (!c.ok) throw Error("Compile failed");
  const request = JSON.parse(
    await readFile(
      "examples/functional-symbols/packet-left-to-right.request.json",
      "utf8",
    ),
  ).views[0];
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    const group = (await prepareCircuitView(c.ir, { ...request, flow }))
      .groups[0]!;
    const doc = parseHTML(group.content).document;
    for (const route of doc.querySelectorAll(
      "[data-circuit-conductor] path:last-child",
    )) {
      expect(
        lengths(points(route.getAttribute("d")!))
          .slice(1, -1)
          .filter((n) => n > 0.05 && n < 3 - 1e-8),
      ).toEqual([]);
    }
    expect(
      doc.querySelectorAll("[data-tag-field=designation]").length,
    ).toBeGreaterThan(0);
  }
});
