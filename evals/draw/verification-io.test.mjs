import { expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeVerification, readVerification } from "./verification-io.mjs";
import { pngFixture } from "./png-fixture.mjs";
import { hash } from "./support.mjs";
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "thermite-verification-"));
  const samples = join(root, "evals/out/draw-samples"),
    bytes = pngFixture(),
    sha = hash(bytes);
  await mkdir(samples, { recursive: true });
  const file = {
    entries: [
      {
        crop: {},
        sourceVerification: {
          attempts: [1, 2].map(() => ({ referenceSha256: sha })),
        },
      },
    ],
  };
  try {
    await run({ root, samples, bytes, sha, file });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it("writes hash-named PNGs once and reads a deduplicated map", () =>
  fixture(async ({ root, bytes, sha, file, samples }) => {
    await writeVerification(root, new Map([[sha, bytes]]));
    await writeVerification(root, new Map([[sha, bytes]]));
    expect(await readVerification(root, file)).toEqual(new Map([[sha, bytes]]));
    expect(await readFile(join(samples, `verification/${sha}.png`))).toEqual(
      bytes,
    );
  }));
it("refuses a writer hash that differs from its PNG", () =>
  fixture(async ({ root, sha }) => {
    await expect(
      writeVerification(root, new Map([[sha, pngFixture({ seed: 10 })]])),
    ).rejects.toThrow(/hash differs/);
  }));
it("refuses changed existing PNGs on both write and read", () =>
  fixture(async ({ root, bytes, sha, file, samples }) => {
    await writeVerification(root, new Map([[sha, bytes]]));
    await writeFile(
      join(samples, `verification/${sha}.png`),
      pngFixture({ seed: 10 }),
    );
    await expect(
      writeVerification(root, new Map([[sha, bytes]])),
    ).rejects.toThrow(/Existing verification PNG hash differs/);
    await expect(readVerification(root, file)).rejects.toThrow(
      /Verification PNG hash mismatch/,
    );
  }));
it("refuses missing references and traversal hashes", () =>
  fixture(async ({ root, file }) => {
    await expect(readVerification(root, file)).rejects.toThrow(/ENOENT/);
    file.entries[0].sourceVerification.attempts[0].referenceSha256 =
      "../../escape";
    await expect(readVerification(root, file)).rejects.toThrow(
      /Invalid verification PNG hash/,
    );
  }));
it("refuses an escaped verification directory", () =>
  fixture(async ({ root, bytes, sha, file, samples }) => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, `${sha}.png`), bytes);
    await symlink(outside, join(samples, "verification"), "junction");
    await expect(
      writeVerification(root, new Map([[sha, bytes]])),
    ).rejects.toThrow(/stay under/);
    await expect(readVerification(root, file)).rejects.toThrow(/stay under/);
  }));
it("refuses a sample root outside the workspace", () =>
  fixture(async ({ root, bytes, sha, file, samples }) => {
    const outside = await mkdtemp(
      join(tmpdir(), "thermite-reference-outside-"),
    );
    try {
      await mkdir(join(outside, "verification"));
      await writeFile(join(outside, `verification/${sha}.png`), bytes);
      await rm(samples, { recursive: true });
      await symlink(outside, samples, "junction");
      await expect(
        writeVerification(root, new Map([[sha, bytes]])),
      ).rejects.toThrow(/stay under/);
      await expect(readVerification(root, file)).rejects.toThrow(/stay under/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }));
