import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import type { ElectricalIr } from "@thermite/compiler";
import { prepareCircuitView, type CircuitViewRequest } from "../src/circuit.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { circuitMark } from "../src/symbols/circuit.js";
import { compileCoreFixture } from "./fixtures.js";
import {
  controlCircuitView,
  motorCircuitView,
  parallelCircuitFixture,
  jumperChainCircuitFixture,
} from "./circuit-fixture.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});

describe("source-selected circuit views", () => {
  it("keeps external jumper labels beside their own ELK routes and clear of module return wiring", async () => {
    const f = await jumperChainCircuitFixture();
    try {
      const before = JSON.stringify(f.ir);
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const result = await prepareCircuitView(f.ir, { ...f.view, flow });
        const group = result.groups[0]!;
        const doc = parseHTML(group.content).document;
        expect(group.coverage.conductorIds).toHaveLength(6);
        expect(doc.querySelectorAll("[data-wire-label]")).toHaveLength(6);
        for (const wire of f.ir.wires) {
          const path = [
            ...doc.querySelectorAll("[data-circuit-conductor]"),
          ].find((n) => n.getAttribute("data-circuit-conductor") === wire.uid)!;
          expect(JSON.parse(path.getAttribute("data-endpoints")!)).toEqual(
            wire.endpoints.map((endpoint) => endpoint.terminal),
          );
        }
        expect(group.content).toContain("18 AWG / Blue/White");
      }
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  });
  it("distributes only terminal-strip functions and preserves source endpoints in both flows", async () => {
    const tb = ir.devices.find((d) => d.designation === "TB1")!;
    const request: CircuitViewRequest = {
      format: "circuit-view-request/0.1",
      title: "Terminal strip source and destination",
      groups: [
        {
          id: "strip",
          functions: [
            { device: { by: "designation", value: "TB1" }, key: "terminal2" },
            { device: { by: "designation", value: "TB1" }, key: "terminal3" },
            { device: { by: "designation", value: "PLC1" }, key: "di0" },
          ],
          conductors: ["JP1", "W-FLD-001"],
        },
      ],
    };
    const before = JSON.stringify(ir);
    const grouped = await prepareCircuitView(ir, request);
    expect(
      await prepareCircuitView(ir, { ...request, terminalLayout: "grouped" }),
    ).toEqual(grouped);
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const result = await prepareCircuitView(ir, {
        ...request,
        flow,
        terminalLayout: "distributed",
      });
      const group = result.groups[0]!;
      const doc = parseHTML(group.content).document;
      const blocks = [...doc.querySelectorAll(`[data-device-uid="${tb.uid}"]`)];
      expect(blocks).toHaveLength(3);
      const ownership = new Map<string, number>();
      blocks.forEach((block, index) => {
        const terminals = new Set(
          [...block.querySelectorAll("[data-terminal-id]")].map((p) =>
            p.getAttribute("data-terminal-id")!,
          ),
        );
        expect(terminals.size).toBe(1);
        for (const id of terminals) {
          expect(ownership.has(id)).toBe(false);
          ownership.set(id, index);
        }
      });
      expect(group.coverage).toEqual(grouped.groups[0]!.coverage);
      expect(doc.querySelectorAll("[data-circuit-conductor]")).toHaveLength(2);
      expect(
        group.references.filter((r) => r.deviceUid === tb.uid),
      ).toHaveLength(3);
    }
    expect(JSON.stringify(ir)).toBe(before);
    // Mechanical three-pole devices remain grouped; the option has no effect here.
    expect(
      await prepareCircuitView(ir, {
        ...motorCircuitView(),
        terminalLayout: "distributed",
      }),
    ).toEqual(await prepareCircuitView(ir, motorCircuitView()));
  });

  it("rejects distributing aliases of one physical terminal into separate nodes", async () => {
    const changed = structuredClone(ir);
    const tb = changed.devices.find((d) => d.designation === "TB1")!;
    const first = changed.functions.find(
      (f) => f.id.deviceUid === tb.uid && f.id.functionKey === "terminal1",
    )!;
    const second = changed.functions.find(
      (f) => f.id.deviceUid === tb.uid && f.id.functionKey === "terminal2",
    )!;
    Object.assign(second, { terminals: first.terminals });
    await expect(
      prepareCircuitView(changed, {
        format: "circuit-view-request/0.1",
        title: "Shared physical terminal",
        terminalLayout: "distributed",
        groups: [
          {
            id: "aliases",
            conductors: [],
            functions: ["terminal1", "terminal2"].map((key) => ({
              device: { by: "designation" as const, value: "TB1" },
              key,
            })),
          },
        ],
      }),
    ).rejects.toThrow("functions sharing physical terminal TB1.1");
  });

  it("retains every selected physical wire and function while leaving IR/net membership unchanged", async () => {
    const before = JSON.stringify(ir),
      result = await prepareCircuitView(ir, motorCircuitView());
    expect(JSON.stringify(ir)).toBe(before);
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0]!;
    expect(group.coverage.conductorIds).toHaveLength(13);
    expect(group.coverage.functionIds).toHaveLength(11);
    expect(group.content.match(/data-circuit-conductor=/gu) ?? []).toHaveLength(
      13,
    );
    expect(group.content.match(/data-function-id=/gu) ?? []).toHaveLength(11);
    expect(group.content).toContain('data-circuit-mark="motor"');
    expect(group.content).toContain('data-circuit-mark="earth"');
    for (const id of group.coverage.conductorIds)
      expect(ir.wires.some((w) => w.uid === id)).toBe(true);
  });

  it("shows exact source wire labels and source-backed outside-view endpoints", async () => {
    const result = await prepareCircuitView(ir, controlCircuitView());
    const group = result.groups[0]!;
    expect(group.coverage.boundaryTerminalIds.length).toBeGreaterThan(0);
    for (const name of controlCircuitView().groups[0]!.conductors) {
      const wire = ir.wires.find((w) => w.designation === name)!;
      expect(group.content).toContain(
        wire.properties?.label ?? wire.designation,
      );
      expect(group.content).toContain(wire.uid);
    }
    expect(group.content).toContain("BOUNDARY");
  });

  it("prints authored conductor size and color at readable scale in measured labels", async () => {
    const request = controlCircuitView();
    const changed = structuredClone(ir);
    const first = changed.wires.find(
      (w) => w.designation === request.groups[0]!.conductors[0],
    )!;
    Object.assign(first, {
      properties: { label: "3100", size: "18 AWG", color: "Brown" },
    });
    const second = changed.wires.find(
      (w) => w.designation === request.groups[0]!.conductors[1],
    )!;
    Object.assign(second, { properties: { label: "3101" } });
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const result = await renderSchematicPacket(changed, {
        format: "schematic-packet-request/0.1",
        page: {
          size: "tabloid",
          orientation: flow === "left-to-right" ? "landscape" : "portrait",
        },
        views: [{ ...request, flow }],
      });
      if (!result.ok) throw new Error(result.error.message);
      expect(result.ok).toBe(true);
      const doc = parseHTML(result.value.sheets[0]!.svg).document;
      const label = (id: string) =>
        [...doc.querySelectorAll("[data-wire-label]")].find(
          (g) => g.getAttribute("data-wire-label") === id,
        )!;
      const text = [...label(first.uid).querySelectorAll("text")];
      expect(text.map((t) => t.textContent)).toEqual([
        "3100",
        "18 AWG / Brown",
      ]);
      expect(
        [...label(second.uid).querySelectorAll("text")].map(
          (t) => t.textContent,
        ),
      ).toEqual(["3101"]);
      for (const t of doc.querySelectorAll(
        "[data-wire-label] text, [data-terminal-id] text, [data-function-key=do0] text",
      ))
        expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(2.5);
      const rect = label(first.uid).querySelector("rect")!;
      const bottom =
        Number(rect.getAttribute("y")) + Number(rect.getAttribute("height"));
      expect(Number(text.at(-1)!.getAttribute("y"))).toBeLessThan(bottom);
      expect(Number(rect.getAttribute("height"))).toBeGreaterThan(6);
      expect(label(first.uid).getAttribute("data-wire-label")).toBe(first.uid);
    }
  });

  it("resolves coil/contact appearances across distinct views and packs complete groups", async () => {
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [motorCircuitView(), controlCircuitView()],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.sheets[0]!.svg).toContain("coil: 200");
    expect(result.value.sheets[1]!.svg).toContain("3 functions: 100");
    expect(
      result.value.sheets
        .flatMap((s) => s.references)
        .filter((r) => r.designation === "K1")
        .map((r) => r.deviceUid),
    ).toEqual([
      ir.devices.find((d) => d.designation === "K1")!.uid,
      ir.devices.find((d) => d.designation === "K1")!.uid,
    ]);
  });

  it("packs multiple wide groups vertically instead of allocating one page per circuit", async () => {
    const base = motorCircuitView();
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          ...base,
          columns: 2,
          groups: [
            { ...base.groups[0]!, id: "power-a" },
            { ...base.groups[0]!, id: "power-b" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.sheets).toHaveLength(1);
    expect(result.value.sheets[0]!.svg).toContain(
      'data-circuit-group="power-a"',
    );
    expect(result.value.sheets[0]!.svg).toContain(
      'data-circuit-group="power-b"',
    );
  });

  it("renders declared spare/unconnected channels without inventing field wires", async () => {
    const view: CircuitViewRequest = {
      format: "circuit-view-request/0.1",
      title: "Spare channel",
      groups: [
        {
          id: "spare",
          functions: [
            { device: { by: "designation", value: "PLC1" }, key: "di1" },
          ],
          conductors: [],
        },
      ],
    };
    const result = await prepareCircuitView(ir, view);
    expect(result.groups[0]!.coverage.conductorIds).toEqual([]);
    expect(result.groups[0]!.coverage.functionIds).toHaveLength(1);
    expect(result.groups[0]!.content).toContain(
      'fill="white" stroke="#17212b"',
    );
  });

  it("is deterministic in either flow", async () => {
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const request = { ...controlCircuitView(), flow };
      expect(await prepareCircuitView(ir, request)).toEqual(
        await prepareCircuitView(ir, request),
      );
    }
  });

  it("rejects duplicate/unknown source selectors and contradictory normal-state glyph overrides", async () => {
    const base = controlCircuitView(),
      g = base.groups[0]!;
    await expect(
      prepareCircuitView(ir, {
        ...base,
        groups: [{ ...g, conductors: [...g.conductors, g.conductors[0]!] }],
      }),
    ).rejects.toThrow("repeats a conductor");
    await expect(
      prepareCircuitView(ir, {
        ...base,
        groups: [{ ...g, conductors: ["not-a-wire"] }],
      }),
    ).rejects.toThrow("does not resolve uniquely");
    await expect(
      prepareCircuitView(ir, {
        ...base,
        groups: [
          {
            ...g,
            functions: [
              {
                device: { by: "designation", value: "K1" },
                key: "not-a-function",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("not a declared device function");
    const f = ir.functions.find(
      (f) =>
        f.id.deviceUid === ir.devices.find((d) => d.designation === "PB1")!.uid,
    )!;
    const type = structuredClone(
      ir.deviceTypes.find((t) => t.id === "core:pushbutton-nc")!,
    );
    Object.assign(type, { circuitSymbols: { contact11: "contact-no" } });
    expect(() => circuitMark(type, f)).toThrow("incompatible");
  });

  it("preserves seal-in parallel wires, shared changeover COM and an external same-device wire", async () => {
    const fixture = await parallelCircuitFixture();
    try {
      const before = JSON.stringify(fixture.ir.nets);
      const result = await prepareCircuitView(fixture.ir, fixture.view);
      expect(result.groups[0]!.coverage.conductorIds).toHaveLength(7);
      expect(result.groups[0]!.coverage.functionIds).toHaveLength(5);
      expect(result.groups[0]!.content).toContain(
        'data-circuit-junction="true"',
      );
      expect(fixture.ir.nets).toHaveLength(4);
      expect(JSON.stringify(fixture.ir.nets)).toBe(before);
      const k = fixture.ir.devices.find((d) => d.designation === "K1")!.uid;
      const net = (t: string) =>
        fixture.ir.indexes.netIdByTerminal.find(
          (e) => e.key.deviceUid === k && e.key.terminalKey === t,
        )!.value;
      expect(net("11")).not.toBe(net("14"));
      expect(net("11")).not.toBe(net("12"));
      expect(net("A1")).not.toBe(net("A2"));
      expect(result.groups[0]!.content).toContain("data-terminal-attachment");
    } finally {
      await fixture.dispose();
    }
  });

  it("attaches shared commons to their actual pin in either flow and either terminal order", async () => {
    for (const reverse of [false, true]) {
      const fixture = await parallelCircuitFixture(reverse);
      try {
        for (const flow of ["left-to-right", "top-to-bottom"] as const) {
          const view: CircuitViewRequest = {
            ...fixture.view,
            flow,
            groups: [
              {
                id: "common",
                conductors: [],
                functions: [
                  { device: { by: "designation", value: "K1" }, key: "no" },
                  { device: { by: "designation", value: "K1" }, key: "nc" },
                ],
              },
            ],
          };
          const r = await prepareCircuitView(fixture.ir, view),
            doc = parseHTML(r.groups[0]!.content).document;
          const attachments = [
            ...doc.querySelectorAll("[data-terminal-attachment]"),
          ];
          expect(attachments).toHaveLength(4);
          for (const attachment of attachments) {
            const id = attachment.getAttribute("data-terminal-attachment"),
              from = JSON.parse(
                attachment.getAttribute("data-attachment-from")!,
              );
            const pins = [...doc.querySelectorAll("[data-terminal-id]")]
              .filter((p) => p.getAttribute("data-terminal-id") === id)
              .map((p) => p.querySelector("circle")!);
            expect(
              pins.some(
                (p) =>
                  Math.abs(Number(p.getAttribute("cx")) - from.x) < 0.001 &&
                  Math.abs(Number(p.getAttribute("cy")) - from.y) < 0.001,
              ),
            ).toBe(true);
          }
        }
      } finally {
        await fixture.dispose();
      }
    }
  });

  it("draws only selected actual ganging members and never sweeps an unrelated coil", async () => {
    const view = (keys: string[]): CircuitViewRequest => ({
      format: "circuit-view-request/0.1",
      title: "Ganging",
      groups: [
        {
          id: "gang",
          conductors: [],
          functions: keys.map((key) => ({
            device: { by: "designation", value: "K1" },
            key,
          })),
        },
      ],
    });
    for (const keys of [
      ["pole1", "coil"],
      ["pole1", "coil", "pole2"],
    ])
      expect(
        (await prepareCircuitView(ir, view(keys))).groups[0]!.content,
      ).not.toContain('data-mechanical-association="ganged"');
    const r = await prepareCircuitView(ir, view(["pole1", "pole2", "coil"]));
    const lines = parseHTML(r.groups[0]!.content).document.querySelectorAll(
      "[data-ganged-functions]",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.getAttribute("data-ganged-functions")).not.toContain(
      "coil",
    );
  });

  it("reserves horizontal address extent in vertical channel blocks and rejects oversized labels", async () => {
    const modified = structuredClone(ir),
      plc = modified.devices.find((d) => d.designation === "PLC1")!;
    plc.io = {
      addressSpace: "PLC1",
      channels: { di1: { address: "M".repeat(20) } },
    };
    const view: CircuitViewRequest = {
      format: "circuit-view-request/0.1",
      title: "Vertical IO",
      flow: "top-to-bottom",
      groups: [
        {
          id: "io",
          conductors: [],
          functions: [
            { device: { by: "designation", value: "PLC1" }, key: "di1" },
          ],
        },
      ],
    };
    const result = await prepareCircuitView(modified, view),
      doc = parseHTML(result.groups[0]!.content).document;
    const node = doc.querySelector("[data-device-uid]")!,
      label = [...node.querySelectorAll("text")].find(
        (t) => t.textContent === "M".repeat(20),
      )!;
    expect(Number(label.getAttribute("x")) - 23).toBeGreaterThanOrEqual(0);
    expect(Number(label.getAttribute("x")) + 23).toBeLessThanOrEqual(
      Number(node.getAttribute("data-layout-width")),
    );
    plc.io.channels.di1!.address = "M".repeat(100);
    await expect(prepareCircuitView(modified, view)).rejects.toThrow(
      "readable block width",
    );
  });

  it("spaces long vertical contact terminal labels on each baseline without overlap", async () => {
    const modified = structuredClone(ir),
      uid = modified.devices.find((d) => d.designation === "K1")!.uid;
    for (const [functionKey, prefix] of [
      ["pole1", "TRIP.NO"],
      ["pole2", "TRIP.NC"],
    ]) {
      const f = modified.functions.find(
        (f) => f.id.deviceUid === uid && f.id.functionKey === functionKey,
      )!;
      Object.assign(f, {
        terminals: ["IN", "OUT"].map((suffix) => ({
          deviceUid: uid,
          terminalKey: `${prefix}.${suffix}`,
        })),
      });
    }
    const result = await prepareCircuitView(modified, {
      format: "circuit-view-request/0.1",
      title: "Vertical contacts",
      flow: "top-to-bottom",
      groups: [
        {
          id: "contacts",
          conductors: [],
          functions: ["pole1", "pole2"].map((key) => ({
            device: { by: "designation", value: "K1" },
            key,
          })),
        },
      ],
    });
    const doc = parseHTML(result.groups[0]!.content).document;
    const labels = [...doc.querySelectorAll("[data-terminal-id] text")];
    expect(labels).toHaveLength(4);
    for (const suffix of ["IN", "OUT"]) {
      const row = labels.filter((t) => t.textContent!.endsWith(suffix));
      expect(row[0]!.getAttribute("y")).toBe(row[1]!.getAttribute("y"));
      expect(
        Math.abs(
          Number(row[0]!.getAttribute("x")) - Number(row[1]!.getAttribute("x")),
        ),
      ).toBeGreaterThanOrEqual(17);
    }
    for (const attachment of doc.querySelectorAll(
      "[data-terminal-attachment]",
    )) {
      const from = JSON.parse(attachment.getAttribute("data-attachment-from")!);
      expect(
        [...doc.querySelectorAll("[data-terminal-id] circle")].some(
          (p) =>
            Math.abs(Number(p.getAttribute("cx")) - from.x) < 0.001 &&
            Math.abs(Number(p.getAttribute("cy")) - from.y) < 0.001,
        ),
      ).toBe(true);
    }
  });

  it("prints complete authored channel meanings and measures wrapped rows in both flows", async () => {
    const modified = structuredClone(ir),
      plc = modified.devices.find((d) => d.designation === "PLC1")!;
    const signal =
      "Hydraulic pump pressure permissive is satisfied before platen motion is enabled";
    plc.io = {
      addressSpace: "PLC1",
      channels: {
        di0: { address: "I0.0", signal },
        di1: { address: "I0.1", signal: "M".repeat(300), usage: "spare" },
      },
    };
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const result = await prepareCircuitView(modified, {
        format: "circuit-view-request/0.1",
        title: "Channel meanings",
        flow,
        groups: [
          {
            id: "channels",
            conductors: [],
            functions: ["di0", "di1"].map((key) => ({
              device: { by: "designation", value: "PLC1" },
              key,
            })),
          },
        ],
      });
      const doc = parseHTML(result.groups[0]!.content).document;
      const node = doc.querySelector("[data-device-uid]")!;
      const rows = [...node.querySelectorAll("[data-function-key]")];
      expect(rows).toHaveLength(2);
      const signals = rows.map((row) => [
        ...row.querySelectorAll('[data-channel-line="signal"] text'),
      ]);
      expect(signals[0]!.map((t) => t.textContent).join(" ")).toBe(signal);
      expect(signals[1]!.map((t) => t.textContent).join("")).toBe(
        "M".repeat(300),
      );
      expect(
        rows[0]!.querySelector('[data-channel-line="address"]')!.textContent,
      ).toBe("I0.0");
      expect(
        rows[1]!.querySelector('[data-channel-line="address"]')!.textContent,
      ).toBe("I0.1 SPARE");
      for (const texts of signals) {
        expect(texts.length).toBeGreaterThan(1);
        for (const t of texts) {
          expect(Number(t.getAttribute("font-size"))).toBe(2.5);
          expect(Number(t.getAttribute("x"))).toBeGreaterThan(0);
          expect(Number(t.getAttribute("x"))).toBeLessThan(
            Number(node.getAttribute("data-layout-width")),
          );
          expect(Number(t.getAttribute("y")) - 2.5).toBeGreaterThan(3.3);
          expect(Number(t.getAttribute("y"))).toBeLessThan(
            Number(node.getAttribute("data-layout-height")),
          );
        }
      }
      if (flow === "top-to-bottom") {
        const centers = signals.map((texts) =>
          Number(texts[0]!.getAttribute("x")),
        );
        expect(Math.abs(centers[0]! - centers[1]!)).toBeGreaterThanOrEqual(38);
      }
    }
  });

  it("connects vertical winding marks to both declared ports", async () => {
    const modified = structuredClone(ir),
      type = modified.deviceTypes.find((t) => t.id === "core:psu-24vdc")!;
    type.circuitSymbols = { dc_output: "winding" };
    const result = await prepareCircuitView(modified, {
      format: "circuit-view-request/0.1",
      title: "Winding",
      flow: "top-to-bottom",
      groups: [
        {
          id: "winding",
          conductors: [],
          functions: [
            { device: { by: "designation", value: "PS1" }, key: "dc_output" },
          ],
        },
      ],
    });
    const doc = parseHTML(result.groups[0]!.content).document,
      points = doc
        .querySelector('[data-circuit-mark="winding"] polyline')!
        .getAttribute("points")!;
    const pins = [...doc.querySelectorAll("[data-terminal-id] circle")];
    expect(pins).toHaveLength(2);
    for (const pin of pins)
      expect(points).toContain(
        `${pin.getAttribute("cx")},${pin.getAttribute("cy")}`,
      );
  });

  it("wraps long titles in both header and title block instead of overflowing paper", async () => {
    const title = "W".repeat(120);
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "letter", orientation: "landscape" },
      views: [
        {
          format: "circuit-view-request/0.1",
          title,
          groups: [
            {
              id: "io",
              conductors: [],
              functions: [
                { device: { by: "designation", value: "PLC1" }, key: "di1" },
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const texts = [
      ...parseHTML(result.value.sheets[0]!.svg).document.querySelectorAll(
        "text",
      ),
    ]
      .map((t) => t.textContent)
      .filter((t) => /^W+$/u.test(t));
    expect(texts.length).toBeGreaterThan(2);
    expect(Math.max(...texts.map((t) => t.length))).toBeLessThan(120);
  });
});
