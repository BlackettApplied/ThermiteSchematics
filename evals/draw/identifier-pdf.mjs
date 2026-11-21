// Painted PDF extraction, including spaces and PDF-only line breaks. No matching
// against SVG text strings: exact-line matching would hide a PDF-only defect.
import { paintedPdfItems, PaintedPdfMeasurementError } from "./pdf-painted.mjs";
import { pointBounds } from "./pdf-clip-operators.mjs";
import { IdentifierMeasurementError } from "./identifier-errors.mjs";

function withPaintedBox(item, glyphs) {
  const points = glyphs
    .filter((glyph) => glyph.visible && glyph.text.trim())
    .flatMap((glyph) => glyph.points);
  return points.length ? { ...item, paintedBox: pointBounds(points) } : item;
}

async function identifierPdfContent(page) {
  try {
    return await page.getTextContent({ disableNormalization: true });
  } catch (error) {
    if (
      ![
        "AbortException",
        "FormatError",
        "InvalidPDFException",
        "UnexpectedResponseException",
        "UnknownErrorException",
        "PasswordException",
      ].includes(error?.name)
    )
      throw error;
    throw new IdentifierMeasurementError(
      `Identifier measurement: PDF extraction failed: ${error.message}`,
      { cause: error },
    );
  }
}
export async function pdfIdentifierRuns(page) {
  const content = await identifierPdfContent(page);
  const viewport = page.getViewport({ scale: 25.4 / 72 });
  const items = content.items
    .filter((item) => typeof item.str === "string" && item.str.length)
    .map((item, index) => {
      const [x, y] = viewport.convertToViewportPoint(
        item.transform[4],
        item.transform[5],
      );
      const size =
        (Math.hypot(item.transform[2], item.transform[3]) * 25.4) / 72;
      return {
        text: item.str,
        extractionIndex: index,
        fontSize: size,
        anchor: { x, y },
        bbox: { x, y: y - size, w: (item.width * 25.4) / 72, h: size },
      };
    });
  const nonempty = content.items.filter(
    (item) => typeof item.str === "string" && item.str.trim(),
  );
  const measured = items.filter((item) => item.text.trim());
  let painted;
  try {
    painted = await paintedPdfItems(page, measured, nonempty, withPaintedBox);
  } catch (error) {
    if (!(error instanceof PaintedPdfMeasurementError)) throw error;
    throw new IdentifierMeasurementError(error.message, { cause: error });
  }
  // Extraction-only whitespace separates runs/columns; it carries no ink.
  // Preserve those separators while all character-bearing runs use PDF clips.
  return [...painted, ...items.filter((item) => !item.text.trim())]
    .sort((a, b) => a.extractionIndex - b.extractionIndex)
    .map(({ fontSize, extractionIndex, ...item }) => item);
}
