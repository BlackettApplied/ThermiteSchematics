import type { PreparedSchematicDrawing } from "../renderer.js";
import { svgSemanticId, escapeXmlAttribute } from "../svg/escape.js";
import { unescape } from "../device-legend/svg-tree.js";
import type { NativeOccurrenceSeed } from "./navigation-types.js";

export function nativeOccurrenceSeeds(
  p: PreparedSchematicDrawing,
): NativeOccurrenceSeed[] {
  return p.graph.nodes.flatMap((node) => {
    if (node.kind === "junction" || !node.functionIds.length) return [];
    const representation =
      node.kind === "rail" ? "boundary" : node.representation;
    const nativeId =
      node.kind === "rail"
        ? svgSemanticId("rail", [
            node.deviceUid,
            node.boundary.terminal.terminalKey,
            node.boundary.kind,
          ])
        : node.representation === "terminal"
          ? svgSemanticId("terminal", [
              node.deviceUid,
              node.ports[0]?.terminal.terminalKey ?? "",
              "context",
            ])
          : node.representation === "function"
            ? svgSemanticId("function", [
                node.deviceUid,
                node.functionIds[0]?.functionKey ?? "",
              ])
            : svgSemanticId("aggregate", [
                node.deviceUid,
                node.labels
                  .flatMap((l) => l.textSources)
                  .find((s) => s.field === "aggregate.key")?.value ??
                  JSON.parse(node.id)[2],
              ]);
    return node.functionIds.map((source) => ({
      source,
      logicalKey: node.id,
      nativeId,
      representation,
      terminals: node.ports
        .filter(
          (port) =>
            !port.memberFunctionId ||
            port.memberFunctionId.functionKey === source.functionKey,
        )
        .map((port) => ({
          key: port.terminal.terminalKey,
          primitiveId: svgSemanticId("terminal", [
            port.terminal.deviceUid,
            port.terminal.terminalKey,
            port.symbolPortId,
          ]),
        })),
      body: { x: 0, y: 0, w: node.symbolSize.width, h: node.symbolSize.height },
    }));
  });
}
export function markNativeOccurrences(
  inner: string,
  seeds: readonly NativeOccurrenceSeed[],
) {
  const ids = new Set(seeds.map((s) => s.nativeId));
  return inner.replace(/<g\b[^>]*>/g, (tag) => {
    const id = /\bid="([^"]*)"/.exec(tag)?.[1];
    return id && ids.has(unescape(id))
      ? tag.replace(
          "<g ",
          `<g data-navigation-native="${escapeXmlAttribute(unescape(id))}" `,
        )
      : tag;
  });
}

/** A compact sheet can retain several authored selections, each with its own seed bank. */
export function navigationDraftInputs(
  drafts: readonly import("./types.js").Draft[],
): readonly import("./navigation-types.js").NavigationDraftInput[] {
  return drafts.flatMap(
    (d) =>
      d.navigationInputs ??
      (d.navigationView
        ? [{ view: d.navigationView, seeds: d.navigationSeeds ?? [] }]
        : []),
  );
}
