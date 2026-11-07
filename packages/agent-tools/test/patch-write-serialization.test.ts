import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import {
  compileProject,
  computeFileIntegrity,
  loadProject,
  PROJECT_WRITE_LOCK_FILE_NAME,
} from "@thermite/compiler";
import { describe, expect, it } from "vitest";

import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import { createPatchProjectFixture } from "./patch-project-fixture.js";
import {
  arrangePartialRollback,
  requestFor,
  ROLLBACK_CHANGES,
} from "./patch-write-serialization.cases.js";
import { reserveProjectWrite } from "../src/project-write-lock.js";
import {
  defaultPatchFilesystemDependencies,
  scanOrdinaryProjectTree,
} from "../src/patch-filesystem.js";

const lockName = PROJECT_WRITE_LOCK_FILE_NAME;

describe("cross-process patch reservation and guarded rollback", () => {
  it("lets exactly one process succeed with the same guards", async () => {
    const fixture = await createPatchProjectFixture("clean");
    let first: ReturnType<typeof spawn> | undefined;
    try {
      const requestA = await requestFor(fixture.projectRoot);
      const requestB = {
        ...(await requestFor(fixture.projectRoot, undefined, "B")),
        project: join(fixture.projectRoot, "system.json"),
      };
      const inputA = join(fixture.root, "a.request.json");
      const inputB = join(fixture.root, "b.request.json");
      await writeFile(inputA, JSON.stringify(requestA));
      await writeFile(inputB, JSON.stringify(requestB));
      first = spawn(
        process.execPath,
        [
          resolve("packages/agent-tools/test/fixtures/paused-patch-writer.mjs"),
          inputA,
        ],
        { stdio: "pipe" },
      );
      const firstExit = once(first, "exit");
      const lines = createInterface({ input: first.stdout! })[
        Symbol.asyncIterator
      ]();
      expect((await lines.next()).value).toBe("ready");
      const second = spawn(
        process.execPath,
        [
          resolve("thermite.mjs"),
          "agent",
          "apply-source-patch",
          "--input",
          inputB,
        ],
        { stdio: "pipe" },
      );
      const stdout: Buffer[] = [],
        stderr: Buffer[] = [];
      second.stdout!.on("data", (data: Buffer) => stdout.push(data));
      second.stderr!.on("data", (data: Buffer) => stderr.push(data));
      const [secondCode] = await once(second, "close");
      first.stdin!.end("resume\n");
      const result = JSON.parse((await lines.next()).value!);
      expect((await firstExit)[0]).toBe(0);
      expect(result).toMatchObject({ ok: true, value: { applied: true } });
      expect(secondCode).toBe(1);
      expect(Buffer.concat(stdout).toString()).toBe("");
      expect(JSON.parse(Buffer.concat(stderr).toString())).toMatchObject({
        error: { code: "A005" },
      });
      expect(
        JSON.parse(
          await readFile(join(fixture.projectRoot, "sources/a.json"), "utf8"),
        ).$schema,
      ).toBe("A");
      expect(await readdir(fixture.projectRoot)).not.toContain(lockName);
    } finally {
      if (first !== undefined && first.exitCode === null) {
        const closed = once(first, "close");
        first.kill();
        await closed;
      }
      await fixture.cleanup();
    }
  });

  it.each([
    "success",
    "no-op",
    "precommit-load",
    "snapshot",
    "commit",
    "rollback",
  ])("cleans the reservation after %s", async (phase) => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const request = await requestFor(fixture.projectRoot, [
        "sources/a.json",
        "sources/b.json",
      ]);
      if (phase === "no-op") {
        // Canonical source bytes make a test-only request a byte-for-byte no-op.
        for (const file of request.files) {
          await writeFile(
            join(fixture.projectRoot, file.path),
            '{\n  "objects": []\n}\n',
          );
        }
      }
      const currentRequest =
        phase === "no-op"
          ? {
              ...request,
              files: await Promise.all(
                request.files.map(async (file) => ({
                  ...file,
                  operations: file.operations.slice(0, 1),
                  expectedIntegrity: computeFileIntegrity(
                    await readFile(join(fixture.projectRoot, file.path)),
                  ),
                })),
              ),
            }
          : request;
      let loads = 0,
        writes = 0;
      let observedLock = false;
      const outcome = await createInternalApplySourcePatchTool(
        {},
        {
          ...defaultApplySourcePatchDependencies,
          async loadProject(input, cwd) {
            loads++;
            if (loads === 2) {
              observedLock = (await readdir(fixture.projectRoot)).includes(
                lockName,
              );
              if (phase === "precommit-load")
                throw Object.assign(new Error("injected"), {
                  code: "E_PRECOMMIT",
                });
            }
            const loaded =
              await defaultApplySourcePatchDependencies.loadProject(input, cwd);
            if (loads === 2 && phase === "snapshot") {
              const path = join(fixture.projectRoot, "sources/b.json");
              await writeFile(
                path,
                Buffer.concat([await readFile(path), Buffer.from("\n")]),
              );
            }
            return loaded;
          },
          async writeFileAtomically(path, bytes, options) {
            expect(await readdir(fixture.projectRoot)).toContain(lockName);
            writes++;
            if (
              ((phase === "commit" || phase === "rollback") && writes === 2) ||
              (phase === "rollback" && writes === 3)
            ) {
              throw Object.assign(new Error("injected"), { code: "E_WRITE" });
            }
            await defaultApplySourcePatchDependencies.writeFileAtomically(
              path,
              bytes,
              options,
            );
          },
        },
      ).applySourcePatch(currentRequest);
      expect(observedLock).toBe(true);
      expect(outcome.ok).toBe(phase === "success" || phase === "no-op");
      if (phase === "snapshot")
        expect(outcome).toMatchObject({
          error: { code: "A004" },
          failureClass: "expected",
        });
      if (phase === "no-op")
        expect(outcome).toMatchObject({ value: { applied: false } });
      if (phase === "rollback")
        expect(JSON.stringify(outcome.diagnostics)).toContain("not restored");
      expect(await readdir(fixture.projectRoot)).not.toContain(lockName);
      // A fresh request can reserve the same project after every outcome.
      expect(
        (
          await createInternalApplySourcePatchTool().applySourcePatch(
            await requestFor(fixture.projectRoot),
          )
        ).ok,
      ).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not create a reservation for dry runs", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const request = {
        ...(await requestFor(fixture.projectRoot)),
        dryRun: true,
      };
      const outcome = await createInternalApplySourcePatchTool(
        {},
        {
          ...defaultApplySourcePatchDependencies,
          async compileProject(input, cwd) {
            expect(await readdir(fixture.projectRoot)).not.toContain(lockName);
            return defaultApplySourcePatchDependencies.compileProject(
              input,
              cwd,
            );
          },
        },
      ).applySourcePatch(request);
      expect(outcome.ok).toBe(true);
      expect(await readdir(fixture.projectRoot)).not.toContain(lockName);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["", "abandoned owner: pid no longer known\n"])(
    "fails closed on an existing lock without stealing it (%j)",
    async (contents) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        const lockPath = join(fixture.projectRoot, lockName);
        await writeFile(lockPath, contents);
        const request = await requestFor(fixture.projectRoot);
        const outcome =
          await createInternalApplySourcePatchTool().applySourcePatch(request);
        expect(outcome).toMatchObject({
          ok: false,
          error: {
            code: "A005",
            file: lockName,
            owner: null,
            ownerState: "unknown",
          },
          failureClass: "expected",
        });
        expect(JSON.stringify(outcome)).toContain("held or abandoned");
        expect(await readFile(lockPath, "utf8")).toBe(contents);
        await unlink(lockPath);
        expect(
          (await createInternalApplySourcePatchTool().applySourcePatch(request))
            .ok,
        ).toBe(true);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("excludes the reservation from explicit source globs and stage copies", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const manifestPath = join(fixture.projectRoot, "system.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.sources = [`{sources/*.json,${lockName}}`];
      await writeFile(manifestPath, JSON.stringify(manifest));
      const loaded = await loadProject(fixture.projectRoot);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded));
      const reservation = reserveProjectWrite(loaded.project);
      if (!reservation.ok) throw new Error(JSON.stringify(reservation));
      try {
        const during = await loadProject(fixture.projectRoot);
        expect(
          during.ok && during.project.sources.map((source) => source.file),
        ).toEqual(["sources/a.json", "sources/b.json"]);
        expect((await compileProject(fixture.projectRoot)).ok).toBe(true);
        // Dry-run must also stage successfully while another writer holds it.
        expect(
          (
            await createInternalApplySourcePatchTool().applySourcePatch({
              ...(await requestFor(fixture.projectRoot)),
              dryRun: true,
            })
          ).ok,
        ).toBe(true);
      } finally {
        reservation.release();
      }
      expect(await readdir(fixture.projectRoot)).not.toContain(lockName);
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores a reservation released between tree enumeration and lstat", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const lockPath = join(fixture.projectRoot, lockName);
      await writeFile(lockPath, "");
      expect(
        await scanOrdinaryProjectTree(fixture.projectRoot, {
          ...defaultPatchFilesystemDependencies,
          async readdir(path) {
            const names =
              await defaultPatchFilesystemDependencies.readdir(path);
            if (path === fixture.projectRoot) await unlink(lockPath);
            return names;
          },
        }),
      ).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses rollback through a swapped ancestor and preserves the outside sentinel", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const request = await requestFor(fixture.projectRoot, [
        "sources/a.json",
        "sources/b.json",
      ]);
      const outside = join(fixture.root, "outside");
      await mkdir(outside);
      const sentinel = join(outside, "a.json");
      await writeFile(sentinel, "OUTSIDE SENTINEL\n");
      let injected = false;
      const outcome = await createInternalApplySourcePatchTool(
        {},
        {
          ...defaultApplySourcePatchDependencies,
          async writeFileAtomically(path, bytes) {
            await defaultApplySourcePatchDependencies.writeFileAtomically(
              path,
              bytes,
            );
            if (!injected) {
              injected = true;
              await rename(
                join(fixture.projectRoot, "sources"),
                join(fixture.projectRoot, "saved"),
              );
              await symlink(
                outside,
                join(fixture.projectRoot, "sources"),
                process.platform === "win32" ? "junction" : "dir",
              );
            }
          },
        },
      ).applySourcePatch(request);
      expect(injected).toBe(true);
      expect(outcome).toMatchObject({
        ok: false,
        error: { code: "A003" },
        failureClass: "tool",
      });
      expect(await readFile(sentinel, "utf8")).toBe("OUTSIDE SENTINEL\n");
      expect(JSON.stringify(outcome.diagnostics)).toContain("not restored");
      expect(await readdir(fixture.projectRoot)).not.toContain(lockName);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(ROLLBACK_CHANGES)(
    "continues safe restores and reports the exact partial rollback after %s changes",
    async (change) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        const arranged = await arrangePartialRollback(fixture, change);
        const { original, paths, outside } = arranged;
        const outcome = await createInternalApplySourcePatchTool(
          {},
          arranged.dependencies,
        ).applySourcePatch(arranged.request);
        expect(outcome).toMatchObject({
          ok: false,
          diagnostics: [
            {
              message:
                "Agent apply-source-patch tool failure (commit-write/E_COMMIT).",
            },
            {
              message:
                "Agent apply-source-patch tool failure (rollback-write/PATCH_WRITE_GUARD_MISMATCH).",
            },
            {
              message: `Source patch rollback restored ["b/b.json"]; not restored [{"file":"a/a.json","reason":"${change === "content" ? "content changed" : "chain changed"}"}]. Only successfully replaced files were candidates for restoration.`,
            },
          ],
        });
        expect(arranged.restoredWhileLocked()).toBe(true);
        expect(await readFile(join(outside, "a.json"), "utf8")).toBe(
          "SENTINEL",
        );
        if (change !== "ancestor") {
          expect(
            JSON.parse(
              await readFile(join(fixture.projectRoot, paths[0]!), "utf8"),
            ).$schema,
          ).toBe("external edit");
        }
        expect(await readFile(join(fixture.projectRoot, paths[1]!))).toEqual(
          original,
        );
        expect(await readFile(join(fixture.projectRoot, paths[2]!))).toEqual(
          original,
        );
        expect(await readdir(fixture.projectRoot)).not.toContain(lockName);
      } finally {
        await fixture.cleanup();
      }
    },
  );
});
