import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  renderSchematicPacket,
  type SchematicPacketRequest,
} from "../src/sheets.js";
import { prepareCircuitView, type CircuitViewRequest } from "../src/circuit.js";

const root = fileURLToPath(
  new URL("../../../examples/functional-symbols/", import.meta.url),
);
let ir: ElectricalIr;
beforeAll(async () => {
  const result = await compileProject(root);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.diagnostics.filter((d) => d.code === "W904")).toHaveLength(10);
  ir = result.ir;
});
const request = async (flow = "left-to-right") =>
  JSON.parse(
    await readFile(join(root, `packet-${flow}.request.json`), "utf8"),
  ) as SchematicPacketRequest;

describe("functional symbol conveyance", () => {
  it.each(["left-to-right", "top-to-bottom"])(
    "preserves every source endpoint and function in %s",
    async (flow) => {
      const before = JSON.stringify(ir);
      const result = await renderSchematicPacket(ir, await request(flow));
      if (!result.ok) throw new Error(result.error.message);
      const packet = result.value;
      const doc = parseHTML(packet.html).document;
      expect(JSON.stringify(ir)).toBe(before);
      expect(packet.coverage.counts).toEqual({
        conductors: { total: 15, represented: 15, outsideAuditedViews: 0 },
        functions: { total: 15, represented: 15, outsideAuditedViews: 0 },
      });
      expect(packet.coverage.unauditedSheets.length).toBeGreaterThan(0);
      for (const conductor of packet.coverage.conductors) {
        const element = [
          ...doc.querySelectorAll("[data-circuit-conductor]"),
        ].find(
          (e) => e.getAttribute("data-circuit-conductor") === conductor.id,
        )!;
        expect(JSON.parse(element.getAttribute("data-endpoints")!)).toEqual(
          conductor.terminals,
        );
        expect(conductor.appearances).toHaveLength(1);
        expect(
          packet.sheets[conductor.appearances[0]!.sheet - 1]!.svg,
        ).toContain(conductor.id);
      }
      for (const mark of [
        "pressure-no",
        "level-nc",
        "level-sensor",
        "conductivity-probe",
        "receptacle",
        "ac-input",
        "dc-output",
      ])
        expect(
          doc.querySelector(`[data-circuit-mark="${mark}"]`),
        ).not.toBeNull();
      const transformer = doc.querySelector(
        '[data-circuit-group="transformer"] [data-device-uid="' +
          ir.devices.find((d) => d.designation === "T1")!.uid +
          '"]',
      )!;
      expect(
        transformer.querySelectorAll(
          '[data-magnetic-association="shared-core"]',
        ),
      ).toHaveLength(1);
      const windings = [
        ...transformer.querySelectorAll(
          '[data-circuit-mark="winding"] polyline',
        ),
      ];
      expect(windings).toHaveLength(3);
      const pins = [
        ...transformer.querySelectorAll("[data-terminal-id] circle"),
      ];
      expect(pins).toHaveLength(6);
      for (const pin of pins)
        expect(
          windings.some((w) =>
            w
              .getAttribute("points")!
              .includes(`${pin.getAttribute("cx")},${pin.getAttribute("cy")}`),
          ),
        ).toBe(true);
      const core = [
        ...transformer.querySelectorAll("[data-magnetic-association] line"),
      ];
      expect(core).toHaveLength(2);
      expect(
        core[0]!.getAttribute(flow === "left-to-right" ? "x1" : "y1"),
      ).not.toBe(core[1]!.getAttribute(flow === "left-to-right" ? "x1" : "y1"));
      // The series jumper alone joins H2/H3. Neither winding nor magnetic core shorts H1/H4 or X1/X2.
      const uid = ir.devices.find((d) => d.designation === "T1")!.uid;
      const net = (terminalKey: string) =>
        ir.indexes.netIdByTerminal.find(
          (e) => e.key.deviceUid === uid && e.key.terminalKey === terminalKey,
        )!.value;
      expect(net("H2")).toBe(net("H3"));
      expect(net("H1")).not.toBe(net("H4"));
      expect(net("X1")).not.toBe(net("X2"));
      if (flow === "top-to-bottom") {
        for (const block of doc.querySelectorAll("[data-device-uid]")) {
          const caption = [...block.querySelectorAll("text")].find(
            (t) => t.textContent === "BOUNDARY",
          );
          if (!caption) continue;
          const height = Number(block.getAttribute("data-layout-height"));
          expect(
            height - Number(caption.getAttribute("y")),
          ).toBeGreaterThanOrEqual(7);
          for (const pinLabel of block.querySelectorAll(
            "[data-terminal-id] text",
          ))
            expect(
              Math.abs(
                Number(pinLabel.getAttribute("y")) -
                  Number(caption.getAttribute("y")),
              ),
            ).toBeGreaterThanOrEqual(3.5);
        }
      }
      const probe = doc.querySelector(
        '[data-function-key="probe"]',
      )!.parentElement!;
      expect(probe.querySelectorAll("[data-terminal-id]")).toHaveLength(6);
      expect(
        probe.querySelectorAll(
          '[data-function-interface="conductivity-probe"] line',
        ),
      ).toHaveLength(6);
      const levelOutput = [
        ...doc.querySelectorAll('[data-function-key="output"]'),
      ].find(
        (e) =>
          e.parentElement!.getAttribute("data-device-uid") ===
          ir.devices.find((d) => d.designation === "LD1")!.uid,
      )!;
      expect(
        levelOutput.querySelector('[data-circuit-mark="level-sensor"]'),
      ).not.toBeNull();
      expect(
        levelOutput.querySelector('[data-channel-line="address"]')!.textContent,
      ).toBe("OUT");
      expect(
        levelOutput.querySelector('[data-channel-line="signal"]')!.textContent,
      ).toBe("Level detected");
      const connector = doc.querySelector(
        '[data-function-key="connector"]',
      )!.parentElement!;
      expect(connector.querySelectorAll("[data-terminal-id]")).toHaveLength(12);
    },
  );

  it("attaches a shared winding terminal to its actual physical port in both flows", async () => {
    const changed = structuredClone(ir);
    const uid = changed.devices.find((d) => d.designation === "T1")!.uid;
    const secondary = changed.functions.find(
      (f) => f.id.deviceUid === uid && f.id.functionKey === "secondary",
    )!;
    secondary.terminals[1] = { deviceUid: uid, terminalKey: "H2" };
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const drawing = await prepareCircuitView(changed, {
        format: "circuit-view-request/0.1",
        title: "Explicit shared winding terminal",
        flow,
        groups: [
          {
            id: "shared-winding",
            conductors: [],
            functions: ["primary1", "secondary"].map((key) => ({
              device: { by: "uid", value: uid },
              key,
            })),
          },
        ],
      });
      const doc = parseHTML(drawing.groups[0]!.content).document;
      const pins = [...doc.querySelectorAll("[data-terminal-id] circle")];
      expect(pins).toHaveLength(3);
      const common = doc.querySelector('[data-terminal-key="H2"] circle')!;
      const winding = doc.querySelector(
        '[data-function-key="secondary"] polyline',
      )!;
      expect(winding.getAttribute("points")).toContain(
        `${common.getAttribute("cx")},${common.getAttribute("cy")}`,
      );
    }
  });

  it("counts repeated appearances once and reports excluded source entries", async () => {
    const source = await request();
    const circuit = source.views[0] as CircuitViewRequest;
    const narrowed = { ...circuit, groups: [circuit.groups[0]!] };
    const result = await renderSchematicPacket(ir, {
      ...source,
      views: [narrowed, narrowed],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.coverage.counts.conductors).toEqual({
      total: 15,
      represented: 3,
      outsideAuditedViews: 12,
    });
    expect(result.value.coverage.counts.functions).toEqual({
      total: 15,
      represented: 4,
      outsideAuditedViews: 11,
    });
    expect(
      result.value.coverage.conductors
        .filter((c) => c.appearances.length)
        .every((c) => c.appearances.length === 2),
    ).toBe(true);
    expect(
      result.value.coverage.functions
        .filter((f) => f.appearances.length)
        .every((f) => f.appearances.length === 2),
    ).toBe(true);
  });

  it("audits wiring endpoints without counting an interface box as a selected function", async () => {
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "wiring-view-request/0.1",
          title: "Probe wiring",
          conductors: ["W11", "W12"],
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.coverage.counts.conductors.represented).toBe(2);
    expect(result.value.coverage.counts.functions.represented).toBe(0);
    expect(result.value.coverage.unauditedSheets).toEqual([]);
    const doc = parseHTML(result.value.html).document;
    for (const c of result.value.coverage.conductors.filter(
      (c) => c.appearances.length,
    )) {
      const element = [...doc.querySelectorAll("[data-wiring-conductor]")].find(
        (e) => e.getAttribute("data-wiring-conductor") === c.id,
      )!;
      expect(JSON.parse(element.getAttribute("data-endpoints")!)).toEqual(
        c.terminals,
      );
    }
  });

  it("never treats schedules as diagram coverage, and rejects unknown selections", async () => {
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "documentation-view-request/0.1", kind: "wires" }],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.coverage.counts.conductors.represented).toBe(0);
    expect(result.value.coverage.unauditedSheets).toEqual(
      result.value.sheets.map((s) => s.number),
    );
    const source = await request();
    const circuit = source.views[0] as CircuitViewRequest;
    const invalid = await renderSchematicPacket(ir, {
      ...source,
      views: [
        {
          ...circuit,
          groups: [{ ...circuit.groups[0]!, conductors: ["NO-SUCH-WIRE"] }],
        },
      ],
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "R006", message: expect.stringContaining("NO-SUCH-WIRE") },
    });
  });
});
