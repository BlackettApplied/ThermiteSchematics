import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CompiledProjectPresentation,
  ElectricalIr,
  TerminalId,
} from "@thermite/compiler";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { beforeAll, describe, expect, it } from "vitest";

import { buildElkAdapterGraph } from "../src/layout/elk-adapter.js";
import { ELK_OPTIONS } from "../src/layout/options.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { renderSchematic } from "../src/renderer.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  type TraversalRole,
} from "../src/symbols/mappings.js";
import type { PresentationClass } from "../src/ordering.js";
import type {
  PresentationGraph,
  RenderedSchematic,
  SchematicFlow,
  SchematicViewFamily,
} from "../src/types.js";
import {
  compileCoreProjectFixture,
  required,
  selectCoreSubgraph,
} from "./fixtures.js";
import { checkRestrictedSvgXml } from "./xml-checker.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const goldenRoot = join(testRoot, "goldens", "motor-starter");

interface ParsedElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
}

let coreIr: ElectricalIr;
let corePresentation: CompiledProjectPresentation;
let control: RenderedSchematic;
let power: RenderedSchematic;
let controlDown: RenderedSchematic;
let powerDown: RenderedSchematic;
let trace: RenderedSchematic;
let conductors: RenderedSchematic;
let loads: RenderedSchematic;
let traceDown: RenderedSchematic;
let conductorsDown: RenderedSchematic;
let loadsDown: RenderedSchematic;

function request(
  root: "K1" | "M1",
  family: SchematicViewFamily,
  flow: SchematicFlow,
) {
  return {
    format: "schematic-view-request/0.1" as const,
    root: { by: "designation" as const, value: root },
    family,
    flow,
  };
}

async function rendered(
  root: "K1" | "M1",
  family: SchematicViewFamily,
  flow: SchematicFlow,
): Promise<RenderedSchematic> {
  const outcome = await renderSchematic(
    coreIr,
    request(root, family, flow),
    corePresentation,
  );
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
  return outcome.value;
}

function intentRequest(
  intent: "trace" | "conductors" | "loads",
  flow: SchematicFlow,
) {
  if (intent === "trace") {
    return {
      format: "schematic-view-request/0.2" as const,
      root: { by: "designation" as const, value: "LS1" },
      intent: {
        kind: "trace" as const,
        to: { by: "designation" as const, value: "PLC1" },
        includePower: true,
      },
      flow,
    };
  }
  return {
    format: "schematic-view-request/0.2" as const,
    root: {
      by: "designation" as const,
      value: intent === "conductors" ? "CBL1" : "PS1",
    },
    intent: { kind: intent },
    flow,
  };
}

async function renderedIntent(
  intent: "trace" | "conductors" | "loads",
  flow: SchematicFlow,
): Promise<RenderedSchematic> {
  const outcome = await renderSchematic(
    coreIr,
    intentRequest(intent, flow),
    corePresentation,
  );
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
  return outcome.value;
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

beforeAll(async () => {
  const compiled = await compileCoreProjectFixture();
  coreIr = deepFreeze(compiled.ir);
  corePresentation = deepFreeze(compiled.presentation);
  const irBytes = JSON.stringify(coreIr);
  [
    control,
    power,
    controlDown,
    powerDown,
    trace,
    conductors,
    loads,
    traceDown,
    conductorsDown,
    loadsDown,
  ] = await Promise.all([
    rendered("K1", "control", "left-to-right"),
    rendered("M1", "power", "left-to-right"),
    rendered("K1", "control", "top-to-bottom"),
    rendered("M1", "power", "top-to-bottom"),
    renderedIntent("trace", "left-to-right"),
    renderedIntent("conductors", "left-to-right"),
    renderedIntent("loads", "left-to-right"),
    renderedIntent("trace", "top-to-bottom"),
    renderedIntent("conductors", "top-to-bottom"),
    renderedIntent("loads", "top-to-bottom"),
  ]);
  expect(JSON.stringify(coreIr)).toBe(irBytes);
});

function designation(deviceUid: string): string {
  return required(coreIr.devices.find(({ uid }) => uid === deviceUid))
    .designation;
}

function terminalName(terminal: TerminalId): string {
  return `${designation(terminal.deviceUid)}.${terminal.terminalKey}`;
}

function deviceNames(result: RenderedSchematic): string[] {
  return result.summary.deviceUids.map(designation);
}

function functionNames(result: RenderedSchematic): string[] {
  return result.summary.functionIds.map(
    ({ deviceUid, functionKey }) => `${designation(deviceUid)}.${functionKey}`,
  );
}

function wireNames(result: RenderedSchematic): string[] {
  return result.summary.conductiveElementIds.map((id) => {
    expect(id.kind).toBe("wire");
    if (id.kind !== "wire") return "";
    return required(coreIr.wires.find(({ uid }) => uid === id.uid)).designation;
  });
}

function conductorNames(result: RenderedSchematic): string[] {
  return result.summary.conductiveElementIds.map((id) => {
    if (id.kind === "wire") {
      return required(coreIr.wires.find(({ uid }) => uid === id.uid))
        .designation;
    }
    if (id.kind === "jumper") {
      return (
        required(coreIr.jumpers.find(({ uid }) => uid === id.uid))
          .designation ?? id.uid
      );
    }
    return `${required(coreIr.cables.find(({ uid }) => uid === id.cableUid)).designation}.${id.conductorId}`;
  });
}

function parsedElements(svg: string): readonly ParsedElement[] {
  const elements: ParsedElement[] = [];
  const tag = /<([A-Za-z]+)\b([^>]*)\/?>/g;
  for (const match of svg.matchAll(tag)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[2]!.matchAll(
      /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g,
    )) {
      attributes[attribute[1]!] = attribute[2]!;
    }
    elements.push({ name: match[1]!, attributes });
  }
  return elements;
}

function hasClass(element: ParsedElement, className: string): boolean {
  return (element.attributes.class ?? "").split(" ").includes(className);
}

function netForTerminal(terminal: TerminalId): string {
  return required(
    coreIr.indexes.netIdByTerminal.find(
      ({ key }) =>
        key.deviceUid === terminal.deviceUid &&
        key.terminalKey === terminal.terminalKey,
    ),
  ).value;
}

function assertPhysicalAttachments(result: RenderedSchematic): void {
  const elements = parsedElements(result.svg);
  const markers = elements.filter((element) =>
    hasClass(element, "terminal-marker"),
  );
  expect(
    new Set(
      markers.map(
        ({ attributes }) =>
          `${attributes["data-device-uid"]}\0${attributes["data-terminal-key"]}`,
      ),
    ).size,
  ).toBe(result.summary.terminalIds.length);
  for (const terminal of result.summary.terminalIds) {
    const marker = required(
      markers.find(
        ({ attributes }) =>
          attributes["data-device-uid"] === terminal.deviceUid &&
          attributes["data-terminal-key"] === terminal.terminalKey,
      ),
    );
    expect(marker.attributes["data-net-id"]).toBe(netForTerminal(terminal));
  }

  const paths = elements.filter((element) => hasClass(element, "net-path"));
  expect(paths).toHaveLength(result.summary.conductiveElementIds.length);
  for (const path of paths) {
    const physical =
      path.attributes["data-wire-uid"] !== undefined
        ? required(
            coreIr.wires.find(
              ({ uid }) => uid === path.attributes["data-wire-uid"],
            ),
          )
        : path.attributes["data-jumper-uid"] !== undefined
          ? required(
              coreIr.jumpers.find(
                ({ uid }) => uid === path.attributes["data-jumper-uid"],
              ),
            )
          : required(
              coreIr.cableConductors.find(
                ({ id }) =>
                  id.cableUid === path.attributes["data-cable-uid"] &&
                  id.conductorId === path.attributes["data-conductor-id"],
              ),
            );
    if ("designation" in physical && physical.designation !== undefined) {
      expect(path.attributes["data-designation"]).toBe(physical.designation);
    }
    expect(path.attributes["data-net-id"]).toBe(
      netForTerminal(physical.endpoints[0].terminal),
    );
    expect(path.attributes["data-net-id"]).toBe(
      netForTerminal(physical.endpoints[1].terminal),
    );
    const renderedEndpoints = [
      terminalName({
        deviceUid: path.attributes["data-source-device-uid"]!,
        terminalKey: path.attributes["data-source-terminal-key"]!,
      }),
      terminalName({
        deviceUid: path.attributes["data-target-device-uid"]!,
        terminalKey: path.attributes["data-target-terminal-key"]!,
      }),
    ].sort();
    expect(renderedEndpoints).toEqual(
      physical.endpoints.map(({ terminal }) => terminalName(terminal)).sort(),
    );
  }

  if (result.view.format === "schematic-view/0.1") {
    expect(
      new Set(paths.map(({ attributes }) => attributes["data-net-id"])).size,
      "crossing geometry must not merge independently identified nets",
    ).toBe(paths.length);
  } else {
    expect(
      paths.every(({ attributes }) =>
        result.summary.netIds.includes(attributes["data-net-id"]!),
      ),
    ).toBe(true);
  }
  expect(elements.some((element) => hasClass(element, "junction"))).toBe(false);
  expect(
    result.summary.presentationNodeIds.some((id) => id.includes("junction")),
  ).toBe(false);
}

function wireEndpointMap(result: RenderedSchematic) {
  return new Map(
    parsedElements(result.svg)
      .filter((element) => hasClass(element, "wire-path"))
      .map(({ attributes }) => [
        attributes["data-designation"]!,
        [
          terminalName({
            deviceUid: attributes["data-source-device-uid"]!,
            terminalKey: attributes["data-source-terminal-key"]!,
          }),
          terminalName({
            deviceUid: attributes["data-target-device-uid"]!,
            terminalKey: attributes["data-target-terminal-key"]!,
          }),
        ].sort(),
      ]),
  );
}

function rulePairs(
  result: RenderedSchematic,
): Array<readonly [string, PresentationClass, TraversalRole]> {
  return result.summary.functionIds.flatMap((functionId) => {
    const device = required(
      coreIr.devices.find(({ uid }) => uid === functionId.deviceUid),
    );
    const mapping = required(
      CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.find(
        ({ typeId }) => typeId === device.typeId,
      ),
    );
    const rule = mapping.functions.find(
      ({ functionKey }) => functionKey === functionId.functionKey,
    );
    return rule === undefined
      ? []
      : [
          [
            `${device.designation}.${functionId.functionKey}`,
            rule.classification,
            rule.traversalRole,
          ] as const,
        ];
  });
}

function presentation(
  root: "K1" | "M1",
  family: SchematicViewFamily,
  flow: SchematicFlow,
): PresentationGraph {
  const result = buildPresentationGraph({
    ir: coreIr,
    selected: selectCoreSubgraph(coreIr, root, family, flow),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.graph;
}

function elkNodes(root: ElkNode): readonly ElkNode[] {
  return (root.children ?? []).flatMap((child) => [child, ...elkNodes(child)]);
}

describe("motor-starter baseline renderer views", () => {
  it("renders the exact K1 control membership and series/return chains", () => {
    expect(control.view).toMatchObject({
      family: "control",
      root: { designation: "K1" },
      flow: "left-to-right",
    });
    expect(deviceNames(control)).toEqual(["K1", "OL1", "PB1", "PLC1", "PS1"]);
    expect(functionNames(control)).toEqual([
      "K1.coil",
      "OL1.aux95",
      "PB1.contact11",
      "PLC1.do0",
    ]);
    expect(rulePairs(control)).toEqual([
      ["K1.coil", "coil", "coil-root"],
      ["OL1.aux95", "protection", "protection-contact"],
      ["PB1.contact11", "command", "command-contact"],
      ["PLC1.do0", "plc-output", "channel-boundary"],
    ]);
    expect(control.summary.terminalIds.map(terminalName).sort()).toEqual(
      [
        "K1.A1",
        "K1.A2",
        "OL1.95",
        "OL1.96",
        "PB1.11",
        "PB1.12",
        "PLC1.X2.0",
        "PS1.-",
      ].sort(),
    );
    expect(wireNames(control).sort()).toEqual([
      "W-CTL-005",
      "W-CTL-006",
      "W-CTL-007",
      "W-CTL-008",
    ]);
    const endpoints = wireEndpointMap(control);
    expect(endpoints.get("W-CTL-007")).toEqual(["K1.A1", "OL1.96"]);
    expect(endpoints.get("W-CTL-006")).toEqual(["OL1.95", "PB1.12"]);
    expect(endpoints.get("W-CTL-005")).toEqual(["PB1.11", "PLC1.X2.0"]);
    expect(endpoints.get("W-CTL-008")).toEqual(["K1.A2", "PS1.-"]);

    const selected = selectCoreSubgraph(coreIr, "K1", "control");
    const input = required(selected.paths.find(({ lane }) => lane === "input"));
    expect({
      start: terminalName(input.start.terminal),
      boundary: terminalName(input.start.boundary!.terminal),
      startConstraint: input.start.constraint,
      end: terminalName(input.end.terminal),
    }).toEqual({
      start: "PLC1.X2.0",
      boundary: "PLC1.X2.0",
      startConstraint: "FIRST",
      end: "K1.A1",
    });
    const returning = required(
      selected.paths.find(({ lane }) => lane === "return"),
    );
    expect({
      start: terminalName(returning.start.terminal),
      end: terminalName(returning.end.terminal),
      boundary: terminalName(returning.end.boundary!.terminal),
      endConstraint: returning.end.constraint,
    }).toEqual({
      start: "K1.A2",
      end: "PS1.-",
      boundary: "PS1.-",
      endConstraint: "LAST",
    });

    const graph = presentation("K1", "control", "left-to-right");
    const plc = required(
      graph.nodes.find(
        (node) =>
          node.kind === "symbol" &&
          node.designation === "PLC1" &&
          node.functionIds.some(({ functionKey }) => functionKey === "do0"),
      ),
    );
    const rail = required(graph.nodes.find((node) => node.kind === "rail"));
    expect(plc).toMatchObject({
      classification: "plc-output",
      boundaryConstraint: "FIRST",
      attachments: [{ kind: "channel" }],
    });
    expect(rail).toMatchObject({
      designation: "PS1",
      boundaryConstraint: "LAST",
      boundary: { terminal: { terminalKey: "-" }, label: "0VDC" },
    });
    expect(
      graph.deviceGroups.map(({ designation }) => designation),
    ).not.toContain("PS1");
    expect(
      graph.nodes.filter(({ kind }) => kind === "junction"),
      "K1 Junctions: none",
    ).toHaveLength(0);

    const contactStates = coreIr.functions
      .filter(
        (fn) =>
          (fn.id.deviceUid ===
            required(
              coreIr.devices.find(({ designation }) => designation === "PB1"),
            ).uid &&
            fn.id.functionKey === "contact11") ||
          (fn.id.deviceUid ===
            required(
              coreIr.devices.find(({ designation }) => designation === "OL1"),
            ).uid &&
            fn.id.functionKey === "aux95"),
      )
      .map((fn) => fn.kind === "contact" && fn.normal_state);
    expect(contactStates).toEqual(["closed", "closed"]);
    assertPhysicalAttachments(control);
  });

  it("renders the exact M1 power phases and PE while pruning PS1", () => {
    expect(power.view).toMatchObject({
      family: "power",
      root: { designation: "M1" },
      flow: "left-to-right",
    });
    expect(deviceNames(power)).toEqual(["CB1", "K1", "M1", "OL1", "SRC1"]);
    expect(functionNames(power)).toEqual([
      "CB1.pole1",
      "CB1.pole2",
      "CB1.pole3",
      "K1.pole1",
      "K1.pole2",
      "K1.pole3",
      "M1.motor_load",
      "M1.protective_earth",
      "OL1.pole1",
      "OL1.pole2",
      "OL1.pole3",
      "SRC1.three_phase_source",
      "SRC1.protective_earth",
    ]);
    expect(rulePairs(power)).toEqual([
      ["CB1.pole1", "protection", "breaker-pole"],
      ["CB1.pole2", "protection", "breaker-pole"],
      ["CB1.pole3", "protection", "breaker-pole"],
      ["K1.pole1", "power-contact", "power-contact"],
      ["K1.pole2", "power-contact", "power-contact"],
      ["K1.pole3", "power-contact", "power-contact"],
      ["OL1.pole1", "overload", "overload-pole"],
      ["OL1.pole2", "overload", "overload-pole"],
      ["OL1.pole3", "overload", "overload-pole"],
    ]);
    expect(wireNames(power).sort()).toEqual(
      Array.from(
        { length: 13 },
        (_, index) => `W-PWR-${String(index + 1).padStart(3, "0")}`,
      ),
    );
    expect(wireNames(power)).not.toContain("W-PWR-014");
    expect(wireNames(power)).not.toContain("W-PWR-015");

    const endpoints = wireEndpointMap(power);
    const exactEndpoints: Readonly<Record<string, readonly string[]>> = {
      "W-PWR-001": ["CB1.1/L1", "SRC1.L1"],
      "W-PWR-002": ["CB1.3/L2", "SRC1.L2"],
      "W-PWR-003": ["CB1.5/L3", "SRC1.L3"],
      "W-PWR-004": ["CB1.2/T1", "K1.1/L1"],
      "W-PWR-005": ["CB1.4/T2", "K1.3/L2"],
      "W-PWR-006": ["CB1.6/T3", "K1.5/L3"],
      "W-PWR-007": ["K1.2/T1", "OL1.1/L1"],
      "W-PWR-008": ["K1.4/T2", "OL1.3/L2"],
      "W-PWR-009": ["K1.6/T3", "OL1.5/L3"],
      "W-PWR-010": ["M1.U", "OL1.2/T1"],
      "W-PWR-011": ["M1.V", "OL1.4/T2"],
      "W-PWR-012": ["M1.W", "OL1.6/T3"],
      "W-PWR-013": ["M1.PE", "SRC1.PE"],
    };
    for (const [wire, expected] of Object.entries(exactEndpoints)) {
      expect(endpoints.get(wire)).toEqual(expected);
    }

    const selected = selectCoreSubgraph(coreIr, "M1", "power");
    expect(
      selected.paths.map((path) => ({
        lane: path.lane,
        start: terminalName(path.start.terminal),
        boundary: terminalName(path.start.boundary!.terminal),
        startConstraint: path.start.constraint,
        end: terminalName(path.end.terminal),
        endConstraint: path.end.constraint,
      })),
    ).toEqual([
      {
        lane: "U",
        start: "SRC1.L1",
        boundary: "SRC1.L1",
        startConstraint: "FIRST",
        end: "M1.U",
        endConstraint: "LAST",
      },
      {
        lane: "V",
        start: "SRC1.L2",
        boundary: "SRC1.L2",
        startConstraint: "FIRST",
        end: "M1.V",
        endConstraint: "LAST",
      },
      {
        lane: "W",
        start: "SRC1.L3",
        boundary: "SRC1.L3",
        startConstraint: "FIRST",
        end: "M1.W",
        endConstraint: "LAST",
      },
      {
        lane: "PE",
        start: "SRC1.PE",
        boundary: "SRC1.PE",
        startConstraint: "FIRST",
        end: "M1.PE",
        endConstraint: "LAST",
      },
    ]);

    const graph = presentation("M1", "power", "left-to-right");
    const source = required(
      graph.nodes.find(
        (node) => node.kind === "symbol" && node.designation === "SRC1",
      ),
    );
    const motor = required(
      graph.nodes.find(
        (node) => node.kind === "symbol" && node.designation === "M1",
      ),
    );
    expect(source).toMatchObject({
      representation: "aggregate",
      classification: "source",
      boundaryConstraint: "FIRST",
    });
    expect(motor).toMatchObject({
      representation: "aggregate",
      classification: "load",
      boundaryConstraint: "LAST",
    });
    expect(source.ports.map(({ terminal }) => terminal.terminalKey)).toEqual([
      "L1",
      "L2",
      "L3",
      "PE",
    ]);
    expect(motor.ports.map(({ terminal }) => terminal.terminalKey)).toEqual([
      "U",
      "V",
      "W",
      "PE",
    ]);
    expect(
      parsedElements(power.svg)
        .filter(({ name }) => name === "g")
        .filter((element) => hasClass(element, "location-group"))
        .map(({ attributes }) => attributes["data-location"]),
    ).toEqual(["FIELD", "MAIN-PANEL"]);
    expect(
      graph.nodes.filter(({ kind }) => kind === "junction"),
      "M1 Junctions: none",
    ).toHaveLength(0);
    assertPhysicalAttachments(power);
  });

  it("renders the complete baseline trace through presentation and SVG", () => {
    expect(trace.view).toEqual({
      format: "schematic-view/0.2",
      family: "control",
      intent: "trace",
      root: {
        kind: "device",
        deviceUid: required(
          coreIr.devices.find(({ designation }) => designation === "LS1"),
        ).uid,
        designation: "LS1",
      },
      target: {
        deviceUid: required(
          coreIr.devices.find(({ designation }) => designation === "PLC1"),
        ).uid,
        designation: "PLC1",
      },
      includePower: true,
      flow: "left-to-right",
    });
    expect(deviceNames(trace)).toEqual(["JB1", "LS1", "PLC1", "PS1", "TB1"]);
    expect(functionNames(trace)).toEqual([
      "JB1.terminal1",
      "JB1.terminal2",
      "LS1.contact13",
      "PLC1.di0",
      "PS1.dc_output",
      "TB1.terminal1",
      "TB1.terminal2",
      "TB1.terminal3",
    ]);
    expect(
      functionNames(trace).filter((name) => name === "PS1.dc_output"),
    ).toHaveLength(1);
    expect(conductorNames(trace).sort()).toEqual([
      "CBL1.1+",
      "CBL1.1-",
      "JP1",
      "W-CTL-003",
      "W-FLD-001",
      "W-FLD-002",
      "W-FLD-003",
    ]);
    expect(trace.summary.netIds).toEqual([
      "net:sha256:3d137761e58b445ed267e091f04cad782acdcec2f6a9f762594531476d54202a",
      "net:sha256:af8c9ba2461a98df6aae2bc32934bfb43e00d202ef9d6a0b4f8c8be8409877b9",
    ]);
    expect(trace.summary.presentationNodeIds).toHaveLength(8);
    expect(trace.svg).toContain("<title>trace schematic: LS1</title>");
    expect(trace.svg).toContain('data-view-intent="trace"');
    expect(trace.svg).toContain(
      `data-root-device-uid="${trace.view.root.deviceUid}"`,
    );
    expect(trace.svg).toContain(
      `data-target-device-uid="${trace.view.target.deviceUid}"`,
    );
    expect(trace.svg).not.toContain("data-root-cable-uid=");
    assertPhysicalAttachments(trace);
  });

  it("renders every CBL1 conductor and exact cable-root metadata", () => {
    expect(conductors.view).toEqual({
      format: "schematic-view/0.2",
      family: "control",
      intent: "conductors",
      root: {
        kind: "cable",
        cableUid: required(
          coreIr.cables.find(({ designation }) => designation === "CBL1"),
        ).uid,
        designation: "CBL1",
      },
      flow: "left-to-right",
    });
    expect(deviceNames(conductors)).toEqual(["JB1", "TB1"]);
    expect(functionNames(conductors)).toEqual([
      "JB1.terminal1",
      "JB1.terminal2",
      "JB1.terminal3",
      "JB1.terminal4",
      "TB1.terminal2",
      "TB1.terminal3",
      "TB1.terminal4",
      "TB1.terminal5",
    ]);
    expect(conductorNames(conductors)).toEqual([
      "CBL1.1+",
      "CBL1.1-",
      "CBL1.2+",
      "CBL1.2-",
    ]);
    expect(conductors.summary.netIds).toHaveLength(4);
    expect(conductors.summary.presentationNodeIds).toHaveLength(8);
    expect(conductors.svg).toContain(
      "<title>conductors schematic: CBL1</title>",
    );
    expect(conductors.svg).toContain('data-view-intent="conductors"');
    expect(conductors.svg).toContain(
      `data-root-cable-uid="${conductors.view.root.cableUid}"`,
    );
    expect(conductors.svg).not.toContain("data-root-device-uid=");
    for (const label of [
      "CBL1.1+ · black · 18AWG",
      "CBL1.1- · white · 18AWG",
      "CBL1.2+ · red · 18AWG",
      "CBL1.2- · green · 18AWG",
    ]) {
      expect(conductors.svg).toContain(`>${label}</text>`);
    }
    assertPhysicalAttachments(conductors);
  });

  it("renders the exact complete PS1-to-PLC1 load pair", () => {
    expect(loads.view).toEqual({
      format: "schematic-view/0.2",
      family: "control",
      intent: "loads",
      root: {
        kind: "device",
        deviceUid: required(
          coreIr.devices.find(({ designation }) => designation === "PS1"),
        ).uid,
        designation: "PS1",
      },
      flow: "left-to-right",
    });
    expect(deviceNames(loads)).toEqual(["PLC1", "PS1"]);
    expect(functionNames(loads)).toEqual(["PLC1.supply", "PS1.dc_output"]);
    expect(loads.summary.terminalIds.map(terminalName)).toEqual([
      "PLC1.L+",
      "PLC1.M",
      "PS1.+",
      "PS1.-",
    ]);
    expect(conductorNames(loads).sort()).toEqual(["W-CTL-001", "W-CTL-002"]);
    expect(loads.summary.netIds).toEqual([
      "net:sha256:3d137761e58b445ed267e091f04cad782acdcec2f6a9f762594531476d54202a",
      "net:sha256:72a015f08216f38a067efa9dcc5f76ad2ed9246cb564f07dcd2abaed457c366d",
    ]);
    expect(loads.summary.presentationNodeIds).toHaveLength(2);
    expect(loads.svg).toContain("<title>loads schematic: PS1</title>");
    expect(loads.svg).toContain('data-view-intent="loads"');
    expect(loads.svg).toContain(
      `data-root-device-uid="${loads.view.root.deviceUid}"`,
    );
    expect(
      required(parsedElements(loads.svg).find(({ name }) => name === "svg"))
        .attributes,
    ).not.toHaveProperty("data-target-device-uid");
    expect(loads.svg).toContain('data-symbol-id="ais:power-source-dc"');
    expect(loads.svg).toContain('data-symbol-id="ais:dc-load"');
    assertPhysicalAttachments(loads);
  });

  it("proves the control and power views are structurally distinct", () => {
    expect(new Set(deviceNames(control))).not.toEqual(
      new Set(deviceNames(power)),
    );
    expect(new Set(functionNames(control))).not.toEqual(
      new Set(functionNames(power)),
    );
    expect(new Set(wireNames(control))).not.toEqual(new Set(wireNames(power)));
    expect(
      functionNames(control).filter((name) => name.startsWith("K1.")),
    ).toEqual(["K1.coil"]);
    expect(
      functionNames(power).filter((name) => name.startsWith("K1.")),
    ).toEqual(["K1.pole1", "K1.pole2", "K1.pole3"]);
    expect(
      functionNames(control).filter((name) => name.startsWith("OL1.")),
    ).toEqual(["OL1.aux95"]);
    expect(
      functionNames(power).filter((name) => name.startsWith("OL1.")),
    ).toEqual(["OL1.pole1", "OL1.pole2", "OL1.pole3"]);
    expect(control.summary.presentationNodeIds).toHaveLength(5);
    expect(power.summary.presentationNodeIds).toHaveLength(11);
    expect(new Set(checkRestrictedSvgXml(control.svg).ids)).not.toEqual(
      new Set(checkRestrictedSvgXml(power.svg).ids),
    );
    expect(control.view.root.deviceUid).not.toBe(power.view.root.deviceUid);
  });

  it("preserves semantics and rotates every port for top-to-bottom renders", () => {
    for (const [root, family, horizontal, vertical] of [
      ["K1", "control", control, controlDown],
      ["M1", "power", power, powerDown],
    ] as const) {
      expect(vertical.summary).toEqual(horizontal.summary);
      expect(vertical.svg).toContain('data-view-flow="top-to-bottom"');
      checkRestrictedSvgXml(vertical.svg);
      expect(
        parsedElements(vertical.svg)
          .filter((element) => hasClass(element, "net-path"))
          .every(({ attributes }) =>
            /^M[^A-Z]*(?:[HV][^A-Z]*)+$/.test(attributes.d!),
          ),
      ).toBe(true);

      const graph = presentation(root, family, "top-to-bottom");
      for (const node of graph.nodes) {
        if (node.kind === "junction") continue;
        expect(node.orientation).toBe("top-to-bottom");
        expect(
          node.ports.every(({ side }) => side === "north" || side === "south"),
        ).toBe(true);
      }
      const adapter = buildElkAdapterGraph(graph).graph;
      expect(adapter.layoutOptions?.[ELK_OPTIONS.direction]).toBe("DOWN");
      const sideByPort = new Map(
        graph.nodes.flatMap((node) =>
          node.ports.map((port) => [port.id, port.side.toUpperCase()] as const),
        ),
      );
      for (const port of elkNodes(adapter).flatMap(
        (node) => node.ports ?? [],
      )) {
        expect(port.layoutOptions?.[ELK_OPTIONS.portSide]).toBe(
          sideByPort.get(port.id),
        );
      }
    }

    for (const [intent, horizontal, vertical] of [
      ["trace", trace, traceDown],
      ["conductors", conductors, conductorsDown],
      ["loads", loads, loadsDown],
    ] as const) {
      expect(vertical.summary).toEqual(horizontal.summary);
      expect(vertical.view).toEqual({
        ...horizontal.view,
        flow: "top-to-bottom",
      });
      expect(vertical.svg).toContain(`data-view-intent="${intent}"`);
      expect(vertical.svg).toContain('data-view-flow="top-to-bottom"');
      expect(
        parsedElements(vertical.svg)
          .filter((element) => hasClass(element, "net-path"))
          .every(({ attributes }) =>
            /^M[^A-Z]*(?:[HV][^A-Z]*)+$/.test(attributes.d!),
          ),
      ).toBe(true);
      checkRestrictedSvgXml(vertical.svg);
    }

    for (const result of [loads, loadsDown]) {
      expect(result.svg).toContain('data-symbol-id="ais:power-source-dc"');
      expect(result.svg).toContain('data-symbol-id="ais:dc-load"');
    }
  });

  it.each([
    ["k1-control-left-to-right.svg", "control", () => control],
    ["m1-power-left-to-right.svg", "power", () => power],
    ["ls1-to-plc1-include-power-left-to-right.svg", "control", () => trace],
    ["cbl1-conductors-left-to-right.svg", "control", () => conductors],
    ["ps1-loads-left-to-right.svg", "control", () => loads],
  ] as const)(
    "matches reviewed golden %s byte for byte",
    async (filename, family, value) => {
      const golden = await readFile(join(goldenRoot, filename), "utf8");
      const result = value();
      expect(result.view.family).toBe(family);
      expect(result.svg).toBe(golden);
      expect(golden).not.toContain("\r");
      expect(golden).not.toContain("\t");
      expect(golden.endsWith("\n")).toBe(true);
      expect(golden.endsWith("\n\n")).toBe(false);
      checkRestrictedSvgXml(golden);
    },
  );

  it("is byte-identical across repeated public renders", async () => {
    const repeatedControl = await rendered("K1", "control", "left-to-right");
    const repeatedPower = await rendered("M1", "power", "left-to-right");
    const repeatedTrace = await renderedIntent("trace", "left-to-right");
    const repeatedConductors = await renderedIntent(
      "conductors",
      "left-to-right",
    );
    const repeatedLoads = await renderedIntent("loads", "left-to-right");
    expect(repeatedControl).toEqual(control);
    expect(repeatedPower).toEqual(power);
    expect(repeatedTrace).toEqual(trace);
    expect(repeatedConductors).toEqual(conductors);
    expect(repeatedLoads).toEqual(loads);
  });
});
