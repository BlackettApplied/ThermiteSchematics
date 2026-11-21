import type { DocumentDependency, IssuedDocument } from "./document-types.js";
import {
  documentCaptionTokens,
  wrapDocumentTokens,
} from "./document-caption-text.js";
import { printableTextMetrics } from "../text-metrics.js";

/** Each native need retains its own text and locator within one measured block. */
export function portCaptionPack(
  needs: readonly DocumentDependency[],
  documents: readonly IssuedDocument[],
  width: number,
) {
  const entries: {
    need: DocumentDependency;
    lines: string[];
    x: number;
    y: number;
  }[] = [];
  let x = 0,
    y = 0,
    rowLines = 0;
  for (const need of needs) {
    const tokens = documentCaptionTokens(need, documents, false);
    if (tokens.some((t) => printableTextMetrics(t, 2.5).advance > width - 2))
      return undefined;
    const lines = wrapDocumentTokens(tokens, width - 2);
    const advance =
      Math.max(...lines.map((s) => printableTextMetrics(s, 2.5).advance)) + 2;
    if (x && x + advance > width) {
      y += rowLines * 3.6;
      x = 0;
      rowLines = 0;
    }
    entries.push({ need, lines, x, y });
    x += advance + 2;
    rowLines = Math.max(rowLines, lines.length);
  }
  return { entries, width, height: y + rowLines * 3.6 + 2 };
}
