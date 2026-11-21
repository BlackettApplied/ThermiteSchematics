import { readdir, readFile, mkdir } from "node:fs/promises";
import { join, relative, posix } from "node:path";
import assert from "node:assert/strict";
import { cases, prepare } from "../draw/corpus.mjs";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
export async function libraryExamples(root) {
  const result = [];
  for (const vendor of (
    await readdir(join(root, "libraries"), { withFileTypes: true })
  )
    .filter((v) => v.isDirectory())
    .map((v) => v.name)
    .sort()) {
    let entries;
    try {
      entries = await readdir(join(root, "libraries", vendor, "examples"), {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      // These are repository identifiers in evidence, not native OS paths.
      const project = posix.join("libraries", vendor, "examples", entry.name);
      const names = await readdir(join(root, project)),
        request = posix.join(
          project,
          names.includes("packet.request.json")
            ? "packet.request.json"
            : "packet.json",
        );
      await readJson(join(root, project, "system.json"));
      const authored = await readJson(join(root, request));
      assert(
        Array.isArray(authored.views),
        `Missing packet request: ${request}`,
      );
      result.push({
        id: `library/${vendor}/${entry.name}`,
        project,
        request,
        kind: "library",
      });
    }
  }
  return result;
}
export async function population(root) {
  return [
    ...(await libraryExamples(root)),
    ...cases().map((c) => ({ ...c, kind: "corpus" })),
  ];
}
export function withoutFlow(request) {
  const copy = structuredClone(request);
  for (const view of copy.views) delete view.flow;
  return copy;
}
/** Reuse the drawing corpus' format eligibility policy. Discard all other
 * preparation changes, including the field recipe's orientation adjustment. */
export async function flowVariant(spec, request, flow, root, dest, cli) {
  const { request: template } = await prepare(
      { ...spec, recipe: undefined, request: structuredClone(request), flow },
      root,
      dest,
      cli,
    ),
    variant = structuredClone(request);
  assert.equal(variant.views.length, template.views.length);
  for (let i = 0; i < variant.views.length; i++) {
    if (Object.hasOwn(template.views[i], "flow"))
      variant.views[i].flow = template.views[i].flow;
    else delete variant.views[i].flow;
  }
  assert.deepEqual(
    withoutFlow(variant),
    withoutFlow(request),
    "Only flow may change",
  );
  return variant;
}
export async function materialize(spec, root, dest, cli) {
  await mkdir(dest, { recursive: true });
  if (spec.kind === "library")
    return {
      project: join(root, spec.project),
      request: await readJson(join(root, spec.request)),
      source: spec.project,
    };
  const prepared = await prepare(spec, root, dest, cli);
  return { ...prepared, source: relative(root, prepared.project) };
}
