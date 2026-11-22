import { motorLabelFixture } from "./helpers/wire-label-fixture.js";
import { readFile } from "node:fs/promises";
import { prepareCircuitView } from "../src/circuit.js";
import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { svgSemanticId } from "../src/svg/escape.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import { prepareWiringDrawing } from "../src/wiring.js";
import { consoleWiringFixture } from "./wiring-landings-fixture.js";
import { required } from "./fixtures.js";
import { points } from "./helpers/route-quality.js";
import { clearOwnedPlate } from "../src/layout/label-plate.js";

import {
  nativePath,
  on,
  horizontalSupport,
  printedCaptionSupport,
  foreignRoutes,
} from "./helpers/wire-label-support.js";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "gives the real LS1 switched-return caption an owned supporting segment or a visible nonconductive leader in %s",
  async (flow) => {
    const { layout, doc } = await motorLabelFixture(flow);
    const label = required(
      layout.labels.find((l) => l.text === "LS1-SWITCHED-RETURN"),
    );
    const text = required(
      doc.querySelector(
        `text[clip-path="url(#${svgSemanticId("clip", [label.id])})"]`,
      ),
    );
    const m = printableTextMetrics(required(text.textContent));
    const scale = text.hasAttribute("textLength")
      ? Number(text.getAttribute("textLength")) / m.advance
      : 1;
    const x = Number(text.getAttribute("x")) - 20,
      y = Number(text.getAttribute("y")) - 20;
    const ink = {
      left: x + m.left * scale,
      right: x + m.right * scale,
      top: y - m.top,
      bottom: y - m.bottom,
    };
    const own = required(layout.edges.find((e) => e.id === label.ownerId));
    const conductor = required(
      doc.querySelector(`[data-edge-key="${svgSemanticId("edge", [own.id])}"]`),
    );
    expect(conductor.getAttribute("data-wire-uid")).toBe(
      "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
    );
    const route = nativePath(required(conductor.getAttribute("d")));
    expect(route).toEqual(
      own.points.map((p) => ({
        x: Number(p.x.toFixed(3)),
        y: Number(p.y.toFixed(3)),
      })),
    );

    const leader = [...doc.querySelectorAll("[data-label-leader-owner]")].find(
      (e) => e.getAttribute("data-label-leader-owner") === label.ownerId,
    );
    const association = printedCaptionSupport(
      ink,
      route,
      foreignRoutes(doc, layout, own.id),
    );
    const nativeSupport = association.supported;
    expect(association.clear).toBe(true);
    expect(nativeSupport || !!leader).toBe(true);
    if (!nativeSupport) {
      const ps = points(required(required(leader).getAttribute("d"))).map(
        (p) => ({ x: p.x - 20, y: p.y - 20 }),
      );
      expect(ps.length).toBeGreaterThanOrEqual(2);
      expect(on(required(ps.at(-1)), route)).toBe(true);
      expect(leader?.getAttribute("stroke")).not.toBe("none");
      expect(Number(leader?.getAttribute("stroke-width"))).toBeGreaterThan(0);
      expect(leader?.closest(".conductor,[data-wire-uid]")).toBeNull();
    }
  },
);

it("keeps the console supply caption blocks supported by their own physical conductors", async () => {
  const c = await consoleWiringFixture();
  const p = await prepareWiringDrawing(c.ir, c.request.views[1]);
  const doc = parseHTML(`<svg>${p.content}</svg>`).document;
  const wires = c.ir.wires.filter((w) =>
    ["W-C07", "W-C08"].includes(w.designation),
  );
  expect(wires).toHaveLength(2);
  for (const w of wires) {
    const g = required(doc.querySelector(`[data-wiring-conductor="${w.uid}"]`));
    const rect = required(g.querySelector("rect")),
      x = Number(rect.getAttribute("x")),
      y = Number(rect.getAttribute("y"));
    const route = points(
      required(required(g.querySelector("path")).getAttribute("d")),
    );
    expect(
      horizontalSupport(
        {
          left: x,
          right: x + Number(rect.getAttribute("width")),
          top: y,
          bottom: y + Number(rect.getAttribute("height")),
        },
        route,
        2,
      ),
      w.designation,
    ).toBe(true);
  }
});

it.each([
  ["W-C08", 1, false],
  ["W-C11", 2, true],
  ["W-C12", 2, false],
] as const)(
  "keeps both printed landings legible for %s",
  async (name, index, pointsWithLeader) => {
    const c = await consoleWiringFixture();
    const output = await prepareWiringDrawing(c.ir, c.request.views[index]);
    const doc = parseHTML(`<svg>${output.content}</svg>`).document;
    const wire = required(c.ir.wires.find((w) => w.designation === name));
    const group = required(
      doc.querySelector(`[data-wiring-conductor="${wire.uid}"]`),
    );
    const shape = required(group.querySelector("rect")),
      x = Number(shape.getAttribute("x")),
      y = Number(shape.getAttribute("y")),
      w = Number(shape.getAttribute("width")),
      h = Number(shape.getAttribute("height"));
    const route = nativePath(
      required(required(group.querySelector("path")).getAttribute("d")),
    );
    const leader = doc.querySelector(`[data-label-leader-owner="${wire.uid}"]`);
    expect(Boolean(leader)).toBe(pointsWithLeader);
    if (leader)
      expect(
        on(
          required(nativePath(required(leader.getAttribute("d"))).at(-1)),
          route,
        ),
      ).toBe(true);

    for (const [end, a, b] of [
      ["source", required(route[0]), required(route[1])],
      ["target", required(route.at(-1)), required(route.at(-2))],
    ] as const) {
      if (a.y !== b.y || a.y < y || a.y > y + h) continue;
      const side = a.x < b.x ? x - a.x : a.x - (x + w);
      if (side > Math.abs(b.x - a.x)) continue;
      const port = group.getAttribute(`data-layout-${end}-port`);
      const marker = required(
        doc.querySelector(`circle[data-layout-port="${port}"]`),
      );
      const ring =
        Number(marker.getAttribute("r")) +
        Number(marker.getAttribute("stroke-width")) / 2;
      expect(
        side - ring,
        `${name} ${end} outside the printed ring`,
      ).toBeGreaterThanOrEqual(Math.max(2, h));
    }
  },
);

it("supports every console wiring caption on its native conductor or an actual leader without changing the 2.7 mm text", async () => {
  const c = await consoleWiringFixture();
  let count = 0;
  for (const request of c.request.views.filter(
    (v: { format: string }) => v.format === "wiring-view-request/0.1",
  )) {
    const p = await prepareWiringDrawing(c.ir, request),
      doc = parseHTML(`<svg>${p.content}</svg>`).document;
    for (const group of doc.querySelectorAll("[data-wiring-conductor]")) {
      const id = group.getAttribute("data-wiring-conductor"),
        route = points(
          required(required(group.querySelector("path")).getAttribute("d")),
        ),
        t = required(group.querySelector("text"));
      const m = printableTextMetrics(required(t.textContent), 2.7),
        x = Number(t.getAttribute("x")),
        y = Number(t.getAttribute("y"));
      expect(t.getAttribute("font-size")).toBe("2.7");
      const plate = required(group.querySelector("rect"));
      const left = Number(plate.getAttribute("x")),
        top = Number(plate.getAttribute("y"));
      expect(
        clearOwnedPlate(
          {
            left,
            top,
            right: left + Number(plate.getAttribute("width")),
            bottom: top + Number(plate.getAttribute("height")),
          },
          [route],
          1.2,
        ),
        t.textContent ?? "",
      ).toBe(true);
      const leader = [
        ...doc.querySelectorAll("[data-label-leader-owner]"),
      ].find((e) => e.getAttribute("data-label-leader-owner") === id);
      const supported = horizontalSupport(
        {
          left: x + m.left,
          right: x + m.right,
          top: y - m.top,
          bottom: y - m.bottom,
        },
        route,
        2,
      );
      expect(supported || !!leader, t.textContent ?? "").toBe(true);
      if (!supported)
        expect(
          on(
            required(
              points(required(required(leader).getAttribute("d"))).at(-1),
            ),
            route,
          ),
        ).toBe(true);
      count++;
    }
  }
  expect(count).toBe(
    c.request.views
      .filter((v: { format: string }) => v.format === "wiring-view-request/0.1")
      .reduce(
        (n: number, v: { conductors: string[] }) => n + v.conductors.length,
        0,
      ),
  );
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "supports the nested external bridge's 103 caption on its actual conductor in %s",
  async (flow) => {
    const c = await compileProject("examples/self-loop-labels");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const request = JSON.parse(
      await readFile("examples/self-loop-labels/packet.json", "utf8"),
    ).views[0];
    const pending = prepareCircuitView(c.ir, { ...request, flow });
    await expect(pending).resolves.toHaveProperty("groups");
    const result = await pending,
      doc = parseHTML(required(result.groups[0]).content).document,
      id = "65000000-0000-4000-8000-000000000013";
    const group = required(doc.querySelector(`[data-wire-label="${id}"]`)),
      text = required(group.querySelector("text"));
    expect(text.textContent).toBe("103");
    expect(text.getAttribute("font-size")).toBe("2.5");
    const route = points(
        required(
          required(
            doc.querySelector(
              `[data-circuit-conductor="${id}"] path[stroke="#17212b"]`,
            ),
          ).getAttribute("d"),
        ),
      ),
      x = Number(text.getAttribute("x")),
      y = Number(text.getAttribute("y")),
      m = printableTextMetrics("103", 2.5);
    const leader = [...doc.querySelectorAll("[data-label-leader-owner]")].find(
      (e) => e.getAttribute("data-label-leader-owner") === id,
    );
    const supported = horizontalSupport(
      {
        left: x + m.left,
        right: x + m.right,
        top: y - m.top,
        bottom: y - m.bottom,
      },
      route,
      2,
    );
    expect(supported || !!leader).toBe(true);
    if (!supported)
      expect(
        on(
          required(points(required(required(leader).getAttribute("d"))).at(-1)),
          route,
        ),
      ).toBe(true);
  },
);
