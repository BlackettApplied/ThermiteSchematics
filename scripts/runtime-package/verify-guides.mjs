import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyGuardedStarter } from "./verify-guarded-starter.mjs";
import {
  assertGuideLinksResolved,
  rewriteGuideLinks,
} from "../../packages/cli/src/guide-markdown.ts";

async function readGuideContext({ entries, runtime, invoke, sourceCli }) {
  const guidePrefix = "node_modules/@thermite/cli/assets/guide/";
  const topicsEntry = entries.find(
    (entry) => entry.path === `${guidePrefix}topics.json`,
  );
  assert(topicsEntry, "Missing shipped topic manifest");
  const topics = JSON.parse(topicsEntry.bytes.toString("utf8"));
  const topicIndex = JSON.parse(invoke(["guide", "--json"]).stdout);
  assert.deepEqual(
    topicIndex.map((topic) => topic.id),
    [...topics.map((topic) => topic.id), "symbols", "diagnostics", "schema"],
  );
  const indexText = invoke(["guide"]).stdout;
  const guidePath = invoke(["guide", "--path"]).stdout.trim();
  assert.equal(
    guidePath.replace(/[\\/]$/, ""),
    join(runtime, guidePrefix).replace(/[\\/]$/, ""),
  );
  assert(!entries.some((entry) => /[/\\]guide-markdown\./.test(entry.path)));
  assert(
    !entries.some((entry) => entry.path.endsWith("/assets/guide-source.json")),
  );
  const originals = sourceCli
    ? JSON.parse(
        await readFile(
          join(dirname(sourceCli), "packages/cli/assets/guide-source.json"),
          "utf8",
        ),
      )
    : undefined;
  return { guidePrefix, topics, indexText, guidePath, originals };
}

async function verifyGuideTopics({
  entries,
  invoke,
  manifest,
  temporary,
  guidePrefix,
  topics,
  indexText,
  guidePath,
  originals,
}) {
  for (const topic of topics) {
    assert(
      entries.some((entry) => entry.path === `${guidePrefix}${topic.id}.md`),
    );
    assert(indexText.includes(topic.id) && indexText.includes(topic.title));
    const output = invoke(["guide", topic.id]);
    assert.equal(output.stderr, "");
    if (originals)
      assert.equal(
        output.stdout,
        rewriteGuideLinks(originals[topic.id], topic, topics, manifest.commit),
        "Prebuilt output must equal G3 runtime rewriting",
      );
    assert(output.stdout.startsWith("#"), `Empty topic: ${topic.id}`);
    assertGuideLinksResolved(output.stdout);
    const shipped = await readFile(join(guidePath, `${topic.id}.md`), "utf8");
    assertGuideLinksResolved(shipped);
    assert.equal(
      shipped,
      output.stdout,
      "--path must expose the resolved topic copies",
    );
    assert(
      !output.stdout.includes(temporary),
      "Topic must not expose source or installation paths",
    );
    for (const match of output.stdout.matchAll(
      /https:\/\/github\.com\/BlackettApplied\/ThermiteSchematics\/blob\/([^/]+)\//gu,
    ))
      assert.equal(
        match[1],
        manifest.commit,
        "Runtime links must use the runtime manifest commit",
      );
  }
}

async function verifyGuideCatalogs({
  entries,
  invoke,
  runtime,
  manifest,
  check,
}) {
  assert(invoke(["guide", "symbols"]).stdout.includes("thermite:io-module"));
  assert.deepEqual(
    JSON.parse(invoke(["guide", "symbols", "--json"]).stdout),
    (
      await import(
        pathToFileURL(
          join(runtime, "node_modules/@thermite/schema/dist/index.js"),
        ).href
      )
    ).SYMBOL_PROFILES,
  );
  assert(invoke(["guide", "diagnostics", "W903"]).stdout.includes("W903"));
  assert(invoke(["guide", "diagnostics", "R006"]).stdout.includes("R006"));
  const schemaList = JSON.parse(invoke(["guide", "schema", "--json"]).stdout);
  const schemaEntries = entries.filter((entry) =>
    /^node_modules\/@thermite\/schema\/schemas\/[^/]+\.schema\.json$/.test(
      entry.path,
    ),
  );
  assert.equal(schemaList.length, schemaEntries.length);
  for (const schema of schemaList) {
    const entry = schemaEntries.find((entry) =>
      entry.path.endsWith(`/${schema.name}.schema.json`),
    );
    assert(entry);
    assert.equal(
      invoke(["guide", "schema", schema.name]).stdout,
      entry.bytes.toString("utf8"),
    );
    assert.equal(schema.$id, JSON.parse(entry.bytes.toString("utf8")).$id);
    assert.equal(schema.path, join(runtime, entry.path));
  }
  assert(
    !manifest.dependencies.some(
      (dependency) => dependency.name === "mdast-util-from-markdown",
    ),
    "Markdown parsing must remain build-only",
  );
  invoke(["guide", "unknown-topic"], undefined, 2);
  invoke(["guide", "diagnostics", "UNKNOWN"], undefined, 2);
  check(
    "all offline guide topics, catalogs, resolved --path copies and manifest-pinned links; exact offline schemas and full diagnostics; no runtime parser assets; restricted PATH, repository reads and network",
  );
}

export async function verifyOfflineGuides(context) {
  const guides = await readGuideContext(context);
  await verifyGuideTopics({ ...context, ...guides });
  await verifyGuideCatalogs(context);
  await verifyGuardedStarter(
    context.invoke,
    join(context.temporary, "guarded starter"),
  );
  context.check(
    "offline starter recipe: inspect, lock, register, guard, dry-run, apply and validate",
  );
}
