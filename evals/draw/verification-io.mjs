import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { within } from "./repin-io.mjs";
import { drawingReferences } from "./repin-drawing-bindings.mjs";
import { verificationPath, verifyAttemptPixels } from "./crop-attempts.mjs";
import { hash } from "./support.mjs";
const directory = (root) => join(root, "evals/out/draw-samples");
export async function writeVerification(root, references) {
  if (!references?.size) return;
  await within(join(root, "evals/out"), root, { existing: true });
  await mkdir(directory(root), { recursive: true });
  await within(directory(root), root, { existing: true });
  const target = join(directory(root), "verification");
  await within(target, directory(root));
  await mkdir(target, { recursive: true });
  for (const [sha, bytes] of references) {
    assert(hash(bytes) === sha, "Verification output hash differs from bytes");
    const path = await within(
      join(directory(root), verificationPath(sha)),
      directory(root),
    );
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      assert(
        hash(
          await readFile(
            await within(path, directory(root), { existing: true }),
          ),
        ) === sha,
        "Existing verification PNG hash differs",
      );
    }
  }
}
export async function readVerification(root, file) {
  const references = new Map();
  for (const { entry } of drawingReferences(file))
    for (const a of entry.sourceVerification.attempts) {
      const sha = a.referenceSha256;
      if (!references.has(sha)) {
        await within(directory(root), root, { existing: true });
        const path = await within(
          join(directory(root), verificationPath(sha)),
          directory(root),
          { existing: true },
        );
        const bytes = await readFile(path);
        assert(hash(bytes) === sha, "Verification PNG hash mismatch");
        references.set(sha, bytes);
      }
    }
  return references;
}
export function verifyDrawingAttempts(file, crops, references) {
  for (const { entry, crop } of drawingReferences(file))
    verifyAttemptPixels(
      entry.sourceVerification,
      crops.get(crop.path),
      crop.headerPixels ?? 0,
      references,
    );
}
