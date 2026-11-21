import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  crc32,
  extractSafeZipArchive,
  readSafeZipArchive,
} from "../../../scripts/safe-zip-reader.mjs";
const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

function mappingKeys(text: string, spaces: number) {
  const expression = new RegExp(
    `^ {${spaces}}([A-Za-z_][A-Za-z0-9_-]*):`,
    "gmu",
  );
  return [...text.matchAll(expression)].map((match) => match[1]);
}

function block(text: string, key: string, spaces: number) {
  const prefix = `${" ".repeat(spaces)}${key}:`;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === prefix);
  if (start < 0) throw new Error(`Missing YAML key ${key}.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== "" && !line.startsWith(" ".repeat(spaces + 1))) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function createStoredZip(
  files: readonly { name: string; bytes: Buffer; mode?: number }[],
) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(file.bytes.length, 18);
    local.writeUInt32LE(file.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, file.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(file.bytes.length, 20);
    central.writeUInt32LE(file.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + file.bytes.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

describe("Runtime CI and ZIP boundaries", () => {
  it("keeps ordinary pull-request CI byte-identical to its authority", async () => {
    const [workflow, authority] = await Promise.all([
      readFile(join(repositoryRoot, ".github", "workflows", "ci.yml")),
      readFile(join(repositoryRoot, "scripts", "ordinary-ci.authority.yml")),
    ]);
    expect(workflow.equals(authority)).toBe(true);
    const text = workflow.toString("utf8");
    expect(text).toContain("pull_request:\n    branches: [release]");
    expect(text).toContain("push:\n    branches: [release]");
    expect(text).not.toContain("branches: [dev]");
    expect(text).toContain(
      "if: github.ref == 'refs/heads/release' || github.base_ref == 'release'",
    );
    expect(text).toContain("permissions:\n  contents: read");
    expect(text).toContain("persist-credentials: false");
    expect(text).toContain("runs-on: ${{ matrix.os }}");
    expect(text).toContain("os: [macos-15, ubuntu-24.04, windows-2022]");
    expect(text).toContain("oven-sh/setup-bun@v2");
    expect(text).toContain("bun-version-file: .bun-version");
    expect(text).toContain("run: bun install --frozen-lockfile");
    expect(text).toContain("run: bun run check");
    expect(text).toContain("run: bun run package:pack");
    // The linked-worktree full check runs as its own matrix job, in
    // parallel with the clone check, so neither exceeds the job time limit.
    const jobs = block(text, "jobs", 0);
    expect(mappingKeys(jobs, 2)).toEqual(["check", "worktree"]);
    const clone = block(jobs, "check", 2);
    const worktree = block(jobs, "worktree", 2);
    expect(clone).toContain("run: bun run check");
    expect(clone).not.toContain("check-worktree");
    for (const job of [clone, worktree]) {
      expect(job).toContain(
        "if: github.ref == 'refs/heads/release' || github.base_ref == 'release'",
      );
      expect(job).toContain("os: [macos-15, ubuntu-24.04, windows-2022]");
      expect(job).toContain("timeout-minutes: 90");
      expect(job).toContain(
        "THERMITE_CI_MAX_WORKERS: ${{ matrix.os == 'ubuntu-24.04' && '2' || '3' }}",
      );
      expect(job).toContain('THERMITE_REQUIRE_BROWSER: "1"');
      expect(job).toContain("persist-credentials: false");
      expect(job).toContain('python-version: "3.12"');
      expect(job).toContain("run: bun install --frozen-lockfile");
      expect(job).toContain("THERMITE_RESEARCH_PYTHON: python");
    }
    expect(worktree).toContain("run: bun scripts/check-worktree.mjs");
    expect(worktree).not.toContain("run: bun run check");
    expect(worktree).not.toContain("package:pack");
    expect(text).toContain("--network=none");
    expect(text).toContain("if: runner.os == 'Linux'");
    expect(text).toContain(
      "runtime-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}",
    );
    expect(text).toContain("release-out/runtime/**/*.zip");
    expect(text).toContain("if-no-files-found: error");
    expect(text).not.toContain("pull_request_target");
    expect(text).not.toContain("run-vitest-and-audit");
    expect(text).not.toContain("THERMITE_SCHEMATICS_RELEASE_");
  });

  it("rejects escaping, duplicate, extra, and link ZIP entries", async () => {
    await expect(
      readSafeZipArchive(
        createStoredZip([{ name: "../escape", bytes: Buffer.from("x") }]),
      ),
    ).rejects.toThrow(/ZIP001/u);
    await expect(
      readSafeZipArchive(
        createStoredZip([
          { name: "same", bytes: Buffer.from("a") },
          { name: "same", bytes: Buffer.from("b") },
        ]),
      ),
    ).rejects.toThrow(/ZIP001/u);
    await expect(
      readSafeZipArchive(
        createStoredZip([{ name: "extra", bytes: Buffer.from("x") }]),
        { expectedFiles: ["expected"] },
      ),
    ).rejects.toThrow(/ZIP001/u);
    await expect(
      readSafeZipArchive(
        createStoredZip([
          { name: "link", bytes: Buffer.from("target"), mode: 0o120777 },
        ]),
      ),
    ).rejects.toThrow(/ZIP001/u);
  });

  it("extracts the exact ordinary file set and rejects an existing destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-zip-valid-"));
    const extraction = join(root, "extracted");
    const bytes = Buffer.from("verified\n");
    const zip = createStoredZip([{ name: "evidence.json", bytes }]);
    try {
      await extractSafeZipArchive(zip, extraction, {
        expectedFiles: ["evidence.json"],
      });
      expect(await readFile(join(extraction, "evidence.json"))).toEqual(bytes);
      await expect(
        extractSafeZipArchive(zip, extraction, {
          expectedFiles: ["evidence.json"],
        }),
      ).rejects.toThrow(/ZIP002/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
