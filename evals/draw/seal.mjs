import { format } from "prettier";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createSeal } from "./corpus.mjs";
import { json } from "./support.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const output =
  process.argv[2] === "--output"
    ? resolve(process.argv[3])
    : resolve(root, "evals/draw/corpus/manifest.json");
await writeFile(
  output,
  await format(json(await createSeal(root)), { parser: "json" }),
);
