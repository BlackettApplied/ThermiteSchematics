import {
  contactCaptionWidth,
  contactCaptionSymbol,
  verticalContactCaption,
} from "./contact-caption.js";
import type {
  PresentationLabel,
  PresentationGraph,
  SelectedSubgraph,
} from "../types.js";
import { invariant, labelWidth, sameStringSet, conductorKey } from "./util.js";
import { structuralTupleId, compareRenderTextSource } from "../ordering.js";
import type { ElectricalIr, IrDevice } from "@thermite/compiler";
import type { DeviceTypeSymbolMapping } from "../symbols/mappings.js";
import { summarizePresentationGraph } from "./summary.js";
import { svgSemanticId } from "../svg/escape.js";
import { validateOffViewLabel } from "../off-view/validate.js";
import { orderedPowerLanes } from "./util.js";

function validateLabel(
  label: PresentationLabel,
  graph: Readonly<PresentationGraph>,
  selected: Readonly<SelectedSubgraph>,
): void {
  if (label.role === "off-view") {
    validateOffViewLabel(label);
    return;
  }
  const owner = graph.nodes.find((n) => n.id === label.ownerId);
  const contact =
    owner?.kind === "symbol" &&
    (verticalContactCaption(owner.orientation, label, owner.symbolId) ||
      (owner.mechanicalGangId !== undefined &&
        label.role === "function" &&
        contactCaptionSymbol(owner.symbolId)));
  invariant(
    label.width ===
      (contact
        ? contactCaptionWidth(label)
        : owner?.kind === "symbol" && orderedPowerLanes(selected)
          ? labelWidth(label.printableText ?? label.text)
          : Math.max(
              labelWidth(label.text),
              labelWidth(label.printableText ?? label.text),
            )),
    `${label.id} width`,
  );
  invariant(label.height === 14, `${label.id} height`);
  invariant(
    label.textLength === Number((label.width - 6).toFixed(3)),
    `${label.id} text length`,
  );
  invariant(
    label.id ===
      structuralTupleId("label", label.ownerKind, label.ownerId, label.role),
    `${label.id} identity`,
  );
  const sortedSources = [...label.textSources].sort(compareRenderTextSource);
  invariant(
    JSON.stringify(label.textSources) === JSON.stringify(sortedSources),
    `${label.id} text source order`,
  );
}

function collectPresentationLabels(
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
  ];
}

export function validateProvenance(
  ir: Readonly<ElectricalIr>,
  graph: Readonly<PresentationGraph>,
  mappings: readonly DeviceTypeSymbolMapping[],
  selected: Readonly<SelectedSubgraph>,
) {
  const graphSummary = summarizePresentationGraph(ir, graph, mappings);
  invariant(
    sameStringSet(graphSummary.deviceUids, selected.deviceUids),
    "selected device provenance union",
  );
  invariant(
    sameStringSet(graphSummary.netIds, selected.netIds),
    "selected net provenance union",
  );
  invariant(
    sameStringSet(
      graphSummary.conductiveElementIds.map(conductorKey),
      selected.conductiveElementIds.map(conductorKey),
    ),
    "selected conductor provenance union",
  );
}

export function validateLabelsAndMetadata(
  graph: Readonly<PresentationGraph>,
  selected: Readonly<SelectedSubgraph>,
  deviceByUid: Map<string, IrDevice>,
) {
  const labels = collectPresentationLabels(graph);
  const labelIds = new Set<string>();
  for (const label of labels) {
    invariant(!labelIds.has(label.id), `${label.id} unique label`);
    labelIds.add(label.id);
    validateLabel(label, graph, selected);
  }
  const sortedMetadata = [...graph.metadataTextSources].sort(
    compareRenderTextSource,
  );
  invariant(
    JSON.stringify(graph.metadataTextSources) ===
      JSON.stringify(sortedMetadata),
    "metadata text source order",
  );
  const typeSources = graph.metadataTextSources.filter(
    ({ ownerKind, field }) => ownerKind === "device" && field === "device.type",
  );
  invariant(
    typeSources.length === selected.deviceUids.length,
    "one device.type source per selected device",
  );
  for (const deviceUid of selected.deviceUids) {
    const device = deviceByUid.get(deviceUid);
    invariant(device !== undefined, `${deviceUid} selected device exists`);
    const matches = typeSources.filter(
      ({ ownerId, value }) =>
        ownerId === svgSemanticId("device", [deviceUid]) &&
        value === device.typeId,
    );
    invariant(
      matches.length === 1,
      `${deviceUid} safe UID-owned device.type source`,
    );
  }
}
