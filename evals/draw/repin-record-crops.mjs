import assert from "node:assert/strict";
import { basename } from "node:path";
import { hash, json } from "./support.mjs";
import { citedCrops } from "./repin-record-crosscheck.mjs";
import { checkSignedDrawings } from "./repin-drawing-bindings.mjs";
import { drawingHash } from "./png-ink.mjs";
export function groupCrops(rows, crops, legacy = false) {
  assert(
    crops instanceof Map && crops.size === rows.length,
    "Supply exactly the indexed crop buffers",
  );
  const files = new Map(),
    pathMap = {},
    groups = new Map();
  const grouped = rows.map((c) => {
    const bytes = crops.get(c.path);
    assert(bytes && hash(bytes) === c.sha256, "Writer crop hash mismatch");
    assert(!Object.hasOwn(pathMap, c.path), "Duplicate indexed crop path");
    const headerPixels = c.headerPixels === undefined ? 0 : c.headerPixels,
      drawingSha256 = drawingHash(bytes, headerPixels);
    let path = !legacy && groups.get(drawingSha256);
    if (!path) {
      path = "crops/" + basename(c.path);
      if (files.has(path))
        path = "crops/" + hash(c.path).slice(0, 16) + "-" + basename(c.path);
      assert(!files.has(path), "Writer crop name collision");
      files.set(path, bytes);
      groups.set(drawingSha256, path);
    }
    pathMap[c.path] = path;
    return legacy ? c : { ...c, headerPixels, drawingSha256, retained: path };
  });
  return { rows: grouped, files, pathMap, groups: files.size };
}
export function verifyCrops(record, files, signed, index) {
  const seen = new Map(),
    retained = new Set(),
    ink = new Map();
  assert(
    ["thermite-draw-crop-index/2.0", "thermite-d1-real-crops/1.0"].includes(
      index.format,
    ),
    "Unknown crop index format",
  );
  const grouped = index.format === "thermite-draw-crop-index/2.0";
  for (const c of index.crops) {
    const path = record.pathMap[c.path],
      bytes = files.get(path);
    assert(
      typeof path === "string" &&
        /^crops\/[a-zA-Z0-9_.-]+\.png$/.test(path) &&
        bytes,
      "Missing retained crop path mapping",
    );
    if (grouped) {
      assert(
        c.retained === path,
        "Indexed retained path differs from path map",
      );
      const key = json([path, c.headerPixels]);
      if (!ink.has(key)) ink.set(key, drawingHash(bytes, c.headerPixels));
      assert(ink.get(key) === c.drawingSha256, "Indexed drawing hash mismatch");
    } else {
      drawingHash(bytes); // Legacy one-crop-per-file layout, including immutable D1.
      assert(hash(bytes) === c.sha256, "Indexed crop hash mismatch");
    }
    assert(!seen.has(c.path), "Duplicate indexed crop path");
    seen.set(c.path, c.sha256);
    retained.add(path);
  }
  assert(
    Object.keys(record.pathMap).length === seen.size,
    "Unused crop path mapping",
  );
  if (grouped) checkSignedDrawings(signed, index.crops);
  const cited = citedCrops(signed),
    paths = new Set(cited.map((c) => c.path));
  for (const c of cited)
    assert(
      seen.get(c.path) === c.sha256,
      "Signed crop differs from retained index",
    );
  assert(
    [...seen.keys()].every((p) => paths.has(p)),
    "Uncited crop in retained index",
  );
  if (!grouped)
    assert(retained.size === paths.size, "Crop path map must be one-to-one");
  for (const path of retained)
    assert(
      index.crops.some(
        (c) =>
          record.pathMap[c.path] === path && c.sha256 === hash(files.get(path)),
      ),
      "Retained PNG must match an original crop row",
    );
  const allowed = new Set([
    record.signedDecisions,
    record.receipt,
    record.cropIndex,
    ...retained,
  ]);
  assert(
    Object.keys(record.files).every((p) => allowed.has(p)),
    "Uncited crop or extra file in original manifest",
  );
  return retained.size;
}
