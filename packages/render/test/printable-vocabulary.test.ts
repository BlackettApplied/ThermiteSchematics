import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import { circuitMark, emitCircuitMark } from "../src/symbols/circuit.js";
import { printableCaption } from "../src/symbols/printable-policy.js";
import { prepareCircuitView } from "../src/circuit.js";

it("uses rectangular coils in both printable families", () => {
  const coil = SYMBOL_CATALOG.find((s) => s.id === "ais:coil")!;
  expect(coil.primitives.some((p) => p.kind === "arc")).toBe(false);
  expect(coil.primitives.find((p) => p.kind === "rect")).not.toHaveProperty(
    "radius",
  );
  const svg = parseHTML(emitCircuitMark("coil")).document;
  expect(svg.querySelector("circle")).toBeNull();
  expect(svg.querySelector("rect")).not.toBeNull();
});

it("distinguishes the authored E-stop from an ordinary stop in both flows", async () => {
  const compiled = await compileProject(
    "packages/core-library/test/fixtures/dol-starter",
  );
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const request = JSON.parse(
    await readFile(
      "packages/core-library/test/fixtures/dol-starter/control.circuit.json",
      "utf8",
    ),
  );
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    const result = await prepareCircuitView(compiled.ir, { ...request, flow });
    const doc = parseHTML(
      result.groups.map((g) => g.content).join(""),
    ).document;
    const uid = (name: string) =>
      compiled.ir.devices.find((d) => d.designation === name)!.uid;
    expect(
      doc.querySelector(
        `[data-device-uid="${uid("S0")}"] [data-circuit-mark="estop-nc"]`,
      ),
    ).not.toBeNull();
    expect(
      doc.querySelector(
        `[data-device-uid="${uid("S1")}"] [data-circuit-mark="pushbutton-nc"]`,
      ),
    ).not.toBeNull();
  }
});

it("never captions protection marks as contact states", async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const { ir } = compiled;
  for (const device of ir.devices) {
    const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
    for (const fn of ir.functions.filter(
      (f) => f.id.deviceUid === device.uid && f.kind !== "mechanism",
    )) {
      const mark = circuitMark(type, fn);
      if (["breaker", "overload", "coil", "motor", "fuse"].includes(mark))
        expect(
          printableCaption({
            kind: "function",
            type,
            fn,
            mark: `circuit:${mark}`,
          }),
        ).not.toMatch(/NC|NO/);
    }
  }
});

it("uses shared protection and contact primitives without inventing a trip class", async () => {
  const { sharedMarkPrimitives } =
    await import("../src/symbols/printable-policy.js");
  for (const [id, mark] of [
    ["breaker-pole", "breaker"],
    ["overload-pole", "overload"],
    ["contact-no", "contact-no"],
    ["contact-nc", "contact-nc"],
  ] as const) {
    expect(
      SYMBOL_CATALOG.find((s) => s.id === `ais:${id}`)!.primitives,
    ).toEqual(sharedMarkPrimitives(mark));
    const svg = parseHTML(emitCircuitMark(mark)).document;
    expect(svg.querySelectorAll("rect").length).toBe(
      mark === "overload" ? 1 : 0,
    );
    expect(svg.querySelectorAll("line").length).toBe(
      sharedMarkPrimitives(mark).filter((p) => p.kind === "line").length,
    );
  }
  const no = sharedMarkPrimitives("contact-no"),
    nc = sharedMarkPrimitives("contact-nc");
  expect(nc.slice(0, no.length)).toEqual(no);
  expect(nc.at(-1)).toMatchObject({
    kind: "line",
    from: { x: 11, y: 17 },
    to: { x: 29, y: 3 },
  });
  expect(emitCircuitMark("breaker")).not.toMatch(/thermal|magnetic|NC|NO/);
});

it("selects all four operators only from profiles and preserves their parent support", async () => {
  const { SYMBOL_PROFILES } = await import("@thermite/schema");
  const { materializeTypeFunctions } = await import("./fixtures.js");
  const { projectDeviceTypeSymbolMappings } =
    await import("../src/symbols/mappings.js");
  const c = await compileProject(
    "packages/core-library/test/fixtures/dol-starter",
  );
  if (!c.ok) throw Error();
  const cases = [
    ["core:estop-nc", "thermite:estop", "estop-nc"],
    ["core:pushbutton-nc", "thermite:pushbutton", "pushbutton-nc"],
    ["core:selector-2pos", "thermite:selector", "selector-no"],
    ["core:limit-switch-2wire", "thermite:switch", "switch-no"],
  ] as const;
  const marks = [];
  for (const [id, profile, mark] of cases) {
    const type = structuredClone(c.ir.deviceTypes.find((t) => t.id === id)!);
    expect(type.symbol).toBe(profile);
    // Misleading identity and prose cannot alter operator identity.
    type.id = "custom:not-the-operator-name";
    type.description = "Emergency stop maintained selector limit switch";
    const fn = materializeTypeFunctions(type, "misleading-S0")[0]!;
    expect(circuitMark(type, fn)).toBe(mark);
    const mapping = projectDeviceTypeSymbolMappings({
      ...c.ir,
      deviceTypes: [type],
    })[0]!;
    expect(mapping.functions[0]!.symbolId).toBe(`ais:${mark}`);
    const def = SYMBOL_CATALOG.find((s) => s.id === `ais:${mark}`)!;
    marks.push(JSON.stringify(def.primitives));
    const declared = SYMBOL_PROFILES.find((p) => p.id === profile)!;
    if (profile === "thermite:estop" || profile === "thermite:selector") {
      const parent = SYMBOL_PROFILES.find(
        (p) =>
          p.id ===
          (profile === "thermite:estop"
            ? "thermite:pushbutton"
            : "thermite:switch"),
      )!;
      expect(declared.support).toEqual(parent.support);
    }
  }
  expect(new Set(marks).size).toBe(4);
  // A plain custom pushbutton keeps its profile even when its ID/description says E-stop.
  const type = structuredClone(
    c.ir.deviceTypes.find((t) => t.id === "core:pushbutton-nc")!,
  );
  type.id = "custom:estop-nc";
  type.description = "Latching emergency stop";
  expect(circuitMark(type, materializeTypeFunctions(type, "S0")[0]!)).toBe(
    "pushbutton-nc",
  );
});

it("qualifies only authored coil classes and three-phase motor shapes", async () => {
  const { coilQualifier } = await import("../src/symbols/printable-policy.js");
  const { materializeTypeFunctions } = await import("./fixtures.js");
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error();
  const type = structuredClone(
    c.ir.deviceTypes.find((t) => t.id === "core:contactor-3p-1no")!,
  );
  const fn = materializeTypeFunctions(type, "K1").find(
    (f) => f.kind === "coil",
  )!;
  for (const value of ["AC", "DC"] as const) {
    for (const t of type.terminals)
      if (fn.terminals.some((p) => p.terminalKey === t.key))
        t.rating = { voltage_type: value };
    expect(coilQualifier(type, fn)).toBe(value);
  }
  for (const t of type.terminals) delete t.rating;
  type.description = "24 VDC coil AC source";
  type.id = "custom:dc-coil";
  expect(coilQualifier(type, fn)).toBeUndefined();
  const pins = fn.terminals.map((t) =>
    type.terminals.find((p) => p.key === t.terminalKey)!,
  );
  pins[0]!.rating = { voltage_type: "AC" };
  pins[1]!.rating = { voltage_type: "DC" };
  expect(coilQualifier(type, fn)).toBeUndefined();
  const { circuitMotor, circuitMotorVertical } =
    await import("../src/symbols/circuit.js");
  for (const svg of [
    circuitMotor(40, 0, 20, [8, 12], false),
    circuitMotorVertical(20, 20, 20, [8, 12], false),
  ]) {
    expect(svg).toContain(">M</text>");
    expect(svg).not.toContain("3~");
  }
  for (const svg of [
    circuitMotor(40, 0, 30, [8, 12, 16], true),
    circuitMotorVertical(20, 20, 30, [8, 12, 16], true),
  ])
    expect(svg).toContain(">3~</text>");
});

it("never prints NO or NC for a non-contact function, even with a misleading key", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error();
  for (const fn of c.ir.functions.filter((f) => f.kind !== "contact")) {
    const type = c.ir.deviceTypes.find(
      (t) =>
        t.id === c.ir.devices.find((d) => d.uid === fn.id.deviceUid)!.typeId,
    )!;
    const named = { ...fn, id: { ...fn.id, functionKey: "NC NO" } };
    for (const mark of [
      "ais:coil",
      "ais:fuse",
      "circuit:coil",
      "circuit:overload",
    ] as const)
      expect(
        printableCaption({ kind: "function", fn: named, type, mark }),
      ).not.toMatch(/\b(?:NC|NO)\b/);
  }
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "links only aligned authored breaker gangs in %s",
  async (flow) => {
    const { prepareSchematicDrawing } = await import("../src/renderer.js");
    const { rootedGangSegments } =
      await import("../src/symbols/rooted-gangs.js");
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error();
    const r = await prepareSchematicDrawing(c.ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M1" },
      family: "power",
      flow,
    });
    if (!r.ok) throw Error(r.error.message);
    const { graph, layout } = r.value;
    expect(rootedGangSegments(c.ir, graph, layout)).toHaveLength(2);
    for (const segment of rootedGangSegments(c.ir, graph, layout))
      for (const point of [segment.from, segment.to])
        expect(
          graph.nodes.some((node) => {
            if (node.kind !== "symbol" || node.symbolId !== "ais:breaker-pole")
              return false;
            const o = layout.nodes.find(
              (n) => n.id === node.id,
            )!.primitiveOrigin!;
            return (
              point.x === o.x + (flow === "left-to-right" ? 18.5 : 13.5) &&
              point.y === o.y + (flow === "left-to-right" ? 6.5 : 18.5)
            );
          }),
        ).toBe(true);

    expect(
      rootedGangSegments({ ...c.ir, gangedGroups: [] }, graph, layout),
    ).toHaveLength(0);
    const moved = structuredClone(layout);
    const pole = graph.nodes.find(
      (n) => n.kind === "symbol" && n.symbolId === "ais:breaker-pole",
    )!;
    const origin = moved.nodes.find((n) => n.id === pole.id)!.primitiveOrigin!;
    if (flow === "left-to-right") origin.x += 3;
    else origin.y += 3;
    expect(rootedGangSegments(c.ir, graph, moved)).toHaveLength(0);
    const blocked = structuredClone(layout),
      segment = rootedGangSegments(c.ir, graph, layout)[0]!;
    blocked.nodes.push({
      id: "obstacle",
      parentId: "root",
      kind: "symbol",
      x: (segment.from.x + segment.to.x) / 2 - 1,
      y: (segment.from.y + segment.to.y) / 2 - 1,
      width: 2,
      height: 2,
    });
    expect(rootedGangSegments(c.ir, graph, blocked)).toHaveLength(1);
    const near = structuredClone(layout);
    const x = (segment.from.x + segment.to.x) / 2,
      y = (segment.from.y + segment.to.y) / 2;
    near.edges.push({
      ...layout.edges[0]!,
      id: "near-conductor",
      points:
        flow === "left-to-right"
          ? [
              { x: x + 2, y: y - 3 },
              { x: x + 2, y: y + 3 },
            ]
          : [
              { x: x - 3, y: y + 2 },
              { x: x + 3, y: y + 2 },
            ],
    });
    expect(rootedGangSegments(c.ir, graph, near)).toHaveLength(1);
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "preserves the selector's switch binding in trace and conductor views in %s",
  async (flow) => {
    const { renderSchematic } = await import("../src/renderer.js");
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const type = c.ir.deviceTypes.find(
      (t) => t.id === "core:limit-switch-2wire",
    )!;
    // A synthetic custom switch opts in without changing any terminals or wiring.
    const before = structuredClone(c.ir);
    type.symbol = "thermite:selector";
    for (const request of [
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: true,
        },
      },
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "CBL1" },
        intent: { kind: "conductors" },
      },
    ] as const) {
      const result = await renderSchematic(c.ir, { ...request, flow });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok && request.intent.kind === "trace")
        expect(result.value.svg).toContain('data-symbol-id="ais:selector-no"');
      else if (request.intent.kind === "conductors") {
        // This family draws terminal interfaces for both parent and child profiles.
        expect(result).toEqual(
          await renderSchematic(before, { ...request, flow }),
        );
      }
    }
  },
);

it("does not call a custom L/N/PE motor function three-phase", async () => {
  const { motorIsThreePhase } =
    await import("../src/symbols/printable-policy.js");
  const { materializeTypeFunctions } = await import("./fixtures.js");
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error();
  const type = c.ir.deviceTypes.find((t) => t.id === "core:motor-3ph")!;
  const device = c.ir.devices.find((d) => d.typeId === type.id)!;
  const fn = c.ir.functions.find(
    (f) => f.id.deviceUid === device.uid && f.kind === "load",
  )!;
  expect(motorIsThreePhase(type, fn)).toBe(true);
  type.symbol = "thermite:io-module";
  type.circuitSymbols = { motor_load: "motor", protective_earth: "earth" };
  const motorTerminals = fn.terminals.map((t) =>
    type.terminals.find((p) => p.key === t.terminalKey)!,
  );
  for (const [i, t] of motorTerminals.entries())
    t.role = ["ac_line_input", "ac_input_return", "protective_earth"][i]!;
  type.description = "Three-phase motor 3~";
  expect(motorIsThreePhase(type, fn)).toBe(false);
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    const view = await prepareCircuitView(c.ir, {
      format: "circuit-view-request/0.1",
      title: "Custom motor",
      flow,
      groups: [
        {
          id: "motor",
          functions: [
            { device: { by: "uid", value: device.uid }, key: "motor_load" },
          ],
          conductors: [],
        },
      ],
    });
    const texts = [
      ...parseHTML(view.groups[0]!.content).document.querySelectorAll(
        '[data-circuit-mark="motor"] text',
      ),
    ].map((t) => t.textContent);
    expect(texts).toEqual(["M"]);
  }
  for (const t of motorTerminals) delete t.role;
  expect(motorIsThreePhase(type, fn)).toBe(false);
  for (const [i, t] of motorTerminals.entries())
    t.role = ["phase_u_input", "phase_v_input", "phase_w_input"][i]!;
  expect(
    motorIsThreePhase(
      type,
      materializeTypeFunctions(type, device.uid).find(
        (f) => f.kind === "load",
      )!,
    ),
  ).toBe(true);
});
