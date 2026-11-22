// Regenerate only the four reviewed adapter/option pins after intentional slot changes.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  compileCoreFixture,
  selectCoreSubgraph,
} from "../packages/render/test/fixtures.ts";
import { buildPresentationGraph } from "../packages/render/dist/presentation.js";
import {
  buildElkAdapterGraph,
  serializeElkAdapterForTest,
} from "../packages/render/dist/layout/elk-adapter.js";
const write = process.argv.includes("--write");
if (
  process.argv.some(
    (a) => a.startsWith("--") && !["--write", "--check"].includes(a),
  )
)
  throw Error("Use --write or --check");
const ir = await compileCoreFixture(),
  builds = [];
for (const [root, family] of [
  ["K1", "control"],
  ["M1", "power"],
])
  for (const flow of ["left-to-right", "top-to-bottom"]) {
    const p = buildPresentationGraph({
      ir,
      selected: selectCoreSubgraph(ir, root, family, flow),
    });
    if (!p.ok) throw Error(JSON.stringify(p.error));
    builds.push(buildElkAdapterGraph(p.value.graph));
  }
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v === null || typeof v !== "object"
      ? JSON.stringify(v)
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`;
const sha = (v) => createHash("sha256").update(v).digest("hex");
const data = {
  adapterSha256: sha(builds.map(serializeElkAdapterForTest).join("\n")),
  assignmentSha256: sha(canonical(builds.map((b) => b.optionAssignments))),
  assignmentCounts: builds.map((b) => b.optionAssignments.length),
  optionCount: new Set(
    builds.flatMap((b) => b.optionAssignments.map((o) => o.option)),
  ).size,
};
const path = fileURLToPath(
    new URL("../packages/render/test/elk-options.golden.json", import.meta.url),
  ),
  text = await format(JSON.stringify(data), { parser: "json" });
if (write) await writeFile(path, text);
else if ((await readFile(path, "utf8")) !== text)
  throw Error(
    "ELK adapter golden differs; review slot/option changes before --write",
  );
console.log(JSON.stringify({ mode: write ? "write" : "check", ...data }));
