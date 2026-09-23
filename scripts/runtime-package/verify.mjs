import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  extractSafeZipArchive,
  readSafeZipArchive,
} from "../safe-zip-reader.mjs";
import {
  fileInventory,
  json,
  listFiles,
  sha256,
  verifyEntries,
  verifyArchiveIdentity,
} from "./common.mjs";

export async function verifyRuntimeArchive(
  archivePath,
  { sourceCli, allowPreview = false } = {},
) {
  if (
    Bun.version !== "1.4.2" ||
    process.platform !== "darwin" ||
    process.arch !== "arm64"
  )
    throw new Error(
      "Runtime acceptance requires Bun 1.4.2 on Apple Silicon macOS.",
    );
  const bytes = await readFile(archivePath);
  const digest = sha256(bytes);
  assert.equal(
    await readFile(`${archivePath}.sha256`, "utf8"),
    `${digest}  ${basename(archivePath)}\n`,
    "Archive SHA-256 mismatch",
  );
  const entries = await readSafeZipArchive(bytes);
  const manifest = verifyEntries(entries);
  verifyArchiveIdentity(manifest, basename(archivePath), { allowPreview });
  const temporary = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-runtime-consumer-"),
  );
  const checks = [];
  const check = (name) => {
    checks.push(name);
    process.stdout.write(`Package acceptance: ${name}\n`);
  };
  let runtime;
  try {
    const extracted = join(temporary, "extracted");
    await extractSafeZipArchive(bytes, extracted);
    runtime = join(temporary, "relocated runtime with spaces");
    await rename(extracted, runtime);
    const before = await fileInventory(runtime);
    const tools = join(temporary, "restricted-bin");
    const home = join(temporary, "home");
    await mkdir(tools);
    await mkdir(home);
    for (const name of ["node", "npm", "npx", "git", "tsc", "bun"]) {
      await writeFile(
        join(tools, name),
        '#!/bin/sh\necho "Unexpected development tool invocation" >&2\nexit 97\n',
      );
      await chmod(join(tools, name), 0o755);
    }
    // System sandbox denies all network access. No source checkout or package
    // cache is available through PATH/HOME/NODE_PATH in consumer subprocesses.
    const env = {
      PATH: tools,
      HOME: home,
      TMPDIR: temporary,
      BUN_INSTALL_CACHE_DIR: join(home, "empty-cache"),
      NODE_PATH: "",
      LANG: "en_US.UTF-8",
    };
    const cli = join(runtime, "thermite.mjs");
    const invoke = (args, input, expected = 0) => {
      const result = spawnSync(
        "/usr/bin/sandbox-exec",
        [
          "-p",
          "(version 1)(allow default)(deny network*)",
          process.execPath,
          cli,
          ...args,
        ],
        {
          cwd: temporary,
          env,
          input,
          encoding: "utf8",
          timeout: 120000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      if (result.error) throw result.error;
      assert.equal(
        result.status,
        expected,
        `${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
      );
      return result;
    };
    // Read-only files prove the CLI does not update its installation or libraries.
    for (const file of await listFiles(runtime))
      await chmod(join(runtime, file), 0o444);
    assert.equal(invoke(["--version"]).stdout.trim(), manifest.version);
    assert.match(invoke(["--help"]).stdout, /Thermite/);
    check(
      "relocated, read-only package; Bun only; network denied; version and help",
    );
    const project = join(temporary, "electrical project");
    invoke(["init", project, "--name", "Package acceptance"]);
    invoke(["init", project], undefined, 2);
    invoke(["validate", project]);
    assert.match(
      await readFile(join(project, "AGENTS.md"), "utf8"),
      /runtime package/,
    );
    for (const notice of ["LICENSE", "NOTICE"])
      assert.deepEqual(
        await readFile(join(project, "libraries/core", notice)),
        await readFile(
          join(runtime, "node_modules/@thermite/core-library", notice),
        ),
      );
    const cabinets = join(temporary, "cabinet project");
    invoke(["init", cabinets, "--template", "cabinets"]);
    invoke(["validate", cabinets]);
    const cable = JSON.parse(
      invoke(["cable", "CBL1", "--project", cabinets, "--json"]).stdout,
    );
    assert.equal(cable.counts.spare, 2);
    check(
      "both templates, overwrite refusal, validation, library notices and cable query",
    );
    for (const extension of ["svg", "html", "pdf"]) {
      const output = join(project, `drawing.${extension}`);
      invoke(["view", "PS1", "--loads", "--project", project, "-o", output]);
      const first = await readFile(output);
      if (extension === "pdf") {
        assert.equal(first.subarray(0, 5).toString(), "%PDF-");
        assert.match(
          first.toString("latin1"),
          /\/FontFile2\s+\d+\s+0\s+R/,
          "Embedded TrueType font stream",
        );
      } else assert.match(first.toString(), /<svg/);
      const repeat = join(project, `repeat.${extension}`);
      invoke(["view", "PS1", "--loads", "--project", project, "-o", repeat]);
      assert.deepEqual(
        await readFile(repeat),
        first,
        `${extension} determinism`,
      );
      if (sourceCli) {
        const sourceOutput = join(project, `source.${extension}`);
        execFileSync(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            "(version 1)(allow default)(deny network*)",
            process.execPath,
            sourceCli,
            "view",
            "PS1",
            "--loads",
            "--project",
            project,
            "-o",
            sourceOutput,
          ],
          { cwd: temporary, env, timeout: 120000 },
        );
        assert.deepEqual(
          await readFile(sourceOutput),
          first,
          `${extension} source/package parity`,
        );
      }
    }
    if (sourceCli)
      check("SVG/HTML/PDF byte parity with the isolated source build");
    invoke([
      "report",
      "bom",
      "--project",
      project,
      "-o",
      join(project, "bom.csv"),
    ]);
    JSON.parse(invoke(["diagnostics", "--project", project, "--json"]).stdout);
    check(
      "deterministic SVG/HTML/PDF with embedded fonts; BOM and diagnostics",
    );
    const agent = (tool, fields = {}, expected = 0) => {
      const request = { format: "agent-tool-request/0.1", project, ...fields };
      const result = invoke(
        ["agent", tool, "--input", "-"],
        json(request),
        expected,
      );
      assert.equal(JSON.parse(result.stderr).format, "agent-tool-report/0.1");
      if (expected !== 0) {
        assert.equal(result.stdout, "");
        return;
      }
      const value = JSON.parse(result.stdout);
      assert.equal(value.format, "agent-tool-result/0.1");
      return value.value;
    };
    assert.equal(agent("validate").valid, true);
    agent("resolve", { target: { by: "designation", value: "PS1" } });
    agent("inspect", { selector: { by: "designation", value: "PS1" } });
    agent("query", {
      query: {
        operation: "net",
        selector: { by: "parts", deviceDesignation: "PS1", terminalKey: "+" },
      },
    });
    agent("create-view", {
      spec: {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
        flow: "left-to-right",
      },
    });
    agent(
      "resolve",
      { target: { by: "designation", value: "DOES-NOT-EXIST" } },
      1,
    );
    const sourcePath = join(project, "devices/equipment.json");
    const original = await readFile(sourcePath);
    const source = JSON.parse(original.toString());
    const patch = {
      patchFormat: "json-patch/0.1",
      files: [
        {
          path: "devices/equipment.json",
          expectedIntegrity: `sha256-${createHash("sha256").update(original).digest("base64")}`,
          operations: [
            {
              op: "test",
              path: "/objects/0/description",
              value: source.objects[0].description,
            },
            {
              op: "replace",
              path: "/objects/0/description",
              value: "Package acceptance description",
            },
          ],
        },
      ],
    };
    agent("apply-source-patch", { ...patch, dryRun: true });
    assert.deepEqual(await readFile(sourcePath), original);
    agent("apply-source-patch", { ...patch, dryRun: false });
    const changed = await readFile(sourcePath);
    assert.equal(
      JSON.parse(changed.toString()).objects[0].description,
      "Package acceptance description",
    );
    agent("apply-source-patch", { ...patch, dryRun: false }, 1);
    assert.deepEqual(await readFile(sourcePath), changed);
    assert.equal(agent("validate").valid, true);
    check(
      "all six agent commands, split streams, dry-run/apply, stale integrity refusal",
    );
    assert.deepEqual(await fileInventory(runtime), before);
    check("runtime payload unchanged after use");
    return {
      format: "thermite-runtime-verification/0.1",
      archive: basename(archivePath),
      sha256: digest,
      version: manifest.version,
      commit: manifest.commit,
      sourceDigest: manifest.sourceDigest,
      preview: manifest.preview,
      runtime: `Bun ${Bun.version}`,
      target: `${process.platform}-${process.arch}`,
      checks,
    };
  } finally {
    // Restore permissions so cleanup also works when the invoking user is not root.
    if (runtime)
      for (const file of await listFiles(runtime).catch(() => []))
        await chmod(join(runtime, file), 0o644);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const allowPreview = args.includes("--allow-preview");
  const paths = args.filter((arg) => arg !== "--allow-preview");
  if (paths.length !== 1 || args.length > 2)
    throw new Error(
      "Usage: bun run package:verify <runtime.zip> [--allow-preview] (with .sha256 sidecar)",
    );
  process.stdout.write(
    json(await verifyRuntimeArchive(resolve(paths[0]), { allowPreview })),
  );
}
