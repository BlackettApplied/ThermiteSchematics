// Verification rasters are evidence references, not additional reviewed drawings.
import assert from "node:assert/strict";
import { checkPdfIndexAttestation } from "./pdf-source-policy.mjs";
import { drawingReferences } from "./repin-drawing-bindings.mjs";
import { verificationPath, verifyAttemptPixels } from "./crop-attempts.mjs";
import { hash } from "./support.mjs";
export function verificationHashes(signed) {
  return new Set(
    drawingReferences(signed).flatMap(({ entry }) =>
      entry.sourceVerification.attempts.map((a) => a.referenceSha256),
    ),
  );
}
export function verificationFiles(signed, references) {
  const hashes = verificationHashes(signed);
  assert(
    references instanceof Map &&
      references.size === hashes.size &&
      [...hashes].every((sha) => references.has(sha)),
    "Supply exactly the signed verification PNG buffers",
  );
  return new Map(
    [...hashes].map((sha) => {
      const bytes = references.get(sha);
      assert(hash(bytes) === sha, "Writer verification PNG hash mismatch");
      return [verificationPath(sha), bytes];
    }),
  );
}
export function verifyRecordedAttempts(
  record,
  files,
  signed,
  index,
  archivePdf2 = false,
) {
  const references = new Map(),
    paths = new Set();
  for (const sha of verificationHashes(signed)) {
    const path = verificationPath(sha),
      bytes = files.get(path);
    assert(
      bytes && hash(bytes) === sha,
      "Missing or changed retained verification PNG",
    );
    references.set(sha, bytes);
    paths.add(path);
  }
  for (const { entry, crop } of drawingReferences(signed)) {
    const row = index.crops.find((r) => r.path === crop.path);
    if (
      entry.sourceVerification.medium === "pdf" ||
      row?.scope?.medium === "pdf" ||
      row?.sourceRender?.medium === "pdf"
    )
      checkPdfIndexAttestation(row, entry.sourceVerification);
    verifyAttemptPixels(
      entry.sourceVerification,
      files.get(record.pathMap[crop.path]),
      crop.headerPixels ?? 0,
      references,
      archivePdf2,
    );
  }
  return paths;
}
