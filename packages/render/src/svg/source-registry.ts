import { comparePresentationLabel } from "../ordering.js";
import type {
  PresentationGraph,
  PresentationLabel,
  RenderTextSource,
} from "../types.js";

function allPresentationLabels(
  graph: Readonly<PresentationGraph>,
): readonly PresentationLabel[] {
  return [
    ...graph.locationGroups.map(({ label }) => label),
    ...graph.deviceGroups.map(({ label }) => label),
    ...graph.nodes.flatMap((node) =>
      node.kind === "junction" ? [] : node.labels,
    ),
    ...graph.edges.flatMap((edge) => [
      ...(edge.label === undefined ? [] : [edge.label]),
      ...(edge.netLabel === undefined ? [] : [edge.netLabel]),
    ]),
  ].sort(comparePresentationLabel);
}

export interface RenderSourceRegistry {
  readonly sources: readonly RenderTextSource[];
  valueFor(
    field: RenderTextSource["field"],
    value: string,
    context: string,
  ): string;
}

export function buildRenderSourceRegistry(
  graph: Readonly<PresentationGraph>,
): RenderSourceRegistry {
  const sources = [
    ...graph.metadataTextSources,
    ...allPresentationLabels(graph).flatMap(({ textSources }) => textSources),
  ];
  const byFieldAndValue = new Map<string, RenderTextSource>();
  for (const source of sources) {
    byFieldAndValue.set(JSON.stringify([source.field, source.value]), source);
  }
  return Object.freeze({
    sources: Object.freeze([...sources]),
    valueFor(
      field: RenderTextSource["field"],
      value: string,
      context: string,
    ): string {
      const source = byFieldAndValue.get(JSON.stringify([field, value]));
      if (source === undefined) {
        throw new Error(
          `SVG source registry has no ${field} value for ${context}.`,
        );
      }
      return source.value;
    },
  });
}
