import { expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import {
  archiveCaseFiles,
  CASE_FILES_FILENAME,
  readCheckpointCaseFiles,
} from "./case-files.mjs";
import { outputCost } from "./output.mjs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal();
  return { ...fs, open: vi.fn(fs.open) };
});
vi.mock("node:zlib", async (importOriginal) => {
  const zlib = await importOriginal();
  return { ...zlib, zstdDecompressSync: vi.fn(zlib.zstdDecompressSync) };
});

it("archives exact case bytes, keeps media loose and counts the stored archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "draw-case-files-"));
  try {
    const id = "case-one",
      dir = join(root, id),
      packet = Buffer.from('\uFEFF{\r\n  "name": "λ"\r\n}\r\n'),
      svg = Buffer.from("<svg/>"),
      refusal = Buffer.from('{"error":{"code":"R006"}}\n');
    await mkdir(dir);
    await mkdir(join(root, "case-refused"));
    await writeFile(join(dir, "packet.json"), packet);
    await writeFile(join(dir, "sheet-001.svg"), svg);
    await writeFile(join(root, "case-refused", "cli.log"), refusal);
    const readLoose = await readCheckpointCaseFiles(root);
    expect(await readLoose(id, "packet.json")).toEqual(packet);

    await archiveCaseFiles(root);
    const archive = await readFile(join(root, CASE_FILES_FILENAME));
    const read = await readCheckpointCaseFiles(root);
    expect(await read(id, "packet.json")).toEqual(packet);
    expect(await read(id, "sheet-001.svg")).toEqual(svg);
    expect(await read("case-refused", "cli.log")).toEqual(refusal);
    await expect(read("case-refused", "packet.json")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(dir, "packet.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const cost = await outputCost(root);
    expect(cost.outputBytes).toBe(
      archive.length +
        svg.length +
        (await readFile(join(root, "cost.json"))).length,
    );

    const archivePath = join(root, CASE_FILES_FILENAME);
    await writeFile(archivePath, archive.subarray(0, archive.length / 2));
    await expect(readCheckpointCaseFiles(root)).rejects.toThrow();
    archive[archive.length - 1] ^= 1;
    await writeFile(archivePath, archive);
    await expect(readCheckpointCaseFiles(root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  [
    "compression",
    () => vi.mocked(zstdDecompressSync).mockReturnValueOnce(Buffer.from("{}")),
  ],
  [
    "read-back",
    async () => {
      const fs = await vi.importActual("node:fs/promises");
      vi.mocked(open).mockImplementationOnce(async (...args) => {
        const file = await fs.open(...args);
        return {
          writeFile: (bytes) => file.writeFile(bytes.subarray(0, -1)),
          close: () => file.close(),
        };
      });
    },
  ],
])("retains loose evidence when %s verification fails", async (stage, fail) => {
  const root = await mkdtemp(join(tmpdir(), "draw-case-files-"));
  try {
    const id = "case-one";
    const packet = Buffer.from('{"name":"test"}\n');
    await mkdir(join(root, id));
    await writeFile(join(root, id, "packet.json"), packet);
    await fail();

    await expect(archiveCaseFiles(root)).rejects.toThrow(
      `Case file archive failed ${stage} verification`,
    );
    await expect(
      readFile(join(root, CASE_FILES_FILENAME)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const read = await readCheckpointCaseFiles(root);
    expect(await read(id, "packet.json")).toEqual(packet);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
