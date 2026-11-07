import {
  assertRuntimePlatform,
  consumerExecution,
  currentTarget,
} from "./platform.mjs";
import {
  assertGuideLinksResolved,
  rewriteGuideLinks,
} from "../../packages/cli/src/guide-markdown.ts";
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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  assertRuntimePlatform();
  const execution = consumerExecution();
  // Consumer CLI processes cannot consult this checkout or the isolated source
  // build used for parity. The verifier itself may read build-only references.
  if (process.platform === "darwin") {
    const denied = [
      fileURLToPath(new URL("../../", import.meta.url)),
      ...(sourceCli ? [dirname(sourceCli)] : []),
    ];
    execution.prefix[1] += denied
      .map(
        (path) =>
          `(deny file-read* (subpath ${JSON.stringify(resolve(path))}))`,
      )
      .join("");
  }
  const bytes = await readFile(archivePath);
  const digest = sha256(bytes);
  assert.equal(
    await readFile(`${archivePath}.sha256`, "utf8"),
    `${digest}  ${basename(archivePath)}\n`,
    "Archive SHA-256 mismatch",
  );
  const entries = await readSafeZipArchive(bytes);
  const manifest = verifyEntries(entries);
  const buildCommit = JSON.parse(
    entries
      .find(
        (entry) =>
          entry.path === "node_modules/@thermite/cli/assets/guide/source.json",
      )
      .bytes.toString("utf8"),
  ).commit;
  assert.equal(
    buildCommit,
    manifest.commit,
    "Packaging must bind guide build and runtime manifest to the same commit",
  );
  const metrics = entries.filter((entry) =>
    /(?:^|\/)text-metrics-data\./u.test(entry.path),
  );
  assert.deepEqual(
    metrics.map((entry) => entry.path).sort(),
    [
      "node_modules/@thermite/render/dist/text-metrics-data.d.ts",
      "node_modules/@thermite/render/dist/text-metrics-data.js",
    ],
    "Ship compact generated data without duplicate source or maps",
  );
  assert(
    metrics.reduce((bytes, entry) => bytes + entry.bytes.length, 0) <= 100000,
    "Generated runtime metric data exceeds 100 KB",
  );
  assert(
    !entries.some((entry) =>
      /node_modules\/(?:dejavu-fonts-ttf|pdfjs-dist|playwright-core|@napi-rs\/canvas)\//u.test(
        entry.path,
      ),
    ),
    "Generator/raster dependencies must remain development-only",
  );
  verifyArchiveIdentity(manifest, basename(archivePath), { allowPreview });
  assert.equal(
    manifest.target,
    currentTarget(),
    "Verify on the archive target platform",
  );
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
    // A mismatched build commit must be refused, then the original bytes restored.
    const guideProvenance = join(
      runtime,
      "node_modules/@thermite/cli/assets/guide/source.json",
    );
    const wrongCommit =
      manifest.commit === "a".repeat(40) ? "b".repeat(40) : "a".repeat(40);
    const before = await fileInventory(runtime);
    const tools = join(temporary, "restricted-bin");
    const home = join(temporary, "home");
    await mkdir(tools);
    await mkdir(home);
    for (const name of ["node", "npm", "npx", "git", "tsc", "bun"]) {
      await writeFile(
        join(tools, process.platform === "win32" ? `${name}.cmd` : name),
        process.platform === "win32"
          ? "@echo Unexpected development tool invocation 1>&2\r\n@exit /b 97\r\n"
          : '#!/bin/sh\necho "Unexpected development tool invocation" >&2\nexit 97\n',
      );
      if (process.platform !== "win32") await chmod(join(tools, name), 0o755);
    }
    // Keep development tools and caches out of consumer processes. Preserve
    // only Windows system locations needed to load OS libraries. Network
    // isolation is measured and reported separately on each platform.
    const env = {
      PATH: tools,
      HOME: home,
      USERPROFILE: home,
      TEMP: temporary,
      TMP: temporary,
      ...(process.platform === "win32"
        ? {
            SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT,
            WINDIR: process.env.WINDIR,
            ComSpec: process.env.ComSpec,
            PATHEXT: ".COM;.EXE;.BAT;.CMD",
            LOCALAPPDATA: home,
            APPDATA: home,
          }
        : {}),
      TMPDIR: temporary,
      BUN_INSTALL_CACHE_DIR: join(home, "empty-cache"),
      NODE_PATH: "",
      LANG: "en_US.UTF-8",
    };
    const cli = join(runtime, "thermite.mjs");
    const invoke = (args, input, expected = 0, cwd = temporary) => {
      const result = spawnSync(
        execution.command,
        [...execution.prefix, cli, ...args],
        {
          cwd,
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
    const originalProvenance = await readFile(guideProvenance);
    await writeFile(guideProvenance, json({ commit: wrongCommit }));
    for (const args of [
      ["guide", "modeling"],
      ["guide", "--json"],
    ]) {
      const refusal = invoke(args, undefined, 2);
      assert.equal(refusal.stdout, "");
      assert.match(refusal.stderr, /commit mismatch/);
    }
    await writeFile(guideProvenance, originalProvenance);
    assert.deepEqual(await fileInventory(runtime), before);
    check(
      "mismatched guide/build commit refused; original provenance restored",
    );
    // Read-only files prove the CLI does not update its installation or libraries.
    for (const file of await listFiles(runtime))
      await chmod(join(runtime, file), 0o444);
    assert.equal(invoke(["--version"]).stdout.trim(), manifest.version);
    assert.match(invoke(["--help"]).stdout, /Thermite/);
    check(
      `relocated, read-only package; Bun only; network isolation: ${execution.networkIsolation}; version and help`,
    );
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
      !entries.some((entry) =>
        entry.path.endsWith("/assets/guide-source.json"),
      ),
    );
    const originals = sourceCli
      ? JSON.parse(
          await readFile(
            join(dirname(sourceCli), "packages/cli/assets/guide-source.json"),
            "utf8",
          ),
        )
      : undefined;
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
          rewriteGuideLinks(
            originals[topic.id],
            topic,
            topics,
            manifest.commit,
          ),
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
    const core = await import(
      pathToFileURL(
        join(runtime, "node_modules/@thermite/core-library/dist/index.js"),
      ).href
    );
    for (const version of ["0.1.0", "0.2.0"]) {
      const entry = core.SHIPPED_CORE_VERSIONS[version];
      assert.equal(entry.fileInventory.length, version === "0.1.0" ? 14 : 34);
      for (const file of entry.fileInventory) {
        assert(
          entries.some(
            (item) =>
              item.path === `node_modules/@thermite/core-library/${file}`,
          ),
          `Missing core ${version} file ${file}`,
        );
      }
      const shippedProject = join(temporary, `shipped-core-${version}`);
      await mkdir(shippedProject);
      await writeFile(
        join(shippedProject, "system.json"),
        json({
          format: "electrical-system/0.1",
          project: { name: `Shipped ${version}` },
          sources: ["devices.json"],
          libraries: [{ name: "core", version }],
        }),
      );
      await writeFile(
        join(shippedProject, "devices.json"),
        json({ objects: [] }),
      );
      invoke(["lock", shippedProject]);
      invoke(["validate", shippedProject]);
      const lock = JSON.parse(
        await readFile(
          join(shippedProject, "electrical-system.lock.json"),
          "utf8",
        ),
      );
      assert.equal(lock.libraries.core.version, version);
      assert.equal(lock.libraries.core.path, `ais-shipped:core@${version}`);
      assert.equal(lock.libraries.core.resolutionKind, "shipped");
      assert.equal(
        Object.keys(lock.libraries.core.files).length,
        version === "0.1.0" ? 14 : 34,
      );
    }
    check(
      "both shipped core inventories resolve and validate from the relocated release package",
    );
    const project = join(temporary, "electrical project");
    invoke(["init", project, "--name", "Package acceptance"]);
    invoke(["init", project], undefined, 2);
    invoke(["validate", project]);
    for (const tool of ["inspect", "apply-source-patch"]) {
      const help = invoke(
        ["agent", tool, "--help"],
        undefined,
        0,
        project,
      ).stdout;
      const requests = [...help.matchAll(/```json\n([\s\S]*?)\n```/g)];
      assert(requests.length > 0);
      for (const [, request] of requests) {
        const result = invoke(
          ["agent", tool, "--input", "-"],
          request,
          0,
          project,
        );
        assert.equal(JSON.parse(result.stdout).tool, tool);
        assert.equal(JSON.parse(result.stderr).error, null);
      }
    }
    check(
      "printed help requests execute unchanged offline in a starter; repository reads denied on macOS",
    );
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
          /\/BaseFont\s+\/[A-Z]{6}\+NotoSans-Regular\b/,
          "Embedded Noto Sans primary face for rooted view text",
        );
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
        // The reference build needs source access; consumer invocations above
        // keep the stricter repository-read denial throughout acceptance.
        const sourceExecution = consumerExecution();
        execFileSync(
          sourceExecution.command,
          [
            ...sourceExecution.prefix,
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
      target: currentTarget(),
      networkIsolation: execution.networkIsolation,
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
