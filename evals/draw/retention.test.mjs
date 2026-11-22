import { expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { retainPacket, retainingCase } from "./retention.mjs";
it("a case exception retains every delivered SVG and losslessly compacts audit artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "draw-retention-"));
  try {
    const packet = {
      html: "duplicate",
      sheets: [
        { number: 1, svg: "<svg>one</svg>" },
        { number: 2, svg: "<svg>later</svg>" },
      ],
    };
    await expect(
      retainingCase(root, false, async () => {
        await retainPacket(root, packet);
        await writeFile(join(root, "packet.html"), "exact delivered HTML\n");
        await writeFile(join(root, "ir.json"), '{\n  "wires": []\n}\n');
        throw Error("synthetic measurement exception");
      }),
    ).rejects.toThrow("synthetic measurement exception");
    expect(await readFile(join(root, "sheet-002.svg"), "utf8")).toBe(
      packet.sheets[1].svg,
    );
    expect(await readFile(join(root, "packet.json"), "utf8")).toBe(
      '{"sheets":[{"number":1},{"number":2}]}\n',
    );
    expect(
      gunzipSync(await readFile(join(root, "packet.html.gz"))).toString(),
    ).toBe("exact delivered HTML\n");
    await expect(readFile(join(root, "packet.html"))).rejects.toThrow();
    expect(await readFile(join(root, "ir.json"), "utf8")).toBe(
      '{"wires":[]}\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { temporaryProject: true, artifacts: false, retained: false },
  { temporaryProject: true, artifacts: true, retained: true },
  { temporaryProject: false, artifacts: false, retained: true },
])(
  "retains the prepared project only when requested or needed (%j)",
  async ({ temporaryProject, artifacts, retained }) => {
    const root = await mkdtemp(join(tmpdir(), "draw-prepared-project-"));
    try {
      const presentation = join(root, "project", "presentation.json");
      await retainingCase(
        root,
        artifacts,
        async () => {
          await mkdir(join(root, "project"));
          await writeFile(presentation, "{}\n");
          await writeFile(join(root, "request.json"), "{}\n");
        },
        { temporaryProject },
      );
      if (retained) expect(await readFile(presentation, "utf8")).toBe("{}\n");
      else
        await expect(readFile(presentation)).rejects.toMatchObject({
          code: "ENOENT",
        });
      expect(await readFile(join(root, "request.json"), "utf8")).toBe("{}\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
