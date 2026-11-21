import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { prepareWiringDrawing } from "../src/wiring.js";
import { points, lengths } from "./helpers/route-quality.js";

it("keeps the branched console supply below the old detour severity with complete tags", async () => {
  const c = await compileProject("examples/operator-console");
  if (!c.ok) throw Error("Compile failed");
  const request = JSON.parse(
    await readFile("examples/operator-console/packet.request.json", "utf8"),
  ).views[1];
  const drawing = await prepareWiringDrawing(c.ir, request);
  const uid = c.ir.wires.find((w) => w.designation === "W-C06")!.uid;
  const doc = parseHTML(drawing.content).document;
  const route = points(
    doc
      .querySelector(`[data-wiring-conductor="${uid}"] path`)!
      .getAttribute("d")!,
  );
  const a = route[0]!,
    z = route.at(-1)!;
  const span = Math.abs(z.x - a.x) + Math.abs(z.y - a.y);
  expect(
    lengths(route).reduce((a, b) => a + b, 0) - 2 * span - 20,
  ).toBeLessThanOrEqual(12.12);
  expect(drawing.coverage!.conductorIds).toHaveLength(5);
  expect(drawing.deviceTags).toHaveLength(4);
});
