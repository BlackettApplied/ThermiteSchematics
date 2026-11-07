// Build an initial/reviewed proposal under evals/out; never edits the registry.
// For established mixed deltas use repin.mjs, which preserves unlisted data.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
import { readJson } from "./support.mjs";
import { seed, serializeRegistry } from "./marker-authoring.mjs";
import { cases } from "./corpus.mjs";
const report = await readJson(process.argv[2]);
assert(
  report.format === "thermite-draw-eval/1.0" &&
    report.subset === "full" &&
    report.mode === "strict",
  "Seed a full strict measured report",
);
assert(
  !report.results.some((r) =>
    ["infrastructure-error", "xpass"].includes(r.status),
  ),
  "Resolve infrastructure and retire stale scopes first",
);
const output = process.argv[3];
assert(
  output,
  "Supply an explicit proposal path under evals/out; never overwrite the registry blindly",
);
assert(
  !relative(
    fileURLToPath(new URL("../out/", import.meta.url)),
    resolve(output),
  ).startsWith(".."),
  "Write proposals under evals/out",
);
const text = serializeRegistry(seed(report.results, cases()));
await writeFile(output, text, { flag: "wx" });
process.stdout.write(
  `Proposal: ${Buffer.byteLength(text)} bytes. Review identities/scopes/bands before replacing expectations.mjs.\n`,
);
