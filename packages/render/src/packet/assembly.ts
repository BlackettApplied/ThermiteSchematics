import { PacketDraftError, type PacketViewContext } from "./errors.js";
import type { ElectricalIr } from "@thermite/compiler";
import type {
  Draft,
  PaperPage,
  RenderedSheet,
  SchematicPacketRequest,
} from "./types.js";
import { frame, zone, sheetLabel } from "./page.js";
import { n } from "./svg.js";
import {
  emitCircuitContinuationBlock,
  emitCommunicationContinuationBlock,
} from "./continuations.js";

/** Resolve view-local destinations before optional compact packing, in authored order. */
export function appendViewDrafts(
  drafts: Draft[],
  incoming: Draft[],
  viewIndex: number,
  layout: SchematicPacketRequest["layout"],
  referenceNumber: number,
  context?: PacketViewContext,
): number {
  for (const draft of incoming)
    draft.views = [context ?? { viewIndex, title: sheetLabel(draft.view) }];
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
      previous.views = [...(previous.views ?? []), ...(draft.views ?? [])];
      previous.content += `<g transform="translate(0 ${n(offset)})">${draft.content}</g>`;
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

/** Final packet sheet numbers also namespace SVG IDs and continuation metadata. */
export function assembleSheets(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  page: PaperPage,
): RenderedSheet[] {
  const netIds = new Map(
    ir.indexes.netIdByTerminal.map((e) => [
      JSON.stringify([e.key.deviceUid, e.key.terminalKey]),
      e.value,
    ]),
  );
  for (const draft of drafts)
    for (const block of draft.circuitBlocks ?? [])
      draft.content += emitCircuitContinuationBlock(block);
  for (const draft of drafts)
    if (draft.communicationBlock)
      draft.content += emitCommunicationContinuationBlock(
        draft.communicationBlock,
      );
  const sheets = drafts.map((draft, index) => ({
    number: index + 1,
    view: draft.view,
    references: draft.references ?? [],
    svg: (() => {
      try {
        return frame(draft, page, index + 1, drafts.length);
      } catch (error) {
        throw new PacketDraftError(
          error instanceof Error ? error.message : "Sheet assembly failed.",
          draft.views ?? [],
        );
      }
    })(),
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
    continuations: draft.links.map((link) => ({
      id: link.id,
      toSheet: link.to,
      conductor: link.conductor,
      netId: link.netId,
    })),
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
