import type { ElectricalIr } from "@thermite/compiler";
import { beforeAll, describe, expect, it } from "vitest";

import { layoutPresentationGraph } from "../src/layout/elk-adapter.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { renderSchematic } from "../src/renderer.js";
import { OUTER_SVG_PADDING } from "../src/symbols/catalog.js";
import { emitSchematicSvg, orthogonalPathData } from "../src/svg/emitter.js";
import { prepareSchematicTitleContext } from "../src/title-block.js";
import {
  decodeSvgSemanticId,
  escapeXmlAttribute,
  escapeXmlText,
  preflightRenderText,
  svgSemanticId,
} from "../src/svg/escape.js";
import { formatSvgNumber } from "../src/svg/numbers.js";
import type {
  NormalizedSchematicLayout,
  PresentationGraph,
  RenderTextSource,
  SymbolPresentationNode,
} from "../src/types.js";
import {
  compileCoreFixture,
  required,
  selectCoreSubgraph,
} from "./fixtures.js";
import { checkRestrictedSvgXml } from "./xml-checker.js";

let coreIr: ElectricalIr;
let graph: PresentationGraph;
let layout: NormalizedSchematicLayout;
let svg: string;

async function presentationAndLayout(
  ir: ElectricalIr,
  root = "K1",
  family: "control" | "power" = "control",
): Promise<{ graph: PresentationGraph; layout: NormalizedSchematicLayout }> {
  const presented = buildPresentationGraph({
    ir,
    selected: selectCoreSubgraph(ir, root, family),
  });
  if (!presented.ok) throw new Error(JSON.stringify(presented.error));
  const laidOut = await layoutPresentationGraph(presented.value.graph);
  if (!laidOut.ok) throw new Error(JSON.stringify(laidOut.error));
  return { graph: presented.value.graph, layout: laidOut.value };
}

function emitted(
  presentation: PresentationGraph,
  normalized: NormalizedSchematicLayout,
): string {
  const titleContext = prepareSchematicTitleContext(
    coreIr.project.name,
    presentation.view,
  );
  if (!titleContext.ok) throw new Error(JSON.stringify(titleContext.error));
  const result = emitSchematicSvg(presentation, normalized, titleContext.value);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function emittedOutcome(
  presentation: PresentationGraph,
  normalized: NormalizedSchematicLayout,
) {
  const titleContext = prepareSchematicTitleContext(
    coreIr.project.name,
    presentation.view,
  );
  if (!titleContext.ok) throw new Error(JSON.stringify(titleContext.error));
  return emitSchematicSvg(presentation, normalized, titleContext.value);
}

beforeAll(async () => {
  coreIr = await compileCoreFixture();
  ({ graph, layout } = await presentationAndLayout(coreIr));
  svg = emitted(graph, layout);
});

describe("canonical semantic SVG emitter", () => {
  it("emits exact v0.2 intent, root, target, title, and ARIA metadata", async () => {
    const requests = [
      {
        name: "trace",
        root: "LS1",
        request: {
          format: "schematic-view-request/0.2" as const,
          root: { by: "designation" as const, value: "LS1" },
          intent: {
            kind: "trace" as const,
            to: { by: "designation" as const, value: "PLC1" },
            includePower: true,
          },
        },
        rootAttribute: "data-root-device-uid",
        target: true,
      },
      {
        name: "conductors",
        root: "CBL1",
        request: {
          format: "schematic-view-request/0.2" as const,
          root: { by: "designation" as const, value: "CBL1" },
          intent: { kind: "conductors" as const },
        },
        rootAttribute: "data-root-cable-uid",
        target: false,
      },
      {
        name: "loads",
        root: "PS1",
        request: {
          format: "schematic-view-request/0.2" as const,
          root: { by: "designation" as const, value: "PS1" },
          intent: { kind: "loads" as const },
        },
        rootAttribute: "data-root-device-uid",
        target: false,
      },
    ] as const;
    for (const testCase of requests) {
      const outcome = await renderSchematic(coreIr, testCase.request);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      const open = outcome.value.svg.split("\n")[1]!;
      expect(open).toContain(
        `aria-label="${testCase.name} schematic: ${testCase.root}"`,
      );
      expect(open).toContain(`data-view-intent="${testCase.name}"`);
      expect(open).toContain(`${testCase.rootAttribute}="`);
      expect(open.includes("data-target-device-uid=")).toBe(testCase.target);
      expect(outcome.value.svg).toContain(
        `<title>${testCase.name} schematic: ${testCase.root}</title>`,
      );
    }
  });

  it("emits canonical layers, root metadata, primitive translations, and rail provenance", () => {
    const checked = checkRestrictedSvgXml(svg);
    expect(
      svg.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1"',
      ),
    ).toBe(true);
    expect(svg).toContain(
      `data-view-format="schematic-view/0.1" data-view-family="control" data-view-flow="left-to-right"`,
    );
    expect(svg).toContain('data-renderer-version="render/0.3"');
    expect(svg).toContain('data-symbol-catalog-version="ais-symbols/0.3"');
    expect(svg).toContain(
      'data-layout-config-version="elk-layered/0.4+elkjs-0.12.0"',
    );
    expect(svg.indexOf("<title")).toBeLessThan(svg.indexOf("<style"));
    expect(svg.indexOf("<style")).toBeLessThan(svg.indexOf("<defs"));
    expect(svg.indexOf("<defs")).toBeLessThan(
      svg.indexOf('class="location-group"'),
    );
    expect(svg.indexOf('class="net-group"')).toBeLessThan(
      svg.indexOf('class="symbol'),
    );

    const semantic = required(
      graph.nodes.find(
        (node): node is SymbolPresentationNode => node.kind === "symbol",
      ),
    );
    const geometry = required(
      layout.nodes.find(({ id }) => id === semantic.id),
    );
    const origin = required(geometry.primitiveOrigin);
    expect(svg).toContain(
      `transform="translate(${formatSvgNumber(origin.x + OUTER_SVG_PADDING)} ${formatSvgNumber(origin.y + OUTER_SVG_PADDING)})"`,
    );
    expect(svg).toContain("data-member-function-key=");
    expect(svg).toMatch(
      /id="rail-[0-9a-f-]+" class="symbol rail-symbol"[^>]*data-boundary-kind="[a-z_]+"[^>]*data-device-uid=/,
    );
    expect(new Set(checked.ids).size).toBe(checked.ids.length);
  });

  it("emits exactly one stable clip definition and reference per label", () => {
    const checked = checkRestrictedSvgXml(svg);
    expect(checked.clipIds).toHaveLength(layout.labels.length);
    expect(checked.clipReferences).toEqual(checked.clipIds);
    for (const label of layout.labels) {
      const clip = svgSemanticId("clip", [label.id]);
      expect(svg).toContain(
        `<clipPath id="${clip}" clipPathUnits="userSpaceOnUse">`,
      );
      expect(svg).toContain(`clip-path="url(#${clip})"`);
      const semantic = [
        ...graph.locationGroups.map(({ label: value }) => value),
        ...graph.deviceGroups.map(({ label: value }) => value),
        ...graph.nodes.flatMap((node) =>
          node.kind === "junction" ? [] : node.labels,
        ),
        ...graph.edges.flatMap((edge) =>
          [edge.label, edge.netLabel].filter((value) => value !== undefined),
        ),
      ].find(({ id }) => id === label.id)!;
      expect(svg).toContain(
        `textLength="${formatSvgNumber(semantic.textLength)}" lengthAdjust="spacingAndGlyphs"`,
      );
    }
  });

  it("is pure, UTF-8 round-trippable, and uses only structural LF", () => {
    const beforeGraph = JSON.stringify(graph);
    const beforeLayout = JSON.stringify(layout);
    expect(emitted(graph, layout)).toBe(svg);
    expect(JSON.stringify(graph)).toBe(beforeGraph);
    expect(JSON.stringify(layout)).toBe(beforeLayout);
    expect(Buffer.from(svg, "utf8").toString("utf8")).toBe(svg);
    expect(svg).not.toContain("\r");
    expect(svg).not.toContain("\t");
    expect(svg.endsWith("\n")).toBe(true);
    expect(svg.endsWith("\n\n")).toBe(false);
  });

  it("deduplicates and simplifies orthogonal path points into absolute M/H/V commands", () => {
    expect(
      orthogonalPathData([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 30 },
      ]),
    ).toBe("M 20 20 H 40 V 50");
    expect(() =>
      orthogonalPathData([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toThrow("diagonal");
  });

  it("encodes every raw UTF-16 code unit reversibly and collision-free", () => {
    const values = ["\ud800", "\udc00", "\ufffd", "😀", "", "A-中"];
    for (const value of values) {
      const id = svgSemanticId("terminal", ["device", value, "port"]);
      expect(decodeSvgSemanticId("terminal", id)).toEqual([
        "device",
        value,
        "port",
      ]);
      expect(id).toMatch(/^terminal-[0-9a-f]*(?:--[0-9a-f]*){2}$/);
    }
    const matrix = ["\ud800", "\udc00", "\ufffd"].map((value) => ({
      cable: svgSemanticId("cable-conductor", ["cable", value]),
      terminal: svgSemanticId("terminal", ["device", value, "port"]),
      function: svgSemanticId("function", ["device", value]),
    }));
    for (const key of ["cable", "terminal", "function"] as const) {
      expect(new Set(matrix.map((entry) => entry[key])).size).toBe(3);
    }
    expect(svgSemanticId("function", ["device", "same"])).not.toBe(
      svgSemanticId("aggregate", ["device", "same"]),
    );
  });

  it.each([
    {
      ownerKind: "cable-conductor",
      prefix: "cable-conductor",
      parts: ["cable", "\ud800"],
      field: "cable.conductor.id",
    },
    {
      ownerKind: "terminal",
      prefix: "terminal",
      parts: ["device", "\udc00", "port"],
      field: "terminal.key",
    },
    {
      ownerKind: "function",
      prefix: "function",
      parts: ["device", "\ud800"],
      field: "function.key",
    },
  ] as const)(
    "uses the same $prefix grammar for surrogate R005 owner IDs",
    (fixture) => {
      const source: RenderTextSource = {
        ownerKind: fixture.ownerKind,
        ownerId: svgSemanticId(fixture.prefix, fixture.parts),
        field: fixture.field,
        value: fixture.parts.find(
          (value) => value === "\ud800" || value === "\udc00",
        )!,
      };
      const result = preflightRenderText({
        ...graph,
        metadataTextSources: [source],
      });
      expect(result).toEqual({
        ok: false,
        error: {
          code: "R005",
          message: `Invalid render text: ${source.ownerKind} ${source.ownerId} field ${source.field} contains unpaired-surrogate.`,
          family: "control",
          ownerKind: source.ownerKind,
          ownerId: source.ownerId,
          field: source.field,
          reason: "unpaired-surrogate",
          root: "K1",
        },
      });
    },
  );

  it("accepts literal U+FFFD and escapes XML syntax and legal controls canonically", () => {
    expect(
      preflightRenderText({
        ...graph,
        metadataTextSources: [
          {
            ownerKind: "function",
            ownerId: svgSemanticId("function", ["device", "\ufffd"]),
            field: "function.key",
            value: "\ufffd",
          },
        ],
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(escapeXmlText('&<>"\t\n\r中')).toBe(
      '&amp;&lt;&gt;"&#x9;&#xA;&#xD;中',
    );
    expect(escapeXmlAttribute('&<>"\t\n\r中')).toBe(
      "&amp;&lt;&gt;&quot;&#x9;&#xA;&#xD;中",
    );
  });

  it.each([
    ["\0", "xml-illegal-code-point"],
    ["\u0001", "xml-illegal-code-point"],
    ["\ufffe", "xml-illegal-code-point"],
    ["\uffff", "xml-illegal-code-point"],
    ["\ud800", "unpaired-surrogate"],
    ["\udc00", "unpaired-surrogate"],
  ] as const)(
    "returns safe R005 and no SVG for illegal device.type %j",
    (value, reason) => {
      const original = required(
        graph.metadataTextSources.find(({ field }) => field === "device.type"),
      );
      const changed = {
        ...graph,
        metadataTextSources: [{ ...original, value }],
      };
      const result = emittedOutcome(changed, layout);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        code: "R005",
        message: `Invalid render text: device ${original.ownerId} field device.type contains ${reason}.`,
        family: "control",
        ownerKind: "device",
        ownerId: original.ownerId,
        field: "device.type",
        reason,
        root: "K1",
      });
      expect(JSON.stringify(result.error)).not.toContain(value);
    },
  );

  it.each([
    ["device.location", "\0", "xml-illegal-code-point"],
    ["device.location", "\ud800", "unpaired-surrogate"],
    ["wire.properties.label", "\0", "xml-illegal-code-point"],
    ["wire.properties.label", "\udc00", "unpaired-surrogate"],
  ] as const)("preflights %s before emitting bytes", (field, value, reason) => {
    const labels = [
      ...graph.locationGroups.map(({ label }) => label),
      ...graph.edges.flatMap(({ label }) =>
        label === undefined ? [] : [label],
      ),
    ];
    const source = required(
      labels
        .flatMap(({ textSources }) => textSources)
        .find((item) => item.field === field),
    );
    const result = emittedOutcome(
      {
        ...graph,
        metadataTextSources: [{ ...source, value }],
      },
      layout,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "R005",
        message: `Invalid render text: ${source.ownerKind} ${source.ownerId} field ${field} contains ${reason}.`,
        family: "control",
        ownerKind: source.ownerKind,
        ownerId: source.ownerId,
        field,
        reason,
        root: "K1",
      },
    });
  });

  it("serializes source CR, LF, and tab in location and wire text as numeric references", () => {
    const locationText = "P\rQ\nR\tS";
    const wireText = "W\tX\nY\rZ";
    const location = required(
      graph.locationGroups.find(({ label }) =>
        label.textSources.some(({ field }) => field === "device.location"),
      ),
    );
    const wire = required(
      graph.edges.find(({ label }) =>
        label?.textSources.some(
          ({ field }) => field === "wire.properties.label",
        ),
      ),
    );
    const locationLabel = {
      ...location.label,
      text: locationText,
      textSources: location.label.textSources.map((source) => ({
        ...source,
        value: source.field === "device.location" ? locationText : source.value,
      })),
    };
    const wireLabel = {
      ...wire.label!,
      text: wireText,
      textSources: wire.label!.textSources.map((source) => ({
        ...source,
        value:
          source.field === "wire.properties.label" ? wireText : source.value,
      })),
    };
    const changedGraph: PresentationGraph = {
      ...graph,
      locationGroups: graph.locationGroups.map((group) =>
        group.id === location.id
          ? {
              ...group,
              identity: ["authored", locationText],
              label: locationLabel,
            }
          : group,
      ),
      edges: graph.edges.map((edge) =>
        edge.id === wire.id ? { ...edge, label: wireLabel } : edge,
      ),
    };
    const changedLayout: NormalizedSchematicLayout = {
      ...layout,
      labels: layout.labels.map((label) =>
        label.id === location.label.id
          ? { ...label, text: locationText }
          : label.id === wire.label!.id
            ? { ...label, text: wireText }
            : label,
      ),
    };
    const output = emitted(changedGraph, changedLayout);
    expect(output).toContain("P&#xD;Q&#xA;R&#x9;S");
    expect(output).toContain("W&#x9;X&#xA;Y&#xD;Z");
    expect(output).not.toContain("\r");
    expect(output).not.toContain("\t");
    checkRestrictedSvgXml(output);
  });

  it("reserves and clips wide CJK, emoji, and combining label text", () => {
    const text = "中😀e\u0301";
    const width = 30.8;
    const edge = required(graph.edges.find(({ label }) => label !== undefined));
    const label = edge.label!;
    const changedLabel = {
      ...label,
      text,
      width,
      textLength: 24.8,
      textSources: label.textSources.map((source) => ({
        ...source,
        value: text,
      })),
    };
    const changedGraph: PresentationGraph = {
      ...graph,
      edges: graph.edges.map((value) =>
        value.id === edge.id ? { ...value, label: changedLabel } : value,
      ),
    };
    const changedLayout: NormalizedSchematicLayout = {
      ...layout,
      labels: layout.labels.map((value) =>
        value.id === label.id ? { ...value, text, width } : value,
      ),
    };
    const output = emitted(changedGraph, changedLayout);
    const clip = svgSemanticId("clip", [label.id]);
    expect(output).toContain(`id="${clip}" clipPathUnits="userSpaceOnUse"`);
    expect(output).toContain(
      'textLength="24.8" lengthAdjust="spacingAndGlyphs">中😀é</text>',
    );
    expect(output).toContain(`clip-path="url(#${clip})"`);
    checkRestrictedSvgXml(output);
  });

  it("keeps authored and virtual UNSPECIFIED location namespaces distinct in one SVG", async () => {
    const ir = structuredClone(coreIr);
    required(
      ir.devices.find(({ designation }) => designation === "K1"),
    ).location = "UNSPECIFIED";
    required(
      ir.devices.find(({ designation }) => designation === "PLC1"),
    ).location = undefined;
    const fixture = await presentationAndLayout(ir);
    const output = emitted(fixture.graph, fixture.layout);
    const authored = svgSemanticId("location", ["authored", "UNSPECIFIED"]);
    const virtual = svgSemanticId("location", ["virtual", "UNSPECIFIED"]);
    expect(authored).not.toBe(virtual);
    expect(output).toContain(
      `id="${authored}" class="location-group" data-location="UNSPECIFIED"`,
    );
    expect(output).toContain(
      `id="${virtual}" class="location-group" data-virtual-location="UNSPECIFIED"`,
    );
    checkRestrictedSvgXml(output);
  });

  it("keeps equal function and aggregate keys in kind-tagged namespaces in one SVG", () => {
    const functionNode = required(
      graph.nodes.find(
        (node): node is SymbolPresentationNode =>
          node.kind === "symbol" && node.representation === "function",
      ),
    );
    const key = required(functionNode.functionIds[0]).functionKey;
    const functionLabel = required(
      functionNode.labels.find(({ role }) => role === "function"),
    );
    const aggregateId = JSON.stringify([
      "aggregate",
      functionNode.deviceUid,
      key,
    ]);
    const aggregateLabel = {
      ...functionLabel,
      id: JSON.stringify(["label", "symbol", aggregateId, "aggregate"]),
      ownerId: aggregateId,
      role: "aggregate" as const,
      text: key,
      textSources: [
        {
          ownerKind: "aggregate" as const,
          ownerId: svgSemanticId("aggregate", [functionNode.deviceUid, key]),
          field: "aggregate.key" as const,
          value: key,
        },
      ],
    };
    const aggregateNode: SymbolPresentationNode = {
      ...functionNode,
      id: aggregateId,
      representation: "aggregate",
      ports: [],
      attachments: [],
      labels: [aggregateLabel],
    };
    const sourceNodeLayout = required(
      layout.nodes.find(({ id }) => id === functionNode.id),
    );
    const sourceLabelLayout = required(
      layout.labels.find(({ id }) => id === functionLabel.id),
    );
    const changedGraph: PresentationGraph = {
      ...graph,
      nodes: [...graph.nodes, aggregateNode],
    };
    const changedLayout: NormalizedSchematicLayout = {
      ...layout,
      nodes: [...layout.nodes, { ...sourceNodeLayout, id: aggregateId }],
      labels: [
        ...layout.labels,
        {
          ...sourceLabelLayout,
          id: aggregateLabel.id,
          ownerId: aggregateId,
          role: "aggregate",
          text: key,
        },
      ],
    };
    const output = emitted(changedGraph, changedLayout);
    expect(output).toContain(
      `id="${svgSemanticId("function", [functionNode.deviceUid, key])}"`,
    );
    expect(output).toContain(
      `id="${svgSemanticId("aggregate", [functionNode.deviceUid, key])}"`,
    );
    checkRestrictedSvgXml(output);
  });

  it("renders true junction dots but no element or metadata at a crossing", () => {
    const junctions = [
      ["a-top", "net-a", 100, 20],
      ["a-bottom", "net-a", 100, 180],
      ["b-left", "net-b", 20, 100],
      ["b-right", "net-b", 180, 100],
    ] as const;
    const nodes = junctions.map(([id, netId]) => ({
      kind: "junction" as const,
      id,
      parentId: "root" as const,
      classification: "junction" as const,
      netId,
      terminal: { deviceUid: id, terminalKey: "T" },
      ports: [],
    }));
    const boundary = (
      id: string,
      netId: string,
      source: string,
      target: string,
    ) => ({
      id,
      parentId: "root" as const,
      kind: "boundary-segment" as const,
      sourcePortId: `${source}-port`,
      targetPortId: `${target}-port`,
      netId,
      elementIds: [],
      endpoints: [
        { deviceUid: source, terminalKey: "T" },
        { deviceUid: target, terminalKey: "T" },
      ] as const,
      pathRank: 0,
    });
    const edges = [
      boundary("edge-a", "net-a", "a-top", "a-bottom"),
      boundary("edge-b", "net-b", "b-left", "b-right"),
    ];
    const crossingGraph: PresentationGraph = {
      format: "schematic-presentation/0.1",
      view: graph.view,
      locationGroups: [],
      deviceGroups: [],
      nodes,
      edges,
      metadataTextSources: [
        {
          ownerKind: "device",
          ownerId: svgSemanticId("device", [graph.view.root.deviceUid]),
          field: "device.designation",
          value: graph.view.root.designation,
        },
        {
          ownerKind: "terminal",
          ownerId: svgSemanticId("terminal", ["a-top", "T"]),
          field: "terminal.key",
          value: "T",
        },
      ],
    };
    const crossingLayout: NormalizedSchematicLayout = {
      format: "schematic-layout/0.1",
      view: graph.view,
      width: 200,
      height: 200,
      nodes: junctions.map(([id, , x, y]) => ({
        id,
        parentId: "root",
        kind: "junction",
        x,
        y,
        width: 0,
        height: 0,
      })),
      ports: [],
      labels: [],
      edges: [
        {
          id: "edge-a",
          kind: "boundary-segment",
          netId: "net-a",
          sourcePortId: "a-top-port",
          targetPortId: "a-bottom-port",
          sectionIds: ["a"],
          sections: [
            {
              id: "a",
              points: [
                { x: 100, y: 20 },
                { x: 100, y: 180 },
              ],
            },
          ],
          points: [
            { x: 100, y: 20 },
            { x: 100, y: 180 },
          ],
        },
        {
          id: "edge-b",
          kind: "boundary-segment",
          netId: "net-b",
          sourcePortId: "b-left-port",
          targetPortId: "b-right-port",
          sectionIds: ["b"],
          sections: [
            {
              id: "b",
              points: [
                { x: 20, y: 100 },
                { x: 180, y: 100 },
              ],
            },
          ],
          points: [
            { x: 20, y: 100 },
            { x: 180, y: 100 },
          ],
        },
      ],
      crossings: [
        {
          edgeIds: ["edge-a", "edge-b"],
          netIds: ["net-a", "net-b"],
          point: { x: 100, y: 100 },
        },
      ],
    };
    const output = emitted(crossingGraph, crossingLayout);
    expect(output.match(/id="junction-/g)).toHaveLength(4);
    expect(output).not.toContain('cx="120" cy="120"');
    expect(output).not.toContain("data-crossing");
    expect(output.match(/class="boundary-path"/g)).toHaveLength(2);
    expect(output.match(/data-presentation-only="true"/g)).toHaveLength(2);
    checkRestrictedSvgXml(output);
  });
});
