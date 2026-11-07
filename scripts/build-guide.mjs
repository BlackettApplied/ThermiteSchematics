// The maintained docs are authoritative; these ignored assets are built for packaging.
import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteGuideLinks } from "../packages/cli/src/guide-markdown.ts";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const destination = join(root, "packages/cli/assets/guide");
export async function guideAssets(commit) {
  const topics = JSON.parse(
    await readFile(join(root, "docs/topics.json"), "utf8"),
  );
  const ids = new Set(["symbols", "diagnostics", "schema"]);
  for (const topic of topics) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(topic.id) ||
      ids.has(topic.id) ||
      !/^docs\/[a-z0-9-]+\.md$/.test(topic.file) ||
      typeof topic.title !== "string" ||
      !topic.title.trim() ||
      !Array.isArray(topic.readBefore) ||
      !topic.readBefore.length ||
      topic.readBefore.some(
        (s) => typeof s !== "string" || !s.startsWith("before "),
      ) ||
      new Set(topic.readBefore).size !== topic.readBefore.length
    )
      throw new Error(`Invalid guide topic: ${JSON.stringify(topic)}`);
    ids.add(topic.id);
  }
  const assets = new Map([
    ["topics.json", await readFile(join(root, "docs/topics.json"))],
  ]);
  const sources = {};
  for (const topic of topics) {
    const markdown = await readFile(join(root, topic.file), "utf8");
    sources[topic.id] = markdown;
    assets.set(
      `${topic.id}.md`,
      Buffer.from(rewriteGuideLinks(markdown, topic, topics, commit)),
    );
  }
  assets.set("source.json", Buffer.from(`${JSON.stringify({ commit })}\n`));
  return { assets, sources: Buffer.from(`${JSON.stringify(sources)}\n`) };
}
export async function sourceCommit() {
  let commit = process.env.THERMITE_SOURCE_COMMIT;
  if (commit === undefined) {
    const checkout = await stat(join(root, ".git")).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    commit = checkout
      ? execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim()
      : await readFile(join(root, "scripts/source-commit.txt"), "utf8").then(
          (value) => value.trim(),
          (error) => {
            if (error.code === "ENOENT") return "";
            throw error;
          },
        );
  }
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error(
      "Guide build needs the source Git commit. In a Git-less copy, set THERMITE_SOURCE_COMMIT to its full 40-character source commit: THERMITE_SOURCE_COMMIT=<commit> bun run build (PowerShell: $env:THERMITE_SOURCE_COMMIT='<commit>'; bun run build).",
    );
  return commit;
}
export async function buildGuide({ check = false } = {}) {
  const { assets, sources } = await guideAssets(await sourceCommit());
  const originals = join(root, "packages/cli/assets/guide-source.json");
  if (check) {
    for (const [file, bytes] of assets)
      if (!bytes.equals(await readFile(join(destination, file))))
        throw new Error(`Stale guide asset: ${file}; run bun run build.`);
    if (!sources.equals(await readFile(originals)))
      throw new Error("Stale guide source asset; run bun run build.");
    if (
      JSON.stringify((await readdir(destination)).sort()) !==
      JSON.stringify([...assets.keys()].sort())
    )
      throw new Error("Unexpected guide assets; rebuild the guide.");
    return;
  }
  await mkdir(destination, { recursive: true });
  for (const file of await readdir(destination))
    if (!assets.has(file))
      await rm(join(destination, file), { recursive: true });
  for (const [file, bytes] of assets)
    await writeFile(join(destination, file), bytes);
  await writeFile(originals, sources);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildGuide({ check: process.argv.includes("--check") });
