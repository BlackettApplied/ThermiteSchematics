import assert from "node:assert/strict";
import { open, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { strictJsonBytes } from "./strict-json.mjs";

export const CASE_FILES_FILENAME = "case-files.json.zst";
const caseFiles = [
  "packet.json",
  "ir.json",
  "query-reports.json",
  "request.json",
  "cli.log",
  "html.log",
  "pdf.log",
];
const maxOutputLength = 256 * 1024 * 1024;

async function readIfPresent(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function archiveCaseFiles(root) {
  const files = {};
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const cases = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // Group by file kind so the compressor can reuse payloads across cases.
  for (const name of caseFiles)
    for (const id of cases) {
      const bytes = await readIfPresent(join(root, id, name));
      if (bytes) files[`${id}/${name}`] = utf8.decode(bytes);
    }
  const paths = Object.keys(files);
  if (!paths.length) return;
  const raw = Buffer.from(JSON.stringify(files));
  assert(raw.length <= maxOutputLength, "Case file archive is too large");
  const packed = zstdCompressSync(raw, {
    params: {
      [constants.ZSTD_c_compressionLevel]: 9,
      [constants.ZSTD_c_checksumFlag]: 1,
    },
  });
  assert(
    zstdDecompressSync(packed, { maxOutputLength }).equals(raw),
    "Case file archive failed compression verification",
  );
  const archivePath = join(root, CASE_FILES_FILENAME);
  const archive = await open(archivePath, "wx");
  try {
    try {
      await archive.writeFile(packed);
    } finally {
      await archive.close();
    }
    assert(
      (await readFile(archivePath)).equals(packed),
      "Case file archive failed read-back verification",
    );
  } catch (error) {
    // Let checkpoint readers fall back to the loose evidence.
    await unlink(archivePath).catch(() => {});
    throw error;
  }
  for (const path of paths) await unlink(join(root, path));
}

export async function readCheckpointCaseFiles(root) {
  const packed = await readIfPresent(join(root, CASE_FILES_FILENAME));
  // Bun can decode a truncated frame to partial bytes. Strict JSON parsing
  // rejects a truncated JSON payload.
  const files =
    packed && strictJsonBytes(zstdDecompressSync(packed, { maxOutputLength }));
  return async (id, name) => {
    const text = files?.[`${id}/${name}`];
    return text === undefined
      ? readFile(join(root, id, name))
      : Buffer.from(text);
  };
}
