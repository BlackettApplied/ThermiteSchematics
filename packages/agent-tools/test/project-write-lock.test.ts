import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadProject, PROJECT_WRITE_LOCK_FILE_NAME } from "@thermite/compiler";
import { expect, it, vi } from "vitest";

// Emulate the Windows legacy component walk preserving an equivalent spelling
// (e.g. RUNNER~1). Native realpath, also used by the loader, resolves that alias.
// A trailing dot component is an equivalent spelling available on POSIX too.
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    realpathSync: Object.assign(
      (path: string) => `${fs.realpathSync(path)}/.`,
      { native: fs.realpathSync.native },
    ),
  };
});

import {
  defaultProjectWriteLockOperations,
  reserveProjectWrite,
} from "../src/project-write-lock.js";
import { createPatchProjectFixture } from "./patch-project-fixture.js";

it("reserves through the host's temporary alias and Windows drive spelling", async () => {
  const fixture = await createPatchProjectFixture("clean");
  try {
    // Reintroduce the runner's real temporary alias (RUNNER~1 on Windows),
    // even though fixture expectations use the canonical spelling.
    const logical = join(
      tmpdir(),
      relative(await realpath(tmpdir()), fixture.projectRoot),
    );
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    process.stdout.write(
      `Reservation path evidence ${JSON.stringify({
        logical,
        promise: await realpath(logical),
        legacySync: fs.realpathSync(logical),
        nativeSync: fs.realpathSync.native(logical),
      })}\n`,
    );
    for (const input of [
      logical,
      logical.replace(/^[A-Z]:/u, (drive) => drive.toLowerCase()),
    ]) {
      const loaded = await loadProject(input);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded));
      const reservation = reserveProjectWrite(loaded.project);
      if (!reservation.ok) throw new Error(JSON.stringify(reservation));
      reservation.release();
    }
    expect(await readdir(fixture.projectRoot)).not.toContain(
      PROJECT_WRITE_LOCK_FILE_NAME,
    );
  } finally {
    await fixture.cleanup();
  }
});

it("reserves and releases using the loader's native canonical spelling", async () => {
  const fixture = await createPatchProjectFixture("clean");
  try {
    const loaded = await loadProject(fixture.projectRoot);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    const reservation = reserveProjectWrite(loaded.project);
    if (!reservation.ok) throw new Error(JSON.stringify(reservation));
    expect(reservation.path).toBe(
      join(loaded.project.canonicalRootPath, PROJECT_WRITE_LOCK_FILE_NAME),
    );
    reservation.assertHeld();
    reservation.release();
    expect(await readdir(fixture.projectRoot)).not.toContain(
      PROJECT_WRITE_LOCK_FILE_NAME,
    );
  } finally {
    await fixture.cleanup();
  }
});

it("refuses a logical root redirected to another ordinary directory", async () => {
  const fixture = await createPatchProjectFixture("clean");
  try {
    const loaded = await loadProject(fixture.projectRoot);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    const outside = join(fixture.root, "outside");
    await mkdir(outside);
    expect(() =>
      reserveProjectWrite({ ...loaded.project, logicalRootPath: outside }),
    ).toThrow("reservation identity changed");
    expect(await readdir(outside)).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
});

it("refuses release after the root inode changes at the same canonical path", async () => {
  const fixture = await createPatchProjectFixture("clean");
  try {
    const loaded = await loadProject(fixture.projectRoot);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    const moved = join(fixture.root, "moved");
    const sentinel = join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME);
    const reservation = reserveProjectWrite(loaded.project, {
      ...defaultProjectWriteLockOperations,
      closeSync(fd) {
        defaultProjectWriteLockOperations.closeSync(fd);
        // Windows refuses to rename a directory with this open lock. Perform
        // the real swap after close, before the release guard/unlink instead.
        renameSync(fixture.projectRoot, moved);
        mkdirSync(fixture.projectRoot);
        writeFileSync(sentinel, "REPLACEMENT OWNER");
      },
    });
    if (!reservation.ok) throw new Error(JSON.stringify(reservation));
    expect(() => reservation.release()).toThrow("reservation identity changed");
    expect(await readFile(sentinel, "utf8")).toBe("REPLACEMENT OWNER");
    expect(await readdir(moved)).toContain(PROJECT_WRITE_LOCK_FILE_NAME);
  } finally {
    await fixture.cleanup();
  }
});
