import { parseHTML } from "linkedom";
import { afterEach, expect, it } from "vitest";
import { buildDocumentation } from "@thermite/query";
import { renderSchematicPacket } from "@thermite/render";
import { selectSignalLoop } from "../../render/src/signal-loop.js";
import {
  fixture,
  OUTPUT_REJECTIONS,
  removeFixtures,
  renderOutputRejection,
} from "./analog-output.cases.js";

afterEach(removeFixtures);

it.each(["left-to-right", "top-to-bottom"])(
  "shows complete command and power nets with a cabinet exit in %s",
  async (flow) => {
    const f = await fixture();
    f.packet.views[0].flow = flow;
    f.packet.page.orientation =
      flow === "top-to-bottom" ? "portrait" : "landscape";
    const ir = await f.compile(),
      selected = selectSignalLoop(ir, f.packet.views[0]);
    expect(
      selected.stages.map((uid) => selected.devices.get(uid)!.designation),
    ).toEqual(["AQ1", "XT1", "XP1", "V1"]);
    expect(selected.conductors).toHaveLength(10);
    expect(new Set(selected.conductors.map((c) => c.net)).size).toBe(4);
    expect(
      buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind: "wires",
      }).rows,
    ).toHaveLength(10);
    const result = await renderSchematicPacket(ir, f.packet);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await renderSchematicPacket(ir, f.packet)).toEqual(result);
    if (!result.ok) return;
    expect(result.value.sheets).toHaveLength(1);
    const svg = result.value.sheets[0]!.svg;
    const { document } = parseHTML(svg);
    const jacket = document.querySelector("[data-cable-assembly]")!;
    expect(jacket.hasAttribute("data-net-id")).toBe(false);
    const members = JSON.parse(jacket.querySelector("desc")!.textContent!);
    expect(members).toHaveLength(4);
    expect(new Set(members.map((c: any) => c.net)).size).toBe(4);
    expect(document.querySelectorAll("[data-loop-conductor]")).toHaveLength(6);
    for (const value of [
      "V1 - analog output",
      "Q3+",
      "Q3-",
      "ch3 / selected channel",
      "1-1, 2-2, 3-3, 4-4",
    ])
      expect(svg).toContain(value);
    expect(svg).not.toContain(">unused</text>");
    if (flow === "left-to-right") {
      const valveUid = ir.devices.find((d) => d.designation === "V1")!.uid;
      const valve = document.querySelector(`[data-device-uid="${valveUid}"]`)!;
      const connectorLabel = valve.querySelector(
        "[data-connector-interface] text",
      )!;
      const commandLabel = [...valve.querySelectorAll("text")].find((t) =>
        /^2\s+Command/u.test(t.textContent!),
      )!;
      // A wrapped pin legend must clear the M12 label in its own column.
      expect(Number(commandLabel.getAttribute("x"))).toBeGreaterThan(
        Number(connectorLabel.getAttribute("x")) + 8,
      );
    }
    const refs = result.value.sheets[0]!.references;
    expect(refs.find((r) => r.designation === "XT1")!.functions).toEqual([
      "aux1",
    ]);
    // Inspect the actual boundary against placed device bodies in both flows.
    const box = document.querySelector("[data-enclosure] > rect")!;
    const at = (e: Element, name: string) => Number(e.getAttribute(name));
    const pos = (tag: string) => {
      const uid = ir.devices.find((d) => d.designation === tag)!.uid;
      const g = document.querySelector(`[data-device-uid="${uid}"]`)!;
      const [x, y] = g
        .getAttribute("transform")!
        .match(/[\d.-]+/g)!
        .map(Number);
      const rect = g.querySelector("rect")!;
      return { x: x!, y: y!, w: at(rect, "width"), h: at(rect, "height") };
    };
    const wall = pos("XP1"),
      actuator = pos("V1"),
      module = pos("AQ1");
    if (flow === "left-to-right") {
      expect(at(box, "x") + at(box, "width")).toBeCloseTo(
        wall.x + wall.w / 2,
        2,
      );
      expect(actuator.x).toBeGreaterThan(at(box, "x") + at(box, "width"));
      expect(module.x).toBeGreaterThan(at(box, "x"));
    } else {
      expect(at(box, "y") + at(box, "height")).toBeCloseTo(
        wall.y + wall.h / 2,
        2,
      );
      expect(actuator.y).toBeGreaterThan(at(box, "y") + at(box, "height"));
      expect(module.y).toBeGreaterThan(at(box, "y"));
    }
    delete f.packet.views[0].cableAssemblies;
    const detail = await renderSchematicPacket(ir, f.packet);
    expect(detail.ok, JSON.stringify(detail)).toBe(true);
    if (detail.ok)
      expect(
        detail.value.sheets[0]!.svg.match(/data-loop-conductor=/g),
      ).toHaveLength(10);
  },
);

it("uses the documented current pair on channel 2 without adding another module", async () => {
  const f = await fixture();
  f.source.objects.find((o: any) => o.designation === "V1").type =
    "field-interfaces:pressure-regulator-m12-proposed";
  f.source.objects.find(
    (o: any) => o.designation === "W1",
  ).endpoints[0].terminal = "3";
  f.source.objects.find(
    (o: any) => o.designation === "W2",
  ).endpoints[0].terminal = "7";
  f.packet.views[0].from.function = "ch2";
  const ir = await f.compile(),
    r = await renderSchematicPacket(ir, f.packet);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (r.ok)
    for (const label of ["Q2+", "Q2-", "4-20 mA"])
      expect(r.value.sheets[0]!.svg).toContain(label);
});

it.each(OUTPUT_REJECTIONS)(
  "rejects %s without hiding an active conductor",
  async (problem) => {
    const result = await renderOutputRejection(problem);
    expect(result.ok, problem).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("R006");
  },
);
