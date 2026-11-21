import type { TerminalId } from "@thermite/compiler";
import type {
  PresentationLabel,
  PresentationLabelOwnerKind,
} from "../types.js";
import type { OffViewConnection } from "./model.js";
import { compareRenderTextSource, structuralTupleId } from "../ordering.js";
import { cardTextMetrics, wrapCardText } from "./metrics.js";

export const CARD_FONT = 12;
export const CARD_PITCH = 16;
export const CARD_PAD = 4;
export const CARD_GAP = 20;

export function createOffViewCard(
  terminal: TerminalId,
  terminalName: string,
  connections: readonly OffViewConnection[],
  ownerKind: PresentationLabelOwnerKind,
  ownerId: string,
  maximumWidth = 240,
): PresentationLabel {
  const heading = `Off-view at ${terminalName}`;
  const rows = connections.map((c) => `${c.designation} → ${c.destination}`);
  const width = Math.min(
    maximumWidth,
    Math.max(
      cardTextMetrics(heading, CARD_FONT, true).width,
      ...rows.map((s) => cardTextMetrics(s, CARD_FONT).width),
    ) +
      2 * CARD_PAD,
  );
  const lines = [
    ...wrapCardText(heading, width - 2 * CARD_PAD, CARD_FONT, true).map(
      (text) => ({
        text,
        bold: true,
      }),
    ),
    ...rows.flatMap((row) =>
      wrapCardText(row, width - 2 * CARD_PAD, CARD_FONT).map((text) => ({
        text,
        bold: false,
      })),
    ),
  ];
  const metrics = lines.map((l) => cardTextMetrics(l.text, CARD_FONT, l.bold));
  const firstBaseline = CARD_PAD + Math.max(...metrics.map((m) => m.ascent));
  const positioned = lines.map((line, i) => ({
    ...line,
    baseline: firstBaseline + i * CARD_PITCH,
    offsetX: metrics[i]?.offsetX ?? 0,
  }));
  const height =
    CARD_PAD +
    Math.max(
      ...positioned.map(
        (line, i) => line.baseline + (metrics[i]?.descent ?? 0),
      ),
    );
  return {
    id: structuralTupleId("label", ownerKind, ownerId, "off-view"),
    ownerKind,
    ownerId,
    role: "off-view",
    text: [heading, ...rows].join("\n"),
    width: Math.ceil(width * 1000) / 1000,
    height: Math.ceil(height * 1000) / 1000,
    textLength: width - 2 * CARD_PAD,
    textSources: connections
      .flatMap((c) => c.textSources)
      .sort(compareRenderTextSource),
    offView: {
      terminal: {
        deviceUid: terminal.deviceUid,
        terminalKey: terminal.terminalKey,
      },
      terminalName,
      connections,
      lines: positioned,
      position: { x: 0, y: 0 },
    },
  };
}
