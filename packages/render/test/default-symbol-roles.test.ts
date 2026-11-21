import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { lateralPinClearanceWidth } from "../src/circuit/pin-clearance.js";
import type { FunctionRow, Pin } from "../src/circuit/types.js";
import {
  renderSchematicPacket,
  type SchematicPacketRequest,
} from "../src/sheets.js";
import { renderSchematic } from "../src/renderer.js";
import { nodeCaptionSegments } from "../src/symbols/circuit-node-ink.js";
import { circuitMark } from "../src/symbols/circuit.js";
import { paintedShape } from "./circuit-fidelity-oracle.js";
import {
  inkClearance,
  svgGeometry,
  svgTextGeometry,
} from "./source-isolation.js";

const flows = ["left-to-right", "top-to-bottom"] as const;
const directory = "examples/functional-symbols";

async function publicPacket(path: string, request: SchematicPacketRequest) {
  const compiled = await compileProject(path);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const result = await renderSchematicPacket(compiled.ir, request);
  if (!result.ok) throw new Error(result.error.message);
  return { ir: compiled.ir, doc: parseHTML(result.value.html).document };
}

function projection(
  points: readonly { x: number; y: number }[],
  axis: "x" | "y",
) {
  return [
    Math.min(...points.map((p) => p[axis])),
    Math.max(...points.map((p) => p[axis])),
  ] as const;
}

function auditConversion(
  owner: Element,
  key: string,
  terminals: string[],
  vertical: boolean,
) {
  const row = owner.querySelector(`[data-function-key="${key}"]`)!;
  const mark = row.querySelector("[data-circuit-mark]")!;
  const box = paintedShape(owner, mark.querySelector("rect")!);
  const axis = vertical ? "x" : "y";
  const [first, last] = projection(box.points, axis);
  const stubs = [...row.querySelectorAll("[data-function-interface] line")];
  expect(stubs).toHaveLength(terminals.length);
  const pins = svgGeometry(owner).ports;
  const landed = stubs.map((line) => {
    const stroke = paintedShape(owner, line);
    const [port, tip] = stroke.points;
    const pin = pins.find(
      (p) => Math.hypot(p.point.x - port!.x, p.point.y - port!.y) < 0.001,
    );
    expect(pin, "stub begins at an authored terminal").toBeDefined();
    const terminal = JSON.parse(pin!.id)[1];
    expect(
      terminals,
      "stub belongs to its own authored terminal group",
    ).toContain(terminal);
    expect(port![axis]).toBeCloseTo(tip![axis], 3);
    expect(tip![axis] - first).toBeGreaterThanOrEqual(1);
    expect(last - tip![axis]).toBeGreaterThanOrEqual(1);
    const clearance = inkClearance(stroke, box);
    expect(clearance).toBeGreaterThanOrEqual(0.3);
    expect(clearance).toBeLessThanOrEqual(1.2);
    return terminal;
  });
  expect(landed.sort()).toEqual([...terminals].sort());
  const foreign = [
    ...owner.querySelectorAll(
      `[data-function-key]:not([data-function-key="${key}"]) [data-function-interface] line`,
    ),
  ];
  for (const e of foreign)
    expect(inkClearance(box, paintedShape(owner, e))).toBeGreaterThanOrEqual(
      0.3,
    );
}

function auditConversionOrientation(
  owner: Element,
  kind: "ac-input" | "dc-output",
) {
  const mark = owner.querySelector(`[data-circuit-mark="${kind}"]`)!;
  const shapes = [...mark.querySelectorAll("line,polyline")].map((e) =>
    paintedShape(owner, e),
  );
  if (kind === "dc-output") {
    expect(shapes.length).toBe(4);
    for (const shape of shapes)
      expect(shape.points[0]!.y).toBeCloseTo(shape.points[1]!.y, 3);
  } else {
    expect(shapes.length).toBe(1);
    const points = shapes[0]!.points;
    expect(points[0]!.y).toBeCloseTo(points.at(-1)!.y, 3);
    expect(Math.abs(points[0]!.x - points.at(-1)!.x)).toBeGreaterThan(5);
  }
}

function auditOutlet(outlet: Element, terminals: string[], hasEarth: boolean) {
  const body = outlet.closest("[data-device-uid]")!;
  const frame = paintedShape(
    body,
    body.querySelector('[data-function-interface="receptacle"] rect')!,
  );
  const leads = [
    ...body.querySelectorAll('[data-function-interface="receptacle"] line'),
  ];
  expect(leads).toHaveLength(terminals.length);
  const ports = svgGeometry(body).ports;
  const landed = leads.map((lead) => {
    const stroke = paintedShape(body, lead);
    expect(
      inkClearance(frame, stroke),
      "outlet frame clears its separate stubs",
    ).toBeGreaterThanOrEqual(0.3);
    const [start] = stroke.points;
    const port = ports.find(
      ({ point }) => Math.hypot(point.x - start!.x, point.y - start!.y) < 0.001,
    );
    expect(port, "outlet stub begins at an authored terminal").toBeDefined();
    return JSON.parse(port!.id)[1];
  });
  expect(landed.sort()).toEqual([...terminals].sort());
  const slots = [...outlet.querySelectorAll("line")].map((e) =>
    paintedShape(body, e),
  );
  expect(slots).toHaveLength(2);
  for (const slot of slots) {
    const [x1, x2] = projection(slot.points, "x");
    const [y1, y2] = projection(slot.points, "y");
    expect(x2 - x1).toBeLessThan(0.001);
    expect(y2 - y1).toBeGreaterThan(2);
  }
  const earth = outlet.querySelectorAll("polyline");
  expect(earth.length).toBe(hasEarth ? 1 : 0);
  if (hasEarth) {
    const opening = paintedShape(body, earth[0]!);
    expect(projection(opening.points, "y")[0]).toBeGreaterThan(
      Math.max(...slots.map((s) => projection(s.points, "y")[1])),
    );
  }
}

function auditDefaultOutlet(doc: Document) {
  const outlet = doc.querySelector('[data-circuit-mark="receptacle"]')!;
  auditOutlet(outlet, ["L", "N"], false);
  expect(
    Boolean(
      doc.querySelector(
        '[data-function-key="bond"] [data-circuit-mark="earth"]',
      ),
    ),
  ).toBe(true);
  for (const e of outlet.querySelectorAll("line"))
    e.setAttribute("transform", "rotate(90 6 6)");
  expect(() => auditOutlet(outlet, ["L", "N"], false)).toThrowError(
    expect.objectContaining({ name: "AssertionError" }),
  );
}

function auditInterface(mark: Element) {
  const text = svgTextGeometry(mark.closest("svg")!).find(
    (t) => t.element.closest("[data-circuit-mark]") === mark,
  );
  expect(text?.element.textContent).toBe("I/F");
  expect(text!.em).toBeGreaterThanOrEqual(2.5);
  expect(text!.corners[0]!.y).toBeCloseTo(text!.corners[1]!.y, 3);
}

it.each(flows)(
  "prints the default functional roles and terminal groupings in %s",
  async (flow) => {
    const request = JSON.parse(
      await readFile(`${directory}/packet-${flow}.request.json`, "utf8"),
    );
    const { doc, ir } = await publicPacket(directory, request);
    const ps = ir.devices.find((d) => d.designation === "PS1")!;
    const converter = [
      ...doc.querySelectorAll(`[data-device-uid="${ps.uid}"]`),
    ].find((e) => e.querySelector('[data-circuit-mark="ac-input"]'))!;
    const vertical = flow === "top-to-bottom";
    for (const key of ["input", "output"]) {
      const fn = ir.functions.find(
        (f) => f.id.deviceUid === ps.uid && f.id.functionKey === key,
      )!;
      auditConversion(
        converter,
        key,
        fn.terminals.map((t) => t.terminalKey),
        vertical,
      );
    }
    auditDefaultOutlet(doc);
    auditInterface(doc.querySelector('[data-circuit-mark="interface"]')!);

    const input = converter.querySelector(
      '[data-function-key="input"] [data-function-interface] line',
    )!;
    const output = converter.querySelector(
      '[data-function-key="output"] [data-function-interface] line',
    )!;
    const axis = vertical ? "x" : "y";
    input.setAttribute(`${axis}1`, output.getAttribute(`${axis}1`)!);
    input.setAttribute(`${axis}2`, output.getAttribute(`${axis}2`)!);
    input.setAttribute(
      vertical ? "y1" : "x1",
      output.getAttribute(vertical ? "y1" : "x1")!,
    );
    const nativeInput = ir.functions.find(
      (f) => f.id.deviceUid === ps.uid && f.id.functionKey === "input",
    )!;
    expect(() =>
      auditConversion(
        converter,
        "input",
        nativeInput.terminals.map((t) => t.terminalKey),
        vertical,
      ),
    ).toThrowError(expect.objectContaining({ name: "AssertionError" }));

    for (const kind of ["ac-input", "dc-output"] as const) {
      auditConversionOrientation(converter, kind);
      const rotated = parseHTML(converter.outerHTML).document.querySelector(
        "[data-device-uid]",
      )!;
      for (const e of rotated.querySelectorAll(
        `[data-circuit-mark="${kind}"] line,[data-circuit-mark="${kind}"] polyline`,
      ))
        e.setAttribute("transform", "rotate(90 6 6)");
      expect(() => auditConversionOrientation(rotated, kind)).toThrowError(
        expect.objectContaining({ name: "AssertionError" }),
      );
    }
  },
);

async function outletFixture(terminalKeys: string[]) {
  const compiled = await compileProject(directory);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const ir = structuredClone(compiled.ir);
  const outlet = ir.devices.find((d) => d.designation === "SO1")!;
  const type = ir.deviceTypes.find((t) => t.id === outlet.typeId)!;
  const power = ir.functions.find(
    (f) => f.id.deviceUid === outlet.uid && f.id.functionKey === "power",
  )!;
  const terminals = terminalKeys.map((key) =>
    ir.terminals.find(
      (t) => t.id.deviceUid === outlet.uid && t.id.terminalKey === key,
    )!,
  );
  power.terminals = terminals.map((t) => t.id);
  type.functions.find((f) => f.key === "power")!.terminalKeys = terminalKeys;

  function setEarthTerminals(earthKeys: string[]) {
    for (const terminal of terminals) {
      const key = terminal.id.terminalKey;
      const authored = type.terminals.find((t) => t.key === key)!;
      if (earthKeys.includes(key)) {
        authored.role = terminal.role = "protective_earth";
      } else {
        delete authored.role;
        delete terminal.role;
      }
    }
  }

  async function audit(flow: (typeof flows)[number], hasEarth: boolean) {
    const request: SchematicPacketRequest = {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "Outlet",
          flow,
          groups: [
            {
              id: "outlet",
              functions: [
                { device: { by: "uid", value: outlet.uid }, key: "power" },
              ],
              conductors: [],
            },
          ],
        },
      ],
    };
    const result = await renderSchematicPacket(ir, request);
    if (!result.ok) throw Error(result.error.message);
    const doc = parseHTML(result.value.html).document;
    auditOutlet(
      doc.querySelector('[data-circuit-mark="receptacle"]')!,
      terminalKeys,
      hasEarth,
    );
  }

  return { type, power, setEarthTerminals, audit };
}

it.each(flows)(
  "prints an earth opening on a three-terminal receptacle only with an authored earth role in %s",
  async (flow) => {
    // The earth terminal occupies the middle of the authored function order.
    const { type, setEarthTerminals, audit } = await outletFixture([
      "L",
      "PE",
      "N",
    ]);
    await audit(flow, true);
    type.circuitSymbols = { power: "receptacle" };
    await audit(flow, true);
    // A terminal still named PE cannot authorize the earth opening.
    setEarthTerminals([]);
    await audit(flow, false);
    delete type.circuitSymbols;
    await audit(flow, false);
  },
);

it.each([
  {
    load: "three-terminal load with two earth roles",
    terminalKeys: ["L", "PE", "N"],
    earthKeys: ["PE", "N"],
  },
  {
    load: "two-terminal load with one earth role",
    terminalKeys: ["L", "PE"],
    earthKeys: ["PE"],
  },
])(
  "paints no earth opening on a $load",
  async ({ terminalKeys, earthKeys }) => {
    const { setEarthTerminals, audit } = await outletFixture(terminalKeys);
    setEarthTerminals(earthKeys);
    await audit("left-to-right", false);
  },
);

it("reserves the interface lead ink and lateral caption clearance of an earthed receptacle", async () => {
  const { type, power } = await outletFixture(["L", "PE", "N"]);
  const mark = circuitMark(type, power);
  expect(mark).toBe("receptacle-with-earth");
  const center = { x: 20, y: 14 };
  const pitch = 10;
  const pins: Pin[] = power.terminals.map((terminal, i) => ({
    id: terminal.terminalKey,
    terminal,
    x: 0,
    y: center.y + (i - 1) * pitch,
    side: "WEST",
    label: terminal.terminalKey,
    outside: 0,
  }));
  const row: FunctionRow = {
    f: power,
    mark,
    start: 0,
    slots: 3,
    center: center.y,
  };
  const node = {
    width: 40,
    height: 28,
    boundary: false,
    type,
    sourceTerminalKeys: [],
    rows: [row],
    pins,
  };
  const { ownerSegments } = nodeCaptionSegments(
    node,
    [center],
    false,
    () => true,
  );
  for (const { x, y } of pins) {
    // The face starts at x=15, leaving a 1 mm gap from the lead tip.
    expect(ownerSegments).toContainEqual([
      { x, y },
      { x: 14, y },
    ]);
  }

  const short = lateralPinClearanceWidth(
    pins,
    [row],
    pitch,
    false,
    (p) => p.label,
  );
  // The outer pin caption lies beyond the circle and still needs clearance from the face outline.
  const long = lateralPinClearanceWidth(pins, [row], pitch, false, (p) =>
    p.label === "L" ? "Line terminal" : p.label,
  );
  expect(long).toBeGreaterThan(short);
});

function auditMotorEarth(motor: Element) {
  const pe = motor.querySelector('.terminal-marker[data-terminal-key="PE"]')!;
  const anchor = {
    x: Number(pe.getAttribute("cx")),
    y: Number(pe.getAttribute("cy")),
  };
  const [stem, ...bars] = [
    ...motor.querySelectorAll("line.symbol-annotation"),
  ].map((e) => paintedShape(motor, e));
  expect(bars).toHaveLength(3);
  const [first, second, third] = bars.map((bar) => {
    const [a, b] = bar.points;
    expect(a!.y).toBeCloseTo(b!.y, 3);
    return { width: Math.abs(a!.x - b!.x), y: a!.y, x: (a!.x + b!.x) / 2 };
  });
  expect(first!.width).toBeGreaterThan(second!.width);
  expect(second!.width).toBeGreaterThan(third!.width);
  expect(first!.y).toBeLessThan(second!.y);
  expect(second!.y).toBeLessThan(third!.y);
  expect(stem!.points[1]).toEqual({ x: first!.x, y: first!.y });
  const lead = [...motor.querySelectorAll("line.symbol-body")]
    .map((e) => paintedShape(motor, e))
    .find(
      (ink) =>
        ink.points[1]!.x === stem!.points[0]!.x &&
        ink.points[1]!.y === stem!.points[0]!.y,
    );
  expect(lead?.points[0]).toEqual(anchor);
}

it.each(flows)(
  "paints upright motor earth at the actual PE terminal in %s",
  async (flow) => {
    const compiled = await compileProject("examples/machine-demo");
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const result = await renderSchematic(compiled.ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M1" },
      family: "power",
      flow,
    });
    if (!result.ok) throw new Error(result.error.message);
    const doc = parseHTML(result.value.svg).document;
    const motor = doc.querySelector('[data-symbol-id="ais:motor-3ph"]')!;
    auditMotorEarth(motor);
    const bar = motor.querySelectorAll("line.symbol-annotation")[1]!;
    bar.setAttribute("transform", "rotate(90)");
    expect(() => auditMotorEarth(motor)).toThrowError(
      expect.objectContaining({ name: "AssertionError" }),
    );
    bar.removeAttribute("transform");
    const pe = motor.querySelector('[data-terminal-key="PE"]')!;
    const phase = motor.querySelector('[data-terminal-key="W"]')!;
    for (const attr of ["cx", "cy"])
      pe.setAttribute(attr, phase.getAttribute(attr)!);
    expect(() => auditMotorEarth(motor)).toThrowError(
      expect.objectContaining({ name: "AssertionError" }),
    );
  },
);

it("labels every repeated self-loop interface without claiming pin behavior", async () => {
  const path = "examples/self-loop-labels";
  const request = JSON.parse(await readFile(`${path}/packet.json`, "utf8"));
  const { doc, ir } = await publicPacket(path, request);
  const d1 = ir.devices.find((d) => d.designation === "D1")!;
  const marks = [
    ...doc.querySelectorAll(
      `[data-device-uid="${d1.uid}"] [data-circuit-mark="interface"]`,
    ),
  ];
  expect(marks.length).toBeGreaterThanOrEqual(2);
  for (const mark of marks) auditInterface(mark);
});

it.each(flows)(
  "keeps the motor starter contact states and the distinct breaker and coil roles in %s",
  async (flow) => {
    const compiled = await compileProject("examples/motor-starter");
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const power = await renderSchematic(compiled.ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M1" },
      family: "power",
      flow,
    });
    const control = await renderSchematic(compiled.ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "K1" },
      family: "control",
      flow,
    });
    if (!power.ok || !control.ok)
      throw new Error("Motor starter could not render");
    const powerDoc = parseHTML(power.value.svg).document;
    const controlDoc = parseHTML(control.value.svg).document;
    const no = powerDoc.querySelector('[data-symbol-id="ais:contact-no"]')!;
    const nc = controlDoc.querySelector(
      '[data-symbol-id="ais:overload-contact-nc"]',
    )!;
    expect(no.querySelectorAll("line.symbol-operator").length).toBe(2);
    expect(nc.querySelectorAll("line.symbol-operator").length).toBe(3);
    const breaker = powerDoc.querySelector(
      '[data-symbol-id="ais:breaker-pole"]',
    )!;
    const bladeAndCross = [...breaker.querySelectorAll("line.symbol-operator")];
    expect(bladeAndCross.length).toBe(3);
    for (const e of bladeAndCross) {
      const [a, b] = paintedShape(breaker, e).points;
      expect(a!.x).not.toBeCloseTo(b!.x, 3);
      expect(a!.y).not.toBeCloseTo(b!.y, 3);
    }
    expect(
      controlDoc.querySelectorAll(
        '[data-symbol-id="ais:coil"] rect.symbol-body',
      ).length,
    ).toBe(1);
  },
);
