import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import type { ElectricalIr } from "@thermite/compiler";
import { prepareCircuitView, circuitTextLines } from "../src/circuit.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { renderSchematic } from "../src/renderer.js";
import { compileCoreFixture, pnpTraceFixture } from "./fixtures.js";
import { motorCircuitView, controlCircuitView } from "./circuit-fixture.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
const texts = (svg: string) =>
  [...parseHTML(svg).document.querySelectorAll("text")].map(
    (e) => e.textContent,
  );

describe("printable function facts", () => {
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    it(`retains PNP output type in the supplied-load view in ${flow}`, async () => {
      const result = await renderSchematic(pnpTraceFixture(ir), {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
        flow,
      });
      if (!result.ok) throw new Error(result.error.message);
      expect(texts(result.value.svg)).toContain("PNP");
    });
    it(`wraps eight coil-operated contact references instead of refusing the packet in ${flow}`, async () => {
      const changed = structuredClone(ir),
        uid = changed.devices.find((d) => d.designation === "K1")!.uid;
      const base = changed.functions.find(
        (f) => f.id.deviceUid === uid && f.id.functionKey === "pole1",
      )!;
      const keys = Array.from({ length: 8 }, (_, i) => `extra${i}`);
      for (const key of keys) {
        changed.functions.push({
          ...structuredClone(base),
          id: { deviceUid: uid, functionKey: key },
        });
        changed.internalRelations.push({
          deviceUid: uid,
          verb: "actuates",
          from: { deviceUid: uid, functionKey: "coil" },
          to: { deviceUid: uid, functionKey: key },
          sourceOrigins: [],
        });
      }
      const extra = {
        format: "circuit-view-request/0.1" as const,
        title: "Extra contacts",
        flow,
        groups: [
          {
            id: "extra",
            lineReference: "300",
            functions: keys.map((key) => ({
              device: { by: "designation" as const, value: "K1" },
              key,
            })),
            conductors: [],
          },
        ],
      };
      const result = await renderSchematicPacket(changed, {
        format: "schematic-packet-request/0.1",
        views: [
          { ...motorCircuitView(), flow },
          { ...controlCircuitView(), flow },
          extra,
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      const coil = parseHTML(result.value.html)
        .document.querySelector('[data-function-key="coil"]')!
        .closest("[data-device-uid]")!;
      const labels = [...coil.querySelectorAll('text[font-size="2.3"]')].map(
        (t) => t.textContent!,
      );
      expect(labels.join(" ")).toContain("300");
      expect(
        labels.filter((s) => s.includes("1/L1-2/T1")).length,
      ).toBeGreaterThan(1);
      for (const label of labels)
        expect(
          circuitTextLines(
            label,
            Number(coil.getAttribute("data-circuit-body-width")) - 4 + 0.001,
            2.3,
          ),
        ).toEqual([label]);
      expect(
        Number(coil.getAttribute("data-circuit-body-width")),
      ).toBeLessThanOrEqual(100);
      // Exercise the bounded semantic-summary fallback without a huge drawn
      // contact bank obscuring what this regression is checking.
      for (let i = 8; i < 40; i++) {
        const key = `extra${i}`;
        changed.functions.push({
          ...structuredClone(base),
          id: { deviceUid: uid, functionKey: key },
        });
        changed.internalRelations.push({
          deviceUid: uid,
          verb: "actuates",
          from: { deviceUid: uid, functionKey: "coil" },
          to: { deviceUid: uid, functionKey: key },
          sourceOrigins: [],
        });
        keys.push(key);
      }
      const appearances = new Map(
        keys.map((key) => [JSON.stringify([uid, key]), ["300"]]),
      );
      const summarized = await prepareCircuitView(
        changed,
        { ...controlCircuitView(), flow },
        appearances,
      );
      expect(texts(summarized.groups[0]!.content)).toContain(
        "40 contacts: 300",
      );
    });
    it(`retains channel direction, spare status, and authored meanings in ${flow}`, async () => {
      const changed = structuredClone(ir);
      changed.devices.find((d) => d.designation === "PLC1")!.io = {
        channels: { di1: { usage: "spare" } },
      };
      const result = await prepareCircuitView(changed, {
        format: "circuit-view-request/0.1",
        title: "I/O",
        flow,
        groups: [
          {
            id: "io",
            functions: ["di0", "do0", "di1"].map((key) => ({
              device: { by: "designation", value: "PLC1" },
              key,
            })),
            conductors: [],
          },
        ],
      });
      const printed = texts(result.groups[0]!.content);
      expect(printed).toContain("DI");
      expect(printed).toContain("DO");
      expect(printed).toContain("DI SPARE");
      expect(printed).not.toContain("di0");
      expect(printed).not.toContain("do0");
      expect(printed).not.toContain("di1");
    });
    it(`keeps rooted NC, NO, coil and DO words in ${flow}`, async () => {
      const result = await renderSchematic(ir, {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
        flow,
      });
      if (!result.ok) throw new Error(result.error.message);
      expect(texts(result.value.svg)).toEqual(
        expect.arrayContaining(["NC", "coil", "DO"]),
      );
      expect(texts(result.value.svg)).not.toContain("contact11 NC");
      const trace = await renderSchematic(ir, {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: true,
        },
        flow,
      });
      if (!trace.ok) throw new Error(trace.error.message);
      expect(texts(trace.value.svg)).toEqual(
        expect.arrayContaining(["NO", "DI"]),
      );
    });
    it(`prints AI from the terminal role in both renderer families in ${flow}`, async () => {
      const changed = structuredClone(ir);
      const plc = changed.devices.find((d) => d.designation === "PLC1")!;
      const f = changed.functions.find(
        (f) => f.id.deviceUid === plc.uid && f.id.functionKey === "di0",
      )!;
      changed.deviceTypes
        .find((t) => t.id === plc.typeId)!
        .terminals.find((t) => t.key === f.terminals[0]!.terminalKey)!.role =
        "analog_input";
      const circuit = await prepareCircuitView(changed, {
        format: "circuit-view-request/0.1",
        title: "Analog input",
        flow,
        groups: [
          {
            id: "ai",
            functions: [
              { device: { by: "designation", value: "PLC1" }, key: "di0" },
            ],
            conductors: [],
          },
        ],
      });
      expect(texts(circuit.groups[0]!.content)).toContain("AI");
      expect(texts(circuit.groups[0]!.content)).not.toContain("DI");
      const rooted = await renderSchematic(changed, {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: true,
        },
        flow,
      });
      if (!rooted.ok) throw new Error(rooted.error.message);
      expect(texts(rooted.value.svg)).toContain("AI");
      expect(texts(rooted.value.svg)).not.toContain("DI");
    });
    it(`uses neutral direction in rooted and circuit captions when class is undeclared in ${flow}`, async () => {
      const changed = structuredClone(ir);
      const plc = changed.devices.find((d) => d.designation === "PLC1")!;
      const type = changed.deviceTypes.find((t) => t.id === plc.typeId)!;
      delete plc.io;
      type.description = "AI AO DI DO in free prose is not a class declaration";
      for (const fn of changed.functions.filter(
        (f) =>
          f.id.deviceUid === plc.uid &&
          ["di0", "do0"].includes(f.id.functionKey),
      ))
        for (const t of fn.terminals)
          delete type.terminals.find((p) => p.key === t.terminalKey)!.role;
      const before = JSON.stringify(changed);
      const circuit = await prepareCircuitView(changed, {
        format: "circuit-view-request/0.1",
        title: "Unclassified channels",
        flow,
        groups: [
          {
            id: "unknown",
            functions: ["di0", "do0"].map((key) => ({
              device: { by: "designation", value: "PLC1" },
              key,
            })),
            conductors: [],
          },
        ],
      });
      expect(texts(circuit.groups[0]!.content)).toEqual(
        expect.arrayContaining(["IN", "OUT"]),
      );
      for (const [root, expected] of [
        ["K1", "OUT"],
        ["LS1", "IN"],
      ] as const) {
        const result = await renderSchematic(
          changed,
          root === "K1"
            ? {
                format: "schematic-view-request/0.1",
                root: { by: "designation", value: root },
                family: "control",
                flow,
              }
            : {
                format: "schematic-view-request/0.2",
                root: { by: "designation", value: root },
                intent: {
                  kind: "trace",
                  to: { by: "designation", value: "PLC1" },
                  includePower: true,
                },
                flow,
              },
        );
        if (!result.ok) throw Error(result.error.message);
        expect(texts(result.value.svg)).toContain(expected);
        expect(texts(result.value.svg)).not.toContain("DI");
        expect(texts(result.value.svg)).not.toContain("DO");
      }
      expect(JSON.stringify(changed)).toBe(before);
    });
    it(`names related functions at two destinations in ${flow}`, async () => {
      const feedback = {
        format: "circuit-view-request/0.1" as const,
        title: "Feedback",
        flow,
        groups: [
          {
            id: "feedback",
            lineReference: "300",
            functions: [
              {
                device: { by: "designation" as const, value: "K1" },
                key: "aux13",
              },
            ],
            conductors: [],
          },
        ],
      };
      const result = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        views: [
          { ...motorCircuitView(), flow },
          { ...controlCircuitView(), flow },
          feedback,
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      const coil = parseHTML(result.value.html)
        .document.querySelector('[data-function-key="coil"]')!
        .closest("[data-device-uid]")!;
      const printed = [...coil.querySelectorAll("text")].map(
        (e) => e.textContent,
      );
      expect(printed).toContain("13-14: 300");
      expect(printed).toContain("1/L1-2/T1, 3/L2-4/T2, 5/L3-6/T3: 100");
      expect(printed).not.toContain("300");
      expect(printed).not.toContain("aux13: 300");
      if (flow === "top-to-bottom") {
        const plain = await prepareCircuitView(ir, {
          ...controlCircuitView(),
          flow,
        });
        const plainNode = parseHTML(plain.groups[0]!.content)
          .document.querySelector('[data-function-key="coil"]')!
          .closest("[data-device-uid]")!;
        const references = new Map(
          ir.functions
            .filter(
              (f) =>
                f.id.deviceUid ===
                  ir.devices.find((d) => d.designation === "K1")!.uid &&
                f.kind === "contact",
            )
            .map((f) => [
              JSON.stringify([f.id.deviceUid, f.id.functionKey]),
              [f.id.functionKey === "aux13" ? "300" : "100"],
            ]),
        );
        const annotated = await prepareCircuitView(
          ir,
          { ...controlCircuitView(), flow },
          references,
        );
        const annotatedNode = parseHTML(annotated.groups[0]!.content)
          .document.querySelector('[data-function-key="coil"]')!
          .closest("[data-device-uid]")!;
        const footer = 2 * 3.1 + 5;
        expect(
          Number(annotatedNode.getAttribute("data-circuit-body-height")) -
            Number(plainNode.getAttribute("data-circuit-body-height")),
        ).toBeCloseTo(footer, 2);
        const designation = coil.querySelector(
          'g[data-tag-kind="body"] > text[data-tag-field="designation"]',
        )!;
        expect(designation.textContent).toBe("K1");
        expect(Number(designation.getAttribute("x"))).toBeGreaterThan(
          Number(coil.getAttribute("data-circuit-body-width")),
        );
        expect(designation.getAttribute("text-anchor")).toBe("start");
      }
      const available =
        Number(coil.getAttribute("data-layout-width")) - 4 + 0.001;
      for (const label of coil.querySelectorAll('text[font-size="2.3"]')) {
        expect(circuitTextLines(label.textContent!, available, 2.3)).toEqual([
          label.textContent,
        ]);
      }
    });
  }
});
