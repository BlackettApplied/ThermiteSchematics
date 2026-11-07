import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  readGitIndexEntries,
  resolveGitIndexPath,
  resolveHeadCommit,
} from "../../../scripts/release-common.mjs";

interface IndexEntry {
  readonly path: string;
  readonly mode: string;
  readonly objectId: string;
}

const PRIMARY_ENTRIES: readonly IndexEntry[] = [
  {
    path: "primary.txt",
    mode: "100644",
    objectId: "1111111111111111111111111111111111111111",
  },
];
const LINKED_ENTRIES: readonly IndexEntry[] = [
  {
    path: "linked.txt",
    mode: "100644",
    objectId: "2222222222222222222222222222222222222222",
  },
  {
    path: "src/tool.sh",
    mode: "100755",
    objectId: "3333333333333333333333333333333333333333",
  },
];
const NOT_A_GITDIR_LINK =
  "REL024 Git repository metadata is invalid: the .git file is not a gitdir link.";
const NO_GIT_DIRECTORY =
  "REL024 Git repository metadata is invalid: the .git file does not name a Git directory.";

// A version-2 index with stage-0 entries, sorted by path, and its SHA-1 trailer.
function syntheticIndex(entries: readonly IndexEntry[]): Buffer {
  const header = Buffer.alloc(12);
  header.write("DIRC", 0, "latin1");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(entries.length, 8);
  const records = entries.map(({ path, mode, objectId }) => {
    const name = Buffer.from(path, "latin1");
    const record = Buffer.alloc(Math.ceil((62 + name.length + 1) / 8) * 8);
    record.writeUInt32BE(Number.parseInt(mode, 8), 24);
    Buffer.from(objectId, "hex").copy(record, 40);
    record.writeUInt16BE(name.length, 60);
    name.copy(record, 62);
    return record;
  });
  const body = Buffer.concat([header, ...records]);
  return Buffer.concat([body, createHash("sha1").update(body).digest()]);
}

async function temporaryDirectory(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

// The administrative layout `git worktree add` creates: the primary checkout's
// .git directory is the common directory, and the linked checkout's per-worktree
// state (HEAD, index) lives below .git/worktrees/<name>.
async function linkedWorktreeLayout() {
  const base = await temporaryDirectory("thermite-git-index-layout-");
  const primary = join(base, "primary");
  const admin = join(primary, ".git", "worktrees", "linked");
  const linked = join(base, "linked");
  await mkdir(admin, { recursive: true });
  await mkdir(linked);
  await writeFile(
    join(primary, ".git", "index"),
    syntheticIndex(PRIMARY_ENTRIES),
  );
  await writeFile(join(admin, "index"), syntheticIndex(LINKED_ENTRIES));
  await writeFile(join(admin, "commondir"), "../..\n");
  await writeFile(join(admin, "gitdir"), `${join(linked, ".git")}\n`);
  await writeFile(join(admin, "HEAD"), `${"4".repeat(40)}\n`);
  return { base, primary, admin, linked };
}

// Git stores objects read-only, and Windows refuses to delete read-only files.
async function removeTree(root: string): Promise<void> {
  for (const name of await readdir(root, { recursive: true })) {
    const path = join(root, name);
    if ((await lstat(path)).isFile()) await chmod(path, 0o666);
  }
  await rm(root, { recursive: true, force: true });
}

// Runs the real `git` executable isolated from the developer's Git environment
// and config: an inherited GIT_DIR/GIT_INDEX_FILE (for example inside a hook),
// signing, hooks, or index.version/feature.manyFiles would change what is tested.
async function gitTools(base: string) {
  const globalConfig = join(base, "empty.gitconfig");
  await writeFile(globalConfig, "");
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.toUpperCase().startsWith("GIT_"),
      ),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfig,
  };
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-c", "safe.directory=*", ...args], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  // Git's own answer: `rev-parse --git-path index` prints the index path
  // relative to the working directory or absolute, followed by one LF.
  const gitIndexPath = async (cwd: string): Promise<string> =>
    realpath(
      resolve(
        cwd,
        git(cwd, "rev-parse", "--git-path", "index").replace(/\n$/u, ""),
      ),
    );
  const stagedEntries = (cwd: string): IndexEntry[] =>
    git(cwd, "ls-files", "--stage", "-z")
      .split("\0")
      .filter((record) => record !== "")
      .map((record) => {
        const tab = record.indexOf("\t");
        const [mode = "", objectId = "", stage] = record
          .slice(0, tab)
          .split(" ");
        expect(stage).toBe("0");
        return { path: record.slice(tab + 1), mode, objectId };
      });
  // A committed primary checkout plus a detached linked worktree whose index
  // also stages `<name>-only.txt`, so every worktree's index differs.
  const createRepository = async (primary: string): Promise<void> => {
    git(base, "-c", "init.defaultBranch=main", "init", primary);
    await mkdir(join(primary, "src"));
    await writeFile(join(primary, "README.txt"), "primary\n");
    await writeFile(join(primary, "src", "tool.sh"), "#!/bin/sh\n");
    git(primary, "add", "README.txt");
    git(primary, "add", "--chmod=+x", "src/tool.sh");
    git(
      primary,
      "-c",
      "user.name=Thermite Test",
      "-c",
      "user.email=thermite-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-verify",
      "-m",
      "fixture",
    );
  };
  const addWorktree = async (
    primary: string,
    worktree: string,
    name: string,
  ): Promise<void> => {
    git(primary, "worktree", "add", "--detach", worktree);
    await writeFile(join(worktree, `${name}-only.txt`), `${name}\n`);
    git(worktree, "add", `${name}-only.txt`);
  };
  return { git, gitIndexPath, stagedEntries, createRepository, addWorktree };
}

describe("Git index discovery in primary and linked worktrees", () => {
  it("reads a primary checkout's index from its ordinary .git directory", async () => {
    const { base, primary } = await linkedWorktreeLayout();
    try {
      await expect(resolveGitIndexPath(primary)).resolves.toBe(
        join(primary, ".git", "index"),
      );
      await expect(readGitIndexEntries(primary)).resolves.toEqual(
        PRIMARY_ENTRIES,
      );
    } finally {
      await removeTree(base);
    }
  });

  it("follows an absolute gitdir link to the per-worktree index, not the common directory's", async () => {
    const { base, admin, linked } = await linkedWorktreeLayout();
    try {
      // Git for Windows writes forward-slash absolute paths.
      await writeFile(
        join(linked, ".git"),
        `gitdir: ${admin.replaceAll("\\", "/")}\n`,
      );
      await expect(resolveGitIndexPath(linked)).resolves.toBe(
        join(admin, "index"),
      );
      await expect(readGitIndexEntries(linked)).resolves.toEqual(
        LINKED_ENTRIES,
      );
    } finally {
      await removeTree(base);
    }
  });

  it("resolves a relative CRLF gitdir link against the checkout directory", async () => {
    const { base, admin, linked } = await linkedWorktreeLayout();
    try {
      await writeFile(
        join(linked, ".git"),
        "gitdir: ../primary/.git/worktrees/linked\r\n",
      );
      await expect(resolveGitIndexPath(linked)).resolves.toBe(
        join(admin, "index"),
      );
      await expect(readGitIndexEntries(linked)).resolves.toEqual(
        LINKED_ENTRIES,
      );
    } finally {
      await removeTree(base);
    }
  });

  it("rejects a .git file that is not a gitdir link", async () => {
    const { base, admin, linked } = await linkedWorktreeLayout();
    const target = admin.replaceAll("\\", "/");
    try {
      for (const contents of [
        Buffer.alloc(0),
        Buffer.from("\n"),
        Buffer.from(`gitdir:${target}\n`),
        Buffer.from(`GITDIR: ${target}\n`),
        Buffer.from(` gitdir: ${target}\n`),
        Buffer.from("gitdir: \n"),
        Buffer.from("gitdir: \r\n"),
        Buffer.from(`gitdir: ${target}\u0000\n`),
        Buffer.from(`﻿gitdir: ${target}\n`),
        Buffer.concat([
          Buffer.from("gitdir: "),
          Buffer.from([0xc3, 0x28]),
          Buffer.from("\n"),
        ]),
      ]) {
        await writeFile(join(linked, ".git"), contents);
        await expect(resolveGitIndexPath(linked)).rejects.toThrow(
          NOT_A_GITDIR_LINK,
        );
        await expect(readGitIndexEntries(linked)).rejects.toThrow(
          NOT_A_GITDIR_LINK,
        );
      }
    } finally {
      await removeTree(base);
    }
  });

  it("rejects a gitdir link whose target is missing or not a directory", async () => {
    const { base, admin, linked } = await linkedWorktreeLayout();
    try {
      for (const target of [
        join(base, "missing"),
        join(admin, "HEAD"),
        join(admin, "HEAD", "nested"),
        // Only trailing CR/LF end the link; embedded ones are path characters.
        `${admin}\nindex`,
        `${admin}\r\nindex`,
      ]) {
        await writeFile(
          join(linked, ".git"),
          `gitdir: ${target.replaceAll("\\", "/")}\n`,
        );
        await expect(readGitIndexEntries(linked)).rejects.toThrow(
          NO_GIT_DIRECTORY,
        );
      }
    } finally {
      await removeTree(base);
    }
  });

  it("keeps the historical .git/index location and error without Git metadata", async () => {
    const base = await temporaryDirectory("thermite-git-index-absent-");
    try {
      await expect(resolveGitIndexPath(base)).resolves.toBe(
        join(base, ".git", "index"),
      );
      await expect(readGitIndexEntries(base)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await removeTree(base);
    }
  });

  it("matches Git's own index discovery in a real linked worktree", async () => {
    const base = await temporaryDirectory("thermite-git-index-worktree-");
    const primary = join(base, "primary");
    const linked = join(base, "linked");
    try {
      const {
        git,
        gitIndexPath,
        stagedEntries,
        createRepository,
        addWorktree,
      } = await gitTools(base);
      await createRepository(primary);
      await addWorktree(primary, linked, "linked");

      expect((await lstat(join(linked, ".git"))).isFile()).toBe(true);
      expect(await realpath(await resolveGitIndexPath(linked))).toBe(
        await gitIndexPath(linked),
      );
      expect(await realpath(await resolveGitIndexPath(primary))).toBe(
        await gitIndexPath(primary),
      );

      const linkedEntries = stagedEntries(linked);
      const primaryEntries = stagedEntries(primary);
      expect(linkedEntries.map(({ path }) => path)).toEqual([
        "README.txt",
        "linked-only.txt",
        "src/tool.sh",
      ]);
      expect(primaryEntries.map(({ path }) => path)).toEqual([
        "README.txt",
        "src/tool.sh",
      ]);
      expect(primaryEntries[1]?.mode).toBe("100755");
      await expect(readGitIndexEntries(linked)).resolves.toEqual(linkedEntries);
      await expect(readGitIndexEntries(primary)).resolves.toEqual(
        primaryEntries,
      );

      // The frozen private-release HEAD/object readers still require an
      // ordinary .git directory; only index discovery follows gitdir links.
      await expect(resolveHeadCommit(primary)).resolves.toBe(
        git(primary, "rev-parse", "HEAD").trim(),
      );
      await expect(resolveHeadCommit(linked)).rejects.toThrow(
        "REL024 Git repository metadata is invalid: .git is not an ordinary directory.",
      );
    } finally {
      await removeTree(base);
    }
  });

  it("resolves a symlink before a following '..' in a gitdir link as Git does", async () => {
    const base = await temporaryDirectory("thermite-git-index-symlink-");
    const primary = join(base, "primary");
    const linked = join(base, "linked");
    const other = join(base, "other");
    try {
      const { gitIndexPath, stagedEntries, createRepository, addWorktree } =
        await gitTools(base);
      await createRepository(primary);
      await addWorktree(primary, linked, "linked");
      await addWorktree(primary, other, "other");
      // `pointer` names primary/child. Following it before ".." reaches
      // primary/.git/worktrees/linked; collapsing "pointer/.." lexically
      // reaches base/.git/worktrees/linked instead. Make that decoy a valid Git
      // directory with a different index (the `other` worktree's), so a reader
      // that disagrees with Git returns the wrong entries rather than failing.
      const decoy = join(base, ".git", "worktrees", "linked");
      const otherAdmin = join(primary, ".git", "worktrees", "other");
      await mkdir(decoy, { recursive: true });
      await copyFile(join(otherAdmin, "HEAD"), join(decoy, "HEAD"));
      await copyFile(join(otherAdmin, "index"), join(decoy, "index"));
      await writeFile(
        join(decoy, "commondir"),
        `${join(primary, ".git").replaceAll("\\", "/")}\n`,
      );
      await mkdir(join(primary, "child"));
      // A junction needs no privilege on Windows; POSIX ignores the type.
      await symlink(join(primary, "child"), join(base, "pointer"), "junction");
      await writeFile(
        join(linked, ".git"),
        "gitdir: ../pointer/../.git/worktrees/linked\n",
      );

      const expected = stagedEntries(linked);
      expect(await realpath(await resolveGitIndexPath(linked))).toBe(
        await gitIndexPath(linked),
      );
      await expect(readGitIndexEntries(linked)).resolves.toEqual(expected);
      // POSIX path resolution (and so Git) follows the symlink before "..".
      // Win32 path normalization collapses ".." before reparse points, so Git
      // for Windows, and this reader there, use the lexical directory.
      expect(expected.map(({ path }) => path)).toContain(
        process.platform === "win32" ? "other-only.txt" : "linked-only.txt",
      );
    } finally {
      await removeTree(base);
    }
  });

  it("accepts the embedded CR and LF Git writes for a checkout path containing them", async () => {
    const base = await temporaryDirectory("thermite-git-index-newline-");
    const primary = join(base, "primary\nnew\rline");
    const linked = join(base, "linked");
    try {
      if (process.platform === "win32") {
        // Win32 file names cannot contain CR or LF, so Git cannot write such a
        // gitdir link there; the synthetic cases above cover the parser.
        await expect(mkdir(primary)).rejects.toThrow();
        return;
      }
      const { gitIndexPath, stagedEntries, createRepository, addWorktree } =
        await gitTools(base);
      await createRepository(primary);
      await addWorktree(primary, linked, "linked");

      expect(await readFile(join(linked, ".git"), "utf8")).toBe(
        `gitdir: ${join(primary, ".git", "worktrees", "linked")}\n`,
      );
      expect(await realpath(await resolveGitIndexPath(linked))).toBe(
        await gitIndexPath(linked),
      );
      const expected = stagedEntries(linked);
      expect(expected.map(({ path }) => path)).toContain("linked-only.txt");
      await expect(readGitIndexEntries(linked)).resolves.toEqual(expected);
    } finally {
      await removeTree(base);
    }
  });
});
