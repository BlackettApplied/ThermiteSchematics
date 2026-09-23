import { execFileSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fileInventory,
  json,
  isLicenseFile,
  runtimeFilename,
  listFiles,
  manifestName,
  readJson,
  sha256,
} from "./common.mjs";
import { verifyRuntimeArchive } from "./verify.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--preview"))
  throw new Error("Usage: bun run package:pack [--preview]");
const preview = args.includes("--preview");
if (
  Bun.version !== "1.4.2" ||
  process.platform !== "darwin" ||
  process.arch !== "arm64"
)
  throw new Error(
    "Build and verify runtime packages on Apple Silicon macOS with Bun 1.4.2.",
  );
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
if (!preview && git("status", "--porcelain").trim())
  throw new Error(
    "Commit all release inputs first, or use --preview for an unpublishable local package.",
  );
const commit = git("rev-parse", "HEAD").trim();
const temporary = await mkdtemp(
  join(await realpath(tmpdir()), "thermite-runtime-build-"),
);
const source = join(temporary, "source");
const production = join(temporary, "production");
const runtime = join(temporary, "runtime");
const run = (args, cwd) =>
  execFileSync(process.execPath, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
try {
  await mkdir(source);
  if (preview) {
    // Git's ignore rules exclude customer projects, secrets, dependencies and builds.
    const files = [
      ...new Set(
        git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
          .split("\0")
          .filter(Boolean),
      ),
    ].sort();
    for (const file of files) {
      let status;
      try {
        status = await lstat(join(root, file));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!status.isFile() || status.nlink !== 1)
        throw new Error(`Nonordinary source input: ${file}`);
      await mkdir(dirname(join(source, file)), { recursive: true });
      await cp(join(root, file), join(source, file));
    }
  } else {
    const archive = execFileSync("git", ["archive", "--format=tar", commit], {
      cwd: root,
      maxBuffer: 128 * 1024 * 1024,
    });
    execFileSync("tar", ["-xf", "-", "-C", source], { input: archive });
  }
  const sourceDigest = sha256(json(await fileInventory(source)));
  const sourceLock = await readFile(join(source, "bun.lock"));
  run(
    ["install", "--frozen-lockfile", "--ignore-scripts", "--backend=copyfile"],
    source,
  );
  run(["run", "build"], source);
  const { THERMITE_VERSION: version } = await import(
    join(source, "packages/cli/dist/alpha.js")
  );
  if (!/^[0-9A-Za-z.-]+$/.test(version))
    throw new Error("Unsafe runtime version.");
  await mkdir(production);
  for (const file of ["package.json", "bun.lock", "bunfig.toml"])
    await cp(join(source, file), join(production, file));
  const workspaces = [];
  for (const name of (await readdir(join(source, "packages"))).sort()) {
    const directory = join(source, "packages", name);
    const manifest = await readJson(join(directory, "package.json"));
    workspaces.push({ directory, manifest });
    await mkdir(join(production, "packages", name), { recursive: true });
    await cp(
      join(directory, "package.json"),
      join(production, "packages", name, "package.json"),
    );
  }
  run(
    [
      "install",
      "--production",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--backend=copyfile",
    ],
    production,
  );
  if (!(await readFile(join(production, "bun.lock"))).equals(sourceLock))
    throw new Error("Production install changed the lockfile.");
  await mkdir(join(runtime, "node_modules"), { recursive: true });
  // Ignore only Bun's generated command links and workspace links. Copy the
  // complete upstream package contents, including nested notices and licenses.
  for (const name of (await readdir(join(production, "node_modules"))).sort()) {
    if ([".bin", "@thermite"].includes(name)) continue;
    const from = join(production, "node_modules", name);
    if (name.startsWith(".") || !(await lstat(from)).isDirectory())
      throw new Error(`Unexpected installed entry: ${name}`);
    await listFiles(from);
    await cp(from, join(runtime, "node_modules", name), { recursive: true });
  }
  for (const { directory, manifest } of workspaces) {
    const nested = join(
      production,
      "packages",
      directory.split("/").at(-1),
      "node_modules",
    );
    try {
      await lstat(nested);
      throw new Error(
        `Workspace-local dependencies need packaging support: ${manifest.name}`,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const target = join(runtime, "node_modules", manifest.name);
    await mkdir(target, { recursive: true });
    for (const file of ["package.json", ...manifest.files, "src"]) {
      if (!/^[\w./-]+$/.test(file) || file.split("/").includes(".."))
        throw new Error(`Unsafe package file: ${file}`);
      await cp(join(directory, file), join(target, file), {
        recursive: true,
        filter: (path) => !path.endsWith(".tsbuildinfo"),
      });
    }
  }
  for (const file of ["LICENSE", "NOTICE", "bun.lock"])
    await cp(join(source, file), join(runtime, file));
  const notices = (
    await readFile(join(source, "THIRD_PARTY_NOTICES.md"), "utf8")
  )
    .replaceAll("packages/cli/assets/", "node_modules/@thermite/cli/assets/")
    .replaceAll(
      "[CONTRIBUTING.md](CONTRIBUTING.md)",
      "[contribution guide](https://github.com/BlackettApplied/ThermiteSchematics/blob/dev/CONTRIBUTING.md)",
    );
  await writeFile(join(runtime, "THIRD_PARTY_NOTICES.md"), notices);
  await cp(
    join(source, "scripts/runtime-package/README.md"),
    join(runtime, "README.md"),
  );
  await cp(
    join(source, "scripts/runtime-package/thermite.mjs"),
    join(runtime, "thermite.mjs"),
  );
  const supplementsRoot = join(source, "scripts/runtime-package/third-party");
  const supplements = await readJson(join(supplementsRoot, "sources.json"));
  for (const supplement of supplements.packages) {
    const directory = join(runtime, "node_modules", supplement.name);
    const installed = await readJson(join(directory, "package.json"));
    if (
      installed.version !== supplement.version ||
      installed.license !== supplement.declaredLicense
    )
      throw new Error(`Supplemental license needs review: ${supplement.name}`);
    for (const file of supplement.files) {
      const bytes = await readFile(join(supplementsRoot, file.file));
      if (sha256(bytes) !== file.sha256)
        throw new Error(`Supplemental license digest mismatch: ${file.file}`);
      await writeFile(join(directory, file.file), bytes, { flag: "wx" });
    }
  }
  await cp(supplementsRoot, join(runtime, "third-party"), { recursive: true });
  const dependencies = [];
  const { readBunLock } = await import(
    join(source, "scripts/read-bun-lock.mjs")
  );
  const lock = await readBunLock(source);
  for (const path of (await listFiles(runtime)).filter((file) =>
    /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file),
  )) {
    const metadata = await readJson(join(runtime, path));
    if (metadata.name.startsWith("@thermite/")) continue;
    const directory = dirname(path);
    const licenses = (await listFiles(join(runtime, directory))).filter(
      isLicenseFile,
    );
    if (!licenses.length)
      throw new Error(`No license text found for ${metadata.name}`);
    const row = Object.values(lock.packages).find(
      (row) => row[0] === `${metadata.name}@${metadata.version}`,
    );
    if (!row?.[3])
      throw new Error(
        `Dependency absent from lock: ${metadata.name}@${metadata.version}`,
      );
    dependencies.push({
      name: metadata.name,
      version: metadata.version,
      path: directory,
      license:
        metadata.name === "elkjs"
          ? "EPL-2.0"
          : metadata.name === "brotli"
            ? "MIT AND Apache-2.0"
            : (metadata.license ?? "See included license"),
      integrity: row[3],
      licenses,
    });
  }
  const manifest = {
    format: "thermite-runtime-release/0.1",
    version,
    commit,
    sourceDigest,
    ...(preview
      ? {
          baseSourceUrl: `https://github.com/BlackettApplied/ThermiteSchematics/tree/${commit}`,
        }
      : {
          sourceUrl: `https://github.com/BlackettApplied/ThermiteSchematics/tree/${commit}`,
        }),
    preview,
    runtime: "Bun 1.4.2",
    target: "darwin-arm64",
    dependencies,
    files: await fileInventory(runtime),
  };
  await writeFile(join(runtime, manifestName), json(manifest));
  const filename = runtimeFilename(manifest);
  // Sorted entries and fixed timestamps make identical payloads reproducible.
  const files = await listFiles(runtime);
  for (const file of files)
    await utimes(
      join(runtime, file),
      new Date("2000-01-01T00:00:00Z"),
      new Date("2000-01-01T00:00:00Z"),
    );
  const archive = join(temporary, filename);
  execFileSync("zip", ["-q", "-X", archive, "-@"], {
    cwd: runtime,
    input: files.join("\n") + "\n",
    env: { ...process.env, TZ: "UTC", COPYFILE_DISABLE: "1" },
  });
  const bytes = await readFile(archive);
  await writeFile(`${archive}.sha256`, `${sha256(bytes)}  ${filename}\n`);
  const report = await verifyRuntimeArchive(archive, {
    sourceCli: join(source, "thermite.mjs"),
    allowPreview: preview,
  });
  const output = join(root, "release-out", "runtime", filename.slice(0, -4));
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Never replace an existing verified candidate.
  await cp(archive, join(output, filename));
  await cp(`${archive}.sha256`, join(output, `${filename}.sha256`));
  await writeFile(join(output, `${filename}.json`), json(manifest));
  await writeFile(join(output, "verification.json"), json(report));
  process.stdout.write(
    `Verified ${preview ? "PREVIEW (not for publication)" : "release candidate"}: ${join(output, filename)}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
