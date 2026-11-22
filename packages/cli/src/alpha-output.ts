import { realpath } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
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
import { promisify } from "node:util";
import {
  LIBRARY_LOCK_FILE_NAME,
  loadProject,
  writeFileAtomically,
  type LoadedProject,
} from "@thermite/compiler";
import micromatch from "micromatch";

const nativeRealpath = promisify(realpath.native);

export function samePathSpelling(left: string, right: string): boolean {
  // Windows lookup can correct the case of a component or drive letter.
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** Reject links in every existing ancestor, including hard-linked output files. */
export async function assertOrdinaryPath(
  path: string,
  leaf?: "directory" | "file",
): Promise<void> {
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
      const expected = cursor === absolute ? leaf : "directory";
      if (
        (expected === "file" && !stat.isFile()) ||
        (expected === "directory" && !stat.isDirectory())
      )
        throw new Error(`Expected an ordinary ${expected}: ${cursor}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export async function canonicalOutputPath(path: string): Promise<string> {
  let ancestor = path;
  const suffix: string[] = [];
  while (true) {
    try {
      return resolve(await nativeRealpath(ancestor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      suffix.unshift(basename(ancestor));
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}
export async function guardAlphaOutput(
  project: LoadedProject,
  output: string,
  protectedInputs: readonly string[] = [],
  options: { allowText?: boolean } = {},
): Promise<string> {
  const authoredTarget = resolve(output);
  await assertOrdinaryPath(authoredTarget, "file");
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
  await assertOrdinaryPath(target, "file");
  if (
    target
      .toLowerCase()
      .split(sep)
      .some((part) => [".git", ".agents", ".codex"].includes(part))
  )
    throw new Error(
      "Output cannot be written into agent or repository configuration.",
    );
  protectProjectSource(project, target);
  await protectReferencedInputs(target, protectedInputs);
  return target;
}

function protectProjectSource(project: LoadedProject, target: string) {
  const root = project.canonicalRootPath;
  const relativeTarget = relative(root, target).split(sep).join("/");
  const within =
    relativeTarget !== ".." &&
    !relativeTarget.startsWith("../") &&
    !isAbsolute(relativeTarget);
  const reserved = [
    "system.json",
    LIBRARY_LOCK_FILE_NAME,
    project.manifest.file,
    "AGENTS.md",
    project.manifest.value.presentation,
  ].filter((value): value is string => typeof value === "string");
  if (
    within &&
    (reserved.some(
      (path) => path.toLowerCase() === relativeTarget.toLowerCase(),
    ) ||
      micromatch.isMatch(
        relativeTarget,
        project.manifest.value.sources.map((pattern) =>
          pattern.replace(/^(?:\.\/)+/u, ""),
        ),
        {
          dot: true,
          nocase: true,
        },
      ))
  )
    throw new Error(
      "Output would overwrite or become authoritative project source.",
    );
  for (const library of project.libraries) {
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
  const documents = [
    project.manifest,
    ...project.sources,
    ...(project.presentation ? [project.presentation] : []),
  ];
  if (
    documents.some(
      (document) =>
        document.canonicalPath.toLowerCase() === target.toLowerCase(),
    )
  )
    throw new Error("Output aliases an authoritative source file.");
}

async function protectReferencedInputs(
  target: string,
  protectedInputs: readonly string[],
) {
  const normalized = target.toLocaleLowerCase("en-US");
  for (const input of protectedInputs) {
    // Compare canonical paths on both sides: a request can be supplied
    // through a link or a Windows short-name alias to the same ordinary file.
    const canonicalInput = await canonicalOutputPath(resolve(input));
    if (canonicalInput.toLocaleLowerCase("en-US") === normalized)
      throw new Error("Output cannot overwrite its request file.");
  }
}

export async function writeAlphaOutput(
  project: string,
  output: string,
  content: string | Uint8Array,
  protectedInputs: readonly string[] = [],
  options: { allowText?: boolean } = {},
): Promise<void> {
  const loaded = await loadProject(project);
  if (!loaded.ok)
    throw new Error(
      "Project changed or cannot be loaded before writing output.",
    );
  const target = await guardAlphaOutput(
    loaded.project,
    output,
    protectedInputs,
    options,
  );
  await mkdir(dirname(target), { recursive: true });
  await writeFileAtomically(target, content, {
    validateDestination: async () => {
      if (
        (await guardAlphaOutput(
          loaded.project,
          output,
          protectedInputs,
          options,
        )) !== target
      )
        throw new Error("Output path changed before publication.");
    },
  });
}
