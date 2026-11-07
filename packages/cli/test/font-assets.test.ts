import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("resolves source and built font assets from an encoded package path", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "thermite fonts-"));
  try {
    for (const name of ["cli", "render"]) {
      const target = join(root, "node_modules/@thermite", name);
      await mkdir(target, { recursive: true });
      for (const file of ["package.json", "dist", "src", "assets"])
        await cp(join("packages", name, file), join(target, file), {
          recursive: true,
        });
    }
    for (const entry of ["src/font-assets.ts", "dist/font-assets.js"]) {
      const { bundledFontUrl } = await import(
        /* @vite-ignore */ join(root, "node_modules/@thermite/cli", entry)
      );
      for (const name of [
        "NotoSans-Regular",
        "NotoSans-Bold",
        "NotoSansMath-Regular",
        "NotoSansMono-Regular",
      ]) {
        const owner = name === "NotoSansMono-Regular" ? "cli" : "render";
        expect(bundledFontUrl(name).href).toBe(
          pathToFileURL(
            join(
              root,
              "node_modules/@thermite",
              owner,
              "assets/fonts",
              `${name}.ttf`,
            ),
          ).href,
        );
        expect(await readFile(bundledFontUrl(name))).toEqual(
          await readFile(
            join("packages", owner, "assets/fonts", `${name}.ttf`),
          ),
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
