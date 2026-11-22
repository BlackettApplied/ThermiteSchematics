import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { prepareCommunicationDrawing } from "../src/communication.js";
import { offViewFixture } from "./off-view-fixtures.js";
import {
  directFixture,
  directView,
  flows,
  withDirectFieldStage,
} from "./direct-loop-fixture.js";
import { compileCoreFixture } from "./fixtures.js";
import { topologyFixture } from "./topology-fixture.js";

it.each(flows)(
  "audits the rooted, loop, communication and cable emitter interfaces in %s",
  async (flow) => {
    const rooted = await offViewFixture();
    const loop = await directFixture((m) => withDirectFieldStage(m, true));
    const network = await topologyFixture();
    try {
      const root = await renderSchematic(await compileCoreFixture(), {
        format: "schematic-view-request/0.2",
        family: "control",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
        flow,
      });
      if (!root.ok) throw Error(JSON.stringify(root.error));
      const rootDoc = parseHTML(root.value.svg).document;
      const css = rootDoc.querySelector("style")!.textContent!;
      const net = css.match(/\.net-path\{[^}]*stroke-width:([\d.]+)/)![1];
      expect(css.match(/\.symbol-body[^}]*stroke-width:([\d.]+)/)![1]).toBe(
        net,
      );
      expect(rootDoc.querySelectorAll(".net-path").length).toBeGreaterThan(0);

      const drawing = await prepareSignalLoopDrawing(
        loop.ir,
        directView({ flow }),
      );
      const loopDoc = parseHTML(drawing.content).document;
      expect(
        loopDoc.querySelectorAll("[data-loop-conductor] path"),
      ).toHaveLength(4);
      for (const p of loopDoc.querySelectorAll("[data-loop-conductor] path"))
        expect(Number(p.getAttribute("stroke-width"))).toBe(0.4);
      // These families land directly on interfaces; there is no separate attachment ray.
      expect(loopDoc.querySelector("[data-terminal-attachment]")).toBeNull();
      expect(
        loopDoc.querySelectorAll("[data-loop-terminal]").length,
      ).toBeGreaterThan(0);

      if (!network.result.ok)
        throw Error(JSON.stringify(network.result.diagnostics));
      // Communication requests are flow-neutral and must keep the same interfaces in either packet flow.
      const comm = parseHTML(
        (
          await prepareCommunicationDrawing(network.result.ir, {
            format: "communication-view-request/0.1",
            medium: "ethernet",
          })
        ).content,
      ).document;
      expect(comm.querySelector("[data-terminal-attachment]")).toBeNull();
      expect(
        comm.querySelectorAll("[data-communication-port]").length,
      ).toBeGreaterThan(0);
      const links = [
        ...comm.querySelectorAll("[data-communication-link] path"),
      ];
      expect(links.length).toBeGreaterThan(0);
      for (const p of links)
        expect(Number(p.getAttribute("stroke-width"))).toBe(0.45);

      const cable = await renderSchematicPacket(rooted.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "schematic-view-request/0.2",
            family: "control",
            root: { by: "designation", value: "CBL1" },
            intent: { kind: "conductors" },
            flow,
          },
        ],
      });
      if (!cable.ok) throw Error(JSON.stringify(cable.error));
      const cores = cable.value.sheets.flatMap((s) => [
        ...parseHTML(s.svg).document.querySelectorAll(
          "[data-cable-uid][data-conductor-id]",
        ),
      ]);
      expect(cores).toHaveLength(4);
      for (const core of cores) {
        expect(core.querySelector("[data-terminal-attachment]")).toBeNull();
        expect(
          Number(core.querySelector("path")!.getAttribute("stroke-width")),
        ).toBe(0.3);
      }
    } finally {
      await Promise.all([rooted.dispose(), loop.dispose(), network.dispose()]);
    }
  },
);
