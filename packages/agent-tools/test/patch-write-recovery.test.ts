import { readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  loadProject,
  PROJECT_WRITE_LOCK_FILE_NAME,
  writeFileAtomically,
} from "@thermite/compiler";
import { describe, expect, it } from "vitest";
import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import {
  reserveProjectWrite,
  defaultProjectWriteLockOperations,
} from "../src/project-write-lock.js";
import { hostname } from "node:os";
import {
  defaultPatchFilesystemDependencies,
  scanOrdinaryProjectTree,
} from "../src/patch-filesystem.js";
import { createPatchProjectFixture } from "./patch-project-fixture.js";
import {
  POSIX_SIGNALS_UNAVAILABLE,
  requestFor,
  RESERVATION_SIGNALS,
  startPausedWriter,
  stopPausedWriter,
  withFailingRelease,
} from "./patch-write-recovery.cases.js";

describe("patch write recovery outcomes", () => {
  it("keeps committed success when reservation release fails", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const outcome = await createInternalApplySourcePatchTool(
        {},
        withFailingRelease(defaultApplySourcePatchDependencies),
      ).applySourcePatch(await requestFor(fixture.projectRoot));
      expect(outcome).toMatchObject({
        ok: true,
        value: { applied: true },
        diagnostics: [{ code: "W801", severity: "warning" }],
      });
      expect(outcome.diagnostics[0]?.message).toContain(
        "changes were committed",
      );
      expect(outcome.diagnostics[0]?.message).toContain(
        JSON.stringify(join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME)),
      );
      expect(
        JSON.parse(
          await readFile(join(fixture.projectRoot, "sources/a.json"), "utf8"),
        ).$schema,
      ).toBe("review");
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["EMFILE", "EACCES", "EIO"])(
    "preserves %s from a write guard read",
    async (code) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        let precommit = false;
        const outcome = await createInternalApplySourcePatchTool(
          {},
          {
            ...defaultApplySourcePatchDependencies,
            async scanProjectTree(root) {
              const result = await scanOrdinaryProjectTree(root);
              if ((await readdir(root)).includes(PROJECT_WRITE_LOCK_FILE_NAME))
                precommit = true;
              return result;
            },
            filesystem: {
              ...defaultPatchFilesystemDependencies,
              async readFile(path) {
                if (
                  precommit &&
                  path === join(fixture.projectRoot, "sources/a.json")
                )
                  throw Object.assign(new Error("injected"), { code });
                return defaultPatchFilesystemDependencies.readFile(path);
              },
            },
          },
        ).applySourcePatch(await requestFor(fixture.projectRoot));
        expect(outcome).toMatchObject({
          ok: false,
          failureClass: "tool",
          error: null,
        });
        expect(outcome.diagnostics[0]?.message).toContain(
          `commit-write/${code}`,
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("allows an editor to replace a target with identical bytes before commit", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const outcome = await createInternalApplySourcePatchTool(
        {},
        {
          ...defaultApplySourcePatchDependencies,
          async scanProjectTree(root) {
            if ((await readdir(root)).includes(PROJECT_WRITE_LOCK_FILE_NAME)) {
              const file = join(root, "sources/a.json");
              await writeFileAtomically(file, await readFile(file));
            }
            return scanOrdinaryProjectTree(root);
          },
        },
      ).applySourcePatch(await requestFor(fixture.projectRoot));
      expect(outcome).toMatchObject({ ok: true, value: { applied: true } });
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores a vanished atomic temporary file during tree scanning", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const temporary = join(fixture.projectRoot, "sources/.a.json.123.4.tmp");
      await writeFile(temporary, "");
      expect(
        await scanOrdinaryProjectTree(fixture.projectRoot, {
          ...defaultPatchFilesystemDependencies,
          async readdir(path) {
            const names =
              await defaultPatchFilesystemDependencies.readdir(path);
            if (path === join(fixture.projectRoot, "sources"))
              await unlink(temporary);
            return names;
          },
        }),
      ).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  // POSIX_SIGNALS_UNAVAILABLE records why Windows skips these.
  it.skipIf(POSIX_SIGNALS_UNAVAILABLE).each(RESERVATION_SIGNALS)(
    "releases a held reservation before re-raising %s",
    async (signal) => {
      const fixture = await createPatchProjectFixture("clean");
      const writer = await startPausedWriter(fixture);
      const { child, closed, lines } = writer;
      try {
        expect((await lines.next()).value).toBe("ready");
        const owner = JSON.parse(
          await readFile(
            join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME),
            "utf8",
          ),
        );
        expect(owner).toMatchObject({
          pid: child.pid,
          hostname: expect.any(String),
          createdAt: expect.any(String),
          thermiteVersion: expect.any(String),
        });
        child.kill(signal);
        expect((await closed)[1]).toBe(signal);
        expect(await readdir(fixture.projectRoot)).not.toContain(
          PROJECT_WRITE_LOCK_FILE_NAME,
        );
        expect(
          (
            await createInternalApplySourcePatchTool().applySourcePatch(
              await requestFor(fixture.projectRoot),
            )
          ).ok,
        ).toBe(true);
      } finally {
        await stopPausedWriter(writer);
        await fixture.cleanup();
      }
    },
  );
  it.each(["fstatSync", "writeFileSync"] as const)(
    "cleans the file and descriptor when %s fails during acquisition",
    async (operation) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        const loaded = await loadProject(fixture.projectRoot);
        if (!loaded.ok) throw new Error(JSON.stringify(loaded));
        let closes = 0;
        const before = process.listenerCount("SIGTERM");
        expect(() =>
          reserveProjectWrite(loaded.project, {
            ...defaultProjectWriteLockOperations,
            [operation]: () => {
              throw Object.assign(new Error("injected"), { code: "EMFILE" });
            },
            closeSync(fd) {
              closes++;
              defaultProjectWriteLockOperations.closeSync(fd);
            },
          }),
        ).toThrow("injected");
        expect(closes).toBe(1);
        expect(process.listenerCount("SIGTERM")).toBe(before);
        expect(await readdir(fixture.projectRoot)).not.toContain(
          PROJECT_WRITE_LOCK_FILE_NAME,
        );
        const reservation = reserveProjectWrite(loaded.project);
        if (!reservation.ok) throw new Error(JSON.stringify(reservation));
        reservation.release();
        reservation.release();
        expect(process.listenerCount("SIGTERM")).toBe(before);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each(["alive", "other-host", "unknown"] as const)(
    "reports %s owner metadata without fake integrity fields or reclamation",
    async (state) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        const path = join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME);
        const contents =
          state === "unknown"
            ? "not metadata"
            : JSON.stringify({
                pid: process.pid,
                hostname:
                  state === "alive" ? hostname() : `${hostname()}-other`,
                createdAt: new Date(Date.now() - 60000).toISOString(),
                thermiteVersion: "review-version",
              });
        await writeFile(path, contents);
        const outcome =
          await createInternalApplySourcePatchTool().applySourcePatch(
            await requestFor(fixture.projectRoot),
          );
        expect(outcome).toMatchObject({
          ok: false,
          failureClass: "expected",
          error: { code: "A005", lockPath: path, ownerState: state },
        });
        if (outcome.ok || outcome.error?.code !== "A005")
          throw new Error(JSON.stringify(outcome));
        expect(outcome.error).not.toHaveProperty("actualIntegrity");
        expect(outcome.error).not.toHaveProperty("expectedIntegrity");
        if (state !== "unknown") {
          expect(outcome.error.owner).toMatchObject({
            pid: process.pid,
            thermiteVersion: "review-version",
          });
          expect(outcome.error.ageMs).toBeGreaterThanOrEqual(60000);
        }
        expect(await readFile(path, "utf8")).toBe(contents);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("reports a SIGKILL-abandoned reservation and permits explicit recovery", async () => {
    const fixture = await createPatchProjectFixture("clean");
    const writer = await startPausedWriter(fixture);
    const { child, closed, lines } = writer;
    try {
      expect((await lines.next()).value).toBe("ready");
      child.kill("SIGKILL");
      await closed;
      const path = join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME);
      const outcome =
        await createInternalApplySourcePatchTool().applySourcePatch(
          await requestFor(fixture.projectRoot),
        );
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          code: "A005",
          lockPath: path,
          ownerState: "not-running",
          owner: { pid: child.pid, hostname: hostname() },
        },
      });
      expect(JSON.stringify(outcome)).toContain("appears abandoned");
      expect(JSON.stringify(outcome)).toContain("re-inspect");
      await unlink(path);
      expect(
        (
          await createInternalApplySourcePatchTool().applySourcePatch(
            await requestFor(fixture.projectRoot),
          )
        ).ok,
      ).toBe(true);
    } finally {
      await stopPausedWriter(writer);
      await fixture.cleanup();
    }
  });
});
