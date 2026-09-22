import { lstat, mkdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { loadProject, writeFileAtomically } from "@thermite/compiler";
import micromatch from "micromatch";

/** Reject links in every existing ancestor, including hard-linked output files. */
export async function assertOrdinaryPath(path: string): Promise<void> {
  const absolute = resolve(path),
    root = parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))
      )
        throw new Error(`Refusing linked or non-ordinary path: ${cursor}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
async function canonicalOutputPath(path: string): Promise<string> {
  let ancestor = path;
  const suffix: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(ancestor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      suffix.unshift(basename(ancestor));
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}
export async function writeAlphaOutput(
  project: string,
  output: string,
  content: string | Uint8Array,
  protectedInputs: readonly string[] = [],
  options: { allowText?: boolean } = {},
): Promise<void> {
  const authoredTarget = resolve(output);
  await assertOrdinaryPath(authoredTarget);
  const target = await canonicalOutputPath(authoredTarget);
  if (
    ![
      ".svg",
      ".html",
      ".json",
      ".csv",
      ".pdf",
      ...(options.allowText ? [".txt"] : []),
    ].includes(extname(target).toLowerCase())
  )
    throw new Error(
      options.allowText
        ? "Output must end in .svg, .html, .json, .csv, .pdf or .txt."
        : "Output must end in .svg, .html, .json, .csv or .pdf.",
    );
  await assertOrdinaryPath(target);
  const loaded = await loadProject(project);
  if (!loaded.ok)
    throw new Error(
      "Project changed or cannot be loaded before writing output.",
    );
  const p = loaded.project,
    root = p.canonicalRootPath;
  const relativeTarget = relative(root, target).split(sep).join("/");
  if (
    target
      .toLowerCase()
      .split(sep)
      .some((part) => [".git", ".agents", ".codex"].includes(part))
  )
    throw new Error(
      "Output cannot be written into agent or repository configuration.",
    );
  const within =
    relativeTarget !== ".." &&
    !relativeTarget.startsWith("../") &&
    !isAbsolute(relativeTarget);
  const reserved = [
    "system.json",
    "electrical-system.lock.json",
    "AGENTS.md",
    p.manifest.value.presentation,
  ].filter((value): value is string => typeof value === "string");
  if (
    within &&
    (reserved.some(
      (path) => path.toLowerCase() === relativeTarget.toLowerCase(),
    ) ||
      micromatch.isMatch(relativeTarget, p.manifest.value.sources, {
        dot: true,
        nocase: true,
      }))
  )
    throw new Error(
      "Output would overwrite or become authoritative project source.",
    );
  for (const library of p.libraries) {
    const rel = relative(
      library.canonicalRootPath.toLowerCase(),
      target.toLowerCase(),
    );
    if (
      rel === "" ||
      (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    )
      throw new Error("Output cannot be written inside a component library.");
  }
  const normalized = target.toLocaleLowerCase("en-US");
  for (const input of protectedInputs) {
    if (resolve(input).toLocaleLowerCase("en-US") === normalized)
      throw new Error("Output cannot overwrite its request file.");
  }
  await mkdir(dirname(target), { recursive: true });
  await assertOrdinaryPath(target);
  // Canonicalize existing case-insensitive aliases before the atomic replace.
  try {
    const canonical = await realpath(target);
    const documents = [
      p.manifest,
      ...p.sources,
      ...(p.presentation ? [p.presentation] : []),
    ];
    if (
      documents.some((document) => resolve(root, document.file) === canonical)
    )
      throw new Error("Output aliases an authoritative source file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFileAtomically(target, content);
}
