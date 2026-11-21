import { resolveTerminalStripLocations } from "./terminal-strip.js";
import { resolveNativePartLocations } from "./native-part-locations.js";
import {
  renderedRootedContinuations,
  resolveRootedContinuations,
} from "./continuation-resolve.js";
import { PacketDraftError, type PacketViewContext } from "./errors.js";
import type { ElectricalIr } from "@thermite/compiler";
import type {
  Draft,
  PaperPage,
  RenderedSheet,
  SchematicPacketRequest,
} from "./types.js";
import { frame, zone, sheetLabel } from "./page.js";
import { boundaryCaptionContents } from "./boundary-captions.js";
import { n, namespaceContentIds } from "./svg.js";
import { navigationDraftInputs } from "./navigation-seeds.js";
import { escapeXmlAttribute } from "../svg/escape.js";
import {
  emitCircuitContinuationBlock,
  emitCommunicationContinuationBlock,
} from "./continuations.js";

function markViewDrafts(
  incoming: Draft[],
  viewIndex: number,
  context: PacketViewContext | undefined,
  navigationView: import("./navigation-types.js").NavigationView | undefined,
) {
  for (const draft of incoming) {
    if (draft.issuedDocument) {
      draft.issuedDocument = {
        ...draft.issuedDocument,
        id: `${draft.issuedDocument.id}/${navigationView?.key ?? viewIndex}`,
      };
      draft.content = `<g data-document-id="${escapeXmlAttribute(draft.issuedDocument.id)}">${draft.content}</g>`;
    }
    draft.views = [context ?? { viewIndex, title: sheetLabel(draft.view) }];
    if (navigationView) {
      if (draft.documentNeeds)
        draft.documentNeeds = draft.documentNeeds.map((need) => ({
          ...need,
          viewKey: navigationView.key,
        }));
      draft.navigationView = navigationView;
      draft.navigationInputs = [
        { view: navigationView, seeds: draft.navigationSeeds ?? [] },
      ];
      draft.content = `<g data-navigation-view="${escapeXmlAttribute(navigationView.key)}">${draft.content}</g>`;
    }
  }
}

/** Resolve view-local destinations before optional compact packing, in authored order. */
export function appendViewDrafts(
  drafts: Draft[],
  incoming: Draft[],
  viewIndex: number,
  layout: SchematicPacketRequest["layout"],
  referenceNumber: number,
  context?: PacketViewContext,
  navigationView?: import("./navigation-types.js").NavigationView,
): number {
  markViewDrafts(incoming, viewIndex, context, navigationView);
  for (const draft of incoming) {
    const block = draft.communicationBlock;
    if (!block) continue;
    block.view = viewIndex + 1;
    for (const row of block.rows)
      for (const target of row.targets) target.sheet += drafts.length;
  }
  for (const draft of incoming)
    for (const block of draft.circuitBlocks ?? [])
      for (const row of block.rows)
        for (const target of row.targets) target.sheet += drafts.length;
  const references = new Map<string, string>();
  for (const draft of incoming)
    for (const link of draft.links) {
      link.to += drafts.length;
      if (!references.has(link.id))
        references.set(
          link.id,
          `C${String(++referenceNumber).padStart(3, "0")}`,
        );
      link.id = references.get(link.id)!;
    }
  for (const draft of incoming) {
    const previous = drafts.at(-1);
    if (
      layout === "compact" &&
      previous?.communicationHeight !== undefined &&
      draft.communicationHeight !== undefined &&
      !previous.communicationBlock &&
      !draft.communicationBlock &&
      previous.title.lines[0]?.value === draft.title.lines[0]?.value &&
      previous.communicationHeight + 10 + draft.communicationHeight <=
        previous.drawingBounds!.h
    ) {
      const offset = previous.communicationHeight + 10;
      mergeNavigationInputs(previous, draft);
      previous.views = [...(previous.views ?? []), ...(draft.views ?? [])];
      previous.content += `<g transform="translate(0 ${n(offset)})">${namespaceContentIds(draft.content, `view-${viewIndex}-`)}</g>`;
      previous.coverage = [
        ...(previous.coverage ?? []),
        ...(draft.coverage ?? []),
      ];
      previous.topologyCoverage = [
        ...(previous.topologyCoverage ?? []),
        ...(draft.topologyCoverage ?? []),
      ];
      previous.references!.push(
        ...draft.references!.map((r) => ({
          ...r,
          yMm: r.yMm! + offset,
          zone: zone(r.xMm!, r.yMm! + offset, previous.drawingBounds!),
        })),
      );
      previous.communicationHeight += 10 + draft.communicationHeight;
    } else drafts.push(draft);
  }
  return referenceNumber;
}

function terminalNetIds(ir: Readonly<ElectricalIr>) {
  return new Map(
    ir.indexes.netIdByTerminal.map((e) => [
      JSON.stringify([e.key.deviceUid, e.key.terminalKey]),
      e.value,
    ]),
  );
}

function frameIssuedSheet(
  draft: Draft,
  page: PaperPage,
  sheet: number,
  total: number,
  referenceSheet: number,
) {
  const issued =
    referenceSheet &&
    draft.view.format === "documentation-view/0.1" &&
    draft.view.kind === "circuit"
      ? {
          ...draft,
          note: `${draft.note} · Device and function references S${String(referenceSheet).padStart(2, "0")}`,
        }
      : draft;
  try {
    return frame(issued, page, sheet, total);
  } catch (error) {
    throw new PacketDraftError(
      error instanceof Error ? error.message : "Sheet assembly failed.",
      draft.views ?? [],
    );
  }
}

/** Final packet sheet numbers also namespace SVG IDs and continuation metadata. */
export function assembleSheets(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  page: PaperPage,
): RenderedSheet[] {
  const netIds = terminalNetIds(ir);
  resolveTerminalStripLocations(drafts, page);
  resolveNativePartLocations(drafts);
  for (const draft of drafts)
    for (const block of draft.circuitBlocks ?? [])
      draft.content += emitCircuitContinuationBlock(block);
  for (const draft of drafts)
    if (draft.communicationBlock)
      draft.content += emitCommunicationContinuationBlock(
        draft.communicationBlock,
      );
  resolveRootedContinuations(drafts, page);
  const contents = boundaryCaptionContents(drafts);
  const referenceSheet =
    drafts.findIndex(
      (d) =>
        d.view.format === "documentation-view/0.1" &&
        d.view.kind === "references",
    ) + 1;
  const sheets = drafts.map((draft, index) => ({
    ...(draft.resolvedTitle ? { sheetKey: draft.resolvedTitle.sheetKey } : {}),
    number: index + 1,
    view: draft.view,
    references: draft.references ?? [],
    svg: frameIssuedSheet(
      { ...draft, content: contents[index] ?? draft.content },
      page,
      index + 1,
      drafts.length,
      referenceSheet,
    ),
    ...(draft.circuitBlocks?.length
      ? {
          circuitContinuations: draft.circuitBlocks.flatMap((block) =>
            block.rows.flatMap((row) =>
              row.targets.map((target) => ({
                group: block.group,
                fromPart: block.part,
                toPart: target.part,
                toSheet: target.sheet,
                terminalId: row.id,
                netId: netIds.get(row.id) ?? null,
              })),
            ),
          ),
        }
      : {}),
    continuations: renderedRootedContinuations(draft),
    ...(draft.communicationBlock
      ? {
          communicationContinuations: draft.communicationBlock.rows.flatMap(
            (row) =>
              row.targets.map((target) => ({
                view: draft.communicationBlock!.view,
                fromPart: draft.communicationBlock!.part,
                toPart: target.part,
                toSheet: target.sheet,
                deviceUid: row.deviceUid,
              })),
          ),
        }
      : {}),
  }));
  return sheets;
}

function mergeNavigationInputs(previous: Draft, draft: Draft) {
  previous.documentNeeds = [
    ...(previous.documentNeeds ?? []),
    ...(draft.documentNeeds ?? []),
  ];
  previous.navigationInputs = [
    ...navigationDraftInputs([previous]),
    ...navigationDraftInputs([draft]),
  ];
}
