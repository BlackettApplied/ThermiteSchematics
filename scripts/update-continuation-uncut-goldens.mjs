import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { writeFileAtomically } from "../packages/compiler/dist/index.js";
import { renderSchematicPacket } from "../packages/render/dist/index.js";
import {
  uncutFixture,
  uncutLabelVariant,
  uncutLayoutDigest,
  uncutReferenceKey,
} from "../packages/render/test/continuation-uncut-fixtures.ts";

// Build first. Owns this platform's six packet layout digests.
// Other platforms' reviewed rows are retained unchanged.
// Inspect the rendered packets before an intentional --write.
const mode = process.argv[2];
if (!["--check", "--write"].includes(mode))
  throw Error(
    "Usage: bun scripts/update-continuation-uncut-goldens.mjs --check|--write",
  );
const path = new URL(
  "../packages/render/test/snapshots/continuation-uncut.json",
  import.meta.url,
);
const reference = JSON.parse(await readFile(path, "utf8"));
for (const name of ["init-starter", "motor-starter"]) {
  const key = uncutReferenceKey(name);
  const input = await uncutFixture(name),
    base = await renderSchematicPacket(
      input.ir,
      input.request,
      input.presentation,
    );
  if (!base.ok) throw Error(JSON.stringify(base.error));
  const crossed = new Set(
    base.value.sheets.flatMap((s) =>
      s.continuations.map((l) =>
        l.provenance && "uid" in l.provenance ? l.provenance.uid : undefined,
      ),
    ),
  );
  reference[key] = [];
  for (const label of ["", "   ", "A\nB"]) {
    const { ir, changed } = uncutLabelVariant(input.ir, crossed, name, label),
      result = await renderSchematicPacket(
        ir,
        input.request,
        input.presentation,
      );
    if (!result.ok) throw Error(JSON.stringify(result.error));
    if (
      !changed.length ||
      result.value.sheets.length !== (name === "init-starter" ? 1 : 7)
    )
      throw Error(`Uncut-label coverage or page contract changed: ${name}`);
    reference[key].push(uncutLayoutDigest(result.value));
  }
}
const bytes = Buffer.from(JSON.stringify(reference, null, 2) + "\n");
if (mode === "--write") await writeFileAtomically(fileURLToPath(path), bytes);
else if (!(await readFile(path)).equals(bytes))
  throw Error("Continuation uncut packet digests are stale.");
