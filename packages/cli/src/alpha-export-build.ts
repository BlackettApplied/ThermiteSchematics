import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The source CLI and the installed runtime both run on Bun.
declare const Bun: {
  Transpiler: new (options: { loader: "js" }) => {
    scanImports(bytes: Uint8Array): readonly { path: string }[];
  };
};

const packageNames = [
  "agent-tools",
  "cli",
  "compiler",
  "core-library",
  "query",
  "render",
  "schema",
] as const;

const assets: Partial<
  Record<(typeof packageNames)[number], readonly string[]>
> = {
  cli: ["assets/fonts"],
  "core-library": ["library", "versions"],
  render: ["assets/fonts"],
  schema: ["schemas"],
};

export function exportBuildIdentity() {
  const hash = createHash("sha256");
  function include(label: string, bytes: Uint8Array) {
    hash.update(JSON.stringify([label, bytes.length]) + "\n").update(bytes);
  }
  function includeTree(root: string, label: string) {
    const entries = readdirSync(root, { withFileTypes: true });
    entries.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const path = join(root, entry.name);
      const key = `${label}/${entry.name}`;
      if (entry.isDirectory()) includeTree(path, key);
      else if (entry.isFile()) include(key, readFileSync(path));
    }
  }

  const cliRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
  const parent = dirname(cliRoot);
  const lockRoot = basename(parent) === "@thermite" ? dirname(parent) : parent;
  include("bun.lock", readFileSync(join(lockRoot, "..", "bun.lock")));

  const packages = packageNames.map((name) => {
    const root =
      name === "cli"
        ? cliRoot
        : realpathSync(
            fileURLToPath(
              new URL("../", import.meta.resolve(`@thermite/${name}`)),
            ),
          );
    include(`${name}/package.json`, readFileSync(join(root, "package.json")));
    for (const asset of assets[name] ?? [])
      includeTree(join(root, asset), `${name}/${asset}`);
    return { name, root };
  });

  // Walk runtime modules from alpha.js. Old tsc outputs and build-only modules
  // can coexist in dist but cannot enter this graph without a runtime import.
  const scanner = new Bun.Transpiler({ loader: "js" });
  const files = new Set([join(cliRoot, "dist", "alpha.js")]);
  for (const file of files) {
    const pkg = packages.find(({ root }) => file.startsWith(root + sep));
    if (!pkg) throw new Error(`Cannot identify export module ${file}.`);
    const label = relative(pkg.root, file).split(sep).join("/");
    const bytes = readFileSync(file);
    include(`${pkg.name}/${label}`, bytes);
    for (const { path } of scanner.scanImports(bytes)) {
      if (path.startsWith(".")) {
        files.add(fileURLToPath(new URL(path, pathToFileURL(file))));
      } else if (path.startsWith("@thermite/") || path.startsWith("#")) {
        files.add(fileURLToPath(import.meta.resolve(path, file)));
      }
    }
  }
  return hash.digest("hex");
}
