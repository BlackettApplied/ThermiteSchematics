import { mkdir, readFile, readdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_WRITE_LOCK_FILE_NAME } from "@thermite/compiler";
import { describe, expect, it } from "vitest";
import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import {
  scanOrdinaryProjectTree,
  copyOrdinaryProjectTree,
  defaultPatchFilesystemDependencies,
} from "../src/patch-filesystem.js";
import { createPatchProjectFixture } from "./patch-project-fixture.js";
import {
  HOST_HANDLER_MODES,
  POSIX_SIGNALS_UNAVAILABLE,
  requestFor,
  runEmbeddedWriter,
} from "./patch-write-chain-changes.cases.js";
import { withFailingRelease } from "./patch-write-recovery.cases.js";

describe("patch write chain changes and leftover reservations", () => {
  it.skipIf(POSIX_SIGNALS_UNAVAILABLE).each(HOST_HANDLER_MODES)(
    "respects a host SIGINT handler registered %s reservation acquisition",
    async (mode) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        const original = await readFile(
          join(fixture.projectRoot, "sources/a.json"),
        );
        const { hostCalls, heldDuringWrite, outcome } = await runEmbeddedWriter(
          fixture,
          mode,
        );
        expect(hostCalls).toBe(1);
        expect(heldDuringWrite).toBe(mode !== "after");
        expect(outcome.ok).toBe(mode === "before");
        if (mode !== "before") {
          expect(outcome).toMatchObject({ failureClass: "tool" });
          expect(JSON.stringify(outcome)).toContain("PATCH_LOCK_REVOKED");
        }
        if (mode === "after") {
          expect(
            await readFile(join(fixture.projectRoot, "sources/a.json")),
          ).toEqual(original);
        }
        if (mode === "after-write") {
          expect(
            JSON.parse(
              await readFile(
                join(fixture.projectRoot, "sources/a.json"),
                "utf8",
              ),
            ).$schema,
          ).toBe("round3");
          expect(JSON.stringify(outcome.diagnostics)).toContain("not restored");
        }
        expect(await readdir(fixture.projectRoot)).not.toContain(
          PROJECT_WRITE_LOCK_FILE_NAME,
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("classifies a source directory renamed after the precommit snapshot as A003", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const original = await readFile(
        join(fixture.projectRoot, "sources/a.json"),
      );
      let scans = 0;
      const outcome = await createInternalApplySourcePatchTool(
        {},
        {
          ...defaultApplySourcePatchDependencies,
          async scanProjectTree(root) {
            const result = await scanOrdinaryProjectTree(root);
            if (++scans === 2)
              await rename(join(root, "sources"), join(root, "moved"));
            return result;
          },
        },
      ).applySourcePatch(await requestFor(fixture.projectRoot));
      expect(outcome).toMatchObject({
        ok: false,
        failureClass: "expected",
        error: { code: "A003" },
      });
      expect(await readFile(join(fixture.projectRoot, "moved/a.json"))).toEqual(
        original,
      );
      expect(await readdir(fixture.projectRoot)).not.toContain(
        PROJECT_WRITE_LOCK_FILE_NAME,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["ENOENT", "ENOTDIR", "ELOOP"])(
    "classifies %s after replacement as a changed rollback chain",
    async (code) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        let replaced = false;
        const outcome = await createInternalApplySourcePatchTool(
          {},
          {
            ...defaultApplySourcePatchDependencies,
            async writeFileAtomically(path, bytes, options) {
              await defaultApplySourcePatchDependencies.writeFileAtomically(
                path,
                bytes,
                options,
              );
              replaced = true;
            },
            filesystem: {
              ...defaultPatchFilesystemDependencies,
              async lstat(path) {
                if (replaced && path === join(fixture.projectRoot, "sources"))
                  throw Object.assign(new Error("injected"), { code });
                return defaultPatchFilesystemDependencies.lstat(path);
              },
            },
          },
        ).applySourcePatch(
          await requestFor(fixture.projectRoot, [
            "sources/a.json",
            "sources/b.json",
          ]),
        );
        expect(outcome).toMatchObject({
          ok: false,
          failureClass: "tool",
          error: { code: "A003" },
        });
        expect(JSON.stringify(outcome.diagnostics)).toContain("chain changed");
        expect(JSON.stringify(outcome.diagnostics)).not.toContain(
          `I/O (${code})`,
        );
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each(["directory", "symlink"])(
    "inspects a temporary-looking %s instead of hiding it",
    async (kind) => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        const candidate = join(
          fixture.projectRoot,
          "sources/.a.json.123.4.tmp",
        );
        const outside = join(fixture.root, "outside");
        await mkdir(outside);
        if (kind === "symlink") {
          await symlink(
            outside,
            candidate,
            process.platform === "win32" ? "junction" : "dir",
          );
        } else {
          await mkdir(candidate);
          await symlink(
            outside,
            join(candidate, "escape"),
            process.platform === "win32" ? "junction" : "dir",
          );
        }
        expect(await scanOrdinaryProjectTree(fixture.projectRoot)).toBe(
          `sources/.a.json.123.4.tmp${kind === "directory" ? "/escape" : ""}`,
        );
        const stage = join(fixture.root, "stage");
        await mkdir(stage);
        await expect(
          copyOrdinaryProjectTree(fixture.projectRoot, stage),
        ).rejects.toThrow("reparse point");
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("names the leftover reservation when both apply and release fail", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const outcome = await createInternalApplySourcePatchTool(
        {},
        {
          ...withFailingRelease(defaultApplySourcePatchDependencies),
          async writeFileAtomically() {
            throw Object.assign(new Error("injected"), { code: "EIO" });
          },
        },
      ).applySourcePatch(await requestFor(fixture.projectRoot));
      expect(outcome).toMatchObject({ ok: false, failureClass: "tool" });
      const message = outcome.diagnostics.find((diagnostic) =>
        diagnostic.message.includes("write-release/EACCES"),
      )?.message;
      expect(message).toContain(
        JSON.stringify(join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME)),
      );
      expect(message).toContain("once this command has exited");
      expect(message).toContain("no other writer is running");
    } finally {
      await fixture.cleanup();
    }
  });
});
