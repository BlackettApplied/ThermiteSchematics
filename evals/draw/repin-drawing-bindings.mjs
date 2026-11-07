// Pixel-derived facts for independent review; this module never grants sign-off.
import assert from "node:assert/strict";
import { hash, json } from "./support.mjs";
import { drawingHash } from "./png-ink.mjs";
export function drawingReferences(file) {
  return [
    ...file.entries
      .filter((e) => e.crop)
      .map((entry) => ({ entry, crop: entry.crop })),
    ...(file.notMove ?? []).flatMap((e) =>
      (e.crops ?? []).map((crop) => ({ entry: crop, crop })),
    ),
  ];
}
export function checkCropDrawing(entry, crop, bytes) {
  assert(
    /^[a-f0-9]{64}$/.test(entry.drawingSha256 ?? ""),
    "Bind drawingSha256 from the crop before sign-off",
  );
  assert(
    drawingHash(
      bytes,
      crop.headerPixels === undefined ? 0 : crop.headerPixels,
    ) === entry.drawingSha256,
    "Signed drawing hash differs from crop pixels",
  );
}
export function checkSignedDrawings(file, rows, label = "Signed") {
  const byPath = new Map(rows.map((c) => [c.path, c]));
  for (const { entry, crop } of drawingReferences(file)) {
    assert(
      /^[a-f0-9]{64}$/.test(entry.drawingSha256 ?? ""),
      label + " crop needs drawingSha256",
    );
    assert(
      byPath.get(crop.path)?.drawingSha256 === entry.drawingSha256,
      label + " drawing hash differs from crop index",
    );
  }
}
export function bindDrawingDraft(file, index, crops) {
  assert(
    file.format === "thermite-draw-decisions/1.0" &&
      Array.isArray(file.entries),
    "Use an unreviewed decisions draft",
  );
  assert(
    file.entries.every(
      (e) =>
        e.reviewed === false &&
        !e.signOff?.kind &&
        !e.signOff?.by &&
        e.counterSignOffs === undefined,
    ),
    "Bind crops before review/sign-off; never edit signed content",
  );
  const result = structuredClone(file),
    refs = drawingReferences(result),
    rows = new Map(index.crops.map((c) => [c.path, c]));
  assert(rows.size === index.crops.length, "Duplicate crop index path");
  const paths = new Set(refs.map((r) => r.crop.path));
  assert(
    json([...rows.keys()].sort()) === json([...paths].sort()) &&
      crops.size === rows.size,
    "Crop index and buffers must exactly cover cited crops",
  );
  for (const { entry, crop } of refs) {
    const row = rows.get(crop.path),
      bytes = crops.get(crop.path);
    assert(
      bytes && hash(bytes) === row.sha256 && row.sha256 === crop.sha256,
      "Drawing binding crop hash mismatch",
    );
    crop.headerPixels = row.headerPixels === undefined ? 0 : row.headerPixels;
    entry.drawingSha256 = drawingHash(bytes, crop.headerPixels);
  }
  return result;
}
