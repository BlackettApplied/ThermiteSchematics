import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileCoreFixture, materializeTypeFunctions } from "./fixtures.js";
import { circuitMark, emitCircuitMark } from "../src/symbols/circuit.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { printableCaption } from "../src/symbols/printable-policy.js";
import {
  printableTextMetrics,
  printableSlotWidth,
  boundedPrintableAdvance,
} from "../src/symbols/printable-font.js";
import { prepareCircuitView } from "../src/circuit.js";
import { contractProject } from "./rooted-profile-contracts.js";
import { renderSchematic } from "../src/renderer.js";

it.each(["W", "M", "I", "-"])(
  "prints %s without stretching or compressing a single glyph",
  (text) => {
    const m = printableTextMetrics(text),
      width = printableSlotWidth(text, 12);
    expect(
      boundedPrintableAdvance(text, 10, width - 6) / m.advance,
    ).toBeCloseTo(1, 3);
  },
);
it("limits multi-glyph compression to 9% and widens reservations when needed", () => {
  const text = "WWWWWW",
    m = printableTextMetrics(text),
    slot = printableSlotWidth(text, 12);
  expect(slot).toBeGreaterThan(12);
  expect(
    boundedPrintableAdvance(text, 10, slot - 6) / m.advance,
  ).toBeGreaterThanOrEqual(0.91);
  expect(() => boundedPrintableAdvance(text, 10, m.advance * 0.905)).toThrow(
    "too narrow",
  );
});
it.each(["left-to-right", "top-to-bottom"] as const)(
  "draws breaker power and auxiliary functions in both families in %s",
  async (flow) => {
    const ir = await compileCoreFixture();
    const type = structuredClone(
      ir.deviceTypes.find((t) => t.id === "core:breaker-3p")!,
    );
    const base = type.functions.find((f) => f.kind === "contact")!;
    type.id = "local:breaker-with-aux";
    type.symbol = "thermite:breaker";
    delete type.circuitSymbols;
    type.terminals = [
      ...Array.from({ length: 4 }, (_, i) => ({
        ...type.terminals[0]!,
        key: String(i + 1),
        role: i % 2 ? "power_output" : "power_input",
      })),
      ...["13", "14", "21", "22"].map((key) => ({
        ...type.terminals[0]!,
        key,
        role: "aux",
      })),
    ];
    type.functions = [
      ...[
        ["pole1", "1", "2", "closed"],
        ["pole2", "3", "4", "closed"],
        ["openAux", "13", "14", "open"],
        ["closedAux", "21", "22", "closed"],
      ].map(([key, a, b, state]) => ({
        ...base,
        key: key!,
        terminalKeys: [a!, b!],
        kind: "contact" as const,
        normal_state: state as "open" | "closed",
      })),
    ];
    const functions = materializeTypeFunctions(type, "QX");
    const mappings = projectDeviceTypeSymbolMappings({
      ...ir,
      deviceTypes: [type],
    })[0]!;
    for (const [i, fn] of functions.entries()) {
      const mark = circuitMark(type, fn),
        root = mappings.functions.find(
          (f) => f.functionKey === fn.id.functionKey,
        )!;
      expect(mark).toBe(["breaker", "breaker", "contact-no", "contact-nc"][i]);
      expect(root.symbolId).toBe(
        [
          "ais:breaker-pole",
          "ais:breaker-pole",
          "ais:contact-no",
          "ais:contact-nc",
        ][i],
      );
      for (const id of [root.symbolId, `circuit:${mark}`] as const)
        expect(printableCaption({ kind: "function", type, fn, mark: id })).toBe(
          i < 2 ? "" : i === 2 ? "NO" : "NC",
        );
    }
    // Explicit per-function binding overrides role-based defaults in both paths.
    type.circuitSymbols = { pole1: "contact-nc", closedAux: "breaker" };
    const overridden = projectDeviceTypeSymbolMappings({
      ...ir,
      deviceTypes: [type],
    })[0]!;
    expect(circuitMark(type, functions[0]!)).toBe("contact-nc");
    expect(circuitMark(type, functions[3]!)).toBe("breaker");
    expect(
      overridden.functions.find((f) => f.functionKey === "pole1")!.symbolId,
    ).toBe("ais:contact-nc");
    expect(
      overridden.functions.find((f) => f.functionKey === "closedAux")!.symbolId,
    ).toBe("ais:breaker-pole");
    // Exercise full rooted SVG delivery of unqualified NO/NC auxiliary contacts.
    for (const [mode, mark] of [
      ["contact-open", "contact-no"],
      ["contact-closed", "contact-nc"],
      ["power-closed", "breaker-pole"],
    ] as const) {
      const fixture = await contractProject("thermite:breaker", mode, "power");
      try {
        const r = await renderSchematic(fixture.ir, {
          ...(fixture.request as object),
          flow,
        });
        if (!r.ok) throw Error(JSON.stringify(r));
        expect(r.value.svg).toContain(`data-symbol-id="ais:${mark}"`);
        const c = await prepareCircuitView(fixture.ir, {
          format: "circuit-view-request/0.1",
          title: "Breaker aux",
          flow,
          groups: [
            {
              id: "breaker",
              functions: [
                {
                  device: { by: "designation", value: "DUT" },
                  key: "function",
                },
              ],
              conductors: [],
            },
          ],
        });
        expect(c.groups[0]!.content).toContain(
          `data-circuit-mark="${mark === "breaker-pole" ? "breaker" : mark}"`,
        );
        if (mark !== "breaker-pole")
          expect(c.groups[0]!.content).toContain(
            `>${mark === "contact-no" ? "NO" : "NC"}</text>`,
          );
      } finally {
        await fixture.dispose();
      }
    }
  },
);
it("pins circuit geometry of each operator, independently of its selected ID", () => {
  const geometry = (mark: Parameters<typeof emitCircuitMark>[0]) =>
    parseHTML(emitCircuitMark(mark)).document.querySelector("g")!.innerHTML;
  // These independent head coordinates also enforce the print-size enlargement.
  const stop = geometry("estop-nc"),
    push = geometry("pushbutton-nc"),
    selector = geometry("selector-no"),
    limit = geometry("switch-no");
  expect(new Set([stop, push, selector, limit]).size).toBe(4);
  expect(stop).toContain('points="1.5,2.85 1.5,1.95 3.3,1.05');
  expect(stop).toContain('points="6.9,3.3 8.7,3.3 8.7,4.65"');
  expect(push).not.toContain("<polyline");
  expect(selector).toContain('x1="4.65" y1="4.2" x2="7.35" y2="1.95"');
  expect(limit).not.toContain("<polyline");
  expect(stop).toContain("10.5,1.95"); // 6 mm wide head after final 2/3 placement scale.
  expect(push).toContain('x1="3.3" y1="1.5" x2="8.7" y2="1.5"');
  expect(selector).toContain('x1="2.85" y1="1.95"');
  expect(limit).toContain('x1="6" y1="2.4" x2="9.6" y2="2.4"');
});
it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps circuit overload power thermal and auxiliary NC in %s",
  async (flow) => {
    const ir = await compileCoreFixture();
    const r = await prepareCircuitView(ir, {
      format: "circuit-view-request/0.1",
      title: "OL pole and aux",
      flow,
      groups: [
        {
          id: "ol",
          functions: [
            { device: { by: "designation", value: "OL1" }, key: "pole1" },
            { device: { by: "designation", value: "OL1" }, key: "aux95" },
          ],
          conductors: [],
        },
      ],
    });
    const doc = parseHTML(r.groups[0]!.content).document;
    const pole = doc.querySelector('[data-function-key="pole1"]')!,
      aux = doc.querySelector('[data-function-key="aux95"]')!;
    expect(
      pole.querySelector('[data-circuit-mark="overload"] rect'),
    ).not.toBeNull();
    expect(
      pole.querySelector('[data-circuit-mark="overload"] polyline'),
    ).not.toBeNull();
    expect(pole.textContent).not.toMatch(/\bNC\b/);
    expect(
      aux.querySelector('[data-circuit-mark="contact-nc"]'),
    ).not.toBeNull();
  },
);
it("suppresses rooted NC captions directly for protection marks only", async () => {
  const ir = await compileCoreFixture(),
    type = ir.deviceTypes.find((t) => t.id === "core:overload-3p-1nc")!;
  const fn = materializeTypeFunctions(type, "OL").find(
    (f) => f.kind === "contact",
  )!;
  for (const mark of [
    "ais:overload-pole",
    "ais:breaker-pole",
    "ais:fuse",
  ] as const)
    expect(printableCaption({ kind: "function", type, fn, mark })).toBe("");
  expect(
    printableCaption({ kind: "function", type, fn, mark: "ais:contact-nc" }),
  ).toBe("NC");
});
